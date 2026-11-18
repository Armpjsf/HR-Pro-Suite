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
