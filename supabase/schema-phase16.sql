-- Phase 16: approval audit visibility

alter table leave_requests
  add column if not exists manager_approved_by text;
