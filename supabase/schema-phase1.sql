-- เฟส 1: สาขา + วันหยุด + ผูกพนักงานเข้าสาขา
-- รันครั้งเดียวใน Supabase SQL editor

create table if not exists branches (
  id bigserial primary key,
  code text unique not null,
  name text not null,
  address text,
  province text,
  phone text,
  created_at timestamptz not null default now()
);

-- วันหยุดบริษัท: branch_id = null หมายถึงวันหยุดของทุกสาขา
create table if not exists holidays (
  id bigserial primary key,
  holiday_date date not null,
  name text not null,
  branch_id bigint references branches(id) on delete cascade,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists holidays_date_idx on holidays (holiday_date);

-- ผูกพนักงานเข้าสาขา
alter table users add column if not exists branch_id bigint references branches(id) on delete set null;
