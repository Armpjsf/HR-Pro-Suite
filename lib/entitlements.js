import { getDeploymentTenantId, requireTenantContext } from './tenantContext.js';
import { supabase } from './supabase.js';

export const MODULES = ['hr', 'wms', 'tms'];

export const PACKAGE_COMBINATIONS = Object.freeze({
  HR_ONLY: ['hr'],
  WMS_ONLY: ['wms'],
  TMS_ONLY: ['tms'],
  HR_WMS: ['hr', 'wms'],
  HR_TMS: ['hr', 'tms'],
  WMS_TMS: ['wms', 'tms'],
  FULL_SUITE: ['hr', 'wms', 'tms'],
});

export const LIFECYCLE_STATES = ['trial', 'active', 'grace', 'suspended', 'cancelled'];
export const DEFAULT_MAX_CACHE_TTL_MS = 5 * 60 * 1000;

export class EntitlementError extends Error {
  constructor(message, code = 'MODULE_NOT_SUBSCRIBED', status = 403) {
    super(message);
    this.name = 'EntitlementError';
    this.code = code;
    this.status = status;
  }
}

const testEntitlements = new Map();
const entitlementCache = new Map();
const quotaLocks = new Map();
const quotaReservations = new Map();
const recordedUsageEvents = new Map();

function resolveTenantId(contextOrTenantId) {
  if (typeof contextOrTenantId === 'string' && contextOrTenantId.trim()) {
    return contextOrTenantId.trim();
  }
  if (contextOrTenantId && typeof contextOrTenantId === 'object' && typeof contextOrTenantId.tenantId === 'string' && contextOrTenantId.tenantId.trim()) {
    return contextOrTenantId.tenantId.trim();
  }
  return getDeploymentTenantId();
}

function normalizeModules(input, packageCode) {
  if (Array.isArray(input) && input.length > 0) {
    return [...new Set(input.map((m) => String(m).toLowerCase()).filter((m) => MODULES.includes(m)))];
  }
  if (packageCode && PACKAGE_COMBINATIONS[packageCode]) {
    return [...PACKAGE_COMBINATIONS[packageCode]];
  }
  return [...PACKAGE_COMBINATIONS.FULL_SUITE];
}

function evaluateLifecycleState(rawState, endsAt, graceDays = 7, nowMs = Date.now()) {
  const baseState = LIFECYCLE_STATES.includes(rawState) ? rawState : 'active';
  if ((baseState === 'active' || baseState === 'trial') && endsAt) {
    const endMs = new Date(endsAt).getTime();
    if (Number.isFinite(endMs) && nowMs > endMs) {
      const graceMs = Math.max(0, Number(graceDays) || 0) * 86_400_000;
      return nowMs <= endMs + graceMs ? 'grace' : 'suspended';
    }
  }
  return baseState;
}

function inferPackageCode(modules) {
  const sorted = [...new Set(modules)].sort().join(',');
  for (const [code, list] of Object.entries(PACKAGE_COMBINATIONS)) {
    if ([...list].sort().join(',') === sorted) return code;
  }
  return 'CUSTOM';
}

function buildEntitlementRecord(tenantId, raw = {}, nowMs = Date.now()) {
  const packageCode = raw.packageCode && PACKAGE_COMBINATIONS[raw.packageCode]
    ? raw.packageCode
    : (raw.modules ? null : 'FULL_SUITE');
  const modules = normalizeModules(raw.modules, packageCode);
  const graceDays = raw.graceDays ?? 7;
  const endsAt = raw.endsAt || null;
  const state = evaluateLifecycleState(raw.state || 'active', endsAt, graceDays, nowMs);
  const features = raw.features && typeof raw.features === 'object' ? { ...raw.features } : {};
  const quotas = raw.quotas && typeof raw.quotas === 'object' ? { ...raw.quotas } : {};

  return {
    tenantId,
    packageCode: packageCode || inferPackageCode(modules),
    modules,
    state,
    endsAt,
    graceDays,
    features,
    quotas,
    verifiedAt: Number(raw.verifiedAt) || nowMs,
    maxCacheTtlMs: Number(raw.maxCacheTtlMs) || DEFAULT_MAX_CACHE_TTL_MS,
  };
}

function readEnvEntitlement(tenantId) {
  const jsonStr = process.env.HR_ENTITLEMENT_JSON;
  if (jsonStr) {
    try {
      const parsed = JSON.parse(jsonStr);
      if (parsed && typeof parsed === 'object') {
        if (parsed[tenantId]) return parsed[tenantId];
        if (!parsed.tenantId || parsed.tenantId === tenantId) return parsed;
      }
    } catch {
      // ignore invalid env json
    }
  }
  const pkg = process.env.HR_PACKAGE?.trim();
  if (pkg && PACKAGE_COMBINATIONS[pkg]) {
    return { packageCode: pkg, modules: PACKAGE_COMBINATIONS[pkg], state: 'active' };
  }
  return null;
}

function isUndefinedFunctionError(err) {
  if (!err) return false;
  const code = String(err.code || '');
  const msg = String(err.message || '');
  return code === '42883' || code === 'PGRST202' || /does not exist|could not find/i.test(msg);
}

export function setTenantEntitlementForTests(tenantId, entitlement) {
  const key = resolveTenantId(tenantId);
  if (!entitlement) {
    testEntitlements.delete(key);
    entitlementCache.delete(key);
    return null;
  }
  const record = buildEntitlementRecord(key, entitlement);
  testEntitlements.set(key, record);
  entitlementCache.set(key, record);
  return record;
}

export function clearEntitlementsForTests() {
  testEntitlements.clear();
  entitlementCache.clear();
  quotaLocks.clear();
  quotaReservations.clear();
  recordedUsageEvents.clear();
}

export function resetEntitlementUsageForTests() {
  quotaReservations.clear();
  recordedUsageEvents.clear();
}

export async function getEntitlements(context, options = {}) {
  const tenantId = resolveTenantId(context);
  const nowMs = typeof options.now === 'function' ? options.now() : (Number(options.now) || Date.now());
  const maxCacheTtlMs = Number(options.maxCacheTtlMs) || DEFAULT_MAX_CACHE_TTL_MS;

  if (testEntitlements.has(tenantId)) {
    const stored = testEntitlements.get(tenantId);
    return buildEntitlementRecord(tenantId, stored, nowMs);
  }

  if (options.useCacheOnly) {
    const cached = entitlementCache.get(tenantId);
    if (!cached) {
      throw new EntitlementError('No cached entitlement available offline', 'ENTITLEMENT_UNAVAILABLE', 403);
    }
    const ttl = Number(cached.maxCacheTtlMs) || maxCacheTtlMs;
    if (nowMs - cached.verifiedAt > ttl) {
      entitlementCache.delete(tenantId);
      throw new EntitlementError('Offline entitlement cache expired', 'ENTITLEMENT_CACHE_EXPIRED', 403);
    }
    return buildEntitlementRecord(tenantId, cached, nowMs);
  }

  const cached = entitlementCache.get(tenantId);
  if (cached && nowMs - cached.verifiedAt <= (Number(cached.maxCacheTtlMs) || maxCacheTtlMs) && !options.forceRefresh) {
    return buildEntitlementRecord(tenantId, cached, nowMs);
  }

  const envEnt = readEnvEntitlement(tenantId);
  if (envEnt) {
    const rec = buildEntitlementRecord(tenantId, envEnt, nowMs);
    entitlementCache.set(tenantId, rec);
    return rec;
  }

  const db = options.database !== undefined ? options.database : supabase;
  if (db && typeof db.from === 'function') {
    try {
      const { data: modRow, error: modErr } = await db
        .from('tenant_modules')
        .select('package_code, modules, lifecycle_state, ends_at, grace_days')
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (!modErr && modRow) {
        let features = {};
        let quotas = {};
        const { data: limRow } = await db
          .from('tenant_features_limits')
          .select('features, quotas')
          .eq('tenant_id', tenantId)
          .maybeSingle();
        if (limRow) {
          features = limRow.features || {};
          quotas = limRow.quotas || {};
        }

        const rec = buildEntitlementRecord(tenantId, {
          packageCode: modRow.package_code,
          modules: modRow.modules,
          state: modRow.lifecycle_state || 'active',
          endsAt: modRow.ends_at || null,
          graceDays: modRow.grace_days ?? 7,
          features,
          quotas,
          verifiedAt: nowMs,
        }, nowMs);
        entitlementCache.set(tenantId, rec);
        return rec;
      }
    } catch {
      // tenant_modules table may not exist before MIG-07
    }
  }

  const fallback = buildEntitlementRecord(tenantId, { packageCode: 'FULL_SUITE', state: 'active', verifiedAt: nowMs }, nowMs);
  entitlementCache.set(tenantId, fallback);
  return fallback;
}

export function isOperationAllowedInState(state, operationType = 'write') {
  const op = String(operationType || 'write').toLowerCase();
  if (state === 'trial' || state === 'active') {
    return true;
  }
  if (state === 'grace') {
    return op === 'read' || op === 'drain_in_flight' || op === 'export' || op === 'reconcile';
  }
  if (state === 'suspended' || state === 'cancelled') {
    return op === 'read' || op === 'export';
  }
  return false;
}

export async function requireModule(context, moduleName, operationType = 'write', options = {}) {
  const ent = await getEntitlements(context, options);
  const mod = String(moduleName || '').toLowerCase();

  if (!ent.modules.includes(mod)) {
    throw new EntitlementError(
      `Module '${mod}' is not included in package '${ent.packageCode}'`,
      'MODULE_NOT_SUBSCRIBED',
      403,
    );
  }

  if (!isOperationAllowedInState(ent.state, operationType)) {
    const code = ent.state === 'grace'
      ? 'MODULE_IN_GRACE_DRAIN'
      : ent.state === 'cancelled'
        ? 'MODULE_CANCELLED'
        : 'MODULE_SUSPENDED';
    throw new EntitlementError(
      `Operation '${operationType}' is blocked while module '${mod}' is in '${ent.state}' state`,
      code,
      403,
    );
  }

  return ent;
}

export async function requireFeature(context, featureKey, options = {}) {
  const ent = await getEntitlements(context, options);
  const val = ent.features?.[featureKey];
  if (val === false) {
    throw new EntitlementError(`Feature '${featureKey}' is not enabled for tenant`, 'FEATURE_NOT_ENABLED', 403);
  }
  return ent;
}

async function withQuotaLock(lockKey, fn) {
  const prev = quotaLocks.get(lockKey) || Promise.resolve();
  let release;
  const next = new Promise((resolve) => {
    release = resolve;
  });
  quotaLocks.set(lockKey, prev.then(() => next));
  await prev;
  try {
    return await fn();
  } finally {
    release();
  }
}

function unwrapRpcResult(data, fnName) {
  const first = Array.isArray(data) ? data[0] : data;
  if (first && typeof first === 'object' && fnName in first) {
    return first[fnName];
  }
  return first;
}

export async function checkAndReserveQuota(context, resourceKey, currentCountFn, options = {}) {
  const tenantId = resolveTenantId(context);
  const moduleName = options.module || 'hr';
  const ent = await requireModule(context, moduleName, 'create', options);
  const limit = ent.quotas?.[resourceKey];

  if (limit === undefined || limit === null || Number(limit) < 0) {
    return { allowed: true, reserved: 0, limit: -1, deduplicated: false };
  }

  const maxLimit = Number(limit);
  const delta = Math.max(1, Number(options.delta) || 1);
  const eventId = String(
    options.eventId || `quota:${tenantId}:${moduleName}:${resourceKey}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`
  ).trim();
  const explicitInMemory = options.database === null || options.allowInMemoryQuotaFallback === true;

  if (explicitInMemory) {
    if (process.env.NODE_ENV === 'production') {
      throw new EntitlementError('In-memory quota fallback is forbidden in production', 'QUOTA_CONFIG_ERROR', 503);
    }
    const lockKey = `${tenantId}:${resourceKey}`;
    return withQuotaLock(lockKey, async () => {
      const baseCount = typeof currentCountFn === 'function' ? Number(await currentCountFn()) : 0;
      const inFlight = quotaReservations.get(lockKey) || 0;
      if (baseCount + inFlight + delta > maxLimit) {
        throw new EntitlementError(
          `Quota exceeded for '${resourceKey}' (limit: ${maxLimit})`,
          'QUOTA_EXCEEDED',
          403,
        );
      }
      quotaReservations.set(lockKey, inFlight + delta);
      if (options.eventId) {
        recordUsageEvent({
          tenantId,
          module: moduleName,
          resource: resourceKey,
          eventId: options.eventId,
          delta,
        });
      }
      return { allowed: true, reserved: inFlight + delta, limit: maxLimit, deduplicated: false, eventId };
    });
  }

  const db = options.database !== undefined ? options.database : supabase;
  if (!db || typeof db.rpc !== 'function') {
    throw new EntitlementError(
      'Quota reservation schema/RPC unavailable: database client missing rpc()',
      'QUOTA_SCHEMA_MISSING',
      503,
    );
  }

  const baseCount = typeof currentCountFn === 'function' ? Number(await currentCountFn()) : 0;
  const { data, error } = await db.rpc('reserve_tenant_quota', {
    p_tenant_id: tenantId,
    p_module: moduleName,
    p_resource: resourceKey,
    p_event_id: eventId,
    p_delta: delta,
    p_limit: maxLimit,
    p_base_count: baseCount,
    p_now: options.nowIso || new Date().toISOString(),
    p_quota_mode: options.quotaMode || 'concurrent_resource',
  });

  if (error) {
    if (isUndefinedFunctionError(error)) {
      throw new EntitlementError(
        `Quota reservation schema/RPC unavailable or invalid: ${error.message}`,
        'QUOTA_SCHEMA_MISSING',
        503,
      );
    }
    throw new EntitlementError(`Quota reservation failed: ${error.message}`, 'QUOTA_DB_ERROR', 503);
  }

  const res = data !== null && data !== undefined ? unwrapRpcResult(data, 'reserve_tenant_quota') : null;
  if (!res || typeof res.allowed !== 'boolean') {
    throw new EntitlementError(
      'Quota reservation schema/RPC unavailable or invalid: malformed reserve_tenant_quota response',
      'QUOTA_SCHEMA_MISSING',
      503,
    );
  }

  if (!res.allowed) {
    throw new EntitlementError(
      `Quota exceeded for '${resourceKey}' (limit: ${maxLimit})`,
      res.code || 'QUOTA_EXCEEDED',
      403,
    );
  }

  return {
    allowed: true,
    deduplicated: Boolean(res.deduplicated),
    reserved: Number(res.reserved ?? delta),
    limit: Number(res.limit ?? maxLimit),
    eventId,
  };
}

export async function releaseQuotaReservation(contextOrTenantId, resourceKey, deltaOrOptions = 1, maybeOptions = {}) {
  const tenantId = resolveTenantId(contextOrTenantId);
  const opts = typeof deltaOrOptions === 'object' && deltaOrOptions !== null ? deltaOrOptions : (maybeOptions || {});
  const delta = typeof deltaOrOptions === 'number' ? deltaOrOptions : (opts.delta ?? 1);
  const moduleName = opts.module || 'hr';
  const eventId = opts.eventId ? String(opts.eventId).trim() : '';
  const explicitInMemory = opts.database === null || opts.allowInMemoryQuotaFallback === true;

  if (explicitInMemory) {
    if (process.env.NODE_ENV === 'production') {
      throw new EntitlementError('In-memory quota fallback is forbidden in production', 'QUOTA_CONFIG_ERROR', 503);
    }
    const lockKey = `${tenantId}:${resourceKey}`;
    const current = quotaReservations.get(lockKey) || 0;
    quotaReservations.set(lockKey, Math.max(0, current - Math.max(1, Number(delta) || 1)));
    return;
  }

  const db = opts.database !== undefined ? opts.database : supabase;
  if (!db || typeof db.rpc !== 'function') {
    throw new EntitlementError(
      'Quota release schema/RPC unavailable: database client missing rpc()',
      'QUOTA_SCHEMA_MISSING',
      503,
    );
  }

  if (eventId) {
    const { error } = await db.rpc('release_tenant_quota', {
      p_tenant_id: tenantId,
      p_module: moduleName,
      p_resource: resourceKey,
      p_event_id: eventId,
    });
    if (error) {
      if (isUndefinedFunctionError(error)) {
        throw new EntitlementError(
          `Quota release schema/RPC unavailable or invalid: ${error.message}`,
          'QUOTA_SCHEMA_MISSING',
          503,
        );
      }
      throw new EntitlementError(`Failed to release quota reservation: ${error.message}`, 'QUOTA_DB_ERROR', 503);
    }
  }
}

export async function commitQuotaReservation(contextOrTenantId, resourceKey, options = {}) {
  const tenantId = resolveTenantId(contextOrTenantId);
  const moduleName = options.module || 'hr';
  const eventId = options.eventId ? String(options.eventId).trim() : '';
  const explicitInMemory = options.database === null || options.allowInMemoryQuotaFallback === true;

  if (explicitInMemory) {
    if (process.env.NODE_ENV === 'production') {
      throw new EntitlementError('In-memory quota fallback is forbidden in production', 'QUOTA_CONFIG_ERROR', 503);
    }
    const lockKey = `${tenantId}:${resourceKey}`;
    const current = quotaReservations.get(lockKey) || 0;
    const delta = Math.max(1, Number(options.delta) || 1);
    quotaReservations.set(lockKey, Math.max(0, current - delta));
    return;
  }

  const db = options.database !== undefined ? options.database : supabase;
  if (!db || typeof db.rpc !== 'function') {
    throw new EntitlementError(
      'Quota commit schema/RPC unavailable: database client missing rpc()',
      'QUOTA_SCHEMA_MISSING',
      503,
    );
  }

  if (eventId) {
    const { error } = await db.rpc('commit_tenant_quota', {
      p_tenant_id: tenantId,
      p_module: moduleName,
      p_resource: resourceKey,
      p_event_id: eventId,
    });
    if (error) {
      if (isUndefinedFunctionError(error)) {
        throw new EntitlementError(
          `Quota commit schema/RPC unavailable or invalid: ${error.message}`,
          'QUOTA_SCHEMA_MISSING',
          503,
        );
      }
      throw new EntitlementError(`Failed to commit quota reservation: ${error.message}`, 'QUOTA_DB_ERROR', 503);
    }
  }
}

export function recordUsageEvent({ tenantId, module, resource, eventId, delta = 1 }) {
  const tId = resolveTenantId(tenantId);
  const dedupKey = `${tId}:${eventId}`;
  if (recordedUsageEvents.has(dedupKey)) {
    return { deduplicated: true, event: recordedUsageEvents.get(dedupKey) };
  }
  const event = {
    tenantId: tId,
    module,
    resource,
    eventId,
    delta,
    recordedAt: new Date().toISOString(),
  };
  recordedUsageEvents.set(dedupKey, event);
  return { deduplicated: false, event };
}

export function getRecordedUsageEventsForTests(tenantId) {
  const tId = resolveTenantId(tenantId);
  return [...recordedUsageEvents.values()].filter((e) => e.tenantId === tId);
}

export async function requireEntitlementScope(request, moduleName, options = {}) {
  const ctx = await requireTenantContext(request, options);
  const ent = await requireModule(ctx, moduleName, options.operationType || 'write', options);
  return { ctx, ent };
}
