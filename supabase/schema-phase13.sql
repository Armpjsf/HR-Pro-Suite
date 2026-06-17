-- Phase 13: document signatures and company stamps
-- Run once in Supabase SQL editor after earlier phase scripts.

create table if not exists document_assets (
  id bigserial primary key,
  asset_type text not null default 'signature' check (asset_type in ('signature', 'company_stamp')),
  name text not null,
  signer_name text,
  signer_title text,
  image_url text,
  active boolean not null default true,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists document_assets_type_idx on document_assets (asset_type);
create index if not exists document_assets_active_idx on document_assets (active);
