import { createHash, randomBytes } from 'node:crypto';

export const MAX_SUPPORT_TTL_MINUTES = 60;
export const MIN_SUPPORT_REASON_LENGTH = 10;

const SENSITIVE_AUDIT_KEYS_RE =
  /^(password|password_hash|passwordHash|secret|webhook_secret|webhookSecret|api_key|apiKey|token|access_token|refresh_token|salary|base_salary|net_pay|bank_account|bankAccountNo|national_id|tax_id)$/i;

export class OpsSupportError extends Error {
  constructor(message, code = 'OPS_SUPPORT_ERROR', status = 403) {
    super(message);
    this.name = 'OpsSupportError';
    this.code = code;
    this.status = status;
  }
}

const supportTokens = new Map();
const immutableAuditLog = [];

export function clearOpsPrivacySupportForTests() {
  supportTokens.clear();
  immutableAuditLog.length = 0;
}

export function getImmutableAuditLog(tenantId) {
  const list = tenantId
    ? immutableAuditLog.filter((e) => e.tenantId === tenantId)
    : immutableAuditLog;
  return list.map((e) => ({ ...e }));
}

export function redactAuditEvent(event) {
  if (Array.isArray(event)) {
    return event.map(redactAuditEvent);
  }
  if (event && typeof event === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(event)) {
      if (SENSITIVE_AUDIT_KEYS_RE.test(k)) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = redactAuditEvent(v);
      }
    }
    return out;
  }
  return event;
}

function recordImmutableAudit(entry) {
  const frozen = Object.freeze(redactAuditEvent({
    ...entry,
    recordedAt: entry.recordedAt || new Date().toISOString(),
  }));
  immutableAuditLog.push(frozen);
  return frozen;
}

export function grantSupportAccessToken({
  tenantId,
  supportActorId,
  reason,
  ttlMinutes = 30,
  nowMs = Date.now(),
}) {
  const scopedTenant = String(tenantId || '').trim();
  const actor = String(supportActorId || '').trim();
  const cleanReason = String(reason || '').trim();
  const ttl = Number(ttlMinutes);

  if (!scopedTenant || !actor) {
    throw new OpsSupportError('tenantId and supportActorId are required', 'INVALID_SUPPORT_REQUEST', 400);
  }
  if (cleanReason.length < MIN_SUPPORT_REASON_LENGTH) {
    throw new OpsSupportError(
      `Support access reason must be at least ${MIN_SUPPORT_REASON_LENGTH} characters`,
      'SUPPORT_REASON_REQUIRED',
      400,
    );
  }
  if (!Number.isFinite(ttl) || ttl <= 0 || ttl > MAX_SUPPORT_TTL_MINUTES) {
    throw new OpsSupportError(
      `Support access ttlMinutes must be between 1 and ${MAX_SUPPORT_TTL_MINUTES}`,
      'SUPPORT_TTL_OUT_OF_BOUNDS',
      400,
    );
  }

  const token = `sup_${randomBytes(18).toString('hex')}`;
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const correlationId = `corr_${randomBytes(8).toString('hex')}`;
  const expiresAtMs = nowMs + ttl * 60 * 1000;
  const expiresAt = new Date(expiresAtMs).toISOString();

  const record = {
    tokenHash,
    tenantId: scopedTenant,
    supportActorId: actor,
    reason: cleanReason,
    ttlMinutes: ttl,
    correlationId,
    expiresAtMs,
    expiresAt,
    revoked: false,
  };
  supportTokens.set(tokenHash, record);

  recordImmutableAudit({
    tenantId: scopedTenant,
    actorId: actor,
    action: 'SUPPORT_ACCESS_GRANTED',
    supportAccess: true,
    reason: cleanReason,
    correlationId,
    expiresAt,
  });

  return {
    token,
    tenantId: scopedTenant,
    supportActorId: actor,
    reason: cleanReason,
    ttlMinutes: ttl,
    correlationId,
    expiresAt,
    expiresAtMs,
  };
}

export function verifySupportAccess(token, { tenantId, action = 'SUPPORT_READ', nowMs = Date.now() } = {}) {
  const rawToken = String(token || '').trim();
  const expectedTenant = String(tenantId || '').trim();
  if (!rawToken || !expectedTenant) {
    throw new OpsSupportError('Support token and tenantId are required', 'SUPPORT_TOKEN_MISSING', 401);
  }

  const tokenHash = createHash('sha256').update(rawToken).digest('hex');
  const record = supportTokens.get(tokenHash);
  if (!record) {
    throw new OpsSupportError('Invalid support access token', 'SUPPORT_TOKEN_INVALID', 403);
  }
  if (record.revoked) {
    throw new OpsSupportError('Support access token has been revoked', 'SUPPORT_TOKEN_REVOKED', 403);
  }
  if (record.tenantId !== expectedTenant) {
    throw new OpsSupportError('Support access token is not valid for this tenant', 'SUPPORT_TENANT_MISMATCH', 403);
  }
  if (nowMs >= record.expiresAtMs) {
    throw new OpsSupportError('Support access token has expired', 'SUPPORT_TOKEN_EXPIRED', 403);
  }

  const auditEvent = recordImmutableAudit({
    tenantId: record.tenantId,
    actorId: record.supportActorId,
    action,
    supportAccess: true,
    reason: record.reason,
    correlationId: record.correlationId,
    expiresAt: record.expiresAt,
  });

  return {
    authorized: true,
    tenantId: record.tenantId,
    supportActorId: record.supportActorId,
    supportAccess: true,
    reason: record.reason,
    correlationId: record.correlationId,
    auditEvent,
  };
}

export function revokeSupportAccessToken(token, actorId = 'platform_admin') {
  const tokenHash = createHash('sha256').update(String(token || '').trim()).digest('hex');
  const record = supportTokens.get(tokenHash);
  if (!record) return false;
  record.revoked = true;
  recordImmutableAudit({
    tenantId: record.tenantId,
    actorId,
    action: 'SUPPORT_ACCESS_REVOKED',
    supportAccess: true,
    reason: record.reason,
    correlationId: record.correlationId,
  });
  return true;
}

export function initiateTenantExitExport({
  tenantId,
  actorId,
  reason = 'Customer contract termination',
  retentionYears = 7,
  store,
}) {
  const scopedTenant = String(tenantId || '').trim();
  const actor = String(actorId || '').trim();
  if (!scopedTenant || !actor) {
    throw new OpsSupportError('tenantId and actorId are required for tenant exit', 'INVALID_EXIT_REQUEST', 400);
  }

  const target = store || {};
  const businessRecords = (target.businessRecords || []).filter((r) => r.tenantId === scopedTenant || r.orgId === scopedTenant);
  const documentSnapshots = (target.documentSnapshots || []).filter((d) => d.tenantId === scopedTenant || d.orgId === scopedTenant);
  const statutoryDocuments = (target.statutoryDocuments || []).filter((s) => s.tenantId === scopedTenant || s.orgId === scopedTenant);

  let revokedCredentialsCount = 0;
  for (const cred of target.integrationCredentials || []) {
    if (cred.tenantId === scopedTenant || cred.orgId === scopedTenant) {
      cred.status = 'revoked';
      cred.revokedAt = new Date().toISOString();
      revokedCredentialsCount++;
    }
  }

  let disabledPushCount = 0;
  for (const sub of target.pushSubscriptions || []) {
    if (sub.tenantId === scopedTenant || sub.orgId === scopedTenant) {
      sub.active = false;
      sub.quarantined = true;
      disabledPushCount++;
    }
  }

  const retentionUntil = new Date(Date.now() + retentionYears * 365 * 24 * 60 * 60 * 1000).toISOString();
  for (const doc of statutoryDocuments) {
    doc.retentionLocked = true;
    doc.retentionUntil = retentionUntil;
  }

  if (target.tenantLifecycle) {
    target.tenantLifecycle.state = 'cancelled';
    target.tenantLifecycle.exitStatus = 'archived_pending_retention';
    target.tenantLifecycle.archivedAt = new Date().toISOString();
    target.tenantLifecycle.retentionUntil = retentionUntil;
  }

  const exportPayload = {
    format: 'nexus-tenant-exit-export-v1',
    tenantId: scopedTenant,
    exportedAt: new Date().toISOString(),
    businessRecords: redactAuditEvent(businessRecords),
    documentSnapshots,
    statutoryDocumentsCount: statutoryDocuments.length,
  };
  const manifestChecksum = createHash('sha256').update(JSON.stringify(exportPayload)).digest('hex');

  const correlationId = `exit_${randomBytes(8).toString('hex')}`;
  recordImmutableAudit({
    tenantId: scopedTenant,
    actorId: actor,
    action: 'TENANT_EXIT_EXPORT_INITIATED',
    supportAccess: false,
    reason,
    correlationId,
    revokedCredentialsCount,
    disabledPushCount,
    retainedStatutoryDocs: statutoryDocuments.length,
  });

  return {
    ok: true,
    tenantId: scopedTenant,
    lifecycleState: 'cancelled',
    exitStatus: 'archived_pending_retention',
    revokedCredentialsCount,
    disabledPushCount,
    retainedStatutoryDocumentsCount: statutoryDocuments.length,
    autoDeletedStatutoryDocuments: false,
    retentionUntil,
    manifestChecksum,
    exportPayload,
  };
}
