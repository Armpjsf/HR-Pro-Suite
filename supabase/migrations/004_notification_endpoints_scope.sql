-- MIG-05: Tenant-scoped push subscriptions and device tokens
-- Additive & non-destructive. Unattributable rows are quarantined instead of assigned to DEFAULT_ORG.

CREATE TABLE IF NOT EXISTS notification_endpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT,
  tenant_id TEXT,
  user_id TEXT,
  device_id TEXT,
  channel TEXT NOT NULL CHECK (channel IN ('web_push', 'fcm', 'line', 'email')),
  endpoint_or_token TEXT NOT NULL,
  quarantined BOOLEAN NOT NULL DEFAULT FALSE,
  quarantine_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notification_endpoints_scope
  ON notification_endpoints (org_id, user_id, quarantined);

DO $$
BEGIN
  IF to_regclass('public.push_subscriptions') IS NOT NULL THEN
    ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS org_id TEXT;
    ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS user_id TEXT;
    ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS quarantined BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;
  IF to_regclass('public.device_tokens') IS NOT NULL THEN
    ALTER TABLE device_tokens ADD COLUMN IF NOT EXISTS org_id TEXT;
    ALTER TABLE device_tokens ADD COLUMN IF NOT EXISTS user_id TEXT;
    ALTER TABLE device_tokens ADD COLUMN IF NOT EXISTS quarantined BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;
END $$;
