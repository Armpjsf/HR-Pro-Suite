-- Audit fixes. Apply after phases 1–20, in staging first. No historical values
-- are inferred or rewritten. Duplicate employee/period rows abort the migration.
begin;
alter table payroll_slips add column if not exists reimbursements numeric not null default 0;
alter table payroll_slips add column if not exists calculation_version integer not null default 1;
alter table payroll_slips add column if not exists paid_at timestamptz;
alter table payroll_slips add column if not exists notification_status text not null default 'pending';
alter table payroll_slips add column if not exists notification_error text;
create unique index if not exists payroll_slips_employee_period_unique on payroll_slips(employee_id, period);
create unique index if not exists time_records_employee_date_unique on time_records(employee_id, work_date);
alter table leave_requests add column if not exists session text not null default 'full';
alter table leave_requests add column if not exists work_dates date[];
alter table time_records add column if not exists leave_request_id bigint references leave_requests(id);
alter table document_requests add column if not exists issued_snapshot jsonb;
alter table documents add column if not exists indexing_status text not null default 'unknown';

create or replace function protect_paid_payroll() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if old.status='paid' and (to_jsonb(new)-array['notification_status','notification_error','notified_at'])
    is distinct from (to_jsonb(old)-array['notification_status','notification_error','notified_at']) then
    raise exception 'Paid payroll is immutable; use an audited correction instead';
  end if;
  return new;
end $$;
drop trigger if exists payroll_paid_immutable on payroll_slips;
create trigger payroll_paid_immutable before update on payroll_slips for each row execute function protect_paid_payroll();

create or replace function protect_issued_certificate() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if old.status='approved' and old.issued_snapshot is not null and to_jsonb(new) is distinct from to_jsonb(old) then
    raise exception 'Issued certificate is immutable; create a new request';
  end if;
  return new;
end $$;
drop trigger if exists certificate_issued_immutable on document_requests;
create trigger certificate_issued_immutable before update on document_requests for each row execute function protect_issued_certificate();

create or replace function protect_closed_payroll_inputs() returns trigger language plpgsql set search_path=public,pg_temp as $$
declare source_date text;
begin
  if tg_op in ('UPDATE','DELETE') and old.status='paid' then
    raise exception 'รายการนี้อยู่ในงวดที่จ่ายแล้ว กรุณาใช้ขั้นตอนปรับปรุงย้อนหลัง';
  end if;
  if tg_op='DELETE' then return old; end if;
  source_date := coalesce(to_jsonb(new)->>'ot_date',to_jsonb(new)->>'claim_date');
  if new.status='approved' and exists(select 1 from payroll_slips where employee_id=new.employee_id and period=left(source_date,7) and status='paid') then
    raise exception 'งวดนี้จ่ายแล้ว ไม่สามารถเพิ่มรายการอนุมัติย้อนหลังได้';
  end if;
  return new;
end $$;
drop trigger if exists ot_closed_payroll_guard on ot_records;
create trigger ot_closed_payroll_guard before insert or update or delete on ot_records for each row execute function protect_closed_payroll_inputs();
drop trigger if exists expenses_closed_payroll_guard on expense_claims;
create trigger expenses_closed_payroll_guard before insert or update or delete on expense_claims for each row execute function protect_closed_payroll_inputs();

-- Preserve existing HR access explicitly; the application no longer grants
-- every menu on an absent/erroring permission query.
insert into role_permissions(role, menus) values ('hr', array['__all__']::text[])
on conflict (role) do nothing;

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
    update payroll_slips set base_salary=incoming.base_salary, ot_pay=incoming.ot_pay,
      bonus=incoming.bonus, reimbursements=incoming.reimbursements, tax=incoming.tax,
      sso=incoming.sso, deduction=incoming.deduction, net=incoming.net, calculation_version=2
      where id=old.id;
    return 'updated';
  end if;
  insert into payroll_slips(employee_id,period,base_salary,ot_pay,bonus,reimbursements,tax,sso,deduction,net,status,calculation_version)
    values(incoming.employee_id,incoming.period,incoming.base_salary,incoming.ot_pay,incoming.bonus,
      incoming.reimbursements,incoming.tax,incoming.sso,incoming.deduction,incoming.net,'draft',2);
  return 'created';
end $$;

create or replace function confirm_payroll_payment(p_period text default null, p_slip_id bigint default null)
returns setof payroll_slips language plpgsql set search_path = public, pg_temp as $$
declare s payroll_slips; period_start date; period_end date; approved_ot numeric; approved_expenses numeric;
begin
  if p_slip_id is null and (p_period is null or p_period !~ '^\d{4}-(0[1-9]|1[0-2])$') then raise exception 'Invalid payment target'; end if;
  lock table ot_records,expense_claims in share row exclusive mode;
  -- Lock every selected row before checking the batch. Any invalid row aborts all.
  perform 1 from payroll_slips where (p_slip_id is not null and id=p_slip_id)
    or (p_slip_id is null and period=p_period) order by id for update;
  if exists(select 1 from payroll_slips where ((p_slip_id is not null and id=p_slip_id)
    or (p_slip_id is null and period=p_period)) and status <> 'paid' and (status <> 'draft' or calculation_version <> 2)) then
    raise exception 'Reconcile legacy payroll before confirming payment';
  end if;
  for s in select * from payroll_slips where ((p_slip_id is not null and id=p_slip_id)
    or (p_slip_id is null and period=p_period)) and status='draft' order by id loop
    period_start := (s.period || '-01')::date;
    period_end := (period_start + interval '1 month - 1 day')::date;
    select coalesce(sum(amount),0) into approved_ot from ot_records where employee_id=s.employee_id and status='approved' and ot_date between period_start and period_end;
    select coalesce(sum(amount),0) into approved_expenses from expense_claims where employee_id=s.employee_id and status='approved' and claim_date between period_start and period_end;
    if approved_ot<>s.ot_pay or approved_expenses<>s.reimbursements then
      raise exception 'ยอด OT หรือค่าใช้จ่ายเปลี่ยนหลังคำนวณ กรุณาคำนวณสลิปใหม่ก่อนยืนยันจ่าย';
    end if;
    update payroll_slips set status='paid', paid_at=now() where id=s.id returning * into s;
    update ot_records set status='paid' where employee_id=s.employee_id and status='approved' and ot_date between period_start and period_end;
    update expense_claims set status='paid' where employee_id=s.employee_id and status='approved' and claim_date between period_start and period_end;
    return next s;
  end loop;
end $$;

create or replace function submit_leave_request(p_employee text, p_type text, p_start date, p_end date, p_session text, p_reason text)
returns leave_requests language plpgsql set search_path = public, pg_temp as $$
declare t leave_types; b employee_leave_balances; u users; result leave_requests;
  dates date[]; n numeric; pending_days numeric; working_days text; leave_year integer;
begin
  if p_start is null or p_end is null or p_start>p_end or extract(year from p_start)<>extract(year from p_end) then raise exception 'กรุณาระบุช่วงวันที่ภายในปีเดียวกัน'; end if;
  if p_session is null or p_session not in ('full','half_morning','half_afternoon') or (p_session<>'full' and p_start<>p_end) then raise exception 'ลาครึ่งวันต้องระบุวันที่เดียวกันและช่วงเวลาให้ถูกต้อง'; end if;
  perform pg_advisory_xact_lock(hashtextextended('leave:' || p_employee, 0));
  select * into u from users where employee_id=p_employee and status='active';
  if not found then raise exception 'ไม่พบพนักงานที่ใช้งานอยู่'; end if;
  select * into t from leave_types where code=p_type;
  if not found then raise exception 'ประเภทการลาไม่ถูกต้อง'; end if;
  if exists(select 1 from leave_requests where employee_id=p_employee and status in ('pending','approved')
    and start_date<=p_end and end_date>=p_start
    and (session='full' or p_session='full' or session=p_session)) then raise exception 'ช่วงเวลาซ้อนกับใบลาที่รออนุมัติหรืออนุมัติแล้ว'; end if;
  select coalesce(bc.work_days, ws.work_days, '1,2,3,4,5') into working_days
    from (select 1) seed left join work_settings ws on ws.id=1 left join branches bc on bc.id=u.branch_id;
  select array_agg(d::date order by d) into dates from generate_series(p_start::timestamp,p_end::timestamp,interval '1 day') d
    where not exists(select 1 from holidays h where h.holiday_date=d::date and (h.branch_id is null or h.branch_id=u.branch_id))
    and coalesce((select s.shift_type not in ('off','holiday','rest') from shifts s where s.employee_id=p_employee and s.shift_date=d::date limit 1),
      extract(dow from d)::integer = any(string_to_array(working_days, ',')::integer[]));
  n := coalesce(cardinality(dates),0) * case when p_session='full' then 1 else 0.5 end;
  if n<=0 then raise exception 'ช่วงที่เลือกไม่มีวันทำงาน กรุณาตรวจตารางกะและวันหยุด'; end if;
  leave_year := extract(year from p_start)::integer;
  if t.deduct_balance then
    insert into employee_leave_balances(employee_id,leave_type,year,total_days,used_days)
      values(p_employee,p_type,leave_year,coalesce(t.days_per_year,0),0) on conflict(employee_id,leave_type,year) do nothing;
    select * into b from employee_leave_balances where employee_id=p_employee and leave_type=p_type and year=leave_year for update;
    select coalesce(sum(days),0) into pending_days from leave_requests where employee_id=p_employee and leave_type=p_type and status='pending' and extract(year from start_date)=leave_year;
    if b.used_days+pending_days+n>b.total_days then raise exception 'สิทธิ์ลาไม่พอเมื่อรวมใบลาที่รออนุมัติ'; end if;
  end if;
  insert into leave_requests(employee_id,leave_type,start_date,end_date,days,session,work_dates,reason,status,manager_id,manager_status)
    values(p_employee,p_type,p_start,p_end,n,p_session,dates,nullif(trim(p_reason),''),'pending',u.manager_id,case when u.manager_id is null then 'approved' else 'pending' end)
    returning * into result;
  return result;
end $$;

create or replace function review_leave_request(p_id bigint, p_action text, p_reviewer text)
returns leave_requests language plpgsql set search_path = public, pg_temp as $$
declare r leave_requests; b employee_leave_balances; t leave_types; legacy_col text;
begin
  select * into r from leave_requests where id=p_id;
  if not found then raise exception 'ไม่พบใบลา'; end if;
  perform pg_advisory_xact_lock(hashtextextended('leave:' || r.employee_id, 0));
  select * into r from leave_requests where id=p_id for update;
  if r.status<>'pending' then raise exception 'ใบลานี้ดำเนินการไปแล้ว'; end if;
  if p_action is null or p_action not in ('approve','reject') then raise exception 'การดำเนินการไม่ถูกต้อง'; end if;
  if p_action='approve' then
    if r.work_dates is null then raise exception 'ใบลาเดิมยังไม่มีรายการวันทำงาน กรุณาตรวจและจัดสรรก่อนอนุมัติ'; end if;
    select * into t from leave_types where code=r.leave_type;
    if not found then raise exception 'ไม่พบประเภทการลา'; end if;
    if not t.paid and exists(select 1 from payroll_slips p where p.employee_id=r.employee_id and p.status='paid'
      and exists(select 1 from unnest(r.work_dates) d where to_char(d,'YYYY-MM')=p.period)) then
      raise exception 'ใบลามีผลต่อเงินเดือนในงวดที่จ่ายแล้ว กรุณาใช้ขั้นตอนปรับปรุงย้อนหลัง';
    end if;
    if t.deduct_balance then
      select * into b from employee_leave_balances where employee_id=r.employee_id and leave_type=r.leave_type and year=extract(year from r.start_date)::integer for update;
      if not found or b.used_days+r.days>b.total_days then raise exception 'สิทธิ์ลาคงเหลือไม่พอ กรุณาตรวจโควตา'; end if;
      update employee_leave_balances set used_days=used_days+r.days,updated_at=now() where id=b.id;
      legacy_col := case r.leave_type when 'annual' then 'leave_annual_used' when 'sick' then 'leave_sick_used' when 'personal' then 'leave_personal_used' end;
      if legacy_col is not null then
        execute format('update employee_records set %I=coalesce(%I,0)+$1,updated_at=now() where employee_id=$2',legacy_col,legacy_col) using r.days,r.employee_id;
      end if;
    end if;
    -- A half day is not a full-day absence; retain its session on leave_requests.
    if r.session='full' then
      insert into time_records(employee_id,work_date,status,note,leave_request_id)
        select r.employee_id,d,'leave','ลา (' || r.leave_type || ')',r.id from unnest(r.work_dates) d
        on conflict(employee_id,work_date) do nothing;
    end if;
  end if;
  update leave_requests set status=case when p_action='approve' then 'approved' else 'rejected' end,
    approved_by=p_reviewer,approved_at=now(),
    manager_status=case when manager_status='pending' then case when p_action='approve' then 'approved' else 'rejected' end else manager_status end,
    manager_approved_by=case when manager_status='pending' then p_reviewer || ' (HR)' else manager_approved_by end,
    manager_approved_at=case when manager_status='pending' then now() else manager_approved_at end
    where id=p_id returning * into r;
  return r;
end $$;

revoke all on function save_payroll_draft(jsonb,boolean) from public, anon, authenticated;
revoke all on function confirm_payroll_payment(text,bigint) from public, anon, authenticated;
revoke all on function submit_leave_request(text,text,date,date,text,text) from public, anon, authenticated;
revoke all on function review_leave_request(bigint,text,text) from public, anon, authenticated;
grant execute on function save_payroll_draft(jsonb,boolean) to service_role;
grant execute on function confirm_payroll_payment(text,bigint) to service_role;
grant execute on function submit_leave_request(text,text,date,date,text,text) to service_role;
grant execute on function review_leave_request(bigint,text,text) to service_role;
commit;
