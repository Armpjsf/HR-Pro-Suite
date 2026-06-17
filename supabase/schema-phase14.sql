-- Phase 14: employee document request workflow
-- Employees request salary/employment certificates, HR approves and chooses
-- optional signature/stamp assets to render on the printable document.

create table if not exists document_requests (
  id bigserial primary key,
  employee_id text not null references users(employee_id) on delete cascade,
  document_type text not null check (document_type in ('salary_certificate', 'employment_certificate')),
  purpose text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_at timestamptz not null default now(),
  approved_by text,
  approved_at timestamptz,
  rejected_by text,
  rejected_at timestamptz,
  review_note text,
  signature_asset_id bigint references document_assets(id) on delete set null,
  stamp_asset_id bigint references document_assets(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists document_requests_employee_idx on document_requests(employee_id);
create index if not exists document_requests_status_idx on document_requests(status);
create index if not exists document_requests_type_idx on document_requests(document_type);

-- Keep existing role setups intact. Roles using '__all__' already get this menu.
update role_permissions
set menus = array(select distinct unnest(menus || array['document-requests'])),
    updated_at = now()
where role = 'hr'
  and not ('__all__' = any(menus));
