-- Phase 11: organization chart as its own HR master data
-- Run once in Supabase SQL editor after earlier phase scripts.

create table if not exists org_chart_nodes (
  employee_id text primary key references users(employee_id) on delete cascade,
  parent_employee_id text references users(employee_id) on delete set null,
  org_title text,
  org_department text,
  sort_order int not null default 0,
  is_visible boolean not null default true,
  updated_at timestamptz not null default now()
);

create index if not exists org_chart_nodes_parent_idx
  on org_chart_nodes (parent_employee_id);

insert into org_chart_nodes (employee_id, parent_employee_id, org_title, org_department, sort_order, is_visible)
select
  u.employee_id,
  nullif(u.manager_id, ''),
  er.position,
  u.department,
  row_number() over (order by u.employee_id)::int,
  true
from users u
left join employee_records er on er.employee_id = u.employee_id
on conflict (employee_id) do nothing;
