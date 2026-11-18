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
