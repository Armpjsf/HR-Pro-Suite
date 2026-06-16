-- Phase 10: flexible leave balances + branch work calendars
-- Run once in Supabase SQL editor after the earlier phase scripts.

alter table branches add column if not exists standard_in time;
alter table branches add column if not exists standard_out time;
alter table branches add column if not exists late_grace_min int;
alter table branches add column if not exists work_days text;
alter table branches add column if not exists calendar_note text;

create table if not exists employee_leave_balances (
  id bigserial primary key,
  employee_id text not null references users(employee_id) on delete cascade,
  leave_type text not null references leave_types(code) on delete cascade,
  year int not null,
  total_days numeric not null default 0,
  used_days numeric not null default 0,
  note text,
  updated_at timestamptz not null default now(),
  unique (employee_id, leave_type, year)
);

create index if not exists employee_leave_balances_emp_year_idx
  on employee_leave_balances (employee_id, year);

insert into leave_types (code, name, days_per_year, paid, deduct_balance, note)
values
  ('annual', 'ลาพักร้อน', 0, true, true, 'ประเภทพื้นฐานสำหรับย้ายข้อมูลเดิม'),
  ('sick', 'ลาป่วย', 0, true, true, 'ประเภทพื้นฐานสำหรับย้ายข้อมูลเดิม'),
  ('personal', 'ลากิจ', 0, true, true, 'ประเภทพื้นฐานสำหรับย้ายข้อมูลเดิม')
on conflict (code) do nothing;

insert into employee_leave_balances (employee_id, leave_type, year, total_days, used_days)
select employee_id, 'annual', extract(year from now())::int, leave_annual_total, leave_annual_used
from employee_records
where (leave_annual_total <> 0 or leave_annual_used <> 0)
on conflict (employee_id, leave_type, year) do nothing;

insert into employee_leave_balances (employee_id, leave_type, year, total_days, used_days)
select employee_id, 'sick', extract(year from now())::int, leave_sick_total, leave_sick_used
from employee_records
where (leave_sick_total <> 0 or leave_sick_used <> 0)
on conflict (employee_id, leave_type, year) do nothing;

insert into employee_leave_balances (employee_id, leave_type, year, total_days, used_days)
select employee_id, 'personal', extract(year from now())::int, leave_personal_total, leave_personal_used
from employee_records
where (leave_personal_total <> 0 or leave_personal_used <> 0)
on conflict (employee_id, leave_type, year) do nothing;
