-- MIG-04: Scoped API credentials & integration connections
-- Additive & non-destructive. Supports dual-key rotation and provenance quarantine.

CREATE TABLE IF NOT EXISTS integration_connections (
  connection_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  source_product TEXT NOT NULL CHECK (source_product IN ('hr', 'wms', 'tms', 'erp')),
  target_product TEXT NOT NULL CHECK (target_product IN ('hr', 'wms', 'tms', 'erp')),
  target_base_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'quarantined', 'revoked')),
  allowed_branches TEXT[] NOT NULL DEFAULT ARRAY['*']::TEXT[],
  scopes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  webhook_key_id TEXT,
  webhook_secret_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_integration_connections_tenant
  ON integration_connections (tenant_id, status);

CREATE TABLE IF NOT EXISTS integration_credentials (
  key_id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL REFERENCES integration_connections(connection_id),
  tenant_id TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  scopes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  allowed_branches TEXT[] NOT NULL DEFAULT ARRAY['*']::TEXT[],
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  quarantined BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF to_regclass('public."Master_API_Keys"') IS NOT NULL THEN
    ALTER TABLE "Master_API_Keys" ADD COLUMN IF NOT EXISTS key_hash TEXT;
    ALTER TABLE "Master_API_Keys" ADD COLUMN IF NOT EXISTS tenant_id TEXT;
    ALTER TABLE "Master_API_Keys" ADD COLUMN IF NOT EXISTS connection_id TEXT;
    ALTER TABLE "Master_API_Keys" ADD COLUMN IF NOT EXISTS allowed_branches TEXT[] DEFAULT ARRAY['*']::TEXT[];
    ALTER TABLE "Master_API_Keys" ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
    ALTER TABLE "Master_API_Keys" ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;
    ALTER TABLE "Master_API_Keys" ADD COLUMN IF NOT EXISTS quarantined BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;
END $$;
