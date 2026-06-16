-- เฟส 9: ทรัพย์สิน — รูปภาพ + สาขาที่อยู่ + ระบบขอเบิก/คืน/เปลี่ยน
alter table assets add column if not exists image_url text;     -- ชื่อไฟล์รูปใน storage
alter table assets add column if not exists branch_id bigint;   -- สาขาที่ทรัพย์สินอยู่ตอนนี้

create table if not exists asset_requests (
  id bigserial primary key,
  asset_id bigint not null references assets(id) on delete cascade,
  employee_id text not null,
  type text not null default 'borrow',          -- borrow / return / replace
  target_branch_id bigint,                        -- สาขาที่ขอให้จัดส่งไป
  reason text,
  status text not null default 'pending',         -- pending / approved / rejected / delivered
  approved_by text,
  created_at timestamptz not null default now()
);
create index if not exists asset_requests_status_idx on asset_requests (status);
