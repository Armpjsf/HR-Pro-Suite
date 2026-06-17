-- Phase 17: company logo assets for generated HR certificates.

alter table document_assets
  drop constraint if exists document_assets_asset_type_check;

alter table document_assets
  add constraint document_assets_asset_type_check
  check (asset_type in ('signature', 'company_stamp', 'company_logo'));

alter table document_requests
  add column if not exists logo_asset_id bigint references document_assets(id) on delete set null;
