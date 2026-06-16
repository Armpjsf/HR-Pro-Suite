-- เฟส 5: ฟิลด์สำหรับแจ้งเตือนอัตโนมัติ
alter table employee_records add column if not exists birth_date date;
alter table employee_records add column if not exists probation_end date;   -- วันครบทดลองงาน
alter table employee_records add column if not exists contract_end date;     -- วันหมดสัญญาจ้าง
alter table employee_records add column if not exists license_expiry date;   -- วันหมดอายุใบขับขี่ (สำคัญสำหรับขนส่ง)
