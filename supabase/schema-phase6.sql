-- เฟส 6: สายบังคับบัญชา (ผังองค์กร) + อนุมัติการลา 2 ระดับ (หัวหน้า → HR)
alter table users add column if not exists manager_id text; -- employee_id ของหัวหน้า

alter table leave_requests add column if not exists manager_id text;
alter table leave_requests add column if not exists manager_status text not null default 'pending'; -- pending/approved/rejected
alter table leave_requests add column if not exists manager_approved_at timestamptz;
