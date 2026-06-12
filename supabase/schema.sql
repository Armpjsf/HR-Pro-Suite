-- HR AI Chatbot — Supabase schema
-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).
-- RLS is left disabled: the app talks to Supabase using the service_role key
-- from the server only, and access control is enforced in lib/permissions.js.

create table if not exists users (
  id text primary key,
  username text unique not null,
  password text not null,
  name text not null,
  name_en text,
  email text,
  role text not null default 'employee',
  employee_id text unique not null,
  department text,
  avatar text,
  created_at timestamptz not null default now()
);

create table if not exists documents (
  id text primary key,
  name text not null,
  file_name text not null,
  stored_file_name text not null,
  category text not null,
  type text not null,
  template_type text,
  size text,
  updated_at text,
  access_roles text[] not null default '{}',
  content text,
  uploaded_by text,
  employee_id text
);

-- Leave-balance / employee data, designed so a future HR module can read/write
-- the same columns directly (no manual JSON sync).
create table if not exists employee_records (
  employee_id text primary key references users(employee_id) on delete cascade,
  position text,
  start_date date,
  leave_annual_total numeric not null default 0,
  leave_annual_used numeric not null default 0,
  leave_sick_total numeric not null default 0,
  leave_sick_used numeric not null default 0,
  leave_personal_total numeric not null default 0,
  leave_personal_used numeric not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists line_mappings (
  line_user_id text primary key,
  employee_id text not null,
  name text,
  role text,
  registered_at timestamptz not null default now()
);

create table if not exists audit_logs (
  id bigserial primary key,
  user_name text,
  action text,
  channel text,
  type text,
  at timestamptz not null default now()
);

create index if not exists audit_logs_at_idx on audit_logs (at desc);

-- Storage: create a bucket named "documents" (private) via
-- Project → Storage → New bucket → name "documents", Public: off.
