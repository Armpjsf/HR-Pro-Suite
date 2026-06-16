-- เฟส 4: เครื่องคำนวณเงินเดือน — เก็บเงินเดือนฐานรายคน
alter table employee_records add column if not exists salary numeric not null default 0;
