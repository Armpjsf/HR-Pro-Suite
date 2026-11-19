-- MIG-01 & MIG-02: Tenant bindings, auth_version, single-use QR tokens, and session revocations
-- Additive & non-destructive.

CREATE TABLE IF NOT EXISTS tenant_bindings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  product TEXT NOT NULL CHECK (product IN ('hr', 'wms', 'tms')),
  deployment_id TEXT NOT NULL,
  local_org_id TEXT NOT NULL,
  idempotency_key TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'cancelled', 'archived_pending_retention')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (product, deployment_id),
  UNIQUE (tenant_id, product, local_org_id)
);

CREATE INDEX IF NOT EXISTS idx_tenant_bindings_tenant_id
  ON tenant_bindings (tenant_id);

CREATE TABLE IF NOT EXISTS qr_login_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  driver_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_qr_login_tokens_tenant_driver
  ON qr_login_tokens (tenant_id, driver_id, expires_at DESC);

CREATE TABLE IF NOT EXISTS session_revocations (
  jti TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  revoked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  reason TEXT
);

-- Additive auth_version columns for existing TMS user/driver tables when present
DO $$
BEGIN
  IF to_regclass('public."Master_Users"') IS NOT NULL THEN
    ALTER TABLE "Master_Users" ADD COLUMN IF NOT EXISTS auth_version INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE "Master_Users" ADD COLUMN IF NOT EXISTS tenant_id TEXT;
  END IF;
  IF to_regclass('public."Master_Drivers"') IS NOT NULL THEN
    ALTER TABLE "Master_Drivers" ADD COLUMN IF NOT EXISTS auth_version INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE "Master_Drivers" ADD COLUMN IF NOT EXISTS tenant_id TEXT;
  END IF;
END $$;
