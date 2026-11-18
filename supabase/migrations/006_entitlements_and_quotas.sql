-- MIG-07: Three-layer entitlement control (modules, features/limits, quota reservations, and idempotent usage events)
-- Additive & non-destructive.

CREATE TABLE IF NOT EXISTS tenant_modules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  package_code TEXT NOT NULL,
  modules TEXT[] NOT NULL,
  lifecycle_state TEXT NOT NULL CHECK (lifecycle_state IN ('trial', 'active', 'grace', 'suspended', 'cancelled')),
  ends_at TIMESTAMPTZ,
  grace_days INTEGER NOT NULL DEFAULT 7,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id)
);

CREATE TABLE IF NOT EXISTS tenant_features_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  features JSONB NOT NULL DEFAULT '{}'::JSONB,
  quotas JSONB NOT NULL DEFAULT '{}'::JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id)
);

CREATE TABLE IF NOT EXISTS usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  module TEXT NOT NULL CHECK (module IN ('hr', 'wms', 'tms')),
  resource TEXT NOT NULL,
  event_id TEXT NOT NULL,
  delta INTEGER NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, module, resource, event_id)
);

CREATE INDEX IF NOT EXISTS idx_usage_events_tenant_resource
  ON usage_events (tenant_id, module, resource, recorded_at DESC);

CREATE TABLE IF NOT EXISTS quota_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  module TEXT NOT NULL CHECK (module IN ('hr', 'wms', 'tms')),
  resource TEXT NOT NULL,
  event_id TEXT NOT NULL,
  delta INTEGER NOT NULL CHECK (delta > 0),
  status TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'committed', 'released')),
  quota_mode TEXT NOT NULL DEFAULT 'concurrent_resource' CHECK (quota_mode IN ('concurrent_resource', 'cumulative_usage')),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '15 minutes'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, module, resource, event_id)
);

CREATE INDEX IF NOT EXISTS idx_quota_reservations_active
  ON quota_reservations (tenant_id, module, resource, status, expires_at);

DROP FUNCTION IF EXISTS reserve_tenant_quota(TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, INTEGER, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS reserve_tenant_quota(TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, INTEGER, TIMESTAMPTZ, TEXT);

CREATE OR REPLACE FUNCTION reserve_tenant_quota(
  p_tenant_id TEXT,
  p_module TEXT,
  p_resource TEXT,
  p_event_id TEXT,
  p_delta INTEGER,
  p_limit INTEGER,
  p_base_count INTEGER,
  p_now TIMESTAMPTZ DEFAULT NOW(),
  p_quota_mode TEXT DEFAULT 'concurrent_resource'
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing_status TEXT;
  v_in_flight_reserved INTEGER := 0;
  v_db_count INTEGER := 0;
  v_tmp_count INTEGER := 0;
  v_delta INTEGER := COALESCE(p_delta, 1);
  v_base INTEGER := GREATEST(0, COALESCE(p_base_count, 0));
  v_now TIMESTAMPTZ := COALESCE(p_now, NOW());
  v_mode TEXT := COALESCE(NULLIF(trim(p_quota_mode), ''), 'concurrent_resource');
  v_has_org_id BOOLEAN := FALSE;
BEGIN
  IF p_tenant_id IS NULL OR length(trim(p_tenant_id)) = 0 THEN
    RAISE EXCEPTION 'tenant_id is required';
  END IF;
  IF p_module NOT IN ('hr', 'wms', 'tms') THEN
    RAISE EXCEPTION 'invalid module: %', p_module;
  END IF;
  IF p_resource IS NULL OR length(trim(p_resource)) = 0 THEN
    RAISE EXCEPTION 'resource is required';
  END IF;
  IF p_event_id IS NULL OR length(trim(p_event_id)) = 0 THEN
    RAISE EXCEPTION 'event_id is required';
  END IF;
  IF v_delta <= 0 THEN
    RAISE EXCEPTION 'delta must be positive';
  END IF;
  IF v_mode NOT IN ('concurrent_resource', 'cumulative_usage') THEN
    RAISE EXCEPTION 'invalid quota_mode: %', v_mode;
  END IF;

  -- Serialize concurrent quota reservations across all processes/instances for (tenant, module, resource)
  PERFORM pg_advisory_xact_lock(hashtext(p_tenant_id || ':' || p_module || ':' || p_resource));

  -- Expire stale reserved slots before computing active usage
  UPDATE quota_reservations
  SET status = 'released',
      updated_at = v_now
  WHERE tenant_id = p_tenant_id
    AND module = p_module
    AND resource = p_resource
    AND status = 'reserved'
    AND expires_at <= v_now;

  -- Idempotent retry check for active/committed event_id
  SELECT status INTO v_existing_status
  FROM quota_reservations
  WHERE tenant_id = p_tenant_id
    AND module = p_module
    AND resource = p_resource
    AND event_id = p_event_id;

  IF v_mode = 'concurrent_resource' THEN
    SELECT COALESCE(SUM(delta), 0)::INTEGER INTO v_in_flight_reserved
    FROM quota_reservations
    WHERE tenant_id = p_tenant_id
      AND module = p_module
      AND resource = p_resource
      AND status = 'reserved';

    IF p_module = 'wms' AND p_resource = 'users' AND to_regclass('public.app_users') IS NOT NULL THEN
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'app_users' AND column_name = 'org_id'
      ) INTO v_has_org_id;
      IF v_has_org_id THEN
        EXECUTE 'SELECT COUNT(*)::INTEGER FROM app_users WHERE org_id = $1' INTO v_db_count USING p_tenant_id;
        IF to_regclass('public.org_memberships') IS NOT NULL THEN
          EXECUTE 'SELECT COUNT(*)::INTEGER FROM org_memberships WHERE org_id = $1' INTO v_tmp_count USING p_tenant_id;
          v_db_count := v_db_count + COALESCE(v_tmp_count, 0);
        END IF;
      END IF;
    ELSIF p_module = 'wms' AND p_resource = 'branches' AND to_regclass('public.branches') IS NOT NULL THEN
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'branches' AND column_name = 'org_id'
      ) INTO v_has_org_id;
      IF v_has_org_id THEN
        EXECUTE 'SELECT COUNT(*)::INTEGER FROM branches WHERE org_id = $1 AND COALESCE(status, ''ACTIVE'') <> ''INACTIVE'''
          INTO v_db_count USING p_tenant_id;
      END IF;
    ELSIF p_module = 'wms' AND p_resource = 'products' AND to_regclass('public.products') IS NOT NULL THEN
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'org_id'
      ) INTO v_has_org_id;
      IF v_has_org_id THEN
        EXECUTE 'SELECT COUNT(*)::INTEGER FROM products WHERE org_id = $1' INTO v_db_count USING p_tenant_id;
      END IF;
    END IF;

    v_base := GREATEST(v_base, COALESCE(v_db_count, 0));
  ELSE
    SELECT COALESCE(SUM(delta), 0)::INTEGER INTO v_in_flight_reserved
    FROM quota_reservations
    WHERE tenant_id = p_tenant_id
      AND module = p_module
      AND resource = p_resource
      AND status IN ('reserved', 'committed');
  END IF;

  IF v_existing_status IN ('reserved', 'committed') THEN
    RETURN jsonb_build_object(
      'allowed', TRUE,
      'deduplicated', TRUE,
      'reserved', v_in_flight_reserved,
      'base_count', v_base,
      'quota_mode', v_mode,
      'limit', p_limit
    );
  END IF;

  IF p_limit IS NOT NULL AND p_limit >= 0 AND (v_base + v_in_flight_reserved + v_delta > p_limit) THEN
    RETURN jsonb_build_object(
      'allowed', FALSE,
      'code', 'QUOTA_EXCEEDED',
      'reserved', v_in_flight_reserved,
      'base_count', v_base,
      'quota_mode', v_mode,
      'limit', p_limit
    );
  END IF;

  INSERT INTO quota_reservations (
    tenant_id,
    module,
    resource,
    event_id,
    delta,
    status,
    quota_mode,
    expires_at,
    created_at,
    updated_at
  ) VALUES (
    p_tenant_id,
    p_module,
    p_resource,
    p_event_id,
    v_delta,
    'reserved',
    v_mode,
    v_now + INTERVAL '15 minutes',
    v_now,
    v_now
  )
  ON CONFLICT (tenant_id, module, resource, event_id) DO UPDATE
    SET delta = EXCLUDED.delta,
        status = 'reserved',
        quota_mode = EXCLUDED.quota_mode,
        expires_at = EXCLUDED.expires_at,
        updated_at = v_now;

  INSERT INTO usage_events (
    tenant_id,
    module,
    resource,
    event_id,
    delta,
    recorded_at
  ) VALUES (
    p_tenant_id,
    p_module,
    p_resource,
    p_event_id,
    v_delta,
    v_now
  )
  ON CONFLICT (tenant_id, module, resource, event_id) DO NOTHING;

  RETURN jsonb_build_object(
    'allowed', TRUE,
    'deduplicated', FALSE,
    'reserved', v_in_flight_reserved + v_delta,
    'base_count', v_base,
    'quota_mode', v_mode,
    'limit', p_limit
  );
END;
$$;

CREATE OR REPLACE FUNCTION release_tenant_quota(
  p_tenant_id TEXT,
  p_module TEXT,
  p_resource TEXT,
  p_event_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_updated INTEGER := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_tenant_id || ':' || p_module || ':' || p_resource));

  UPDATE quota_reservations
  SET status = 'released',
      updated_at = NOW()
  WHERE tenant_id = p_tenant_id
    AND module = p_module
    AND resource = p_resource
    AND event_id = p_event_id
    AND status = 'reserved';

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN jsonb_build_object('released', v_updated > 0);
END;
$$;

CREATE OR REPLACE FUNCTION commit_tenant_quota(
  p_tenant_id TEXT,
  p_module TEXT,
  p_resource TEXT,
  p_event_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_updated INTEGER := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_tenant_id || ':' || p_module || ':' || p_resource));

  UPDATE quota_reservations
  SET status = 'committed',
      updated_at = NOW()
  WHERE tenant_id = p_tenant_id
    AND module = p_module
    AND resource = p_resource
    AND event_id = p_event_id
    AND status = 'reserved';

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN jsonb_build_object('committed', v_updated > 0);
END;
$$;
