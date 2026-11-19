import {
  getOutboxEventsForTenant,
  requeueDeadLetterEvents,
  redactSensitiveError,
} from './integration-outbox-inbox.js';

const opsAuditTrail = [];
const unmappedItemsByTenant = new Map();

export class IntegrationOpsError extends Error {
  constructor(message, code = 'INTEGRATION_OPS_ERROR', status = 400) {
    super(message);
    this.name = 'IntegrationOpsError';
    this.code = code;
    this.status = status;
  }
}

function resolveTenantId(ctx) {
  const tid = String(ctx?.tenantId || ctx?.orgId || '').trim();
  if (!tid) throw new IntegrationOpsError('Tenant context is required', 'TENANT_REQUIRED', 401);
  return tid;
}

function assertOpsAdminPermission(ctx, actorId) {
  const role = String(ctx?.role || '').toLowerCase();
  const allowed = role === 'admin' || role === 'hr' || role === 'super_admin' || role === 'manager';
  if (!allowed && ctx?.role !== undefined) {
    throw new IntegrationOpsError('Forbidden: insufficient permission for integration ops action', 'FORBIDDEN', 403);
  }
  if (!String(actorId || ctx?.userId || '').trim()) {
    throw new IntegrationOpsError('actorId is required for audited integration ops action', 'ACTOR_REQUIRED', 400);
  }
}

export function recordUnmappedReviewItem(tenantId, itemId, storeMap = unmappedItemsByTenant) {
  const tid = String(tenantId || '').trim();
  if (!tid || !itemId) return;
  if (!storeMap.has(tid)) storeMap.set(tid, new Set());
  storeMap.get(tid).add(String(itemId));
}

export function clearIntegrationOpsForTests() {
  opsAuditTrail.length = 0;
  unmappedItemsByTenant.clear();
}

export function getIntegrationOpsAuditLog(tenantId) {
  return opsAuditTrail.filter((e) => e.tenantId === tenantId);
}

export async function getIntegrationOperationsSummary(tenantContext, options = {}) {
  const tenantId = resolveTenantId(tenantContext);
  const storeOrRepo = options.store || options.database;
  const events = await getOutboxEventsForTenant(tenantId, storeOrRepo);

  let pendingOutboxCount = 0;
  let failedPermanentCount = 0;
  let deadLetterCount = 0;
  let lastSuccessfulSyncAt = null;
  const recentErrors = [];

  for (const ev of events) {
    if (ev.status === 'pending' || ev.status === 'processing') pendingOutboxCount++;
    else if (ev.status === 'failed_permanent') failedPermanentCount++;
    else if (ev.status === 'dead_letter') deadLetterCount++;

    if (ev.deliveredAt) {
      const iso = new Date(ev.deliveredAt).toISOString();
      if (!lastSuccessfulSyncAt || iso > lastSuccessfulSyncAt) {
        lastSuccessfulSyncAt = iso;
      }
    }

    if (ev.lastErrorRedacted) {
      recentErrors.push({
        eventId: ev.eventId,
        eventType: ev.eventType,
        status: ev.status,
        attemptCount: ev.attemptCount,
        error: redactSensitiveError(ev.lastErrorRedacted),
      });
    }
  }

  const unmappedCount = Number(options.unmappedCount ?? (unmappedItemsByTenant.get(tenantId)?.size || 0));
  const isConfigured =
    options.configured !== undefined
      ? Boolean(options.configured)
      : Boolean(process.env.NEXUS_TMS_URL && process.env.NEXUS_TMS_API_KEY) || events.length > 0;

  let connectionStatus = 'connected';
  if (!isConfigured) {
    connectionStatus = 'disconnected';
  } else if (deadLetterCount > 0 || failedPermanentCount > 0 || unmappedCount > 0) {
    connectionStatus = 'degraded';
  }

  return {
    tenantId,
    connectionStatus,
    lastSuccessfulSyncAt,
    pendingOutboxCount,
    failedPermanentCount,
    deadLetterCount,
    unmappedCount,
    recentErrors: recentErrors.slice(-10),
  };
}

export async function retryDeadLetterEvents(tenantContext, { eventIds, actorId } = {}, options = {}) {
  const tenantId = resolveTenantId(tenantContext);
  const actor = String(actorId || tenantContext?.userId || '').trim();
  assertOpsAdminPermission(tenantContext, actor);

  const storeOrRepo = options.store || options.database;
  const res = await requeueDeadLetterEvents({ tenantId, eventIds, actorId: actor }, storeOrRepo);

  opsAuditTrail.push({
    tenantId,
    action: 'retry_dead_letter',
    actorId: actor,
    eventIds: res.requeued,
    at: new Date().toISOString(),
  });

  return res;
}

export function runDryRunReconciliation(tenantContext, { sourceItems = [], localItems = [] } = {}) {
  const tenantId = resolveTenantId(tenantContext);
  const localById = new Map();
  for (const item of localItems) {
    if (item.tenantId && item.tenantId !== tenantId) continue;
    const key = String(item.id || item.externalId || item.orderNo || '').trim();
    if (key) localById.set(key, item);
  }

  const drifts = [];
  for (const src of sourceItems) {
    if (src.tenantId && src.tenantId !== tenantId) continue;
    const id = String(src.id || src.externalId || src.orderNo || '').trim();
    if (!id) continue;

    if (src.unmapped === true || (!src.mappedIdentity && src.requiresIdentityMapping)) {
      drifts.push({
        id,
        driftType: 'unmapped_identity',
        sourceStatus: src.status ?? null,
        localStatus: null,
        sourceAmountMinor: src.amountMinor ?? null,
        localAmountMinor: null,
        authoritative: Boolean(src.authoritative),
      });
      continue;
    }

    const local = localById.get(id);
    if (!local) {
      drifts.push({
        id,
        driftType: 'missing_in_target',
        sourceStatus: src.status ?? null,
        localStatus: null,
        sourceAmountMinor: src.amountMinor ?? null,
        localAmountMinor: null,
        authoritative: Boolean(src.authoritative),
      });
      continue;
    }

    if (src.status && local.status && String(src.status) !== String(local.status)) {
      drifts.push({
        id,
        driftType: 'status_mismatch',
        sourceStatus: src.status,
        localStatus: local.status,
        authoritative: Boolean(local.authoritative || src.authoritative),
      });
    }

    if (
      src.amountMinor !== undefined &&
      local.amountMinor !== undefined &&
      Number(src.amountMinor) !== Number(local.amountMinor)
    ) {
      drifts.push({
        id,
        driftType: 'amount_mismatch',
        sourceAmountMinor: Number(src.amountMinor),
        localAmountMinor: Number(local.amountMinor),
        authoritative: Boolean(local.authoritative || src.authoritative),
      });
    }
  }

  return {
    dryRun: true,
    tenantId,
    totalChecked: sourceItems.length,
    driftCount: drifts.length,
    drifts,
  };
}

export async function applyReconciliationRepair(
  tenantContext,
  { approvedIds = [], actorId, drifts = [], applyRepairFn } = {}
) {
  const tenantId = resolveTenantId(tenantContext);
  const actor = String(actorId || tenantContext?.userId || '').trim();
  assertOpsAdminPermission(tenantContext, actor);

  const approvedSet = new Set((approvedIds || []).map((x) => String(x).trim()).filter(Boolean));
  if (approvedSet.size === 0) {
    throw new IntegrationOpsError('Explicit approvedIds are required before repairing drift', 'APPROVAL_REQUIRED', 400);
  }

  const repaired = [];
  const skipped = [];

  for (const drift of drifts) {
    if (!approvedSet.has(String(drift.id))) {
      skipped.push({ id: drift.id, reason: 'not_approved' });
      continue;
    }
    if (drift.authoritative) {
      skipped.push({ id: drift.id, reason: 'authoritative_record_protected' });
      continue;
    }
    if (typeof applyRepairFn === 'function') {
      await applyRepairFn(drift);
    }
    repaired.push(drift.id);
  }

  opsAuditTrail.push({
    tenantId,
    action: 'reconciliation_repair',
    actorId: actor,
    repaired,
    skipped,
    at: new Date().toISOString(),
  });

  return {
    dryRun: false,
    tenantId,
    repaired,
    skipped,
    actorId: actor,
  };
}
