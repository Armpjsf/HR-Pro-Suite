-- เฟส 18: ฐานข้อมูลพนักงานให้ครบถ้วน
-- 1) ข้อมูลติดต่อ + ผู้ติดต่อฉุกเฉิน  2) สถานะพนักงาน (active/resigned/suspended)
-- 3) ประเภทการจ้าง  4) รูปถ่ายพนักงาน  5) ประวัติปรับเงินเดือน/ตำแหน่ง

-- สถานะพนักงาน — ใช้แทนการลบ user (ลบแล้วประวัติหาย cascade)
alter table users add column if not exists status text not null default 'active'; -- active/resigned/suspended
alter table users add column if not exists resign_date date;

-- ข้อมูลติดต่อ + ฉุกเฉิน
alter table employee_records add column if not exists phone text;
alter table employee_records add column if not exists address text;
alter table employee_records add column if not exists emergency_name text;
alter table employee_records add column if not exists emergency_phone text;
alter table employee_records add column if not exists emergency_relation text;

-- ประเภทการจ้าง: monthly/daily/contract/parttime
alter table employee_records add column if not exists employment_type text not null default 'monthly';

-- รูปถ่ายพนักงาน (path ใน storage bucket "documents" prefix employee-photos/)
alter table employee_records add column if not exists photo_url text;

-- ประวัติการเปลี่ยนแปลงเงินเดือน/ตำแหน่ง
create table if not exists employee_history (
  id bigserial primary key,
  employee_id text not null references users(employee_id) on delete cascade,
  change_type text not null, -- salary/position/status
  old_value text,
  new_value text,
  changed_by text,
  created_at timestamptz not null default now()
);
create index if not exists employee_history_emp_idx on employee_history (employee_id, created_at desc);
