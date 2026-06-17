-- Phase 15: notification center + Web Push subscriptions

create table if not exists notifications (
  id bigserial primary key,
  recipient_employee_id text not null references users(employee_id) on delete cascade,
  recipient_role text,
  audience text not null default 'employee' check (audience in ('employee', 'hr', 'manager', 'admin')),
  title text not null,
  body text not null,
  url text,
  type text not null default 'general',
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_recipient_idx on notifications(recipient_employee_id, read_at, created_at desc);
create index if not exists notifications_type_idx on notifications(type);

create table if not exists push_subscriptions (
  id bigserial primary key,
  employee_id text not null references users(employee_id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists push_subscriptions_employee_idx on push_subscriptions(employee_id, active);
