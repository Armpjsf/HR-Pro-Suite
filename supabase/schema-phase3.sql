-- เฟส 3: e-Payslip / 50ทวิ / ลย.01 + ข้อมูลพนักงานสำหรับออกเอกสาร

-- แยกรายการหักเป็น ภาษี + ประกันสังคม (เพื่อออกสลิป/50ทวิ ได้ถูกต้อง)
alter table payroll_slips add column if not exists tax numeric not null default 0;
alter table payroll_slips add column if not exists sso numeric not null default 0;

-- ข้อมูลพนักงานสำหรับสลิป/โอนเงิน/ภาษี
alter table employee_records add column if not exists national_id text;
alter table employee_records add column if not exists bank_name text;
alter table employee_records add column if not exists bank_account text;
alter table employee_records add column if not exists tax_id text;

-- แบบลดหย่อนภาษี (ลย.01) ที่พนักงานกรอกเอง
create table if not exists tax_allowances (
  id bigserial primary key,
  employee_id text not null,
  year int not null,
  data jsonb,           -- { spouse, children, parents, insurance, life_insurance, provident_fund, donation, ... }
  status text not null default 'submitted',
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (employee_id, year)
);
