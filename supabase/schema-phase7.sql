-- เฟส 7: ตั้งค่าระบบ — ประเภทการลา / รูปแบบกะ / เวลาทำงาน

-- ประเภทการลา (ตั้งค่าได้) — 3 แบบหลัก (annual/sick/personal) ยังตัดยอดอัตโนมัติ
-- ประเภทอื่น (ลาคลอด/บวช/ทหาร ฯลฯ) บันทึกเป็นใบลาได้ แต่ไม่ตัดยอดโควต้าตัวเลข
create table if not exists leave_types (
  id bigserial primary key,
  code text unique not null,        -- annual/sick/personal/maternity/ordination/...
  name text not null,
  days_per_year numeric,            -- สิทธิ์ต่อปี (null = ไม่จำกัด/ตามกฎหมาย)
  paid boolean not null default true,
  deduct_balance boolean not null default false, -- ตัดยอดโควต้าอัตโนมัติไหม
  note text,
  created_at timestamptz not null default now()
);

-- รูปแบบกะมาตรฐาน (ใช้เติมเวลาเร็วเวลาจัดกะ)
create table if not exists shift_patterns (
  id bigserial primary key,
  name text not null,               -- เช่น "กะเช้า"
  shift_type text not null,         -- morning/afternoon/night/off
  start_time time,
  end_time time,
  created_at timestamptz not null default now()
);

-- ตั้งค่าเวลาทำงานบริษัท (แถวเดียว id=1)
create table if not exists work_settings (
  id int primary key default 1,
  standard_in time not null default '08:00',
  standard_out time not null default '17:00',
  late_grace_min int not null default 15,   -- ผ่อนผันสาย (นาที)
  work_days text not null default '1,2,3,4,5', -- 0=อา .. 6=ส
  updated_at timestamptz not null default now()
);
insert into work_settings (id) values (1) on conflict (id) do nothing;
