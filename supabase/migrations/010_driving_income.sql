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
