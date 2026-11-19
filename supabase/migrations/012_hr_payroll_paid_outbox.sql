BEGIN;
CREATE OR REPLACE FUNCTION enqueue_hr_payroll_paid(p_slip_id bigint) RETURNS void
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE s payroll_slips; r record; body jsonb;
BEGIN
 SELECT * INTO s FROM payroll_slips WHERE id=p_slip_id;
 IF NOT FOUND OR s.status <> 'paid' THEN RETURN; END IF;
 FOR r IN
  SELECT x.tenant_id,x.connection_id,jsonb_agg(x.line ORDER BY x.job_id) lines FROM (
    SELECT l.tenant_id,l.connection_id,l.job_id,
      jsonb_build_object('job_id',l.job_id,'driver_id',l.tms_driver_id,
        'revision',max(l.source_revision),'amount_minor',sum(l.payable_minor),'currency','THB') line
    FROM payroll_import_lines l JOIN payroll_import_batches b ON b.batch_id=l.batch_id AND b.tenant_id=l.tenant_id
    WHERE b.status='posted' AND l.reversed=false AND l.hr_employee_id=s.employee_id AND l.period=s.period
      AND l.disposition IN ('imported_payable','imported_revision_delta')
    GROUP BY l.tenant_id,l.connection_id,l.job_id,l.tms_driver_id
    HAVING sum(l.payable_minor)>0
  ) x GROUP BY x.tenant_id,x.connection_id
 LOOP
  body := jsonb_build_object('slip_id',s.id::text,'period',s.period,'paid_at',s.paid_at,'lines',r.lines);
  INSERT INTO integration_outbox(tenant_id,connection_id,event_id,aggregate_id,aggregate_version,event_type,schema_version,payload,payload_hash)
  VALUES(r.tenant_id,r.connection_id,'hr-paid:'||r.tenant_id||':'||s.id||':'||r.connection_id,
    'hr-slip:'||s.id,1,'hr.payroll.paid','2.0.0',body,encode(sha256(convert_to(body::text,'UTF8')),'hex'))
  ON CONFLICT(connection_id,event_id) DO NOTHING;
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION on_hr_payroll_paid() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.status='paid' AND OLD.status IS DISTINCT FROM 'paid' THEN PERFORM enqueue_hr_payroll_paid(NEW.id); END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS hr_payroll_paid_outbox ON payroll_slips;
CREATE TRIGGER hr_payroll_paid_outbox AFTER UPDATE OF status ON payroll_slips FOR EACH ROW EXECUTE FUNCTION on_hr_payroll_paid();
REVOKE ALL ON FUNCTION enqueue_hr_payroll_paid(bigint) FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION enqueue_hr_payroll_paid(bigint) TO service_role;
-- Catch up confirmed historical slips without confirming any unpaid slip.
SELECT enqueue_hr_payroll_paid(id) FROM payroll_slips WHERE status='paid' AND coalesce(driving_pay,0)>0;
NOTIFY pgrst,'reload schema';
COMMIT;
