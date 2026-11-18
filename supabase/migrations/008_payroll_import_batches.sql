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
