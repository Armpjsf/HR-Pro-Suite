-- HR Pro Suite module — Supabase schema (additional tables)
-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).
-- RLS is left disabled: the app talks to Supabase using the service_role key
-- from the server only, and access control is enforced via lib/auth.js requireRole.

create table if not exists departments (
  id bigserial primary key,
  code text unique not null,
  name text not null,
  description text,
  created_at timestamptz not null default now()
);

create table if not exists positions (
  id bigserial primary key,
  title text not null,
  department_code text,
  level text,
  description text,
  created_at timestamptz not null default now()
);

create table if not exists time_records (
  id bigserial primary key,
  employee_id text not null,
  work_date date not null,
  clock_in time,
  clock_out time,
  status text not null default 'normal', -- normal/late/absent/leave
  note text,
  created_at timestamptz not null default now()
);
create index if not exists time_records_emp_date_idx on time_records (employee_id, work_date);

create table if not exists leave_requests (
  id bigserial primary key,
  employee_id text not null,
  leave_type text not null, -- annual/sick/personal
  start_date date not null,
  end_date date not null,
  days numeric not null,
  reason text,
  status text not null default 'pending', -- pending/approved/rejected
  approved_by text,
  approved_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists payroll_slips (
  id bigserial primary key,
  employee_id text not null,
  period text not null, -- e.g. '2026-06'
  base_salary numeric not null default 0,
  ot_pay numeric not null default 0,
  bonus numeric not null default 0,
  deduction numeric not null default 0,
  net numeric not null default 0,
  status text not null default 'draft', -- draft/paid/notified
  notified_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists ot_records (
  id bigserial primary key,
  employee_id text not null,
  ot_date date not null,
  hours numeric not null,
  rate numeric not null default 1.5,
  amount numeric not null default 0,
  status text not null default 'pending',
  note text,
  created_at timestamptz not null default now()
);

create table if not exists shifts (
  id bigserial primary key,
  employee_id text not null,
  shift_date date not null,
  shift_type text not null, -- morning/afternoon/night/off
  start_time time,
  end_time time,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists shifts_date_idx on shifts (shift_date);

create table if not exists job_openings (
  id bigserial primary key,
  title text not null,
  department_code text,
  headcount int not null default 1,
  status text not null default 'open', -- open/closed
  description text,
  posted_date date,
  created_at timestamptz not null default now()
);

create table if not exists applicants (
  id bigserial primary key,
  name text not null,
  email text,
  phone text,
  position_applied text,
  opening_id bigint,
  status text not null default 'applied', -- applied/screening/interview/offer/hired/rejected
  applied_date date,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists onboarding_checklists (
  id bigserial primary key,
  employee_id text not null,
  item text not null,
  due_date date,
  done boolean not null default false,
  assigned_to text,
  created_at timestamptz not null default now()
);

create table if not exists trainings (
  id bigserial primary key,
  title text not null,
  trainer text,
  train_date date,
  hours numeric,
  location text,
  participants text,
  status text not null default 'planned', -- planned/done/cancelled
  created_at timestamptz not null default now()
);

create table if not exists evaluations (
  id bigserial primary key,
  employee_id text not null,
  period text not null,
  score numeric,
  grade text,
  evaluator text,
  comments text,
  status text not null default 'draft',
  created_at timestamptz not null default now()
);

create table if not exists okrs (
  id bigserial primary key,
  employee_id text,
  objective text not null,
  key_results text,
  period text,
  progress numeric not null default 0,
  status text not null default 'active',
  created_at timestamptz not null default now()
);

create table if not exists assets (
  id bigserial primary key,
  code text unique not null,
  name text not null,
  category text,
  assigned_to text,
  assigned_date date,
  status text not null default 'available', -- available/assigned/repair/retired
  note text,
  created_at timestamptz not null default now()
);

create table if not exists expense_claims (
  id bigserial primary key,
  employee_id text not null,
  claim_date date,
  category text,
  amount numeric not null default 0,
  description text,
  status text not null default 'pending', -- pending/approved/rejected/paid
  approved_by text,
  created_at timestamptz not null default now()
);

create table if not exists benefits_loans (
  id bigserial primary key,
  employee_id text not null,
  type text not null, -- benefit/loan
  name text not null,
  amount numeric not null default 0,
  start_date date,
  end_date date,
  status text not null default 'active',
  note text,
  created_at timestamptz not null default now()
);

create table if not exists social_security (
  id bigserial primary key,
  employee_id text unique not null,
  sso_number text,
  hospital text,
  registered_date date,
  monthly_contribution numeric not null default 0,
  status text not null default 'active',
  created_at timestamptz not null default now()
);

create table if not exists meeting_rooms (
  id bigserial primary key,
  name text not null,
  capacity int not null default 0,
  equipment text,
  status text not null default 'available',
  created_at timestamptz not null default now()
);

create table if not exists room_bookings (
  id bigserial primary key,
  room_id bigint not null,
  employee_id text,
  title text,
  book_date date not null,
  start_time time not null,
  end_time time not null,
  status text not null default 'booked',
  created_at timestamptz not null default now()
);

create table if not exists company_trips (
  id bigserial primary key,
  title text not null,
  destination text,
  start_date date,
  end_date date,
  budget numeric not null default 0,
  participants text,
  status text not null default 'planned',
  created_at timestamptz not null default now()
);

create table if not exists announcements (
  id bigserial primary key,
  title text not null,
  body text,
  category text,
  publish_date date,
  pinned boolean not null default false,
  author text,
  created_at timestamptz not null default now()
);

-- ===== Employee Mobile App — additional tables =====

-- จุดปักหมุดสำหรับ GPS check-in (สำนักงาน / สาขา)
create table if not exists check_locations (
  id bigserial primary key,
  name text not null,
  latitude numeric not null,
  longitude numeric not null,
  radius_meters int not null default 200,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ประเมินเพื่อนร่วมงาน (360°)
create table if not exists peer_evaluations (
  id bigserial primary key,
  evaluator_id text not null,
  target_id text not null,
  period text not null,
  scores jsonb,
  comments text,
  status text not null default 'draft',
  created_at timestamptz not null default now()
);

-- เพิ่ม GPS columns ให้ time_records
alter table time_records add column if not exists clock_in_lat numeric;
alter table time_records add column if not exists clock_in_lng numeric;
alter table time_records add column if not exists clock_out_lat numeric;
alter table time_records add column if not exists clock_out_lng numeric;
alter table time_records add column if not exists check_type text default 'office';
alter table time_records add column if not exists location_name text;
