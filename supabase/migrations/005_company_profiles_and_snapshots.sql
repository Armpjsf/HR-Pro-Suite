-- MIG-06: Company profiles, legal entities, document profiles, and immutable document snapshots
-- Additive & non-destructive.

CREATE TABLE IF NOT EXISTS legal_entities (
  entity_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  legal_name TEXT NOT NULL,
  tax_id TEXT NOT NULL,
  branch_code TEXT NOT NULL DEFAULT '00000',
  registered_address TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  bank_name TEXT,
  bank_account_no TEXT,
  bank_account_name TEXT,
  signatory_name TEXT,
  signatory_title TEXT,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_legal_entities_tenant
  ON legal_entities (tenant_id);

CREATE TABLE IF NOT EXISTS company_profiles (
  tenant_id TEXT PRIMARY KEY,
  brand_name TEXT NOT NULL,
  short_name TEXT,
  logo_url TEXT,
  primary_color TEXT,
  support_email TEXT,
  support_phone TEXT,
  public_portal_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS document_profiles (
  profile_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  entity_id TEXT NOT NULL REFERENCES legal_entities(entity_id),
  document_type TEXT NOT NULL,
  prefix TEXT NOT NULL,
  footer_note TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, document_type)
);

CREATE TABLE IF NOT EXISTS document_snapshots (
  snapshot_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  document_type TEXT NOT NULL,
  document_id TEXT NOT NULL,
  document_number TEXT NOT NULL,
  issuer_entity_id TEXT,
  issued_snapshot JSONB NOT NULL,
  snapshot_checksum TEXT NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  issued_by TEXT NOT NULL,
  UNIQUE (tenant_id, document_type, document_id)
);

DO $$
BEGIN
  IF to_regclass('public.document_requests') IS NOT NULL THEN
    ALTER TABLE document_requests ADD COLUMN IF NOT EXISTS issued_snapshot JSONB;
  END IF;
  IF to_regclass('public.outbound_orders') IS NOT NULL THEN
    ALTER TABLE outbound_orders ADD COLUMN IF NOT EXISTS issued_snapshot JSONB;
  END IF;
END $$;
