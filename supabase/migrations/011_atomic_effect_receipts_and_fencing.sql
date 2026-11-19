-- MIG-12: Atomic domain effect receipts, strict lease fencing, and atomic domain+receipt RPCs (RV3-01)
-- Additive & idempotent. Safe to run on fresh or already-migrated (006/007/008/009) databases.

-- ============================================================================
-- 1. Durable Effect Receipts Table (Per-Target Idempotency Within Domain Tx)
-- ============================================================================

CREATE TABLE IF NOT EXISTS integration_effect_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  target_key TEXT NOT NULL,
  inbox_id UUID REFERENCES integration_inbox(id) ON DELETE CASCADE,
  worker_id TEXT NOT NULL,
  fencing_token INTEGER NOT NULL DEFAULT 1,
  effect_type TEXT NOT NULL DEFAULT 'domain_mutation',
  result_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, connection_id, event_id, target_key)
);

CREATE INDEX IF NOT EXISTS idx_integration_effect_receipts_inbox
  ON integration_effect_receipts (inbox_id);

-- ============================================================================
-- 2. Updated Inbox Claim RPC (Returns Fencing Token & Committed Receipts)
-- ============================================================================

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
  v_committed_receipts JSONB := '{}'::JSONB;
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

    SELECT COALESCE(jsonb_object_agg(target_key, result_json), '{}'::JSONB)
    INTO v_committed_receipts
    FROM integration_effect_receipts
    WHERE tenant_id = p_tenant_id
      AND connection_id = p_connection_id
      AND event_id = p_event_id;

    RETURN jsonb_build_object(
      'outcome', 'claimed',
      'http_status', 200,
      'inbox_id', v_existing.id,
      'reclaimed', TRUE,
      'attempt_count', v_attempt_count,
      'fencing_token', v_attempt_count,
      'lease_owner', v_worker,
      'committed_receipts', COALESCE(v_committed_receipts, '{}'::JSONB)
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

  SELECT COALESCE(jsonb_object_agg(target_key, result_json), '{}'::JSONB)
  INTO v_committed_receipts
  FROM integration_effect_receipts
  WHERE tenant_id = p_tenant_id
    AND connection_id = p_connection_id
    AND event_id = p_event_id;

  RETURN jsonb_build_object(
    'outcome', 'claimed',
    'http_status', 200,
    'inbox_id', v_id,
    'reclaimed', FALSE,
    'attempt_count', 1,
    'fencing_token', 1,
    'lease_owner', v_worker,
    'committed_receipts', COALESCE(v_committed_receipts, '{}'::JSONB)
  );
END;
$$;

-- ============================================================================
-- 3. Strict Fenced Completion RPC (Guards All Statuses Against Stale Workers)
-- ============================================================================

DROP FUNCTION IF EXISTS complete_integration_inbox_event(UUID, TEXT, TEXT, JSONB, TEXT, BOOLEAN, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS complete_integration_inbox_event(UUID, TEXT, TEXT, JSONB, TEXT, BOOLEAN, TIMESTAMPTZ, INTEGER);

CREATE OR REPLACE FUNCTION complete_integration_inbox_event(
  p_inbox_id UUID,
  p_worker_id TEXT,
  p_status TEXT,
  p_result_json JSONB DEFAULT NULL,
  p_error TEXT DEFAULT NULL,
  p_effect_applied BOOLEAN DEFAULT FALSE,
  p_now TIMESTAMPTZ DEFAULT NOW(),
  p_fencing_token INTEGER DEFAULT NULL
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

  IF v_row.status IN ('applied', 'rejected_stale_version') THEN
    RETURN jsonb_build_object(
      'updated', FALSE,
      'inbox_id', p_inbox_id,
      'reason', CASE WHEN v_row.status = 'applied' THEN 'already_applied' ELSE 'already_rejected_stale_version' END,
      'status', v_row.status,
      'result_json', v_row.result_json
    );
  END IF;

  IF (
    v_row.lease_owner IS NOT NULL
    AND p_worker_id IS NOT NULL
    AND length(trim(p_worker_id)) > 0
    AND v_row.lease_owner <> trim(p_worker_id)
  ) OR (
    p_fencing_token IS NOT NULL
    AND v_row.attempt_count <> p_fencing_token
  ) THEN
    RETURN jsonb_build_object(
      'updated', FALSE,
      'inbox_id', p_inbox_id,
      'reason', 'lease_lost',
      'current_owner', v_row.lease_owner,
      'current_fencing_token', v_row.attempt_count
    );
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
-- 4. Atomic Effect Receipt Recorder (With Fencing Guard)
-- ============================================================================

CREATE OR REPLACE FUNCTION record_integration_effect_receipt(
  p_tenant_id TEXT,
  p_connection_id TEXT,
  p_event_id TEXT,
  p_target_key TEXT,
  p_inbox_id UUID DEFAULT NULL,
  p_worker_id TEXT DEFAULT 'inbox-worker',
  p_fencing_token INTEGER DEFAULT NULL,
  p_effect_type TEXT DEFAULT 'domain_mutation',
  p_result_json JSONB DEFAULT '{}'::JSONB,
  p_mark_inbox_complete BOOLEAN DEFAULT FALSE,
  p_now TIMESTAMPTZ DEFAULT NOW()
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now TIMESTAMPTZ := COALESCE(p_now, NOW());
  v_existing integration_effect_receipts%ROWTYPE;
  v_inbox integration_inbox%ROWTYPE;
  v_id UUID;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtext(
      'eff_rcpt:' || COALESCE(p_tenant_id, '') || ':' || COALESCE(p_connection_id, '') || ':' ||
      COALESCE(p_event_id, '') || ':' || COALESCE(p_target_key, '')
    )
  );

  IF p_inbox_id IS NOT NULL THEN
    SELECT * INTO v_inbox
    FROM integration_inbox
    WHERE id = p_inbox_id
    FOR UPDATE;

    IF FOUND THEN
      IF (
        v_inbox.lease_owner IS NOT NULL
        AND p_worker_id IS NOT NULL
        AND length(trim(p_worker_id)) > 0
        AND v_inbox.lease_owner <> trim(p_worker_id)
      ) OR (
        p_fencing_token IS NOT NULL
        AND v_inbox.attempt_count <> p_fencing_token
      ) THEN
        RAISE EXCEPTION 'INBOX_LEASE_LOST: Worker % (token %) lost lease on inbox % (owner %, token %)',
          p_worker_id, p_fencing_token, p_inbox_id, v_inbox.lease_owner, v_inbox.attempt_count;
      END IF;
    END IF;
  END IF;

  SELECT * INTO v_existing
  FROM integration_effect_receipts
  WHERE tenant_id = p_tenant_id
    AND connection_id = p_connection_id
    AND event_id = p_event_id
    AND target_key = p_target_key;

  IF FOUND THEN
    IF p_mark_inbox_complete AND p_inbox_id IS NOT NULL THEN
      UPDATE integration_inbox
      SET effect_applied_at = COALESCE(effect_applied_at, v_now),
          result_json = COALESCE(result_json, v_existing.result_json)
      WHERE id = p_inbox_id;
    END IF;
    RETURN jsonb_build_object(
      'outcome', 'already_applied',
      'idempotent', TRUE,
      'receipt_id', v_existing.id,
      'result_json', v_existing.result_json
    );
  END IF;

  INSERT INTO integration_effect_receipts (
    tenant_id,
    connection_id,
    event_id,
    target_key,
    inbox_id,
    worker_id,
    fencing_token,
    effect_type,
    result_json,
    applied_at
  ) VALUES (
    p_tenant_id,
    p_connection_id,
    p_event_id,
    p_target_key,
    p_inbox_id,
    COALESCE(NULLIF(trim(p_worker_id), ''), 'inbox-worker'),
    COALESCE(p_fencing_token, 1),
    COALESCE(NULLIF(trim(p_effect_type), ''), 'domain_mutation'),
    COALESCE(p_result_json, '{}'::JSONB),
    v_now
  )
  ON CONFLICT (tenant_id, connection_id, event_id, target_key) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT * INTO v_existing
    FROM integration_effect_receipts
    WHERE tenant_id = p_tenant_id
      AND connection_id = p_connection_id
      AND event_id = p_event_id
      AND target_key = p_target_key;
    IF p_mark_inbox_complete AND p_inbox_id IS NOT NULL THEN
      UPDATE integration_inbox
      SET effect_applied_at = COALESCE(effect_applied_at, v_now),
          result_json = COALESCE(result_json, v_existing.result_json)
      WHERE id = p_inbox_id;
    END IF;
    RETURN jsonb_build_object(
      'outcome', 'already_applied',
      'idempotent', TRUE,
      'receipt_id', v_existing.id,
      'result_json', v_existing.result_json
    );
  END IF;

  IF p_mark_inbox_complete AND p_inbox_id IS NOT NULL THEN
    UPDATE integration_inbox
    SET effect_applied_at = COALESCE(effect_applied_at, v_now),
        result_json = COALESCE(result_json, p_result_json)
    WHERE id = p_inbox_id;
  END IF;

  RETURN jsonb_build_object(
    'outcome', 'recorded',
    'idempotent', FALSE,
    'receipt_id', v_id,
    'result_json', COALESCE(p_result_json, '{}'::JSONB)
  );
END;
$$;

-- ============================================================================
-- 5. WMS Atomic POD Domain Mutation + Effect Receipt RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION apply_wms_tms_pod_target_atomic(
  p_tenant_id TEXT,
  p_connection_id TEXT,
  p_event_id TEXT,
  p_target_key TEXT,
  p_inbox_id UUID DEFAULT NULL,
  p_worker_id TEXT DEFAULT 'wms-webhook-worker',
  p_fencing_token INTEGER DEFAULT NULL,
  p_order_id TEXT DEFAULT NULL,
  p_order_no TEXT DEFAULT NULL,
  p_tms_job_id TEXT DEFAULT NULL,
  p_status TEXT DEFAULT 'In Transit',
  p_is_completed BOOLEAN DEFAULT FALSE,
  p_signature_url TEXT DEFAULT NULL,
  p_photo_urls JSONB DEFAULT '[]'::JSONB,
  p_delivery_date TIMESTAMPTZ DEFAULT NULL,
  p_receiver_name TEXT DEFAULT NULL,
  p_driver_name TEXT DEFAULT NULL,
  p_vehicle_plate TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_has_incidents BOOLEAN DEFAULT FALSE,
  p_incidents JSONB DEFAULT '[]'::JSONB,
  p_mark_inbox_complete BOOLEAN DEFAULT FALSE,
  p_now TIMESTAMPTZ DEFAULT NOW()
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now TIMESTAMPTZ := COALESCE(p_now, NOW());
  v_tenant TEXT := COALESCE(NULLIF(trim(p_tenant_id), ''), 'default');
  v_conn TEXT := COALESCE(NULLIF(trim(p_connection_id), ''), 'default');
  v_evt TEXT := NULLIF(trim(p_event_id), '');
  v_existing_receipt integration_effect_receipts%ROWTYPE;
  v_inbox integration_inbox%ROWTYPE;
  v_order RECORD;
  v_order_rows INTEGER := 0;
  v_order_found BOOLEAN := FALSE;
  v_order_key TEXT;
  v_already_delivered BOOLEAN := FALSE;
  v_rma_created BOOLEAN := FALSE;
  v_rma_id UUID;
  v_rma_no TEXT;
  v_pod_note TEXT := '';
  v_photo_str TEXT := '';
  v_inc_summary TEXT := '';
  v_inc_note TEXT := '';
  v_items_json JSONB := '[]'::JSONB;
  v_delivered_at TIMESTAMPTZ := COALESCE(p_delivery_date, v_now);
  v_res_json JSONB;
  v_agg_result JSONB;
  v_safe_job TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtext('eff_rcpt:' || v_tenant || ':' || v_conn || ':' || COALESCE(v_evt, '') || ':' || COALESCE(p_target_key, ''))
  );

  IF p_inbox_id IS NOT NULL THEN
    SELECT * INTO v_inbox
    FROM integration_inbox
    WHERE id = p_inbox_id
    FOR UPDATE;

    IF FOUND THEN
      IF (
        v_inbox.lease_owner IS NOT NULL
        AND p_worker_id IS NOT NULL
        AND length(trim(p_worker_id)) > 0
        AND v_inbox.lease_owner <> trim(p_worker_id)
      ) OR (
        p_fencing_token IS NOT NULL
        AND v_inbox.attempt_count <> p_fencing_token
      ) THEN
        RAISE EXCEPTION 'INBOX_LEASE_LOST: Worker % (token %) lost lease on inbox %',
          p_worker_id, p_fencing_token, p_inbox_id;
      END IF;
    END IF;
  END IF;

  IF v_evt IS NOT NULL THEN
    SELECT * INTO v_existing_receipt
    FROM integration_effect_receipts
    WHERE tenant_id = v_tenant
      AND connection_id = v_conn
      AND event_id = v_evt
      AND target_key = p_target_key;

    IF FOUND THEN
      IF p_mark_inbox_complete AND p_inbox_id IS NOT NULL THEN
        SELECT jsonb_build_object(
          'applied', COALESCE((SELECT jsonb_agg(r.result_json->>'orderKey' ORDER BY r.applied_at) FROM integration_effect_receipts r WHERE r.tenant_id = v_tenant AND r.connection_id = v_conn AND r.event_id = v_evt AND r.result_json->>'outcome' = 'applied'), '[]'::JSONB),
          'skippedIdempotent', COALESCE((SELECT jsonb_agg(r.result_json->>'orderKey' ORDER BY r.applied_at) FROM integration_effect_receipts r WHERE r.tenant_id = v_tenant AND r.connection_id = v_conn AND r.event_id = v_evt AND r.result_json->>'outcome' = 'skipped_idempotent'), '[]'::JSONB),
          'failed', '[]'::JSONB,
          'unmappedReviewQueue', '[]'::JSONB
        ) INTO v_agg_result;
        UPDATE integration_inbox
        SET effect_applied_at = COALESCE(effect_applied_at, v_now),
            result_json = COALESCE(result_json, v_agg_result)
        WHERE id = p_inbox_id;
      END IF;
      RETURN COALESCE(v_existing_receipt.result_json, '{}'::JSONB) || jsonb_build_object(
        'idempotent', TRUE,
        'receipt_reused', TRUE,
        'outcome', 'skipped_idempotent'
      );
    END IF;
  END IF;

  -- Locate target order in outbound_orders FOR UPDATE
  IF NULLIF(trim(p_order_id), '') IS NOT NULL THEN
    IF v_tenant <> 'default' THEN
      EXECUTE 'SELECT * FROM outbound_orders WHERE org_id::TEXT = $1 AND id::TEXT = $2 LIMIT 1 FOR UPDATE'
        INTO v_order USING v_tenant, trim(p_order_id);
    ELSE
      EXECUTE 'SELECT * FROM outbound_orders WHERE id::TEXT = $1 LIMIT 1 FOR UPDATE'
        INTO v_order USING trim(p_order_id);
    END IF;
    GET DIAGNOSTICS v_order_rows = ROW_COUNT;
    v_order_found := v_order_rows > 0;
  ELSIF NULLIF(trim(p_order_no), '') IS NOT NULL THEN
    IF v_tenant <> 'default' THEN
      EXECUTE 'SELECT * FROM outbound_orders WHERE org_id::TEXT = $1 AND order_no = $2 LIMIT 1 FOR UPDATE'
        INTO v_order USING v_tenant, trim(p_order_no);
    ELSE
      EXECUTE 'SELECT * FROM outbound_orders WHERE order_no = $1 LIMIT 1 FOR UPDATE'
        INTO v_order USING trim(p_order_no);
    END IF;
    GET DIAGNOSTICS v_order_rows = ROW_COUNT;
    v_order_found := v_order_rows > 0;
  ELSIF NULLIF(trim(p_tms_job_id), '') IS NOT NULL THEN
    v_safe_job := regexp_replace(trim(p_tms_job_id), '[^a-zA-Z0-9._-]', '', 'g');
    IF v_tenant <> 'default' THEN
      EXECUTE 'SELECT * FROM outbound_orders WHERE org_id::TEXT = $1 AND (tms_job_id = $2 OR tracking_no = $2) LIMIT 1 FOR UPDATE'
        INTO v_order USING v_tenant, v_safe_job;
    ELSE
      EXECUTE 'SELECT * FROM outbound_orders WHERE (tms_job_id = $1 OR tracking_no = $1) LIMIT 1 FOR UPDATE'
        INTO v_order USING v_safe_job;
    END IF;
    GET DIAGNOSTICS v_order_rows = ROW_COUNT;
    v_order_found := v_order_rows > 0;
  ELSE
    RETURN jsonb_build_object(
      'outcome', 'not_found',
      'ok', FALSE,
      'notFound', TRUE,
      'orderKey', 'UNKNOWN'
    );
  END IF;

  IF NOT v_order_found THEN
    RETURN jsonb_build_object(
      'outcome', 'not_found',
      'ok', FALSE,
      'notFound', TRUE,
      'orderKey', COALESCE(NULLIF(trim(p_order_no), ''), NULLIF(trim(p_order_id), ''), NULLIF(trim(p_tms_job_id), ''), 'UNKNOWN')
    );
  END IF;

  v_order_key := COALESCE(NULLIF(v_order.order_no, ''), v_order.id::TEXT);

  IF COALESCE(jsonb_array_length(COALESCE(p_incidents, '[]'::JSONB)), 0) > 0 THEN
    SELECT string_agg(
      COALESCE(elem->>'category', 'ปัญหาขนส่ง') ||
      CASE WHEN NULLIF(elem->>'description', '') IS NOT NULL THEN ': ' || (elem->>'description') ELSE '' END,
      ' | '
    ) INTO v_inc_summary
    FROM jsonb_array_elements(p_incidents) AS elem;
  END IF;

  IF COALESCE(p_is_completed, FALSE) THEN
    IF UPPER(COALESCE(v_order.status, '')) = 'DELIVERED'
       AND (NULLIF(trim(p_tms_job_id), '') IS NULL OR v_order.tms_job_id IS NULL OR v_order.tms_job_id = trim(p_tms_job_id)) THEN
      v_already_delivered := TRUE;
    ELSE
      v_already_delivered := FALSE;

      SELECT string_agg(part, ' · ') INTO v_pod_note
      FROM unnest(ARRAY[
        CASE WHEN NULLIF(trim(p_receiver_name), '') IS NOT NULL THEN 'ผู้รับ: ' || trim(p_receiver_name) END,
        CASE WHEN NULLIF(trim(p_driver_name), '') IS NOT NULL THEN 'คนขับ: ' || trim(p_driver_name) END,
        CASE WHEN NULLIF(trim(p_vehicle_plate), '') IS NOT NULL THEN 'ทะเบียน: ' || trim(p_vehicle_plate) END,
        CASE WHEN NULLIF(v_inc_summary, '') IS NOT NULL THEN '⚠️ แจ้งปัญหาขนส่ง/ชำรุด: ' || v_inc_summary END
      ]) AS part
      WHERE part IS NOT NULL;
      v_pod_note := COALESCE(NULLIF(v_pod_note, ''), 'ส่งมอบสำเร็จผ่านระบบ TMS ePOD');

      IF COALESCE(jsonb_array_length(COALESCE(p_photo_urls, '[]'::JSONB)), 0) > 0 THEN
        SELECT string_agg(val, ',') INTO v_photo_str
        FROM jsonb_array_elements_text(p_photo_urls) AS val;
      END IF;
      v_photo_str := COALESCE(NULLIF(v_photo_str, ''), COALESCE(v_order.pod_photo, ''));

      EXECUTE '
        UPDATE outbound_orders
        SET status = ''DELIVERED'',
            delivered_at = $1,
            pod_signature = COALESCE(NULLIF($2, ''''), pod_signature, ''''),
            pod_photo = $3,
            pod_note = $4,
            tms_status = ''Completed'',
            tms_synced_at = $5,
            updated_at = $5,
            driver_name = COALESCE(NULLIF($6, ''''), driver_name),
            vehicle_plate = COALESCE(NULLIF($7, ''''), vehicle_plate),
            tms_job_id = COALESCE(NULLIF($8, ''''), tms_job_id)
        WHERE id = $9'
        USING v_delivered_at, COALESCE(p_signature_url, ''), v_photo_str, v_pod_note, v_now,
              COALESCE(p_driver_name, ''), COALESCE(p_vehicle_plate, ''), COALESCE(p_tms_job_id, ''), v_order.id;

      IF to_regclass('public.audit_log') IS NOT NULL THEN
        EXECUTE '
          INSERT INTO audit_log (org_id, user_name, action, module, record_id, description, new_values)
          VALUES ($1, ''TMS ePOD Bot'', ''UPDATE'', ''ORDERS'', $2, $3, $4)'
          USING v_order.org_id,
                v_order.id::TEXT,
                'ปิดออเดอร์อัตโนมัติ ' || v_order_key || ' เป็น DELIVERED ผ่าน TMS (คนขับ: ' || COALESCE(NULLIF(trim(p_driver_name), ''), '-') || ')',
                jsonb_build_object(
                  'status', 'DELIVERED',
                  'pod_signature', CASE WHEN NULLIF(trim(p_signature_url), '') IS NOT NULL THEN 'มี' ELSE 'ไม่มี' END,
                  'photos_count', COALESCE(jsonb_array_length(COALESCE(p_photo_urls, '[]'::JSONB)), 0)
                );
      END IF;
    END IF;

    IF COALESCE(p_has_incidents, FALSE)
       AND COALESCE(jsonb_array_length(COALESCE(p_incidents, '[]'::JSONB)), 0) > 0
       AND to_regclass('public.return_orders') IS NOT NULL THEN
      EXECUTE 'SELECT id, rma_no FROM return_orders WHERE org_id::TEXT = $1 AND order_no = $2 LIMIT 1 FOR UPDATE'
        INTO v_rma_id, v_rma_no USING v_order.org_id::TEXT, v_order.order_no;

      IF v_rma_id IS NULL THEN
        v_rma_no := 'RMA-' || to_char(v_now, 'YYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::TEXT, '-', ''), 1, 6));
        v_items_json := COALESCE(v_order.items_json, '[]'::JSONB);
        EXECUTE '
          INSERT INTO return_orders (org_id, rma_no, order_no, customer_name, reason, status, disposition, items_json, created_by, notes)
          VALUES ($1, $2, $3, $4, $5, ''REQUESTED'', ''QUARANTINE'', $6, ''TMS ePOD Bot'', $7)'
          USING v_order.org_id,
                v_rma_no,
                v_order.order_no,
                COALESCE(v_order.customer_name, ''),
                'แจ้งชำรุด/ปัญหาขนส่ง: ' || COALESCE(NULLIF(v_inc_summary, ''), 'TMS Damage Incident'),
                v_items_json,
                'สร้างอัตโนมัติจากรายงานปัญหาคนขับ TMS (คนขับ: ' || COALESCE(NULLIF(trim(p_driver_name), ''), '-') || ', ทะเบียน: ' || COALESCE(NULLIF(trim(p_vehicle_plate), ''), '-') || ')';
        v_rma_created := TRUE;
      END IF;
    END IF;
  ELSE
    IF UPPER(COALESCE(v_order.status, '')) = 'DELIVERED' THEN
      v_already_delivered := TRUE;
    ELSE
      v_already_delivered := FALSE;
      IF COALESCE(p_has_incidents, FALSE) AND NULLIF(v_inc_summary, '') IS NOT NULL THEN
        v_inc_note := '⚠️ ตรวจพบปัญหาขนส่งระหว่างทาง: ' || v_inc_summary;
      END IF;
      EXECUTE '
        UPDATE outbound_orders
        SET tms_status = $1,
            tms_synced_at = $2,
            updated_at = $2,
            driver_name = COALESCE(NULLIF($3, ''''), driver_name),
            vehicle_plate = COALESCE(NULLIF($4, ''''), vehicle_plate),
            pod_note = CASE WHEN $5 <> '''' THEN $5 ELSE pod_note END
        WHERE id = $6'
        USING COALESCE(NULLIF(trim(p_status), ''), 'In Transit'),
              v_now,
              COALESCE(p_driver_name, ''),
              COALESCE(p_vehicle_plate, ''),
              v_inc_note,
              v_order.id;
    END IF;
  END IF;

  v_res_json := jsonb_build_object(
    'outcome', CASE WHEN v_already_delivered THEN 'skipped_idempotent' ELSE 'applied' END,
    'ok', TRUE,
    'idempotent', v_already_delivered,
    'orderKey', v_order_key,
    'orderId', v_order.id::TEXT,
    'rmaCreated', v_rma_created,
    'rmaNo', v_rma_no
  );

  IF v_evt IS NOT NULL THEN
    INSERT INTO integration_effect_receipts (
      tenant_id,
      connection_id,
      event_id,
      target_key,
      inbox_id,
      worker_id,
      fencing_token,
      effect_type,
      result_json,
      applied_at
    ) VALUES (
      v_tenant,
      v_conn,
      v_evt,
      p_target_key,
      p_inbox_id,
      COALESCE(NULLIF(trim(p_worker_id), ''), 'wms-webhook-worker'),
      COALESCE(p_fencing_token, 1),
      'wms_pod_target',
      v_res_json,
      v_now
    )
    ON CONFLICT (tenant_id, connection_id, event_id, target_key) DO NOTHING;

    IF p_mark_inbox_complete AND p_inbox_id IS NOT NULL THEN
      SELECT jsonb_build_object(
        'applied', COALESCE((SELECT jsonb_agg(r.result_json->>'orderKey' ORDER BY r.applied_at) FROM integration_effect_receipts r WHERE r.tenant_id = v_tenant AND r.connection_id = v_conn AND r.event_id = v_evt AND r.result_json->>'outcome' = 'applied'), '[]'::JSONB),
        'skippedIdempotent', COALESCE((SELECT jsonb_agg(r.result_json->>'orderKey' ORDER BY r.applied_at) FROM integration_effect_receipts r WHERE r.tenant_id = v_tenant AND r.connection_id = v_conn AND r.event_id = v_evt AND r.result_json->>'outcome' = 'skipped_idempotent'), '[]'::JSONB),
        'failed', '[]'::JSONB,
        'unmappedReviewQueue', '[]'::JSONB
      ) INTO v_agg_result;
      UPDATE integration_inbox
      SET effect_applied_at = COALESCE(effect_applied_at, v_now),
          result_json = COALESCE(result_json, v_agg_result)
      WHERE id = p_inbox_id;
    END IF;
  END IF;

  RETURN v_res_json;
END;
$$;

-- ============================================================================
-- 6. TMS Atomic Job Creation + Scan Seed + Quota Commit + Receipt RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION apply_tms_job_create_atomic(
  p_tenant_id TEXT,
  p_connection_id TEXT,
  p_event_id TEXT,
  p_target_key TEXT,
  p_inbox_id UUID DEFAULT NULL,
  p_worker_id TEXT DEFAULT 'tms-api-worker',
  p_fencing_token INTEGER DEFAULT NULL,
  p_job_payload JSONB DEFAULT '{}'::JSONB,
  p_scan_rows JSONB DEFAULT '[]'::JSONB,
  p_quota_resource TEXT DEFAULT NULL,
  p_quota_event_id TEXT DEFAULT NULL,
  p_mark_inbox_complete BOOLEAN DEFAULT TRUE,
  p_now TIMESTAMPTZ DEFAULT NOW()
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now TIMESTAMPTZ := COALESCE(p_now, NOW());
  v_tenant TEXT := COALESCE(NULLIF(trim(p_tenant_id), ''), 'default');
  v_conn TEXT := COALESCE(NULLIF(trim(p_connection_id), ''), 'default');
  v_evt TEXT := NULLIF(trim(p_event_id), '');
  v_existing_receipt integration_effect_receipts%ROWTYPE;
  v_inbox integration_inbox%ROWTYPE;
  v_job_id TEXT := NULLIF(trim(p_job_payload->>'Job_ID'), '');
  v_existing_job_id TEXT;
  v_scan_count INTEGER := 0;
  v_res_json JSONB;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtext('eff_rcpt:' || v_tenant || ':' || v_conn || ':' || COALESCE(v_evt, '') || ':' || COALESCE(p_target_key, ''))
  );

  IF p_inbox_id IS NOT NULL THEN
    SELECT * INTO v_inbox
    FROM integration_inbox
    WHERE id = p_inbox_id
    FOR UPDATE;

    IF FOUND THEN
      IF (
        v_inbox.lease_owner IS NOT NULL
        AND p_worker_id IS NOT NULL
        AND length(trim(p_worker_id)) > 0
        AND v_inbox.lease_owner <> trim(p_worker_id)
      ) OR (
        p_fencing_token IS NOT NULL
        AND v_inbox.attempt_count <> p_fencing_token
      ) THEN
        RAISE EXCEPTION 'INBOX_LEASE_LOST: Worker % (token %) lost lease on inbox %',
          p_worker_id, p_fencing_token, p_inbox_id;
      END IF;
    END IF;
  END IF;

  IF v_evt IS NOT NULL THEN
    SELECT * INTO v_existing_receipt
    FROM integration_effect_receipts
    WHERE tenant_id = v_tenant
      AND connection_id = v_conn
      AND event_id = v_evt
      AND target_key = p_target_key;

    IF FOUND THEN
      IF p_mark_inbox_complete AND p_inbox_id IS NOT NULL THEN
        UPDATE integration_inbox
        SET effect_applied_at = COALESCE(effect_applied_at, v_now)
        WHERE id = p_inbox_id;
      END IF;
      RETURN COALESCE(v_existing_receipt.result_json, '{}'::JSONB) || jsonb_build_object(
        'idempotent', TRUE,
        'receipt_reused', TRUE
      );
    END IF;
  END IF;

  IF v_job_id IS NULL THEN
    RAISE EXCEPTION 'Job_ID is required in p_job_payload';
  END IF;

  IF to_regclass('public."Jobs_Main"') IS NOT NULL THEN
    EXECUTE 'SELECT "Job_ID" FROM "Jobs_Main" WHERE "Job_ID" = $1 FOR UPDATE'
      INTO v_existing_job_id USING v_job_id;

    IF v_existing_job_id IS NULL THEN
      EXECUTE '
        INSERT INTO "Jobs_Main" (
          "Job_ID", "Customer_ID", "Customer_Name", "Origin_Location", "Dest_Location",
          "Vehicle_Type", "Cargo_Type", "Weight_Kg", "Plan_Date", "Job_Status",
          "Notes", "Created_At", "Branch_ID", "Driver_ID", "Driver_Name", "Vehicle_Plate",
          "Sub_ID", "Total_Drop", "original_destinations_json"
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, NULLIF($8, '''')::NUMERIC, NULLIF($9, '''')::DATE, COALESCE(NULLIF($10, ''''), ''New''),
          $11, COALESCE(NULLIF($12, ''''), $13::TEXT), NULLIF($14, ''''), NULLIF($15, ''''), NULLIF($16, ''''), NULLIF($17, ''''),
          NULLIF($18, ''''), NULLIF($19, '''')::BIGINT, NULLIF($20, '''')
        )'
        USING v_job_id,
              p_job_payload->>'Customer_ID',
              p_job_payload->>'Customer_Name',
              p_job_payload->>'Origin_Location',
              p_job_payload->>'Dest_Location',
              COALESCE(NULLIF(p_job_payload->>'Vehicle_Type', ''), '4-Wheel'),
              COALESCE(NULLIF(p_job_payload->>'Cargo_Type', ''), 'พัสดุทั่วไป'),
              COALESCE(p_job_payload->>'Weight_Kg', ''),
              COALESCE(p_job_payload->>'Plan_Date', ''),
              COALESCE(p_job_payload->>'Job_Status', 'New'),
              p_job_payload->>'Notes',
              COALESCE(p_job_payload->>'Created_At', ''),
              v_now,
              COALESCE(p_job_payload->>'Branch_ID', ''),
              COALESCE(p_job_payload->>'Driver_ID', ''),
              COALESCE(p_job_payload->>'Driver_Name', ''),
              COALESCE(p_job_payload->>'Vehicle_Plate', ''),
              COALESCE(p_job_payload->>'Sub_ID', ''),
              COALESCE(p_job_payload->>'Total_Drop', ''),
              COALESCE(p_job_payload->>'original_destinations_json', '');
    ELSE
      EXECUTE '
        UPDATE "Jobs_Main"
        SET "Customer_ID" = COALESCE($2, "Customer_ID"),
            "Customer_Name" = COALESCE($3, "Customer_Name"),
            "Origin_Location" = COALESCE($4, "Origin_Location"),
            "Dest_Location" = COALESCE($5, "Dest_Location"),
            "Notes" = COALESCE($6, "Notes")
        WHERE "Job_ID" = $1'
        USING v_job_id,
              p_job_payload->>'Customer_ID',
              p_job_payload->>'Customer_Name',
              p_job_payload->>'Origin_Location',
              p_job_payload->>'Dest_Location',
              p_job_payload->>'Notes';
    END IF;
  END IF;

  IF COALESCE(jsonb_array_length(COALESCE(p_scan_rows, '[]'::JSONB)), 0) > 0
     AND to_regclass('public."Job_Scans"') IS NOT NULL THEN
    EXECUTE 'SELECT COUNT(*)::INTEGER FROM "Job_Scans" WHERE "Job_ID" = $1 AND phase = ''pickup'''
      INTO v_scan_count USING v_job_id;
    IF COALESCE(v_scan_count, 0) = 0 THEN
      EXECUTE '
        INSERT INTO "Job_Scans" ("Job_ID", drop_index, phase, code, label, qty, driver_id, created_at)
        SELECT $1,
               CASE WHEN elem->>''drop_index'' IS NOT NULL THEN (elem->>''drop_index'')::BIGINT ELSE NULL END,
               COALESCE(NULLIF(elem->>''phase'', ''''), ''pickup''),
               NULLIF(elem->>''code'', ''''),
               NULLIF(elem->>''label'', ''''),
               COALESCE(NULLIF(elem->>''qty'', '''')::NUMERIC, 1),
               NULLIF(elem->>''driver_id'', ''''),
               $2
        FROM jsonb_array_elements($3) AS elem'
        USING v_job_id, v_now, p_scan_rows;
    END IF;
  END IF;

  IF NULLIF(trim(p_quota_resource), '') IS NOT NULL
     AND NULLIF(trim(p_quota_event_id), '') IS NOT NULL
     AND to_regclass('public.quota_reservations') IS NOT NULL THEN
    UPDATE quota_reservations
    SET status = 'committed',
        updated_at = v_now
    WHERE tenant_id = v_tenant
      AND module = 'tms'
      AND resource = trim(p_quota_resource)
      AND event_id = trim(p_quota_event_id)
      AND status = 'reserved';
  END IF;

  v_res_json := jsonb_build_object(
    'job_id', v_job_id,
    'idempotent', FALSE,
    'created', v_existing_job_id IS NULL
  );

  IF v_evt IS NOT NULL THEN
    INSERT INTO integration_effect_receipts (
      tenant_id,
      connection_id,
      event_id,
      target_key,
      inbox_id,
      worker_id,
      fencing_token,
      effect_type,
      result_json,
      applied_at
    ) VALUES (
      v_tenant,
      v_conn,
      v_evt,
      p_target_key,
      p_inbox_id,
      COALESCE(NULLIF(trim(p_worker_id), ''), 'tms-api-worker'),
      COALESCE(p_fencing_token, 1),
      'tms_job_create',
      v_res_json,
      v_now
    )
    ON CONFLICT (tenant_id, connection_id, event_id, target_key) DO NOTHING;

    IF p_mark_inbox_complete AND p_inbox_id IS NOT NULL THEN
      UPDATE integration_inbox
      SET effect_applied_at = COALESCE(effect_applied_at, v_now),
          result_json = COALESCE(result_json, v_res_json)
      WHERE id = p_inbox_id;
    END IF;
  END IF;

  RETURN v_res_json;
END;
$$;

-- ============================================================================
-- 7. HR Atomic Payroll Post + Effect Receipt + Inbox Fencing RPC
-- ============================================================================

DROP FUNCTION IF EXISTS post_payroll_import_batch(TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS post_payroll_import_batch(TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, INTEGER);

DO $$
BEGIN
  IF to_regclass('public.payroll_import_batches') IS NOT NULL THEN
    CREATE OR REPLACE FUNCTION post_payroll_import_batch(
      p_tenant_id TEXT,
      p_batch_id TEXT,
      p_actor_id TEXT,
      p_event_id TEXT DEFAULT NULL,
      p_connection_id TEXT DEFAULT NULL,
      p_inbox_id UUID DEFAULT NULL,
      p_worker_id TEXT DEFAULT NULL,
      p_fencing_token INTEGER DEFAULT NULL
    )
    RETURNS payroll_import_batches
    LANGUAGE plpgsql
    SET search_path = public, pg_temp
    AS $fn$
    DECLARE
      v_batch payroll_import_batches;
      v_inbox_owner TEXT;
      v_inbox_attempt INTEGER;
      v_inbox_rows INTEGER := 0;
      v_receipt_id UUID;
      v_locked BOOLEAN := FALSE;
      v_has_driving_pay BOOLEAN := FALSE;
      v_adjustments JSONB := '[]'::JSONB;
      v_slip payroll_slips;
      v_base_salary NUMERIC := 0;
      v_delta_dec NUMERIC := 0;
      v_next_bonus NUMERIC := 0;
      v_next_driving NUMERIC := 0;
      v_next_net NUMERIC := 0;
      v_conn TEXT;
      v_target_key TEXT := 'payroll_post:' || p_batch_id;
      v_line RECORD;
      v_prior_minor BIGINT;
      r RECORD;
    BEGIN
      IF p_actor_id IS NULL OR length(trim(p_actor_id)) = 0 THEN
        RAISE EXCEPTION 'ACTOR_REQUIRED: actorId is required';
      END IF;

      IF p_inbox_id IS NOT NULL AND to_regclass('public.integration_inbox') IS NOT NULL THEN
        EXECUTE 'SELECT lease_owner, attempt_count FROM integration_inbox WHERE id = $1 FOR UPDATE'
          INTO v_inbox_owner, v_inbox_attempt USING p_inbox_id;
        GET DIAGNOSTICS v_inbox_rows = ROW_COUNT;

        IF v_inbox_rows > 0 THEN
          IF (
            v_inbox_owner IS NOT NULL
            AND p_worker_id IS NOT NULL
            AND length(trim(p_worker_id)) > 0
            AND v_inbox_owner <> trim(p_worker_id)
          ) OR (
            p_fencing_token IS NOT NULL
            AND v_inbox_attempt <> p_fencing_token
          ) THEN
            RAISE EXCEPTION 'INBOX_LEASE_LOST: Worker % (token %) lost lease on inbox %',
              p_worker_id, p_fencing_token, p_inbox_id;
          END IF;
        END IF;
      END IF;

      SELECT * INTO v_batch
      FROM payroll_import_batches
      WHERE batch_id = p_batch_id
        AND tenant_id = p_tenant_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_FOUND: Import batch % not found', p_batch_id;
      END IF;

      v_conn := COALESCE(NULLIF(trim(p_connection_id), ''), v_batch.connection_id, 'default');

      IF NULLIF(trim(p_event_id), '') IS NOT NULL
         AND to_regclass('public.integration_effect_receipts') IS NOT NULL THEN
        EXECUTE 'SELECT id FROM integration_effect_receipts WHERE tenant_id = $1 AND connection_id = $2 AND event_id = $3 AND target_key = $4 LIMIT 1'
          INTO v_receipt_id USING p_tenant_id, v_conn, trim(p_event_id), v_target_key;

        IF v_receipt_id IS NOT NULL AND v_batch.status = 'posted' THEN
          IF p_inbox_id IS NOT NULL AND to_regclass('public.integration_inbox') IS NOT NULL THEN
            EXECUTE 'UPDATE integration_inbox SET effect_applied_at = COALESCE(effect_applied_at, NOW()), result_json = COALESCE(result_json, $1) WHERE id = $2'
              USING to_jsonb(v_batch), p_inbox_id;
          END IF;
          RETURN v_batch;
        END IF;
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

      SELECT EXISTS(
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'payroll_slips'
          AND column_name = 'driving_pay'
      ) INTO v_has_driving_pay;

      IF v_has_driving_pay THEN
        FOR v_line IN
          SELECT * FROM payroll_import_lines
          WHERE batch_id = p_batch_id
            AND tenant_id = p_tenant_id
            AND disposition IN ('imported_payable', 'imported_revision_delta')
            AND NOT reversed
          ORDER BY source_earning_line_id
        LOOP
          PERFORM pg_advisory_xact_lock(hashtextextended('tms-source:' || p_tenant_id || ':' || v_batch.connection_id || ':' || v_line.source_earning_line_id, 0));
          IF to_regclass('public.driver_employee_links') IS NOT NULL AND to_regclass('public.users') IS NOT NULL THEN
            IF NOT EXISTS (
              SELECT 1 FROM driver_employee_links link
              JOIN users u ON u.employee_id = link.hr_employee_id
              WHERE link.tenant_id = p_tenant_id
                AND link.connection_id = v_batch.connection_id
                AND link.active
                AND link.tms_driver_id = v_line.tms_driver_id
                AND link.hr_employee_id = v_line.hr_employee_id
                AND nullif(trim(link.verified_by), '') IS NOT NULL
                AND link.employment_classification <> 'subcontractor'
                AND (link.effective_from IS NULL OR link.effective_from <= v_line.recognition_date::date)
                AND (link.effective_to IS NULL OR link.effective_to >= v_line.recognition_date::date)
                AND u.status = 'active'
            ) THEN
              RAISE EXCEPTION 'INVALID_STATE: Driver mapping or employee changed; review batch again';
            END IF;
          END IF;
          IF EXISTS (
            SELECT 1 FROM payroll_import_lines prior
            JOIN payroll_import_batches b ON b.batch_id = prior.batch_id
            WHERE prior.tenant_id = p_tenant_id
              AND prior.connection_id = v_batch.connection_id
              AND prior.source_earning_line_id = v_line.source_earning_line_id
              AND prior.batch_id <> p_batch_id
              AND NOT prior.reversed
              AND b.status = 'posted'
              AND prior.disposition IN ('imported_payable', 'imported_revision_delta')
              AND (prior.source_revision >= v_line.source_revision OR prior.period <> v_batch.period OR prior.hr_employee_id IS DISTINCT FROM v_line.hr_employee_id)
          ) THEN
            RAISE EXCEPTION 'INVALID_STATE: Source revision or recipient changed; reconcile import';
          END IF;
          SELECT COALESCE(SUM(prior.payable_minor), 0) INTO v_prior_minor
          FROM payroll_import_lines prior
          JOIN payroll_import_batches b ON b.batch_id = prior.batch_id
          WHERE prior.tenant_id = p_tenant_id
            AND prior.connection_id = v_batch.connection_id
            AND prior.source_earning_line_id = v_line.source_earning_line_id
            AND prior.batch_id <> p_batch_id
            AND NOT prior.reversed
            AND b.status = 'posted'
            AND prior.disposition IN ('imported_payable', 'imported_revision_delta');
          IF v_line.payable_minor <> v_line.amount_minor - v_prior_minor THEN
            RAISE EXCEPTION 'INVALID_STATE: Source delta changed; rebuild and review batch';
          END IF;
        END LOOP;
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

          IF v_has_driving_pay THEN
            EXECUTE 'SELECT ROUND((COALESCE(driving_pay, 0) + $1)::NUMERIC, 2) FROM payroll_slips WHERE id = $2'
              INTO v_next_driving USING v_delta_dec, v_slip.id;
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
            EXECUTE 'UPDATE payroll_slips SET driving_pay = $1, net = $2, recalculation_required = TRUE WHERE id = $3'
              USING v_next_driving, v_next_net, v_slip.id;

            v_adjustments := v_adjustments || jsonb_build_object(
              'employeeId', r.hr_employee_id,
              'slipId', v_slip.id,
              'deltaDecimal', v_delta_dec,
              'incomeField', 'driving_pay',
              'createdSlip', FALSE
            );
          ELSE
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
          END IF;
        ELSIF v_delta_dec > 0 THEN
          SELECT COALESCE(salary, 0) INTO v_base_salary
          FROM employee_records
          WHERE employee_id = r.hr_employee_id;

          v_base_salary := COALESCE(v_base_salary, 0);

          IF v_has_driving_pay THEN
            EXECUTE '
              INSERT INTO payroll_slips (
                employee_id, period, status, calculation_version, recalculation_required,
                base_salary, ot_pay, driving_pay, reimbursements, tax, sso, deduction, net
              ) VALUES (
                $1, $2, ''draft'', 2, TRUE, $3, 0, $4, 0, 0, 0, 0, $5
              ) RETURNING *'
              INTO v_slip
              USING r.hr_employee_id, v_batch.period, v_base_salary, v_delta_dec, (v_base_salary + v_delta_dec);

            v_adjustments := v_adjustments || jsonb_build_object(
              'employeeId', r.hr_employee_id,
              'slipId', v_slip.id,
              'deltaDecimal', v_delta_dec,
              'incomeField', 'driving_pay',
              'createdSlip', TRUE
            );
          ELSE
            INSERT INTO payroll_slips (
              employee_id, period, status, calculation_version,
              base_salary, ot_pay, bonus, reimbursements, tax, sso, deduction, net
            ) VALUES (
              r.hr_employee_id, v_batch.period, 'draft', 2,
              v_base_salary, 0, v_delta_dec, 0, 0, 0, 0, v_base_salary + v_delta_dec
            )
            RETURNING * INTO v_slip;

            v_adjustments := v_adjustments || jsonb_build_object(
              'employeeId', r.hr_employee_id,
              'slipId', v_slip.id,
              'deltaDecimal', v_delta_dec,
              'createdSlip', TRUE
            );
          END IF;
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

      IF NULLIF(trim(p_event_id), '') IS NOT NULL
         AND to_regclass('public.integration_effect_receipts') IS NOT NULL THEN
        EXECUTE '
          INSERT INTO integration_effect_receipts (
            tenant_id, connection_id, event_id, target_key, inbox_id,
            worker_id, fencing_token, effect_type, result_json, applied_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, ''hr_payroll_post'', $8, NOW()
          )
          ON CONFLICT (tenant_id, connection_id, event_id, target_key) DO NOTHING'
          USING p_tenant_id,
                v_conn,
                trim(p_event_id),
                v_target_key,
                p_inbox_id,
                COALESCE(NULLIF(trim(p_worker_id), ''), trim(p_actor_id), 'hr-payroll-worker'),
                COALESCE(p_fencing_token, 1),
                to_jsonb(v_batch);

        IF p_inbox_id IS NOT NULL AND to_regclass('public.integration_inbox') IS NOT NULL THEN
          EXECUTE 'UPDATE integration_inbox SET effect_applied_at = COALESCE(effect_applied_at, NOW()), result_json = COALESCE(result_json, $1) WHERE id = $2'
            USING to_jsonb(v_batch), p_inbox_id;
        END IF;
      END IF;

      RETURN v_batch;
    END;
    $fn$;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      REVOKE ALL ON FUNCTION post_payroll_import_batch(TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, INTEGER) FROM public, anon, authenticated;
      GRANT EXECUTE ON FUNCTION post_payroll_import_batch(TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, INTEGER) TO service_role;
    END IF;
  END IF;
END $$;
