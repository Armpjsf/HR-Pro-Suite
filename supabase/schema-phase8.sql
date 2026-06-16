-- เฟส 8: สิทธิ์ใช้งานเมนูตาม role (RBAC)
-- menus = รายการ key เมนูที่ role นั้นเข้าได้ ('__all__' = ทุกเมนู)
create table if not exists role_permissions (
  role text primary key,
  menus text[] not null default '{}',
  updated_at timestamptz not null default now()
);

-- ค่าเริ่มต้น: hr เข้าได้ทุกเมนู, employee ไม่เข้า /hr,
-- accounting เห็นเฉพาะส่วนการเงิน (ไม่เห็นข้อมูลพนักงานเต็ม)
insert into role_permissions (role, menus) values
  ('hr', ARRAY['__all__']),
  ('employee', ARRAY[]::text[]),
  ('accounting', ARRAY['dashboard','payroll','ot','expenses','benefits','social-security','reports'])
on conflict (role) do nothing;
-- หมายเหตุ: role 'admin' เข้าได้ทุกเมนูเสมอ (กำหนดในโค้ด ไม่ต้องมีในตาราง)
