-- HR database ONLY. Requires existing HR schema through schema-phase21.sql.
-- Bundled migrations 006-010 for Nexus TMS dual-duty payroll.
-- Run the entire file in Supabase SQL Editor. All changes are one transaction.
BEGIN;


-- SOURCE: supabase/migrations/006_entitlements_and_quotas.sql
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


-- SOURCE: supabase/migrations/007_integration_links_outbox_inbox.sql
-- MIG-08: Cross-system entity links, driver-employee links, durable outbox/inbox, and atomic worker claim RPC
-- Additive & non-destructive.

CREATE TABLE IF NOT EXISTS driver_employee_links (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  connection_id TEXT NOT NULL DEFAULT 'default',
  tms_driver_id TEXT NOT NULL,
  hr_employee_id TEXT NOT NULL,
  employment_type TEXT NOT NULL DEFAULT 'internal' CHECK (employment_type IN ('internal', 'subcontractor', 'employee')),
  employment_classification TEXT NOT NULL DEFAULT 'employee' CHECK (employment_classification IN ('employee', 'internal', 'subcontractor')),
  effective_from DATE,
  effective_to DATE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  verified_by TEXT NOT NULL,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  UNIQUE (tenant_id, connection_id, tms_driver_id),
  UNIQUE (tenant_id, connection_id, hr_employee_id)
);

CREATE TABLE IF NOT EXISTS external_entity_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  source_system TEXT NOT NULL,
  source_entity_type TEXT NOT NULL,
  source_entity_id TEXT NOT NULL,
  target_system TEXT NOT NULL,
  target_entity_type TEXT NOT NULL,
  target_entity_id TEXT NOT NULL,
  drop_index INTEGER NOT NULL DEFAULT 1,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, connection_id, source_entity_type, source_entity_id, drop_index)
);

CREATE TABLE IF NOT EXISTS integration_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  aggregate_version BIGINT NOT NULL DEFAULT 1,
  event_type TEXT NOT NULL,
  schema_version TEXT NOT NULL DEFAULT '2.0.0',
  payload JSONB NOT NULL,
  payload_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'delivered', 'failed_permanent', 'dead_letter')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at TIMESTAMPTZ,
  UNIQUE (connection_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_integration_outbox_claim
  ON integration_outbox (status, next_attempt_at, lease_expires_at);

CREATE INDEX IF NOT EXISTS idx_integration_outbox_tenant
  ON integration_outbox (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS integration_inbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  aggregate_version BIGINT NOT NULL DEFAULT 1,
  event_type TEXT NOT NULL,
  schema_version TEXT NOT NULL DEFAULT '2.0.0',
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  payload_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('processing', 'applied', 'rejected_stale_version', 'failed')),
  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  effect_applied_at TIMESTAMPTZ,
  result_json JSONB,
  last_error TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  applied_at TIMESTAMPTZ,
  UNIQUE (connection_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_integration_inbox_agg
  ON integration_inbox (connection_id, aggregate_id, status, aggregate_version DESC);

CREATE INDEX IF NOT EXISTS idx_integration_inbox_lease
  ON integration_inbox (status, lease_expires_at);

CREATE TABLE IF NOT EXISTS integration_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  outbox_id UUID NOT NULL REFERENCES integration_outbox(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL,
  attempt_number INTEGER NOT NULL,
  http_status INTEGER,
  error_summary TEXT,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION claim_integration_outbox_batch(
  p_worker_id TEXT,
  p_lease_ms INTEGER DEFAULT 30000,
  p_limit INTEGER DEFAULT 20,
  p_now TIMESTAMPTZ DEFAULT NOW()
)
RETURNS SETOF integration_outbox
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now TIMESTAMPTZ := COALESCE(p_now, NOW());
BEGIN
  IF p_worker_id IS NULL OR length(trim(p_worker_id)) = 0 THEN
    RAISE EXCEPTION 'worker_id is required to claim outbox batch';
  END IF;

  RETURN QUERY
  WITH due AS (
    SELECT o.id
    FROM integration_outbox o
    WHERE (o.status = 'pending' AND o.next_attempt_at <= v_now)
       OR (o.status = 'processing' AND o.lease_expires_at IS NOT NULL AND o.lease_expires_at <= v_now)
    ORDER BY o.next_attempt_at ASC, o.created_at ASC
    LIMIT GREATEST(1, COALESCE(p_limit, 20))
    FOR UPDATE SKIP LOCKED
  )
  UPDATE integration_outbox AS target
  SET status = 'processing',
      lease_owner = trim(p_worker_id),
      lease_expires_at = v_now + (GREATEST(100, COALESCE(p_lease_ms, 30000))::TEXT || ' milliseconds')::INTERVAL
  FROM due
  WHERE target.id = due.id
  RETURNING target.*;
END;
$$;

CREATE OR REPLACE FUNCTION claim_integration_inbox_event(
  p_connection_id TEXT,
  p_tenant_id TEXT,
  p_event_id TEXT,
  p_aggregate_id TEXT,
  p_aggregate_version BIGINT DEFAULT 1,
  p_event_type TEXT DEFAULT 'integration.event',
  p_schema_version TEXT DEFAULT '2.0.0',
  p_payload JSONB DEFAULT '{}'::JSONB,
  p_payload_hash TEXT DEFAULT '',
  p_worker_id TEXT DEFAULT 'inbox-worker',
  p_lease_ms INTEGER DEFAULT 30000,
  p_external_last_version BIGINT DEFAULT 0,
  p_now TIMESTAMPTZ DEFAULT NOW()
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now TIMESTAMPTZ := COALESCE(p_now, NOW());
  v_lease_ms INTEGER := GREATEST(100, COALESCE(p_lease_ms, 30000));
  v_lease_expires TIMESTAMPTZ := v_now + (v_lease_ms::TEXT || ' milliseconds')::INTERVAL;
  v_worker TEXT := COALESCE(NULLIF(trim(p_worker_id), ''), 'inbox-worker');
  v_incoming_version BIGINT := GREATEST(1, COALESCE(p_aggregate_version, 1));
  v_existing integration_inbox%ROWTYPE;
  v_other_active_id UUID;
  v_other_active_expires TIMESTAMPTZ;
  v_stored_last_version BIGINT := 0;
  v_last_version BIGINT := 0;
  v_id UUID;
  v_attempt_count INTEGER := 0;
BEGIN
  IF p_connection_id IS NULL OR length(trim(p_connection_id)) = 0
     OR p_tenant_id IS NULL OR length(trim(p_tenant_id)) = 0
     OR p_event_id IS NULL OR length(trim(p_event_id)) = 0
     OR p_aggregate_id IS NULL OR length(trim(p_aggregate_id)) = 0 THEN
    RETURN jsonb_build_object('outcome', 'invalid_event', 'http_status', 400);
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('inbox_agg:' || p_connection_id || ':' || p_aggregate_id));
  PERFORM pg_advisory_xact_lock(hashtext('inbox_evt:' || p_connection_id || ':' || p_event_id));

  SELECT * INTO v_existing
  FROM integration_inbox
  WHERE connection_id = p_connection_id
    AND event_id = p_event_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.payload_hash <> p_payload_hash THEN
      RETURN jsonb_build_object(
        'outcome', 'conflict_payload_mismatch',
        'http_status', 409,
        'inbox_id', v_existing.id
      );
    END IF;

    IF v_existing.status IN ('applied', 'rejected_stale_version') THEN
      RETURN jsonb_build_object(
        'outcome', 'duplicate_ignored',
        'http_status', 200,
        'prior_status', v_existing.status,
        'inbox_id', v_existing.id,
        'result_json', v_existing.result_json
      );
    END IF;

    IF v_existing.effect_applied_at IS NOT NULL THEN
      UPDATE integration_inbox
      SET status = 'applied',
          applied_at = COALESCE(applied_at, v_now),
          lease_owner = NULL,
          lease_expires_at = NULL,
          last_error = NULL
      WHERE id = v_existing.id;

      RETURN jsonb_build_object(
        'outcome', 'recovered_already_applied',
        'http_status', 200,
        'prior_status', 'applied',
        'inbox_id', v_existing.id,
        'result_json', v_existing.result_json
      );
    END IF;

    IF v_existing.status = 'processing'
       AND v_existing.lease_expires_at IS NOT NULL
       AND v_existing.lease_expires_at > v_now THEN
      RETURN jsonb_build_object(
        'outcome', 'in_progress_retry_later',
        'http_status', 409,
        'prior_status', 'processing',
        'inbox_id', v_existing.id,
        'lease_expires_at', v_existing.lease_expires_at
      );
    END IF;

    SELECT id, lease_expires_at INTO v_other_active_id, v_other_active_expires
    FROM integration_inbox
    WHERE connection_id = p_connection_id
      AND aggregate_id = p_aggregate_id
      AND event_id <> p_event_id
      AND status = 'processing'
      AND lease_expires_at IS NOT NULL
      AND lease_expires_at > v_now
    LIMIT 1;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'outcome', 'in_progress_retry_later',
        'http_status', 409,
        'prior_status', 'processing',
        'inbox_id', v_other_active_id,
        'lease_expires_at', v_other_active_expires
      );
    END IF;

    SELECT COALESCE(MAX(aggregate_version), 0) INTO v_stored_last_version
    FROM integration_inbox
    WHERE connection_id = p_connection_id
      AND aggregate_id = p_aggregate_id
      AND status = 'applied';

    v_last_version := GREATEST(COALESCE(v_stored_last_version, 0), COALESCE(p_external_last_version, 0));

    IF v_incoming_version < v_last_version THEN
      UPDATE integration_inbox
      SET status = 'rejected_stale_version',
          applied_at = v_now,
          lease_owner = NULL,
          lease_expires_at = NULL,
          last_error = NULL
      WHERE id = v_existing.id;

      RETURN jsonb_build_object(
        'outcome', 'rejected_stale_version',
        'http_status', 200,
        'inbox_id', v_existing.id,
        'last_applied_version', v_last_version
      );
    END IF;

    UPDATE integration_inbox
    SET status = 'processing',
        payload = CASE WHEN p_payload IS NOT NULL THEN p_payload ELSE payload END,
        lease_owner = v_worker,
        lease_expires_at = v_lease_expires,
        attempt_count = COALESCE(attempt_count, 0) + 1,
        received_at = v_now,
        last_error = NULL
    WHERE id = v_existing.id
    RETURNING attempt_count INTO v_attempt_count;

    RETURN jsonb_build_object(
      'outcome', 'claimed',
      'http_status', 200,
      'inbox_id', v_existing.id,
      'reclaimed', TRUE,
      'attempt_count', v_attempt_count
    );
  END IF;

  SELECT id, lease_expires_at INTO v_other_active_id, v_other_active_expires
  FROM integration_inbox
  WHERE connection_id = p_connection_id
    AND aggregate_id = p_aggregate_id
    AND status = 'processing'
    AND lease_expires_at IS NOT NULL
    AND lease_expires_at > v_now
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'outcome', 'in_progress_retry_later',
      'http_status', 409,
      'prior_status', 'processing',
      'inbox_id', v_other_active_id,
      'lease_expires_at', v_other_active_expires
    );
  END IF;

  SELECT COALESCE(MAX(aggregate_version), 0) INTO v_stored_last_version
  FROM integration_inbox
  WHERE connection_id = p_connection_id
    AND aggregate_id = p_aggregate_id
    AND status = 'applied';

  v_last_version := GREATEST(COALESCE(v_stored_last_version, 0), COALESCE(p_external_last_version, 0));

  IF v_incoming_version < v_last_version THEN
    INSERT INTO integration_inbox (
      tenant_id, connection_id, event_id, aggregate_id, aggregate_version,
      event_type, schema_version, payload, payload_hash,
      status, attempt_count, received_at, applied_at
    ) VALUES (
      p_tenant_id, p_connection_id, p_event_id, p_aggregate_id, v_incoming_version,
      COALESCE(p_event_type, 'integration.event'), COALESCE(p_schema_version, '2.0.0'),
      COALESCE(p_payload, '{}'::JSONB), p_payload_hash,
      'rejected_stale_version', 0, v_now, v_now
    )
    RETURNING id INTO v_id;

    RETURN jsonb_build_object(
      'outcome', 'rejected_stale_version',
      'http_status', 200,
      'inbox_id', v_id,
      'last_applied_version', v_last_version
    );
  END IF;

  INSERT INTO integration_inbox (
    tenant_id, connection_id, event_id, aggregate_id, aggregate_version,
    event_type, schema_version, payload, payload_hash,
    status, lease_owner, lease_expires_at, attempt_count, received_at
  ) VALUES (
    p_tenant_id, p_connection_id, p_event_id, p_aggregate_id, v_incoming_version,
    COALESCE(p_event_type, 'integration.event'), COALESCE(p_schema_version, '2.0.0'),
    COALESCE(p_payload, '{}'::JSONB), p_payload_hash,
    'processing', v_worker, v_lease_expires, 1, v_now
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'outcome', 'claimed',
    'http_status', 200,
    'inbox_id', v_id,
    'reclaimed', FALSE,
    'attempt_count', 1
  );
END;
$$;

CREATE OR REPLACE FUNCTION complete_integration_inbox_event(
  p_inbox_id UUID,
  p_worker_id TEXT,
  p_status TEXT,
  p_result_json JSONB DEFAULT NULL,
  p_error TEXT DEFAULT NULL,
  p_effect_applied BOOLEAN DEFAULT FALSE,
  p_now TIMESTAMPTZ DEFAULT NOW()
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now TIMESTAMPTZ := COALESCE(p_now, NOW());
  v_row integration_inbox%ROWTYPE;
  v_final_status TEXT;
BEGIN
  IF p_inbox_id IS NULL THEN
    RAISE EXCEPTION 'p_inbox_id is required';
  END IF;

  SELECT * INTO v_row
  FROM integration_inbox
  WHERE id = p_inbox_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('updated', FALSE, 'reason', 'not_found');
  END IF;

  IF p_status = 'effect_applied' THEN
    UPDATE integration_inbox
    SET effect_applied_at = COALESCE(effect_applied_at, v_now),
        result_json = COALESCE(p_result_json, result_json)
    WHERE id = p_inbox_id;

    RETURN jsonb_build_object(
      'updated', TRUE,
      'inbox_id', p_inbox_id,
      'status', v_row.status,
      'effect_applied', TRUE
    );
  ELSIF p_status = 'applied' THEN
    v_final_status := 'applied';
    UPDATE integration_inbox
    SET status = 'applied',
        effect_applied_at = COALESCE(effect_applied_at, v_now),
        applied_at = COALESCE(applied_at, v_now),
        result_json = COALESCE(p_result_json, result_json),
        lease_owner = NULL,
        lease_expires_at = NULL,
        last_error = NULL
    WHERE id = p_inbox_id;
  ELSIF p_status = 'failed' THEN
    IF NOT p_effect_applied
       AND v_row.effect_applied_at IS NULL
       AND v_row.lease_owner IS NOT NULL
       AND p_worker_id IS NOT NULL
       AND length(trim(p_worker_id)) > 0
       AND v_row.lease_owner <> trim(p_worker_id) THEN
      RETURN jsonb_build_object(
        'updated', FALSE,
        'inbox_id', p_inbox_id,
        'reason', 'lease_lost'
      );
    END IF;
    v_final_status := CASE
      WHEN p_effect_applied OR v_row.effect_applied_at IS NOT NULL THEN 'applied'
      ELSE 'failed'
    END;
    UPDATE integration_inbox
    SET status = v_final_status,
        effect_applied_at = CASE
          WHEN p_effect_applied OR v_row.effect_applied_at IS NOT NULL THEN COALESCE(v_row.effect_applied_at, v_now)
          ELSE NULL
        END,
        applied_at = CASE
          WHEN v_final_status = 'applied' THEN COALESCE(v_row.applied_at, v_now)
          ELSE v_row.applied_at
        END,
        result_json = COALESCE(p_result_json, v_row.result_json),
        last_error = p_error,
        lease_owner = NULL,
        lease_expires_at = NULL
    WHERE id = p_inbox_id;
  ELSE
    RAISE EXCEPTION 'Unsupported completion status: %', p_status;
  END IF;

  RETURN jsonb_build_object(
    'updated', TRUE,
    'inbox_id', p_inbox_id,
    'status', v_final_status
  );
END;
$$;


-- SOURCE: supabase/migrations/008_payroll_import_batches.sql
-- MIG-09: Controlled HR-TMS payroll import batches, line revisions, period locks, and atomic post/reverse RPCs
-- Additive & non-destructive.

CREATE TABLE IF NOT EXISTS payroll_period_locks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  period TEXT NOT NULL,
  locked BOOLEAN NOT NULL DEFAULT TRUE,
  locked_by TEXT NOT NULL,
  locked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, period)
);

CREATE TABLE IF NOT EXISTS payroll_import_batches (
  batch_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  connection_id TEXT NOT NULL DEFAULT 'default',
  period TEXT NOT NULL,
  recognition_policy TEXT NOT NULL DEFAULT 'verified_date',
  status TEXT NOT NULL CHECK (status IN ('draft', 'reviewed', 'approved', 'posted', 'reversed')),
  reconciliation_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  adjustments_json JSONB NOT NULL DEFAULT '[]'::JSONB,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  posted_by TEXT,
  posted_at TIMESTAMPTZ,
  reversed_by TEXT,
  reversed_at TIMESTAMPTZ,
  reversal_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_payroll_import_batches_tenant_created
  ON payroll_import_batches (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS payroll_import_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id TEXT NOT NULL REFERENCES payroll_import_batches(batch_id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL,
  connection_id TEXT NOT NULL DEFAULT 'default',
  source_earning_line_id TEXT NOT NULL,
  source_revision INTEGER NOT NULL CHECK (source_revision >= 1),
  job_id TEXT NOT NULL,
  tms_driver_id TEXT,
  hr_employee_id TEXT,
  period TEXT NOT NULL,
  recognition_date TEXT,
  payment_owner TEXT NOT NULL DEFAULT 'hr_payroll',
  amount_minor BIGINT NOT NULL,
  amount_decimal NUMERIC(12,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'THB',
  payable_minor BIGINT NOT NULL DEFAULT 0,
  disposition TEXT NOT NULL,
  reason TEXT,
  reversed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payroll_import_lines_batch
  ON payroll_import_lines (batch_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payroll_import_lines_active_unique
  ON payroll_import_lines (tenant_id, connection_id, source_earning_line_id, source_revision)
  WHERE disposition IN ('imported_payable', 'imported_revision_delta') AND reversed = FALSE;

CREATE OR REPLACE FUNCTION post_payroll_import_batch(
  p_tenant_id TEXT,
  p_batch_id TEXT,
  p_actor_id TEXT
)
RETURNS payroll_import_batches
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_batch payroll_import_batches;
  v_locked BOOLEAN := FALSE;
  v_adjustments JSONB := '[]'::JSONB;
  v_slip payroll_slips;
  v_base_salary NUMERIC := 0;
  v_delta_dec NUMERIC := 0;
  v_next_bonus NUMERIC := 0;
  v_next_net NUMERIC := 0;
  r RECORD;
BEGIN
  IF p_actor_id IS NULL OR length(trim(p_actor_id)) = 0 THEN
    RAISE EXCEPTION 'ACTOR_REQUIRED: actorId is required';
  END IF;

  SELECT * INTO v_batch
  FROM payroll_import_batches
  WHERE batch_id = p_batch_id
    AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Import batch % not found', p_batch_id;
  END IF;

  IF v_batch.status <> 'approved' THEN
    RAISE EXCEPTION 'INVALID_STATE: Cannot post batch in status %; must be approved first', v_batch.status;
  END IF;

  SELECT EXISTS(
    SELECT 1
    FROM payroll_period_locks
    WHERE tenant_id = p_tenant_id
      AND period = v_batch.period
      AND locked = TRUE
  ) INTO v_locked;

  IF v_locked THEN
    RAISE EXCEPTION 'PERIOD_LOCKED: Payroll period % is closed/locked', v_batch.period;
  END IF;

  FOR r IN
    SELECT hr_employee_id, COALESCE(SUM(payable_minor), 0)::BIGINT AS total_payable_minor
    FROM payroll_import_lines
    WHERE batch_id = p_batch_id
      AND tenant_id = p_tenant_id
      AND disposition IN ('imported_payable', 'imported_revision_delta')
      AND reversed = FALSE
      AND hr_employee_id IS NOT NULL
    GROUP BY hr_employee_id
    ORDER BY hr_employee_id
  LOOP
    v_delta_dec := ROUND((r.total_payable_minor::NUMERIC / 100.0), 2);

    SELECT * INTO v_slip
    FROM payroll_slips
    WHERE employee_id = r.hr_employee_id
      AND period = v_batch.period
    FOR UPDATE;

    IF FOUND THEN
      IF v_slip.status IN ('paid', 'notified') THEN
        RAISE EXCEPTION 'PERIOD_LOCKED: Payroll slip for % in % is already % and immutable', r.hr_employee_id, v_batch.period, v_slip.status;
      END IF;

      v_next_bonus := GREATEST(0, ROUND((COALESCE(v_slip.bonus, 0) + v_delta_dec)::NUMERIC, 2));
      v_next_net := GREATEST(
        0,
        COALESCE(v_slip.base_salary, 0) +
        COALESCE(v_slip.ot_pay, 0) +
        v_next_bonus +
        COALESCE(v_slip.reimbursements, 0) -
        COALESCE(v_slip.tax, 0) -
        COALESCE(v_slip.sso, 0) -
        COALESCE(v_slip.deduction, 0)
      );

      UPDATE payroll_slips
      SET bonus = v_next_bonus,
          net = v_next_net
      WHERE id = v_slip.id;

      v_adjustments := v_adjustments || jsonb_build_object(
        'employeeId', r.hr_employee_id,
        'slipId', v_slip.id,
        'deltaDecimal', v_delta_dec,
        'createdSlip', FALSE
      );
    ELSIF v_delta_dec > 0 THEN
      SELECT COALESCE(salary, 0) INTO v_base_salary
      FROM employee_records
      WHERE employee_id = r.hr_employee_id;

      v_base_salary := COALESCE(v_base_salary, 0);

      INSERT INTO payroll_slips (
        employee_id,
        period,
        status,
        calculation_version,
        base_salary,
        ot_pay,
        bonus,
        reimbursements,
        tax,
        sso,
        deduction,
        net
      ) VALUES (
        r.hr_employee_id,
        v_batch.period,
        'draft',
        2,
        v_base_salary,
        0,
        v_delta_dec,
        0,
        0,
        0,
        0,
        v_base_salary + v_delta_dec
      )
      RETURNING * INTO v_slip;

      v_adjustments := v_adjustments || jsonb_build_object(
        'employeeId', r.hr_employee_id,
        'slipId', v_slip.id,
        'deltaDecimal', v_delta_dec,
        'createdSlip', TRUE
      );
    END IF;
  END LOOP;

  UPDATE payroll_import_batches
  SET status = 'posted',
      posted_by = trim(p_actor_id),
      posted_at = NOW(),
      adjustments_json = v_adjustments
  WHERE batch_id = p_batch_id
    AND tenant_id = p_tenant_id
  RETURNING * INTO v_batch;

  RETURN v_batch;
END;
$$;

CREATE OR REPLACE FUNCTION reverse_payroll_import_batch(
  p_tenant_id TEXT,
  p_batch_id TEXT,
  p_actor_id TEXT,
  p_reason TEXT
)
RETURNS payroll_import_batches
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_batch payroll_import_batches;
  v_locked BOOLEAN := FALSE;
  v_elem JSONB;
  v_slip payroll_slips;
  v_delta_dec NUMERIC := 0;
  v_next_bonus NUMERIC := 0;
  v_next_net NUMERIC := 0;
BEGIN
  IF p_actor_id IS NULL OR length(trim(p_actor_id)) = 0 THEN
    RAISE EXCEPTION 'ACTOR_REQUIRED: actorId is required';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'REASON_REQUIRED: reversal reason is required';
  END IF;

  SELECT * INTO v_batch
  FROM payroll_import_batches
  WHERE batch_id = p_batch_id
    AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Import batch % not found', p_batch_id;
  END IF;

  IF v_batch.status NOT IN ('approved', 'posted') THEN
    RAISE EXCEPTION 'INVALID_STATE: Cannot reverse batch in status %', v_batch.status;
  END IF;

  SELECT EXISTS(
    SELECT 1
    FROM payroll_period_locks
    WHERE tenant_id = p_tenant_id
      AND period = v_batch.period
      AND locked = TRUE
  ) INTO v_locked;

  IF v_locked THEN
    RAISE EXCEPTION 'PERIOD_LOCKED: Cannot reverse batch in locked period %', v_batch.period;
  END IF;

  IF v_batch.status = 'posted' THEN
    FOR v_elem IN
      SELECT * FROM jsonb_array_elements(COALESCE(v_batch.adjustments_json, '[]'::JSONB))
    LOOP
      SELECT * INTO v_slip
      FROM payroll_slips
      WHERE id = (v_elem->>'slipId')::BIGINT
      FOR UPDATE;

      IF FOUND THEN
        IF v_slip.status IN ('paid', 'notified') THEN
          RAISE EXCEPTION 'PERIOD_LOCKED: Cannot reverse batch after slip % is %', v_slip.id, v_slip.status;
        END IF;

        v_delta_dec := COALESCE((v_elem->>'deltaDecimal')::NUMERIC, 0);
        v_next_bonus := GREATEST(0, ROUND((COALESCE(v_slip.bonus, 0) - v_delta_dec)::NUMERIC, 2));
        v_next_net := GREATEST(
          0,
          COALESCE(v_slip.base_salary, 0) +
          COALESCE(v_slip.ot_pay, 0) +
          v_next_bonus +
          COALESCE(v_slip.reimbursements, 0) -
          COALESCE(v_slip.tax, 0) -
          COALESCE(v_slip.sso, 0) -
          COALESCE(v_slip.deduction, 0)
        );

        UPDATE payroll_slips
        SET bonus = v_next_bonus,
            net = v_next_net
        WHERE id = v_slip.id;
      END IF;
    END LOOP;
  END IF;

  UPDATE payroll_import_lines
  SET reversed = TRUE
  WHERE batch_id = p_batch_id
    AND tenant_id = p_tenant_id;

  UPDATE payroll_import_batches
  SET status = 'reversed',
      reversed_by = trim(p_actor_id),
      reversed_at = NOW(),
      reversal_reason = trim(p_reason)
  WHERE batch_id = p_batch_id
    AND tenant_id = p_tenant_id
  RETURNING * INTO v_batch;

  RETURN v_batch;
END;
$$;


-- SOURCE: supabase/migrations/009_inbox_leases_and_quota_accounting_fix.sql
-- MIG-11: Inbox processing leases/recovery (RV2-01) and concurrent-resource vs cumulative-usage quota accounting fix (RV2-03)
-- Additive & idempotent. Safe to run on fresh or already-migrated (006/007) databases.

-- ============================================================================
-- 1. RV2-01: Integration Inbox Lease, Payload & Effect-Applied Tracking
-- ============================================================================

ALTER TABLE integration_inbox
  ADD COLUMN IF NOT EXISTS payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  ADD COLUMN IF NOT EXISTS lease_owner TEXT,
  ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS effect_applied_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_integration_inbox_lease
  ON integration_inbox (status, lease_expires_at);

CREATE OR REPLACE FUNCTION claim_integration_inbox_event(
  p_connection_id TEXT,
  p_tenant_id TEXT,
  p_event_id TEXT,
  p_aggregate_id TEXT,
  p_aggregate_version BIGINT DEFAULT 1,
  p_event_type TEXT DEFAULT 'integration.event',
  p_schema_version TEXT DEFAULT '2.0.0',
  p_payload JSONB DEFAULT '{}'::JSONB,
  p_payload_hash TEXT DEFAULT '',
  p_worker_id TEXT DEFAULT 'inbox-worker',
  p_lease_ms INTEGER DEFAULT 30000,
  p_external_last_version BIGINT DEFAULT 0,
  p_now TIMESTAMPTZ DEFAULT NOW()
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now TIMESTAMPTZ := COALESCE(p_now, NOW());
  v_lease_ms INTEGER := GREATEST(100, COALESCE(p_lease_ms, 30000));
  v_lease_expires TIMESTAMPTZ := v_now + (v_lease_ms::TEXT || ' milliseconds')::INTERVAL;
  v_worker TEXT := COALESCE(NULLIF(trim(p_worker_id), ''), 'inbox-worker');
  v_incoming_version BIGINT := GREATEST(1, COALESCE(p_aggregate_version, 1));
  v_existing integration_inbox%ROWTYPE;
  v_other_active_id UUID;
  v_other_active_expires TIMESTAMPTZ;
  v_stored_last_version BIGINT := 0;
  v_last_version BIGINT := 0;
  v_id UUID;
  v_attempt_count INTEGER := 0;
BEGIN
  IF p_connection_id IS NULL OR length(trim(p_connection_id)) = 0
     OR p_tenant_id IS NULL OR length(trim(p_tenant_id)) = 0
     OR p_event_id IS NULL OR length(trim(p_event_id)) = 0
     OR p_aggregate_id IS NULL OR length(trim(p_aggregate_id)) = 0 THEN
    RETURN jsonb_build_object('outcome', 'invalid_event', 'http_status', 400);
  END IF;

  -- Serialize aggregate version checks & event claims in consistent lock order
  PERFORM pg_advisory_xact_lock(hashtext('inbox_agg:' || p_connection_id || ':' || p_aggregate_id));
  PERFORM pg_advisory_xact_lock(hashtext('inbox_evt:' || p_connection_id || ':' || p_event_id));

  SELECT * INTO v_existing
  FROM integration_inbox
  WHERE connection_id = p_connection_id
    AND event_id = p_event_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.payload_hash <> p_payload_hash THEN
      RETURN jsonb_build_object(
        'outcome', 'conflict_payload_mismatch',
        'http_status', 409,
        'inbox_id', v_existing.id
      );
    END IF;

    IF v_existing.status IN ('applied', 'rejected_stale_version') THEN
      RETURN jsonb_build_object(
        'outcome', 'duplicate_ignored',
        'http_status', 200,
        'prior_status', v_existing.status,
        'inbox_id', v_existing.id,
        'result_json', v_existing.result_json
      );
    END IF;

    IF v_existing.effect_applied_at IS NOT NULL THEN
      UPDATE integration_inbox
      SET status = 'applied',
          applied_at = COALESCE(applied_at, v_now),
          lease_owner = NULL,
          lease_expires_at = NULL,
          last_error = NULL
      WHERE id = v_existing.id;

      RETURN jsonb_build_object(
        'outcome', 'recovered_already_applied',
        'http_status', 200,
        'prior_status', 'applied',
        'inbox_id', v_existing.id,
        'result_json', v_existing.result_json
      );
    END IF;

    IF v_existing.status = 'processing'
       AND v_existing.lease_expires_at IS NOT NULL
       AND v_existing.lease_expires_at > v_now THEN
      RETURN jsonb_build_object(
        'outcome', 'in_progress_retry_later',
        'http_status', 409,
        'prior_status', 'processing',
        'inbox_id', v_existing.id,
        'lease_expires_at', v_existing.lease_expires_at
      );
    END IF;

    -- Prevent concurrent apply of another active event on the same aggregate
    SELECT id, lease_expires_at INTO v_other_active_id, v_other_active_expires
    FROM integration_inbox
    WHERE connection_id = p_connection_id
      AND aggregate_id = p_aggregate_id
      AND event_id <> p_event_id
      AND status = 'processing'
      AND lease_expires_at IS NOT NULL
      AND lease_expires_at > v_now
    LIMIT 1;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'outcome', 'in_progress_retry_later',
        'http_status', 409,
        'prior_status', 'processing',
        'inbox_id', v_other_active_id,
        'lease_expires_at', v_other_active_expires
      );
    END IF;

    SELECT COALESCE(MAX(aggregate_version), 0) INTO v_stored_last_version
    FROM integration_inbox
    WHERE connection_id = p_connection_id
      AND aggregate_id = p_aggregate_id
      AND status = 'applied';

    v_last_version := GREATEST(COALESCE(v_stored_last_version, 0), COALESCE(p_external_last_version, 0));

    IF v_incoming_version < v_last_version THEN
      UPDATE integration_inbox
      SET status = 'rejected_stale_version',
          applied_at = v_now,
          lease_owner = NULL,
          lease_expires_at = NULL,
          last_error = NULL
      WHERE id = v_existing.id;

      RETURN jsonb_build_object(
        'outcome', 'rejected_stale_version',
        'http_status', 200,
        'inbox_id', v_existing.id,
        'last_applied_version', v_last_version
      );
    END IF;

    UPDATE integration_inbox
    SET status = 'processing',
        payload = CASE WHEN p_payload IS NOT NULL THEN p_payload ELSE payload END,
        lease_owner = v_worker,
        lease_expires_at = v_lease_expires,
        attempt_count = COALESCE(attempt_count, 0) + 1,
        received_at = v_now,
        last_error = NULL
    WHERE id = v_existing.id
    RETURNING attempt_count INTO v_attempt_count;

    RETURN jsonb_build_object(
      'outcome', 'claimed',
      'http_status', 200,
      'inbox_id', v_existing.id,
      'reclaimed', TRUE,
      'attempt_count', v_attempt_count
    );
  END IF;

  -- New event: ensure no other event on the same aggregate is actively processing
  SELECT id, lease_expires_at INTO v_other_active_id, v_other_active_expires
  FROM integration_inbox
  WHERE connection_id = p_connection_id
    AND aggregate_id = p_aggregate_id
    AND status = 'processing'
    AND lease_expires_at IS NOT NULL
    AND lease_expires_at > v_now
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'outcome', 'in_progress_retry_later',
      'http_status', 409,
      'prior_status', 'processing',
      'inbox_id', v_other_active_id,
      'lease_expires_at', v_other_active_expires
    );
  END IF;

  SELECT COALESCE(MAX(aggregate_version), 0) INTO v_stored_last_version
  FROM integration_inbox
  WHERE connection_id = p_connection_id
    AND aggregate_id = p_aggregate_id
    AND status = 'applied';

  v_last_version := GREATEST(COALESCE(v_stored_last_version, 0), COALESCE(p_external_last_version, 0));

  IF v_incoming_version < v_last_version THEN
    INSERT INTO integration_inbox (
      tenant_id, connection_id, event_id, aggregate_id, aggregate_version,
      event_type, schema_version, payload, payload_hash,
      status, attempt_count, received_at, applied_at
    ) VALUES (
      p_tenant_id, p_connection_id, p_event_id, p_aggregate_id, v_incoming_version,
      COALESCE(p_event_type, 'integration.event'), COALESCE(p_schema_version, '2.0.0'),
      COALESCE(p_payload, '{}'::JSONB), p_payload_hash,
      'rejected_stale_version', 0, v_now, v_now
    )
    RETURNING id INTO v_id;

    RETURN jsonb_build_object(
      'outcome', 'rejected_stale_version',
      'http_status', 200,
      'inbox_id', v_id,
      'last_applied_version', v_last_version
    );
  END IF;

  INSERT INTO integration_inbox (
    tenant_id, connection_id, event_id, aggregate_id, aggregate_version,
    event_type, schema_version, payload, payload_hash,
    status, lease_owner, lease_expires_at, attempt_count, received_at
  ) VALUES (
    p_tenant_id, p_connection_id, p_event_id, p_aggregate_id, v_incoming_version,
    COALESCE(p_event_type, 'integration.event'), COALESCE(p_schema_version, '2.0.0'),
    COALESCE(p_payload, '{}'::JSONB), p_payload_hash,
    'processing', v_worker, v_lease_expires, 1, v_now
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'outcome', 'claimed',
    'http_status', 200,
    'inbox_id', v_id,
    'reclaimed', FALSE,
    'attempt_count', 1
  );
END;
$$;

CREATE OR REPLACE FUNCTION complete_integration_inbox_event(
  p_inbox_id UUID,
  p_worker_id TEXT,
  p_status TEXT,
  p_result_json JSONB DEFAULT NULL,
  p_error TEXT DEFAULT NULL,
  p_effect_applied BOOLEAN DEFAULT FALSE,
  p_now TIMESTAMPTZ DEFAULT NOW()
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now TIMESTAMPTZ := COALESCE(p_now, NOW());
  v_row integration_inbox%ROWTYPE;
  v_final_status TEXT;
BEGIN
  IF p_inbox_id IS NULL THEN
    RAISE EXCEPTION 'p_inbox_id is required';
  END IF;

  SELECT * INTO v_row
  FROM integration_inbox
  WHERE id = p_inbox_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('updated', FALSE, 'reason', 'not_found');
  END IF;

  IF p_status = 'effect_applied' THEN
    UPDATE integration_inbox
    SET effect_applied_at = COALESCE(effect_applied_at, v_now),
        result_json = COALESCE(p_result_json, result_json)
    WHERE id = p_inbox_id;

    RETURN jsonb_build_object(
      'updated', TRUE,
      'inbox_id', p_inbox_id,
      'status', v_row.status,
      'effect_applied', TRUE
    );
  ELSIF p_status = 'applied' THEN
    v_final_status := 'applied';
    UPDATE integration_inbox
    SET status = 'applied',
        effect_applied_at = COALESCE(effect_applied_at, v_now),
        applied_at = COALESCE(applied_at, v_now),
        result_json = COALESCE(p_result_json, result_json),
        lease_owner = NULL,
        lease_expires_at = NULL,
        last_error = NULL
    WHERE id = p_inbox_id;
  ELSIF p_status = 'failed' THEN
    IF NOT p_effect_applied
       AND v_row.effect_applied_at IS NULL
       AND v_row.lease_owner IS NOT NULL
       AND p_worker_id IS NOT NULL
       AND length(trim(p_worker_id)) > 0
       AND v_row.lease_owner <> trim(p_worker_id) THEN
      RETURN jsonb_build_object(
        'updated', FALSE,
        'inbox_id', p_inbox_id,
        'reason', 'lease_lost'
      );
    END IF;
    v_final_status := CASE
      WHEN p_effect_applied OR v_row.effect_applied_at IS NOT NULL THEN 'applied'
      ELSE 'failed'
    END;
    UPDATE integration_inbox
    SET status = v_final_status,
        effect_applied_at = CASE
          WHEN p_effect_applied OR v_row.effect_applied_at IS NOT NULL THEN COALESCE(v_row.effect_applied_at, v_now)
          ELSE NULL
        END,
        applied_at = CASE
          WHEN v_final_status = 'applied' THEN COALESCE(v_row.applied_at, v_now)
          ELSE v_row.applied_at
        END,
        result_json = COALESCE(p_result_json, v_row.result_json),
        last_error = p_error,
        lease_owner = NULL,
        lease_expires_at = NULL
    WHERE id = p_inbox_id;
  ELSE
    RAISE EXCEPTION 'Unsupported completion status: %', p_status;
  END IF;

  RETURN jsonb_build_object(
    'updated', TRUE,
    'inbox_id', p_inbox_id,
    'status', v_final_status
  );
END;
$$;

-- ============================================================================
-- 2. RV2-03: Quota Accounting Fix (Separate In-Flight Reservations from Committed History)
-- ============================================================================

ALTER TABLE quota_reservations
  ADD COLUMN IF NOT EXISTS quota_mode TEXT NOT NULL DEFAULT 'concurrent_resource';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'quota_reservations_quota_mode_check'
      AND conrelid = 'quota_reservations'::regclass
  ) THEN
    ALTER TABLE quota_reservations
      ADD CONSTRAINT quota_reservations_quota_mode_check
      CHECK (quota_mode IN ('concurrent_resource', 'cumulative_usage'));
  END IF;
END $$;

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
    -- Only sum outstanding in-flight 'reserved' slots; 'committed' rows are already counted in v_base!
    SELECT COALESCE(SUM(delta), 0)::INTEGER INTO v_in_flight_reserved
    FROM quota_reservations
    WHERE tenant_id = p_tenant_id
      AND module = p_module
      AND resource = p_resource
      AND status = 'reserved';

    -- Dynamic in-transaction table count when resource table exists in this DB
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
    -- cumulative_usage: sum both reserved and committed usage entries
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


-- SOURCE: supabase/migrations/010_driving_income.sql
-- Warehouse salary + verified driving income on one employee slip.
-- Requires schema-phase21 and migrations 006..009. Existing legacy postings need reconciliation.
ALTER TABLE payroll_slips ADD COLUMN IF NOT EXISTS driving_pay NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE payroll_slips ADD COLUMN IF NOT EXISTS recalculation_required BOOLEAN NOT NULL DEFAULT FALSE;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM payroll_import_batches WHERE status='posted' AND jsonb_array_length(adjustments_json)>0 AND NOT (adjustments_json @> '[{"incomeField":"driving_pay"}]'::jsonb)) THEN
   RAISE EXCEPTION 'Existing posted TMS batches require reconciliation before enabling separate driving pay';
 END IF;
END $$;
create or replace function save_payroll_draft(p_row jsonb, p_overwrite boolean default false)
returns text language plpgsql set search_path = public, pg_temp as $$
declare old payroll_slips; incoming payroll_slips;
begin
  incoming := jsonb_populate_record(null::payroll_slips, p_row);
  if incoming.period !~ '^\d{4}-(0[1-9]|1[0-2])$' or incoming.employee_id is null then
    raise exception 'Invalid payroll period/employee';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('payroll:' || incoming.employee_id || ':' || incoming.period, 0));
  select * into old from payroll_slips where employee_id=incoming.employee_id and period=incoming.period for update;
  if found then
    if old.status <> 'draft' or not p_overwrite then return 'skipped'; end if;
    if old.calculation_version <> 2 and (old.bonus <> 0 or incoming.reimbursements <> 0) then
      raise exception 'Legacy payroll requires reconciliation';
    end if;
    if coalesce(incoming.driving_pay,0) <> old.driving_pay then raise exception 'TMS income changed; reload and recalculate'; end if;
    update payroll_slips set base_salary=incoming.base_salary, ot_pay=incoming.ot_pay,
      bonus=incoming.bonus, driving_pay=old.driving_pay, recalculation_required=coalesce(incoming.recalculation_required,old.recalculation_required), reimbursements=incoming.reimbursements, tax=incoming.tax,
      sso=incoming.sso, deduction=incoming.deduction, net=incoming.net, calculation_version=2
      where id=old.id;
    return 'updated';
  end if;
  if coalesce(incoming.driving_pay,0) <> 0 then raise exception 'TMS income must be posted through import'; end if;
  insert into payroll_slips(employee_id,period,base_salary,ot_pay,bonus,reimbursements,tax,sso,deduction,net,status,calculation_version)
    values(incoming.employee_id,incoming.period,incoming.base_salary,incoming.ot_pay,incoming.bonus,
      incoming.reimbursements,incoming.tax,incoming.sso,incoming.deduction,incoming.net,'draft',2);
  return 'created';
end $$;

CREATE OR REPLACE FUNCTION post_payroll_import_batch(
  p_tenant_id TEXT,
  p_batch_id TEXT,
  p_actor_id TEXT
)
RETURNS payroll_import_batches
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_batch payroll_import_batches;
  v_locked BOOLEAN := FALSE;
  v_adjustments JSONB := '[]'::JSONB;
  v_slip payroll_slips;
  v_base_salary NUMERIC := 0;
  v_delta_dec NUMERIC := 0;
  v_next_driving NUMERIC := 0;
  v_next_net NUMERIC := 0;
  r RECORD;
  v_line RECORD; v_prior_minor BIGINT;
BEGIN
  IF p_actor_id IS NULL OR length(trim(p_actor_id)) = 0 THEN
    RAISE EXCEPTION 'ACTOR_REQUIRED: actorId is required';
  END IF;

  SELECT * INTO v_batch
  FROM payroll_import_batches
  WHERE batch_id = p_batch_id
    AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Import batch % not found', p_batch_id;
  END IF;

  IF v_batch.status <> 'approved' THEN
    RAISE EXCEPTION 'INVALID_STATE: Cannot post batch in status %; must be approved first', v_batch.status;
  END IF;

  SELECT EXISTS(
    SELECT 1
    FROM payroll_period_locks
    WHERE tenant_id = p_tenant_id
      AND period = v_batch.period
      AND locked = TRUE
  ) INTO v_locked;

  IF v_locked THEN
    RAISE EXCEPTION 'PERIOD_LOCKED: Payroll period % is closed/locked', v_batch.period;
  END IF;

  -- Serialize source revisions across batches, then verify the reviewed delta against posted history.
  FOR v_line IN SELECT * FROM payroll_import_lines WHERE batch_id=p_batch_id AND tenant_id=p_tenant_id
    AND disposition IN ('imported_payable','imported_revision_delta') AND NOT reversed ORDER BY source_earning_line_id LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('tms-source:' || p_tenant_id || ':' || v_batch.connection_id || ':' || v_line.source_earning_line_id,0));
    IF NOT EXISTS (SELECT 1 FROM driver_employee_links link JOIN users u ON u.employee_id=link.hr_employee_id
      WHERE link.tenant_id=p_tenant_id AND link.connection_id=v_batch.connection_id AND link.active
      AND link.tms_driver_id=v_line.tms_driver_id AND link.hr_employee_id=v_line.hr_employee_id
      AND nullif(trim(link.verified_by),'') IS NOT NULL AND link.employment_classification<>'subcontractor'
      AND (link.effective_from IS NULL OR link.effective_from<=v_line.recognition_date::date)
      AND (link.effective_to IS NULL OR link.effective_to>=v_line.recognition_date::date) AND u.status='active') THEN
      RAISE EXCEPTION 'INVALID_STATE: Driver mapping or employee changed; review batch again';
    END IF;
    IF EXISTS (SELECT 1 FROM payroll_import_lines prior JOIN payroll_import_batches b ON b.batch_id=prior.batch_id
      WHERE prior.tenant_id=p_tenant_id AND prior.connection_id=v_batch.connection_id AND prior.source_earning_line_id=v_line.source_earning_line_id
      AND prior.batch_id<>p_batch_id AND NOT prior.reversed AND b.status='posted'
      AND prior.disposition IN ('imported_payable','imported_revision_delta')
      AND (prior.source_revision>=v_line.source_revision OR prior.period<>v_batch.period OR prior.hr_employee_id IS DISTINCT FROM v_line.hr_employee_id)) THEN
      RAISE EXCEPTION 'INVALID_STATE: Source revision or recipient changed; reconcile import';
    END IF;
    SELECT coalesce(sum(prior.payable_minor),0) INTO v_prior_minor FROM payroll_import_lines prior
      JOIN payroll_import_batches b ON b.batch_id=prior.batch_id WHERE prior.tenant_id=p_tenant_id
      AND prior.connection_id=v_batch.connection_id AND prior.source_earning_line_id=v_line.source_earning_line_id
      AND prior.batch_id<>p_batch_id AND NOT prior.reversed AND b.status='posted'
      AND prior.disposition IN ('imported_payable','imported_revision_delta');
    IF v_line.payable_minor <> v_line.amount_minor-v_prior_minor THEN
      RAISE EXCEPTION 'INVALID_STATE: Source delta changed; rebuild and review batch';
    END IF;
  END LOOP;

  FOR r IN
    SELECT hr_employee_id, COALESCE(SUM(payable_minor), 0)::BIGINT AS total_payable_minor
    FROM payroll_import_lines
    WHERE batch_id = p_batch_id
      AND tenant_id = p_tenant_id
      AND disposition IN ('imported_payable', 'imported_revision_delta')
      AND reversed = FALSE
      AND hr_employee_id IS NOT NULL
    GROUP BY hr_employee_id
    ORDER BY hr_employee_id
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('payroll:' || r.hr_employee_id || ':' || v_batch.period, 0));
    v_delta_dec := ROUND((r.total_payable_minor::NUMERIC / 100.0), 2);

    SELECT * INTO v_slip
    FROM payroll_slips
    WHERE employee_id = r.hr_employee_id
      AND period = v_batch.period
    FOR UPDATE;

    IF FOUND THEN
      IF v_slip.status IN ('paid', 'notified') THEN
        RAISE EXCEPTION 'PERIOD_LOCKED: Payroll slip for % in % is already % and immutable', r.hr_employee_id, v_batch.period, v_slip.status;
      END IF;

      v_next_driving := ROUND((COALESCE(v_slip.driving_pay, 0) + v_delta_dec)::NUMERIC, 2);
      IF v_next_driving < 0 THEN RAISE EXCEPTION 'INVALID_STATE: Negative driving income'; END IF;
      v_next_net := GREATEST(
        0,
        COALESCE(v_slip.base_salary, 0) +
        COALESCE(v_slip.ot_pay, 0) +
        COALESCE(v_slip.bonus, 0) +
        v_next_driving +
        COALESCE(v_slip.reimbursements, 0) -
        COALESCE(v_slip.tax, 0) -
        COALESCE(v_slip.sso, 0) -
        COALESCE(v_slip.deduction, 0)
      );

      UPDATE payroll_slips
      SET driving_pay = v_next_driving,
          net = v_next_net, recalculation_required = TRUE
      WHERE id = v_slip.id;

      v_adjustments := v_adjustments || jsonb_build_object(
        'employeeId', r.hr_employee_id,
        'slipId', v_slip.id,
        'deltaDecimal', v_delta_dec,
        'incomeField', 'driving_pay',
        'createdSlip', FALSE
      );
    ELSIF v_delta_dec > 0 THEN
      SELECT COALESCE(salary, 0) INTO v_base_salary
      FROM employee_records
      WHERE employee_id = r.hr_employee_id;

      v_base_salary := COALESCE(v_base_salary, 0);

      INSERT INTO payroll_slips (
        employee_id,
        period,
        status,
        calculation_version,
        recalculation_required,
        base_salary,
        ot_pay,
        driving_pay,
        reimbursements,
        tax,
        sso,
        deduction,
        net
      ) VALUES (
        r.hr_employee_id,
        v_batch.period,
        'draft',
        2,
        TRUE,
        v_base_salary,
        0,
        v_delta_dec,
        0,
        0,
        0,
        0,
        v_base_salary + v_delta_dec
      )
      RETURNING * INTO v_slip;

      v_adjustments := v_adjustments || jsonb_build_object(
        'employeeId', r.hr_employee_id,
        'slipId', v_slip.id,
        'deltaDecimal', v_delta_dec,
        'incomeField', 'driving_pay',
        'createdSlip', TRUE
      );
    END IF;
  END LOOP;

  UPDATE payroll_import_batches
  SET status = 'posted',
      posted_by = trim(p_actor_id),
      posted_at = NOW(),
      adjustments_json = v_adjustments
  WHERE batch_id = p_batch_id
    AND tenant_id = p_tenant_id
  RETURNING * INTO v_batch;

  RETURN v_batch;
END;
$$;

CREATE OR REPLACE FUNCTION reverse_payroll_import_batch(
  p_tenant_id TEXT,
  p_batch_id TEXT,
  p_actor_id TEXT,
  p_reason TEXT
)
RETURNS payroll_import_batches
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_batch payroll_import_batches;
  v_locked BOOLEAN := FALSE;
  v_elem JSONB;
  v_slip payroll_slips;
  v_delta_dec NUMERIC := 0;
  v_next_driving NUMERIC := 0;
  v_next_net NUMERIC := 0;
BEGIN
  IF p_actor_id IS NULL OR length(trim(p_actor_id)) = 0 THEN
    RAISE EXCEPTION 'ACTOR_REQUIRED: actorId is required';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'REASON_REQUIRED: reversal reason is required';
  END IF;

  SELECT * INTO v_batch
  FROM payroll_import_batches
  WHERE batch_id = p_batch_id
    AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Import batch % not found', p_batch_id;
  END IF;

  IF v_batch.status NOT IN ('draft', 'reviewed', 'approved', 'posted') THEN
    RAISE EXCEPTION 'INVALID_STATE: Cannot reverse batch in status %', v_batch.status;
  END IF;

  SELECT EXISTS(
    SELECT 1
    FROM payroll_period_locks
    WHERE tenant_id = p_tenant_id
      AND period = v_batch.period
      AND locked = TRUE
  ) INTO v_locked;

  IF v_locked THEN
    RAISE EXCEPTION 'PERIOD_LOCKED: Cannot reverse batch in locked period %', v_batch.period;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('tms-source:' || p_tenant_id || ':' || v_batch.connection_id || ':' || source_earning_line_id,0)) FROM payroll_import_lines WHERE batch_id=p_batch_id ORDER BY source_earning_line_id;
  IF EXISTS (SELECT 1 FROM payroll_import_lines own JOIN payroll_import_lines newer
    ON newer.tenant_id=own.tenant_id AND newer.connection_id=own.connection_id
    AND newer.source_earning_line_id=own.source_earning_line_id AND newer.source_revision>own.source_revision
    AND NOT newer.reversed AND newer.disposition IN ('imported_payable','imported_revision_delta')
    WHERE own.batch_id=p_batch_id AND NOT own.reversed) THEN
    RAISE EXCEPTION 'INVALID_STATE: Reverse later revisions first';
  END IF;
  IF v_batch.status = 'posted' THEN
    FOR v_elem IN
      SELECT * FROM jsonb_array_elements(COALESCE(v_batch.adjustments_json, '[]'::JSONB))
    LOOP
      PERFORM pg_advisory_xact_lock(hashtextextended('payroll:' || (v_elem->>'employeeId') || ':' || v_batch.period, 0));
      SELECT * INTO v_slip
      FROM payroll_slips
      WHERE id = (v_elem->>'slipId')::BIGINT
      FOR UPDATE;

      IF FOUND THEN
        IF v_slip.status IN ('paid', 'notified') THEN
          RAISE EXCEPTION 'PERIOD_LOCKED: Cannot reverse batch after slip % is %', v_slip.id, v_slip.status;
        END IF;

        v_delta_dec := COALESCE((v_elem->>'deltaDecimal')::NUMERIC, 0);
        v_next_driving := ROUND((COALESCE(v_slip.driving_pay, 0) - v_delta_dec)::NUMERIC, 2);
        IF v_next_driving < 0 THEN RAISE EXCEPTION 'INVALID_STATE: Reverse later revisions first'; END IF;
        v_next_net := GREATEST(
          0,
          COALESCE(v_slip.base_salary, 0) +
          COALESCE(v_slip.ot_pay, 0) +
          COALESCE(v_slip.bonus, 0) +
        v_next_driving +
          COALESCE(v_slip.reimbursements, 0) -
          COALESCE(v_slip.tax, 0) -
          COALESCE(v_slip.sso, 0) -
          COALESCE(v_slip.deduction, 0)
        );

        UPDATE payroll_slips
        SET driving_pay = v_next_driving,
            net = v_next_net, recalculation_required = TRUE
        WHERE id = v_slip.id;
      END IF;
    END LOOP;
  END IF;

  UPDATE payroll_import_lines
  SET reversed = TRUE
  WHERE batch_id = p_batch_id
    AND tenant_id = p_tenant_id;

  UPDATE payroll_import_batches
  SET status = 'reversed',
      reversed_by = trim(p_actor_id),
      reversed_at = NOW(),
      reversal_reason = trim(p_reason)
  WHERE batch_id = p_batch_id
    AND tenant_id = p_tenant_id
  RETURNING * INTO v_batch;

  RETURN v_batch;
END;
$$;

CREATE OR REPLACE FUNCTION guard_payroll_recalculation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status IN ('paid','notified') AND OLD.status='draft' AND NEW.recalculation_required THEN
   RAISE EXCEPTION 'RECALCULATION_REQUIRED: คำนวณเงินเดือนใหม่หลังเปลี่ยนค่าเที่ยวก่อนยืนยันจ่าย';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS payroll_recalculation_guard ON payroll_slips;
CREATE TRIGGER payroll_recalculation_guard BEFORE UPDATE ON payroll_slips FOR EACH ROW EXECUTE FUNCTION guard_payroll_recalculation();
REVOKE ALL ON FUNCTION post_payroll_import_batch(text,text,text), reverse_payroll_import_batch(text,text,text,text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION post_payroll_import_batch(text,text,text), reverse_payroll_import_batch(text,text,text,text) TO service_role;


COMMIT;
