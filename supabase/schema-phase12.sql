-- Phase 12: branch-aware shift patterns and GPS check locations
-- Run once in Supabase SQL editor after earlier phase scripts.

alter table shift_patterns add column if not exists branch_id bigint references branches(id) on delete set null;

alter table check_locations add column if not exists branch_id bigint references branches(id) on delete set null;

alter table time_records add column if not exists location_branch_id bigint references branches(id) on delete set null;

create index if not exists shift_patterns_branch_idx on shift_patterns (branch_id);
create index if not exists check_locations_branch_idx on check_locations (branch_id);
