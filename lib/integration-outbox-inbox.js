import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { supabase } from './supabase.js';

const PERMANENT_HTTP_STATUSES = new Set([400, 401, 403, 422]);
const SENSITIVE_KEYS_RE =
  /(password|secret|token|authorization|api[-_]?key|salary|base_salary|net_pay|bank[-_]?account|bankAccountNo|national_id|tax_id|cookie)/i;

export function canonicalizePayload(value) {
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalizePayload(v)).join(',')}]`;
  }
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const keys = Object.keys(value).sort();
    const parts = [];
    for (const k of keys) {
      if (value[k] !== undefined) {
        parts.push(`${JSON.stringify(k)}:${canonicalizePayload(value[k])}`);
      }
    }
    return `{${parts.join(',')}}`;
  }
  return JSON.stringify(value);
}

export function computePayloadHash(payload) {
  return createHash('sha256').update(canonicalizePayload(payload ?? {})).digest('hex');
}

export function redactSensitiveError(input) {
  if (input === null || input === undefined) return null;
  let text = typeof input === 'string' ? input : input instanceof Error ? input.message : JSON.stringify(input);
  text = text.replace(/Bearer\s+[A-Za-z0-9._\-+/=]+/gi, 'Bearer [REDACTED]');
  text = text.replace(
    /((?:password|secret|token|api_key|apiKey|authorization|salary|base_salary|bank_account|bankAccountNo)\s*[:=]\s*)([^\s,;}"']+)/gi,
    '$1[REDACTED]'
  );
  text = text.replace(/\b\d{10,16}\b/g, (m) => (m.length >= 10 ? '[REDACTED_ACCT]' : m));
  return text.slice(0, 500);
}

export function redactSensitiveObject(obj) {
  if (Array.isArray(obj)) return obj.map(redactSensitiveObject);
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      if (SENSITIVE_KEYS_RE.test(k)) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = redactSensitiveObject(v);
      }
    }
    return out;
  }
  return obj;
}

export function signWebhookPayload(rawBody, secret, keyId, timestampSec = Math.floor(Date.now() / 1000)) {
  if (typeof rawBody !== 'string') {
    throw new Error('rawBody must be a string');
  }
  if (!secret || !keyId) {
    throw new Error('secret and keyId are required for webhook signing');
  }
  const ts = Math.floor(Number(timestampSec));
  const digest = createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest('hex');
  return {
    'x-nexus-signature': `v1=${digest}`,
    'x-nexus-timestamp': String(ts),
    'x-nexus-key-id': String(keyId),
  };
}

function getSecretByKeyId(secretsByKeyId, keyId) {
  if (!secretsByKeyId || !keyId) return null;
  if (secretsByKeyId instanceof Map) {
    return secretsByKeyId.get(keyId) || null;
  }
  if (typeof secretsByKeyId === 'object' && Object.prototype.hasOwnProperty.call(secretsByKeyId, keyId)) {
    return secretsByKeyId[keyId] || null;
  }
  return null;
}

export function verifyWebhookSignature({
  rawBody,
  signatureHeader,
  timestampHeader,
  keyIdHeader,
  secretsByKeyId,
  nowSec = Math.floor(Date.now() / 1000),
  windowSec = 300,
}) {
  if (typeof rawBody !== 'string') {
    return { valid: false, reason: 'missing_raw_body', httpStatus: 400 };
  }
  const sig = String(signatureHeader || '').trim();
  const tsStr = String(timestampHeader || '').trim();
  const keyId = String(keyIdHeader || '').trim();

  if (!sig || !tsStr || !keyId) {
    return { valid: false, reason: 'missing_signature_headers', httpStatus: 401 };
  }

  const ts = Number(tsStr);
  if (!Number.isInteger(ts) || ts <= 0) {
    return { valid: false, reason: 'invalid_timestamp', httpStatus: 401 };
  }

  if (Math.abs(Math.floor(nowSec) - ts) > windowSec) {
    return { valid: false, reason: 'timestamp_outside_window', httpStatus: 401 };
  }

  const secret = getSecretByKeyId(secretsByKeyId, keyId);
  if (!secret) {
    return { valid: false, reason: 'unknown_key_id', httpStatus: 401 };
  }

  const expected = `v1=${createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest('hex')}`;
  const sigBuf = Buffer.from(sig, 'utf8');
  const expBuf = Buffer.from(expected, 'utf8');

  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return { valid: false, reason: 'signature_mismatch', httpStatus: 401 };
  }

  return { valid: true, keyId, timestampSec: ts, httpStatus: 200 };
}

export function computeBackoffMs(attempt, options = {}) {
  const n = Math.max(1, Math.floor(Number(attempt) || 1));
  const baseMs = Math.max(100, Number(options.baseMs) || 1000);
  const maxMs = Math.max(baseMs, Number(options.maxMs) || 60000);
  const jitterRatio = Math.min(0.5, Math.max(0, options.jitterRatio ?? 0.2));
  const exponential = Math.min(maxMs, baseMs * Math.pow(2, n - 1));
  const rand = typeof options.randomFn === 'function' ? Number(options.randomFn()) : 0.5;
  const boundedRand = Number.isFinite(rand) ? Math.min(1, Math.max(0, rand)) : 0.5;
  const jitter = Math.round(exponential * jitterRatio * boundedRand);
  return Math.min(maxMs, exponential + jitter);
}

/**
 * In-memory test adapter ONLY. Production runtime must use SupabaseOutboxInboxRepository.
 */
export class IntegrationOutboxInboxStore {
  constructor() {
    this.outbox = new Map();
    this.inbox = new Map();
    this.aggregateVersions = new Map();
    this.auditLog = [];
  }

  _outboxKey(connectionId, eventId) {
    return `${connectionId}::${eventId}`;
  }

  _inboxKey(connectionId, eventId) {
    return `${connectionId}::${eventId}`;
  }

  _aggKey(connectionId, aggregateId) {
    return `${connectionId}::${aggregateId}`;
  }

  clear() {
    this.outbox.clear();
    this.inbox.clear();
    this.aggregateVersions.clear();
    this.auditLog.length = 0;
  }
}

export function createInMemoryOutboxInboxStoreForTests() {
  return new IntegrationOutboxInboxStore();
}

export const defaultOutboxInboxStore = new IntegrationOutboxInboxStore();

function toMs(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === 'number') return val;
  const parsed = Date.parse(String(val));
  return Number.isFinite(parsed) ? parsed : null;
}

function mapOutboxRow(row) {
  return {
    id: row.id,
    eventId: row.event_id,
    tenantId: row.tenant_id,
    connectionId: row.connection_id,
    aggregateId: row.aggregate_id,
    aggregateVersion: Number(row.aggregate_version) || 1,
    eventType: row.event_type,
    schemaVersion: row.schema_version || '2.0.0',
    payload: row.payload ?? {},
    payloadHash: row.payload_hash,
    status: row.status,
    attemptCount: Number(row.attempt_count) || 0,
    nextAttemptAt: toMs(row.next_attempt_at) ?? Date.now(),
    leaseOwner: row.lease_owner || null,
    leaseExpiresAt: toMs(row.lease_expires_at),
    lastErrorRedacted: row.last_error || null,
    createdAt: toMs(row.created_at) ?? Date.now(),
    deliveredAt: toMs(row.delivered_at),
  };
}

function isUndefinedFunctionError(err) {
  if (!err) return false;
  const code = String(err.code || '');
  const msg = String(err.message || '');
  return code === '42883' || code === 'PGRST202' || /does not exist|could not find/i.test(msg);
}

function unwrapRpcResult(data, fnName) {
  const first = Array.isArray(data) ? data[0] : data;
  if (first && typeof first === 'object' && fnName in first) {
    return first[fnName];
  }
  return first;
}

function isUniqueViolation(err) {
  if (!err) return false;
  const code = String(err.code || '');
  const msg = String(err.message || '');
  return code === '23505' || /duplicate key|unique/i.test(msg);
}

export class SupabaseOutboxInboxRepository {
  constructor(database = supabase) {
    this.db = database;
  }

  _requireDb() {
    if (!this.db || typeof this.db.from !== 'function') {
      throw new Error('Database client is required for SupabaseOutboxInboxRepository');
    }
    return this.db;
  }

  async enqueueOutboxEvent(event) {
    const db = this._requireDb();
    const eventId = String(event?.eventId || '').trim();
    const tenantId = String(event?.tenantId || '').trim();
    const connectionId = String(event?.connectionId || '').trim();
    const aggregateId = String(event?.aggregateId || '').trim();

    if (!eventId || !tenantId || !connectionId || !aggregateId) {
      throw new Error('eventId, tenantId, connectionId, and aggregateId are required');
    }

    const nowMs = Number(event.nowMs) || Date.now();
    const nextAttemptMs = event.nextAttemptAt !== undefined ? Number(event.nextAttemptAt) : nowMs;
    const payload = event.payload ?? {};
    const payloadHash = computePayloadHash(payload);

    const insertRow = {
      tenant_id: tenantId,
      connection_id: connectionId,
      event_id: eventId,
      aggregate_id: aggregateId,
      aggregate_version: Number(event.aggregateVersion) || 1,
      event_type: String(event.eventType || 'integration.event'),
      schema_version: String(event.schemaVersion || '2.0.0'),
      payload,
      payload_hash: payloadHash,
      status: 'pending',
      attempt_count: 0,
      next_attempt_at: new Date(nextAttemptMs).toISOString(),
      created_at: new Date(nowMs).toISOString(),
    };

    const { data, error } = await db
      .from('integration_outbox')
      .insert(insertRow)
      .select('*')
      .maybeSingle();

    if (!error && data) {
      return { ...mapOutboxRow(data), deduplicated: false };
    }

    if (isUniqueViolation(error)) {
      const { data: existing, error: selErr } = await db
        .from('integration_outbox')
        .select('*')
        .eq('connection_id', connectionId)
        .eq('event_id', eventId)
        .maybeSingle();
      if (selErr || !existing) {
        throw new Error(`Outbox lookup after duplicate failed: ${selErr?.message || 'not found'}`);
      }
      return { ...mapOutboxRow(existing), deduplicated: true };
    }

    throw new Error(`Outbox enqueue failed: ${error?.message || 'unknown database error'}`);
  }

  async claimOutboxBatch({ workerId, leaseDurationMs = 30000, nowMs = Date.now(), limit = 20 }) {
    const db = this._requireDb();
    const wId = String(workerId || '').trim();
    if (!wId) throw new Error('workerId is required to claim outbox batch');

    const nowIso = new Date(nowMs).toISOString();

    if (typeof db.rpc === 'function') {
      const { data, error } = await db.rpc('claim_integration_outbox_batch', {
        p_worker_id: wId,
        p_lease_ms: Number(leaseDurationMs) || 30000,
        p_limit: Number(limit) || 20,
        p_now: nowIso,
      });

      if (!error) {
        const rows = Array.isArray(data) ? data : data ? [data] : [];
        return rows.map(mapOutboxRow);
      }

      if (!isUndefinedFunctionError(error)) {
        throw new Error(`Outbox claim RPC failed: ${error.message}`);
      }
    }

    // Optimistic conditional fallback only when SQL RPC is absent (e.g. unit test mocks)
    const { data: candidates, error: selErr } = await db
      .from('integration_outbox')
      .select('*')
      .in('status', ['pending', 'processing'])
      .order('next_attempt_at', { ascending: true })
      .limit(Math.max(1, (Number(limit) || 20) * 2));

    if (selErr) {
      throw new Error(`Outbox claim query failed: ${selErr.message}`);
    }

    const leaseIso = new Date(nowMs + (Number(leaseDurationMs) || 30000)).toISOString();
    const claimed = [];
    for (const row of candidates || []) {
      if (claimed.length >= limit) break;
      const nextAt = toMs(row.next_attempt_at) ?? 0;
      const leaseExp = toMs(row.lease_expires_at);
      const isDuePending = row.status === 'pending' && nextAt <= nowMs;
      const isExpiredLease = row.status === 'processing' && leaseExp !== null && leaseExp <= nowMs;
      if (!isDuePending && !isExpiredLease) continue;

      let upd = db
        .from('integration_outbox')
        .update({
          status: 'processing',
          lease_owner: wId,
          lease_expires_at: leaseIso,
        })
        .eq('id', row.id)
        .eq('status', row.status);
      if (row.lease_owner == null) {
        upd = upd.is('lease_owner', null);
      } else {
        upd = upd.eq('lease_owner', row.lease_owner);
      }
      const { data: updatedRows, error: updErr } = await upd.select('*');
      if (updErr) throw new Error(`Outbox conditional claim failed: ${updErr.message}`);
      if (Array.isArray(updatedRows) && updatedRows.length > 0) {
        claimed.push(mapOutboxRow(updatedRows[0]));
      }
    }

    return claimed;
  }

  async processOutboxBatch({
    workerId,
    leaseDurationMs = 30000,
    nowMs = Date.now(),
    limit = 20,
    maxAttempts = 5,
    signingConfig,
    deliverFn,
    backoffOptions,
  }) {
    if (typeof deliverFn !== 'function') {
      throw new Error('deliverFn is required');
    }
    const db = this._requireDb();
    const claimed = await this.claimOutboxBatch({ workerId, leaseDurationMs, nowMs, limit });
    const results = [];

    for (const record of claimed) {
      const envelope = {
        event_id: record.eventId,
        connection_id: record.connectionId,
        event_type: record.eventType,
        schema_version: record.schemaVersion,
        aggregate_id: record.aggregateId,
        aggregate_version: record.aggregateVersion,
        tenant_claim: record.tenantId,
        payload: record.payload,
      };
      const rawBody = JSON.stringify(envelope);
      const attemptTsSec = Math.floor(nowMs / 1000);
      const headers =
        signingConfig?.secret && signingConfig?.keyId
          ? signWebhookPayload(rawBody, signingConfig.secret, signingConfig.keyId, attemptTsSec)
          : {};

      let outcome;
      try {
        outcome = await deliverFn(record, { rawBody, headers, attemptTimestampSec: attemptTsSec });
      } catch (err) {
        outcome = { ok: false, httpStatus: 500, error: err instanceof Error ? err.message : String(err) };
      }

      const nextAttemptCount = record.attemptCount + 1;
      const httpStatus = Number(outcome?.httpStatus) || (outcome?.ok ? 200 : 0);

      if (outcome?.ok) {
        const { error: updErr } = await db
          .from('integration_outbox')
          .update({
            status: 'delivered',
            attempt_count: nextAttemptCount,
            lease_owner: null,
            lease_expires_at: null,
            delivered_at: new Date(nowMs).toISOString(),
            last_error: null,
          })
          .eq('id', record.id)
          .eq('lease_owner', workerId);
        if (updErr) throw new Error(`Outbox delivery status update failed: ${updErr.message}`);

        await db.from('integration_attempts').insert({
          outbox_id: record.id,
          tenant_id: record.tenantId,
          attempt_number: nextAttemptCount,
          http_status: httpStatus,
          error_summary: null,
          attempted_at: new Date(nowMs).toISOString(),
        });

        results.push({ eventId: record.eventId, status: 'delivered', attemptCount: nextAttemptCount });
        continue;
      }

      const isPermanent = Boolean(outcome?.permanent) || PERMANENT_HTTP_STATUSES.has(httpStatus);
      const redactedErr = redactSensitiveError(outcome?.error || `HTTP ${httpStatus || 'ERROR'}`);

      let nextStatus = 'pending';
      let nextAttemptAtIso = new Date(nowMs).toISOString();
      if (isPermanent) {
        nextStatus = 'failed_permanent';
      } else if (nextAttemptCount >= maxAttempts) {
        nextStatus = 'dead_letter';
      } else {
        const backoffMs = computeBackoffMs(nextAttemptCount, backoffOptions);
        nextAttemptAtIso = new Date(nowMs + backoffMs).toISOString();
      }

      const { error: updErr } = await db
        .from('integration_outbox')
        .update({
          status: nextStatus,
          attempt_count: nextAttemptCount,
          lease_owner: null,
          lease_expires_at: null,
          next_attempt_at: nextAttemptAtIso,
          last_error: redactedErr,
        })
        .eq('id', record.id)
        .eq('lease_owner', workerId);
      if (updErr) throw new Error(`Outbox failure status update failed: ${updErr.message}`);

      await db.from('integration_attempts').insert({
        outbox_id: record.id,
        tenant_id: record.tenantId,
        attempt_number: nextAttemptCount,
        http_status: httpStatus || null,
        error_summary: redactedErr,
        attempted_at: new Date(nowMs).toISOString(),
      });

      results.push({
        eventId: record.eventId,
        status: nextStatus,
        attemptCount: nextAttemptCount,
        ...(nextStatus === 'pending' ? { nextAttemptAt: Date.parse(nextAttemptAtIso) } : {}),
        lastErrorRedacted: redactedErr,
      });
    }

    return { claimedCount: claimed.length, results };
  }

  async receiveAndApplyInboxEvent({
    connectionId,
    tenantId,
    eventId,
    aggregateId,
    aggregateVersion = 1,
    eventType = 'integration.event',
    schemaVersion = '2.0.0',
    payload,
    applyFn,
    getLastAppliedVersion,
    persistInboxFn,
    workerId,
    leaseDurationMs = 30000,
    nowMs = Date.now(),
  }) {
    const db = this._requireDb();
    const connId = String(connectionId || '').trim();
    const evtId = String(eventId || '').trim();
    const aggId = String(aggregateId || '').trim();
    const tId = String(tenantId || '').trim();

    if (!connId || !evtId || !aggId || !tId) {
      return { status: 'invalid_event', idempotent: false, httpStatus: 400, error: 'Missing required inbox fields' };
    }

    const payloadHash = computePayloadHash(payload ?? {});
    const incomingVersion = Number(aggregateVersion) || 1;
    const wId = String(workerId || `inbox-worker-${process.pid}-${Math.random().toString(36).slice(2, 8)}`).trim();
    const leaseMs = Math.max(100, Number(leaseDurationMs) || 30000);
    const nowIso = new Date(nowMs).toISOString();
    const leaseExpiresIso = new Date(nowMs + leaseMs).toISOString();
    const externalLastVersion =
      typeof getLastAppliedVersion === 'function' ? Number(await getLastAppliedVersion(aggId, connId, tId)) || 0 : 0;

    let claimedInboxId = null;
    let claimedAttemptCount = null;
    let claimedCommittedReceipts = {};
    let usedClaimRpc = false;

    if (typeof db.rpc === 'function') {
      const rpcPayload =
        payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : { value: payload ?? null };
      const { data: claimData, error: claimErr } = await db.rpc('claim_integration_inbox_event', {
        p_connection_id: connId,
        p_tenant_id: tId,
        p_event_id: evtId,
        p_aggregate_id: aggId,
        p_aggregate_version: incomingVersion,
        p_event_type: eventType,
        p_schema_version: schemaVersion,
        p_payload: rpcPayload,
        p_payload_hash: payloadHash,
        p_worker_id: wId,
        p_lease_ms: leaseMs,
        p_external_last_version: externalLastVersion,
        p_now: nowIso,
      });

      if (!claimErr && claimData !== null && claimData !== undefined) {
        const claimRes = unwrapRpcResult(claimData, 'claim_integration_inbox_event');
        if (claimRes && typeof claimRes.outcome === 'string') {
          usedClaimRpc = true;
          if (claimRes.outcome === 'invalid_event') {
            return { status: 'invalid_event', idempotent: false, httpStatus: 400, error: 'Missing required inbox fields' };
          }
          if (claimRes.outcome === 'conflict_payload_mismatch') {
            return {
              status: 'conflict_payload_mismatch',
              idempotent: false,
              httpStatus: 409,
              error: `Event ${evtId} already received with different payload hash`,
            };
          }
          if (claimRes.outcome === 'duplicate_ignored' || claimRes.outcome === 'recovered_already_applied') {
            return {
              status: 'duplicate_ignored',
              idempotent: true,
              httpStatus: 200,
              priorStatus: claimRes.prior_status || 'applied',
              ...(claimRes.result_json !== null && claimRes.result_json !== undefined
                ? { result: claimRes.result_json }
                : {}),
            };
          }
          if (claimRes.outcome === 'in_progress_retry_later') {
            return {
              status: 'in_progress_retry_later',
              idempotent: false,
              httpStatus: 409,
              priorStatus: claimRes.prior_status || 'processing',
              error: 'Event or aggregate is currently being processed by an active worker; retry after lease expiry',
            };
          }
          if (claimRes.outcome === 'rejected_stale_version') {
            const lastAppliedVersion = Number(claimRes.last_applied_version) || 0;
            if (typeof persistInboxFn === 'function') {
              try {
                await persistInboxFn({
                  connectionId: connId,
                  tenantId: tId,
                  eventId: evtId,
                  aggregateId: aggId,
                  aggregateVersion: incomingVersion,
                  eventType,
                  schemaVersion,
                  payloadHash,
                  status: 'rejected_stale_version',
                  appliedAt: nowMs,
                });
              } catch (err) {
                return {
                  status: 'inbox_persistence_failed',
                  idempotent: false,
                  httpStatus: 500,
                  error: redactSensitiveError(err),
                };
              }
            }
            return {
              status: 'rejected_stale_version',
              idempotent: true,
              httpStatus: 200,
              lastAppliedVersion,
            };
          }
          if (claimRes.outcome === 'claimed') {
            claimedInboxId = claimRes.inbox_id;
            claimedAttemptCount =
              claimRes.fencing_token !== undefined && claimRes.fencing_token !== null
                ? Number(claimRes.fencing_token)
                : claimRes.attempt_count !== undefined && claimRes.attempt_count !== null
                  ? Number(claimRes.attempt_count)
                  : null;
            if (
              claimRes.committed_receipts &&
              typeof claimRes.committed_receipts === 'object' &&
              !Array.isArray(claimRes.committed_receipts)
            ) {
              claimedCommittedReceipts = { ...claimRes.committed_receipts };
            }
          }
        }
      } else if (claimErr && !isUndefinedFunctionError(claimErr)) {
        return {
          status: 'inbox_persistence_failed',
          idempotent: false,
          httpStatus: 500,
          error: redactSensitiveError(claimErr.message),
        };
      }
    }

    if (!usedClaimRpc) {
      const { data: existing, error: lookupErr } = await db
        .from('integration_inbox')
        .select('*')
        .eq('connection_id', connId)
        .eq('event_id', evtId)
        .maybeSingle();

      if (lookupErr) {
        return {
          status: 'inbox_persistence_failed',
          idempotent: false,
          httpStatus: 500,
          error: redactSensitiveError(lookupErr.message),
        };
      }

      if (existing) {
        if (existing.payload_hash !== payloadHash) {
          return {
            status: 'conflict_payload_mismatch',
            idempotent: false,
            httpStatus: 409,
            error: `Event ${evtId} already received with different payload hash`,
          };
        }
        if (existing.status === 'applied' || existing.status === 'rejected_stale_version') {
          return {
            status: 'duplicate_ignored',
            idempotent: true,
            httpStatus: 200,
            priorStatus: existing.status,
            ...(existing.result_json !== null && existing.result_json !== undefined
              ? { result: existing.result_json }
              : {}),
          };
        }
        if (existing.effect_applied_at) {
          await db
            .from('integration_inbox')
            .update({
              status: 'applied',
              applied_at: existing.applied_at || nowIso,
              lease_owner: null,
              lease_expires_at: null,
              last_error: null,
            })
            .eq('id', existing.id);
          return {
            status: 'duplicate_ignored',
            idempotent: true,
            httpStatus: 200,
            priorStatus: 'applied',
            ...(existing.result_json !== null && existing.result_json !== undefined
              ? { result: existing.result_json }
              : {}),
          };
        }
        if (existing.status === 'processing') {
          const leaseExp = toMs(existing.lease_expires_at);
          if (leaseExp !== null && leaseExp > nowMs) {
            return {
              status: 'in_progress_retry_later',
              idempotent: false,
              httpStatus: 409,
              priorStatus: 'processing',
              error: 'Event is currently being processed by an active worker; retry after lease expiry',
            };
          }
        }
      }

      const { data: activeAggRows, error: activeAggErr } = await db
        .from('integration_inbox')
        .select('id, event_id, lease_expires_at')
        .eq('connection_id', connId)
        .eq('aggregate_id', aggId)
        .eq('status', 'processing');

      if (activeAggErr) {
        return {
          status: 'inbox_persistence_failed',
          idempotent: false,
          httpStatus: 500,
          error: redactSensitiveError(activeAggErr.message),
        };
      }

      const activeList = Array.isArray(activeAggRows) ? activeAggRows : activeAggRows ? [activeAggRows] : [];
      const otherActive = activeList.find((r) => {
        if (r.event_id === evtId) return false;
        const exp = toMs(r.lease_expires_at);
        return exp !== null && exp > nowMs;
      });
      if (otherActive) {
        return {
          status: 'in_progress_retry_later',
          idempotent: false,
          httpStatus: 409,
          priorStatus: 'processing',
          error: 'Another event for this aggregate is currently being processed; retry later',
        };
      }

      const { data: latestAggRow, error: aggErr } = await db
        .from('integration_inbox')
        .select('aggregate_version')
        .eq('connection_id', connId)
        .eq('aggregate_id', aggId)
        .eq('status', 'applied')
        .order('aggregate_version', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (aggErr) {
        return {
          status: 'inbox_persistence_failed',
          idempotent: false,
          httpStatus: 500,
          error: redactSensitiveError(aggErr.message),
        };
      }

      const storedLastVersion = Number(latestAggRow?.aggregate_version) || 0;
      const lastAppliedVersion = Math.max(storedLastVersion, externalLastVersion);

      if (incomingVersion < lastAppliedVersion) {
        const staleRecord = {
          connectionId: connId,
          tenantId: tId,
          eventId: evtId,
          aggregateId: aggId,
          aggregateVersion: incomingVersion,
          eventType,
          schemaVersion,
          payloadHash,
          status: 'rejected_stale_version',
          appliedAt: nowMs,
        };
        try {
          if (typeof persistInboxFn === 'function') {
            await persistInboxFn(staleRecord);
          }
          if (existing) {
            const { error: staleUpdErr } = await db
              .from('integration_inbox')
              .update({
                status: 'rejected_stale_version',
                applied_at: nowIso,
                lease_owner: null,
                lease_expires_at: null,
                last_error: null,
              })
              .eq('id', existing.id);
            if (staleUpdErr) throw new Error(staleUpdErr.message);
          } else {
            const { error: staleErr } = await db.from('integration_inbox').insert({
              tenant_id: tId,
              connection_id: connId,
              event_id: evtId,
              aggregate_id: aggId,
              aggregate_version: incomingVersion,
              event_type: eventType,
              schema_version: schemaVersion,
              payload_hash: payloadHash,
              status: 'rejected_stale_version',
              received_at: nowIso,
              applied_at: nowIso,
            });
            if (staleErr && !isUniqueViolation(staleErr)) {
              throw new Error(staleErr.message);
            }
          }
        } catch (err) {
          return {
            status: 'inbox_persistence_failed',
            idempotent: false,
            httpStatus: 500,
            error: redactSensitiveError(err),
          };
        }
        return {
          status: 'rejected_stale_version',
          idempotent: true,
          httpStatus: 200,
          lastAppliedVersion,
        };
      }

      // Claim or reclaim inbox slot before applying side effects
      if (existing && (existing.status === 'failed' || existing.status === 'processing')) {
        const { data: reclaimed, error: recErr } = await db
          .from('integration_inbox')
          .update({
            status: 'processing',
            lease_owner: wId,
            lease_expires_at: leaseExpiresIso,
            attempt_count: (Number(existing.attempt_count) || 0) + 1,
            last_error: null,
            received_at: nowIso,
          })
          .eq('id', existing.id)
          .eq('status', existing.status)
          .select('*')
          .maybeSingle();
        if (recErr) {
          return {
            status: 'inbox_persistence_failed',
            idempotent: false,
            httpStatus: 500,
            error: redactSensitiveError(recErr.message),
          };
        }
        if (!reclaimed) {
          return {
            status: 'in_progress_retry_later',
            idempotent: false,
            httpStatus: 409,
            priorStatus: 'processing',
            error: 'Failed to reclaim inbox row due to concurrent worker claim; retry later',
          };
        }
        claimedInboxId = reclaimed.id;
        claimedAttemptCount = Number(reclaimed.attempt_count) || 1;
      } else {
        const { data: inserted, error: insErr } = await db
          .from('integration_inbox')
          .insert({
            tenant_id: tId,
            connection_id: connId,
            event_id: evtId,
            aggregate_id: aggId,
            aggregate_version: incomingVersion,
            event_type: eventType,
            schema_version: schemaVersion,
            payload_hash: payloadHash,
            status: 'processing',
            lease_owner: wId,
            lease_expires_at: leaseExpiresIso,
            attempt_count: 1,
            received_at: nowIso,
          })
          .select('*')
          .maybeSingle();

        if (isUniqueViolation(insErr)) {
          const { data: raced } = await db
            .from('integration_inbox')
            .select('*')
            .eq('connection_id', connId)
            .eq('event_id', evtId)
            .maybeSingle();
          if (raced && raced.payload_hash !== payloadHash) {
            return {
              status: 'conflict_payload_mismatch',
              idempotent: false,
              httpStatus: 409,
              error: `Event ${evtId} already received with different payload hash`,
            };
          }
          if (raced && (raced.status === 'applied' || raced.status === 'rejected_stale_version' || raced.effect_applied_at)) {
            return {
              status: 'duplicate_ignored',
              idempotent: true,
              httpStatus: 200,
              priorStatus: raced.effect_applied_at ? 'applied' : raced.status,
              ...(raced.result_json !== null && raced.result_json !== undefined ? { result: raced.result_json } : {}),
            };
          }
          return {
            status: 'in_progress_retry_later',
            idempotent: false,
            httpStatus: 409,
            priorStatus: raced?.status || 'processing',
            error: 'Event is currently being processed by a concurrent worker; retry later',
          };
        }

        if (insErr || !inserted) {
          return {
            status: 'inbox_persistence_failed',
            idempotent: false,
            httpStatus: 500,
            error: redactSensitiveError(insErr?.message || 'Failed to persist inbox slot'),
          };
        }
        claimedInboxId = inserted.id;
        claimedAttemptCount = Number(inserted.attempt_count) || 1;
      }

      try {
        const { data: rcptRows } = await db
          .from('integration_effect_receipts')
          .select('target_key, result_json')
          .eq('tenant_id', tId)
          .eq('connection_id', connId)
          .eq('event_id', evtId);
        if (Array.isArray(rcptRows)) {
          for (const row of rcptRows) {
            if (row?.target_key) claimedCommittedReceipts[String(row.target_key)] = row.result_json;
          }
        }
      } catch {
        // Optional table when running without effect receipt migration in minimal mock DBs
      }
    }

    let applyResult = null;
    let effectApplied = false;

    const recordTargetReceipt = async (targetKey, res, options = {}) => {
      const tKey = String(targetKey || '').trim();
      if (!tKey) throw new Error('targetKey is required for recordTargetReceipt');
      if (typeof db.rpc === 'function') {
        const { data: rcptData, error: rcptErr } = await db.rpc('record_integration_effect_receipt', {
          p_tenant_id: tId,
          p_connection_id: connId,
          p_event_id: evtId,
          p_target_key: tKey,
          p_inbox_id: claimedInboxId,
          p_worker_id: wId,
          p_fencing_token: claimedAttemptCount,
          p_effect_type: options.effectType || 'domain_mutation',
          p_result_json: res !== undefined ? res : {},
          p_mark_inbox_complete: Boolean(options.markInboxComplete),
          p_now: nowIso,
        });
        if (!rcptErr) {
          const parsed = unwrapRpcResult(rcptData, 'record_integration_effect_receipt');
          claimedCommittedReceipts[tKey] = parsed?.result_json ?? res ?? {};
          if (options.markInboxComplete) {
            effectApplied = true;
          }
          return parsed;
        }
        if (!isUndefinedFunctionError(rcptErr)) {
          throw new Error(rcptErr.message);
        }
      }

      const { data: currentInbox } = await db
        .from('integration_inbox')
        .select('lease_owner, attempt_count')
        .eq('id', claimedInboxId)
        .maybeSingle();
      if (
        currentInbox &&
        ((currentInbox.lease_owner && currentInbox.lease_owner !== wId) ||
          (claimedAttemptCount !== null && Number(currentInbox.attempt_count) !== claimedAttemptCount))
      ) {
        throw new Error(`INBOX_LEASE_LOST: Worker ${wId} lost lease on inbox ${claimedInboxId}`);
      }
      claimedCommittedReceipts[tKey] = res ?? {};
      if (options.markInboxComplete) {
        effectApplied = true;
      }
      return { outcome: 'recorded', idempotent: false, result_json: res ?? {} };
    };

    const recordEffectApplied = async (res) => {
      effectApplied = true;
      if (res !== undefined) applyResult = res;
      if (usedClaimRpc && typeof db.rpc === 'function') {
        const { data: effData, error: effErr } = await db.rpc('complete_integration_inbox_event', {
          p_inbox_id: claimedInboxId,
          p_worker_id: wId,
          p_status: 'effect_applied',
          p_result_json: res !== undefined ? res : null,
          p_now: nowIso,
          ...(claimedAttemptCount !== null ? { p_fencing_token: claimedAttemptCount } : {}),
        });
        if (effErr && !isUndefinedFunctionError(effErr)) {
          throw new Error(effErr.message);
        }
        const effRes = effData ? unwrapRpcResult(effData, 'complete_integration_inbox_event') : null;
        if (effRes && effRes.updated === false && effRes.reason === 'lease_lost') {
          throw new Error(`INBOX_LEASE_LOST: Worker ${wId} lost lease while recording effect_applied`);
        }
      } else {
        let upd = db
          .from('integration_inbox')
          .update({
            effect_applied_at: nowIso,
            ...(res !== undefined ? { result_json: res } : {}),
          })
          .eq('id', claimedInboxId)
          .eq('lease_owner', wId);
        if (claimedAttemptCount !== null) {
          upd = upd.eq('attempt_count', claimedAttemptCount);
        }
        const { data: updatedRows, error: effErr } = await upd.select('id');
        if (effErr) throw new Error(effErr.message);
        if (!Array.isArray(updatedRows) || updatedRows.length === 0) {
          throw new Error(`INBOX_LEASE_LOST: Worker ${wId} lost lease while recording effect_applied`);
        }
      }
    };

    try {
      if (typeof applyFn === 'function') {
        applyResult = await applyFn({
          connectionId: connId,
          tenantId: tId,
          eventId: evtId,
          aggregateId: aggId,
          aggregateVersion: incomingVersion,
          payload,
          inboxId: claimedInboxId,
          workerId: wId,
          fencingToken: claimedAttemptCount,
          committedReceipts: claimedCommittedReceipts,
          recordEffectApplied,
          recordTargetReceipt,
        });
        effectApplied = true;
      }
    } catch (err) {
      const rawMsg = err instanceof Error ? err.message : String(err);
      const isLeaseLost = /INBOX_LEASE_LOST/i.test(rawMsg);
      const redactedErr = redactSensitiveError(err);
      if (isLeaseLost) {
        return {
          status: 'lease_lost',
          idempotent: false,
          httpStatus: 409,
          error: redactedErr || 'Worker lease expired and was reclaimed by another worker',
        };
      }
      if (usedClaimRpc && typeof db.rpc === 'function') {
        try {
          await db.rpc('complete_integration_inbox_event', {
            p_inbox_id: claimedInboxId,
            p_worker_id: wId,
            p_status: 'failed',
            p_result_json: effectApplied ? (applyResult ?? null) : null,
            p_error: redactedErr,
            p_effect_applied: effectApplied,
            p_now: nowIso,
            ...(claimedAttemptCount !== null ? { p_fencing_token: claimedAttemptCount } : {}),
          });
        } catch {
          // ignore secondary cleanup error
        }
      } else {
        let upd = db
          .from('integration_inbox')
          .update({
            status: effectApplied ? 'applied' : 'failed',
            ...(effectApplied
              ? { effect_applied_at: nowIso, applied_at: nowIso, result_json: applyResult ?? null }
              : {}),
            lease_owner: null,
            lease_expires_at: null,
            last_error: redactedErr,
          })
          .eq('id', claimedInboxId)
          .eq('lease_owner', wId);
        if (claimedAttemptCount !== null) upd = upd.eq('attempt_count', claimedAttemptCount);
        await upd;
      }
      return {
        status: 'inbox_persistence_failed',
        idempotent: false,
        httpStatus: 500,
        error: redactedErr,
      };
    }

    try {
      const appliedRecord = {
        connectionId: connId,
        tenantId: tId,
        eventId: evtId,
        aggregateId: aggId,
        aggregateVersion: incomingVersion,
        eventType,
        schemaVersion,
        payloadHash,
        status: 'applied',
        appliedAt: nowMs,
      };
      if (typeof persistInboxFn === 'function') {
        await persistInboxFn(appliedRecord);
      }

      if (usedClaimRpc && typeof db.rpc === 'function') {
        const { data: compData, error: compErr } = await db.rpc('complete_integration_inbox_event', {
          p_inbox_id: claimedInboxId,
          p_worker_id: wId,
          p_status: 'applied',
          p_result_json: applyResult ?? null,
          p_effect_applied: true,
          p_now: nowIso,
          ...(claimedAttemptCount !== null ? { p_fencing_token: claimedAttemptCount } : {}),
        });
        if (compErr) {
          if (isUndefinedFunctionError(compErr)) {
            let upd = db
              .from('integration_inbox')
              .update({
                status: 'applied',
                effect_applied_at: nowIso,
                result_json: applyResult ?? null,
                applied_at: nowIso,
                lease_owner: null,
                lease_expires_at: null,
                last_error: null,
              })
              .eq('id', claimedInboxId)
              .eq('lease_owner', wId);
            if (claimedAttemptCount !== null) upd = upd.eq('attempt_count', claimedAttemptCount);
            const { data: finRows, error: finErr } = await upd.select('id');
            if (finErr) throw new Error(finErr.message);
            if (!Array.isArray(finRows) || finRows.length === 0) {
              return {
                status: 'lease_lost',
                idempotent: false,
                httpStatus: 409,
                error: 'Worker lease expired and was reclaimed by another worker',
              };
            }
          } else {
            throw new Error(compErr.message);
          }
        } else if (compData !== null && compData !== undefined) {
          const compRes = unwrapRpcResult(compData, 'complete_integration_inbox_event');
          if (compRes && compRes.updated === false) {
            if (compRes.reason === 'lease_lost') {
              return {
                status: 'lease_lost',
                idempotent: false,
                httpStatus: 409,
                error: 'Worker lease expired and was reclaimed by another worker',
              };
            }
            if (compRes.reason === 'already_applied') {
              return {
                status: 'duplicate_ignored',
                idempotent: true,
                httpStatus: 200,
                priorStatus: 'applied',
                ...(compRes.result_json !== null && compRes.result_json !== undefined
                  ? { result: compRes.result_json }
                  : {}),
              };
            }
          }
        }
      } else {
        let upd = db
          .from('integration_inbox')
          .update({
            status: 'applied',
            effect_applied_at: nowIso,
            result_json: applyResult ?? null,
            applied_at: nowIso,
            lease_owner: null,
            lease_expires_at: null,
            last_error: null,
          })
          .eq('id', claimedInboxId)
          .eq('lease_owner', wId);
        if (claimedAttemptCount !== null) upd = upd.eq('attempt_count', claimedAttemptCount);
        const { data: finRows, error: finErr } = await upd.select('id');
        if (finErr) {
          throw new Error(finErr.message);
        }
        if (!Array.isArray(finRows) || finRows.length === 0) {
          return {
            status: 'lease_lost',
            idempotent: false,
            httpStatus: 409,
            error: 'Worker lease expired and was reclaimed by another worker',
          };
        }
      }

      return {
        status: 'applied',
        idempotent: false,
        httpStatus: 200,
        result: applyResult,
      };
    } catch (err) {
      const redactedErr = redactSensitiveError(err);
      // NEVER delete the inbox receipt if business effect succeeded; stamp effect_applied_at / failed instead.
      if (usedClaimRpc && typeof db.rpc === 'function') {
        try {
          await db.rpc('complete_integration_inbox_event', {
            p_inbox_id: claimedInboxId,
            p_worker_id: wId,
            p_status: 'failed',
            p_result_json: effectApplied ? (applyResult ?? null) : null,
            p_error: redactedErr,
            p_effect_applied: effectApplied,
            p_now: nowIso,
            ...(claimedAttemptCount !== null ? { p_fencing_token: claimedAttemptCount } : {}),
          });
        } catch {
          // ignore secondary cleanup error
        }
      } else {
        let upd = db
          .from('integration_inbox')
          .update({
            status: effectApplied ? 'applied' : 'failed',
            ...(effectApplied
              ? { effect_applied_at: nowIso, applied_at: nowIso, result_json: applyResult ?? null }
              : {}),
            lease_owner: null,
            lease_expires_at: null,
            last_error: redactedErr,
          })
          .eq('id', claimedInboxId)
          .eq('lease_owner', wId);
        if (claimedAttemptCount !== null) upd = upd.eq('attempt_count', claimedAttemptCount);
        await upd;
      }
      return {
        status: 'inbox_persistence_failed',
        idempotent: false,
        httpStatus: 500,
        error: redactedErr,
      };
    }
  }

  async getOutboxEventsForTenant(tenantId) {
    const db = this._requireDb();
    const { data, error } = await db
      .from('integration_outbox')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: true });
    if (error) {
      throw new Error(`Failed to list outbox events: ${error.message}`);
    }
    return (data || []).map(mapOutboxRow);
  }

  async requeueDeadLetterEvents({ tenantId, eventIds, nowMs = Date.now() }) {
    const db = this._requireDb();
    const targetIds = new Set((eventIds || []).map((id) => String(id).trim()).filter(Boolean));
    const events = await this.getOutboxEventsForTenant(tenantId);
    const requeued = [];
    const skipped = [];

    for (const rec of events) {
      if (targetIds.size > 0 && !targetIds.has(rec.eventId)) continue;
      if (rec.status === 'dead_letter' || rec.status === 'failed_permanent') {
        const { error: updErr } = await db
          .from('integration_outbox')
          .update({
            status: 'pending',
            next_attempt_at: new Date(nowMs).toISOString(),
            lease_owner: null,
            lease_expires_at: null,
          })
          .eq('id', rec.id)
          .eq('tenant_id', tenantId);
        if (updErr) throw new Error(`Failed to requeue event ${rec.eventId}: ${updErr.message}`);
        requeued.push(rec.eventId);
      } else {
        skipped.push(rec.eventId);
      }
    }

    return { requeued, skipped };
  }
}

export const defaultOutboxInboxRepository = new SupabaseOutboxInboxRepository(supabase);

function resolveRepository(storeOrRepo) {
  if (storeOrRepo instanceof SupabaseOutboxInboxRepository) return storeOrRepo;
  if (storeOrRepo && typeof storeOrRepo.from === 'function') {
    return new SupabaseOutboxInboxRepository(storeOrRepo);
  }
  return defaultOutboxInboxRepository;
}

function enqueueInMemoryOutboxEvent(event, store) {
  const eventId = String(event?.eventId || '').trim();
  const tenantId = String(event?.tenantId || '').trim();
  const connectionId = String(event?.connectionId || '').trim();
  const aggregateId = String(event?.aggregateId || '').trim();

  if (!eventId || !tenantId || !connectionId || !aggregateId) {
    throw new Error('eventId, tenantId, connectionId, and aggregateId are required');
  }

  const key = store._outboxKey(connectionId, eventId);
  const existing = store.outbox.get(key);
  if (existing) {
    return { ...existing, deduplicated: true };
  }

  const nowMs = Number(event.nowMs) || Date.now();
  const record = {
    eventId,
    tenantId,
    connectionId,
    aggregateId,
    aggregateVersion: Number(event.aggregateVersion) || 1,
    eventType: String(event.eventType || 'integration.event'),
    schemaVersion: String(event.schemaVersion || '2.0.0'),
    payload: event.payload ?? {},
    status: 'pending',
    attemptCount: 0,
    nextAttemptAt: event.nextAttemptAt !== undefined ? Number(event.nextAttemptAt) : nowMs,
    leaseOwner: null,
    leaseExpiresAt: null,
    lastErrorRedacted: null,
    createdAt: nowMs,
    deliveredAt: null,
  };
  store.outbox.set(key, record);
  return { ...record, deduplicated: false };
}

function claimInMemoryOutboxBatch({ workerId, leaseDurationMs = 30000, nowMs = Date.now(), limit = 20 }, store) {
  const wId = String(workerId || '').trim();
  if (!wId) throw new Error('workerId is required to claim outbox batch');
  const claimed = [];

  for (const record of store.outbox.values()) {
    if (claimed.length >= limit) break;
    const isDuePending = record.status === 'pending' && record.nextAttemptAt <= nowMs;
    const isExpiredLease =
      record.status === 'processing' && record.leaseExpiresAt !== null && record.leaseExpiresAt <= nowMs;

    if (isDuePending || isExpiredLease) {
      record.status = 'processing';
      record.leaseOwner = wId;
      record.leaseExpiresAt = nowMs + leaseDurationMs;
      claimed.push({ ...record });
    }
  }

  return claimed;
}

export function enqueueOutboxEvent(event, storeOrRepo) {
  if (storeOrRepo instanceof IntegrationOutboxInboxStore) {
    return enqueueInMemoryOutboxEvent(event, storeOrRepo);
  }
  return resolveRepository(storeOrRepo).enqueueOutboxEvent(event);
}

export function claimOutboxBatch(params, storeOrRepo) {
  if (storeOrRepo instanceof IntegrationOutboxInboxStore) {
    return claimInMemoryOutboxBatch(params, storeOrRepo);
  }
  return resolveRepository(storeOrRepo).claimOutboxBatch(params);
}

export async function processOutboxBatch(params, storeOrRepo) {
  if (!(storeOrRepo instanceof IntegrationOutboxInboxStore)) {
    return resolveRepository(storeOrRepo).processOutboxBatch(params);
  }

  const store = storeOrRepo;
  const {
    workerId,
    leaseDurationMs = 30000,
    nowMs = Date.now(),
    limit = 20,
    maxAttempts = 5,
    signingConfig,
    deliverFn,
    backoffOptions,
  } = params;

  if (typeof deliverFn !== 'function') {
    throw new Error('deliverFn is required');
  }

  const claimed = claimInMemoryOutboxBatch({ workerId, leaseDurationMs, nowMs, limit }, store);
  const results = [];

  for (const snapshot of claimed) {
    const key = store._outboxKey(snapshot.connectionId, snapshot.eventId);
    const record = store.outbox.get(key);
    if (!record) continue;

    const envelope = {
      event_id: record.eventId,
      connection_id: record.connectionId,
      event_type: record.eventType,
      schema_version: record.schemaVersion,
      aggregate_id: record.aggregateId,
      aggregate_version: record.aggregateVersion,
      tenant_claim: record.tenantId,
      payload: record.payload,
    };
    const rawBody = JSON.stringify(envelope);
    const attemptTsSec = Math.floor(nowMs / 1000);
    const headers =
      signingConfig?.secret && signingConfig?.keyId
        ? signWebhookPayload(rawBody, signingConfig.secret, signingConfig.keyId, attemptTsSec)
        : {};

    let outcome;
    try {
      outcome = await deliverFn(record, { rawBody, headers, attemptTimestampSec: attemptTsSec });
    } catch (err) {
      outcome = { ok: false, httpStatus: 500, error: err instanceof Error ? err.message : String(err) };
    }

    if (outcome?.ok) {
      record.status = 'delivered';
      record.attemptCount += 1;
      record.leaseOwner = null;
      record.leaseExpiresAt = null;
      record.deliveredAt = nowMs;
      record.lastErrorRedacted = null;
      results.push({ eventId: record.eventId, status: 'delivered', attemptCount: record.attemptCount });
      continue;
    }

    const httpStatus = Number(outcome?.httpStatus) || 0;
    const isPermanent = Boolean(outcome?.permanent) || PERMANENT_HTTP_STATUSES.has(httpStatus);
    record.attemptCount += 1;
    record.leaseOwner = null;
    record.leaseExpiresAt = null;
    record.lastErrorRedacted = redactSensitiveError(outcome?.error || `HTTP ${httpStatus || 'ERROR'}`);

    if (isPermanent) {
      record.status = 'failed_permanent';
      results.push({
        eventId: record.eventId,
        status: 'failed_permanent',
        attemptCount: record.attemptCount,
        lastErrorRedacted: record.lastErrorRedacted,
      });
    } else if (record.attemptCount >= maxAttempts) {
      record.status = 'dead_letter';
      results.push({
        eventId: record.eventId,
        status: 'dead_letter',
        attemptCount: record.attemptCount,
        lastErrorRedacted: record.lastErrorRedacted,
      });
    } else {
      const backoffMs = computeBackoffMs(record.attemptCount, backoffOptions);
      record.status = 'pending';
      record.nextAttemptAt = nowMs + backoffMs;
      results.push({
        eventId: record.eventId,
        status: 'pending',
        attemptCount: record.attemptCount,
        nextAttemptAt: record.nextAttemptAt,
        lastErrorRedacted: record.lastErrorRedacted,
      });
    }
  }

  return { claimedCount: claimed.length, results };
}

export async function receiveAndApplyInboxEvent(params, storeOrRepo) {
  if (!(storeOrRepo instanceof IntegrationOutboxInboxStore)) {
    return resolveRepository(storeOrRepo).receiveAndApplyInboxEvent(params);
  }

  const store = storeOrRepo;
  const {
    connectionId,
    tenantId,
    eventId,
    aggregateId,
    aggregateVersion = 1,
    eventType = 'integration.event',
    schemaVersion = '2.0.0',
    payload,
    applyFn,
    getLastAppliedVersion,
    persistInboxFn,
    nowMs = Date.now(),
  } = params;

  const connId = String(connectionId || '').trim();
  const evtId = String(eventId || '').trim();
  const aggId = String(aggregateId || '').trim();
  const tId = String(tenantId || '').trim();

  if (!connId || !evtId || !aggId || !tId) {
    return { status: 'invalid_event', idempotent: false, httpStatus: 400, error: 'Missing required inbox fields' };
  }

  const payloadHash = computePayloadHash(payload ?? {});
  const inboxKey = store._inboxKey(connId, evtId);
  const existing = store.inbox.get(inboxKey);
  const wId = String(params.workerId || `mem-inbox-worker-${process.pid}`).trim();
  const leaseMs = Math.max(100, Number(params.leaseDurationMs) || 30000);

  if (existing) {
    if (existing.payloadHash !== payloadHash) {
      return {
        status: 'conflict_payload_mismatch',
        idempotent: false,
        httpStatus: 409,
        error: `Event ${evtId} already received with different payload hash`,
      };
    }
    if (existing.status === 'applied' || existing.status === 'rejected_stale_version') {
      return {
        status: 'duplicate_ignored',
        idempotent: true,
        httpStatus: 200,
        priorStatus: existing.status,
        ...(existing.result !== undefined ? { result: existing.result } : {}),
      };
    }
    if (existing.effectAppliedAt) {
      existing.status = 'applied';
      existing.appliedAt = existing.appliedAt || nowMs;
      existing.leaseOwner = null;
      existing.leaseExpiresAt = null;
      return {
        status: 'duplicate_ignored',
        idempotent: true,
        httpStatus: 200,
        priorStatus: 'applied',
        ...(existing.result !== undefined ? { result: existing.result } : {}),
      };
    }
    if (existing.status === 'processing' && existing.leaseExpiresAt && existing.leaseExpiresAt > nowMs) {
      return {
        status: 'in_progress_retry_later',
        idempotent: false,
        httpStatus: 409,
        priorStatus: 'processing',
        error: 'Event is currently being processed by an active worker; retry after lease expiry',
      };
    }
  }

  for (const rec of store.inbox.values()) {
    if (
      rec.connectionId === connId &&
      rec.aggregateId === aggId &&
      rec.eventId !== evtId &&
      rec.status === 'processing' &&
      rec.leaseExpiresAt &&
      rec.leaseExpiresAt > nowMs
    ) {
      return {
        status: 'in_progress_retry_later',
        idempotent: false,
        httpStatus: 409,
        priorStatus: 'processing',
        error: 'Another event for this aggregate is currently being processed; retry later',
      };
    }
  }

  const aggKey = store._aggKey(connId, aggId);
  const externalLastVersion =
    typeof getLastAppliedVersion === 'function' ? Number(await getLastAppliedVersion(aggId, connId, tId)) || 0 : 0;
  const storedLastVersion = store.aggregateVersions.get(aggKey) || 0;
  const lastAppliedVersion = Math.max(storedLastVersion, externalLastVersion);
  const incomingVersion = Number(aggregateVersion) || 1;

  if (incomingVersion < lastAppliedVersion) {
    const staleRecord = {
      connectionId: connId,
      tenantId: tId,
      eventId: evtId,
      aggregateId: aggId,
      aggregateVersion: incomingVersion,
      eventType,
      schemaVersion,
      payloadHash,
      status: 'rejected_stale_version',
      appliedAt: nowMs,
    };
    try {
      if (typeof persistInboxFn === 'function') {
        await persistInboxFn(staleRecord);
      }
      store.inbox.set(inboxKey, staleRecord);
    } catch (err) {
      return {
        status: 'inbox_persistence_failed',
        idempotent: false,
        httpStatus: 500,
        error: redactSensitiveError(err),
      };
    }
    return {
      status: 'rejected_stale_version',
      idempotent: true,
      httpStatus: 200,
      lastAppliedVersion,
    };
  }

  const claimedToken = (existing?.attemptCount || 0) + 1;
  const committedReceipts = { ...(existing?.effectReceipts || {}) };
  const processingRecord = {
    connectionId: connId,
    tenantId: tId,
    eventId: evtId,
    aggregateId: aggId,
    aggregateVersion: incomingVersion,
    eventType,
    schemaVersion,
    payloadHash,
    status: 'processing',
    leaseOwner: wId,
    leaseExpiresAt: nowMs + leaseMs,
    attemptCount: claimedToken,
    effectAppliedAt: null,
    effectReceipts: committedReceipts,
  };
  store.inbox.set(inboxKey, processingRecord);

  let applyResult = null;
  let effectApplied = false;
  const checkLease = () => {
    const cur = store.inbox.get(inboxKey);
    if (!cur || cur.leaseOwner !== wId || cur.attemptCount !== claimedToken) {
      throw new Error(`INBOX_LEASE_LOST: Worker ${wId} (token ${claimedToken}) lost lease`);
    }
  };
  const recordTargetReceipt = async (targetKey, res, options = {}) => {
    checkLease();
    const tKey = String(targetKey || '').trim();
    if (!tKey) throw new Error('targetKey is required for recordTargetReceipt');
    if (!committedReceipts[tKey]) {
      committedReceipts[tKey] = res ?? {};
    }
    processingRecord.effectReceipts = { ...committedReceipts };
    if (options.markInboxComplete) {
      effectApplied = true;
      processingRecord.effectAppliedAt = processingRecord.effectAppliedAt || nowMs;
    }
    return { outcome: 'recorded', idempotent: false, result_json: committedReceipts[tKey] };
  };
  const recordEffectApplied = async (res) => {
    checkLease();
    effectApplied = true;
    if (res !== undefined) applyResult = res;
    processingRecord.effectAppliedAt = nowMs;
    processingRecord.result = applyResult;
  };

  try {
    if (typeof applyFn === 'function') {
      applyResult = await applyFn({
        connectionId: connId,
        tenantId: tId,
        eventId: evtId,
        aggregateId: aggId,
        aggregateVersion: incomingVersion,
        payload,
        inboxId: inboxKey,
        workerId: wId,
        fencingToken: claimedToken,
        committedReceipts,
        recordEffectApplied,
        recordTargetReceipt,
      });
      effectApplied = true;
      processingRecord.effectAppliedAt = nowMs;
      processingRecord.result = applyResult;
    }
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : String(err);
    if (/INBOX_LEASE_LOST/i.test(rawMsg)) {
      return {
        status: 'lease_lost',
        idempotent: false,
        httpStatus: 409,
        error: redactSensitiveError(err) || 'Worker lease expired and was reclaimed by another worker',
      };
    }
    const cur = store.inbox.get(inboxKey);
    if (cur && cur.leaseOwner === wId && cur.attemptCount === claimedToken) {
      processingRecord.status = effectApplied ? 'applied' : 'failed';
      processingRecord.leaseOwner = null;
      processingRecord.leaseExpiresAt = null;
      if (effectApplied) {
        processingRecord.appliedAt = nowMs;
        store.aggregateVersions.set(aggKey, Math.max(store.aggregateVersions.get(aggKey) || 0, incomingVersion));
      }
    }
    return {
      status: 'inbox_persistence_failed',
      idempotent: false,
      httpStatus: 500,
      error: redactSensitiveError(err),
    };
  }

  try {
    const cur = store.inbox.get(inboxKey);
    if (cur && cur.status === 'applied') {
      return {
        status: 'duplicate_ignored',
        idempotent: true,
        httpStatus: 200,
        priorStatus: 'applied',
        ...(cur.result !== undefined ? { result: cur.result } : {}),
      };
    }
    if (!cur || cur.leaseOwner !== wId || cur.attemptCount !== claimedToken) {
      return {
        status: 'lease_lost',
        idempotent: false,
        httpStatus: 409,
        error: 'Worker lease expired and was reclaimed by another worker',
      };
    }
    const appliedRecord = {
      connectionId: connId,
      tenantId: tId,
      eventId: evtId,
      aggregateId: aggId,
      aggregateVersion: incomingVersion,
      eventType,
      schemaVersion,
      payloadHash,
      status: 'applied',
      effectAppliedAt: nowMs,
      appliedAt: nowMs,
      attemptCount: claimedToken,
      effectReceipts: committedReceipts,
      result: applyResult,
    };
    if (typeof persistInboxFn === 'function') {
      await persistInboxFn(appliedRecord);
    }
    store.inbox.set(inboxKey, appliedRecord);
    store.aggregateVersions.set(aggKey, Math.max(store.aggregateVersions.get(aggKey) || 0, incomingVersion));
    return {
      status: 'applied',
      idempotent: false,
      httpStatus: 200,
      result: applyResult,
    };
  } catch (err) {
    const cur = store.inbox.get(inboxKey);
    if (cur && cur.leaseOwner === wId && cur.attemptCount === claimedToken) {
      processingRecord.status = effectApplied ? 'applied' : 'failed';
      processingRecord.leaseOwner = null;
      processingRecord.leaseExpiresAt = null;
      if (effectApplied) {
        processingRecord.appliedAt = nowMs;
        store.aggregateVersions.set(aggKey, Math.max(store.aggregateVersions.get(aggKey) || 0, incomingVersion));
      }
    }
    return {
      status: 'inbox_persistence_failed',
      idempotent: false,
      httpStatus: 500,
      error: redactSensitiveError(err),
    };
  }
}

export function getOutboxEventsForTenant(tenantId, storeOrRepo) {
  if (storeOrRepo instanceof IntegrationOutboxInboxStore) {
    const out = [];
    for (const rec of storeOrRepo.outbox.values()) {
      if (rec.tenantId === tenantId) out.push({ ...rec });
    }
    return out;
  }
  return resolveRepository(storeOrRepo).getOutboxEventsForTenant(tenantId);
}

export function requeueDeadLetterEvents(params, storeOrRepo) {
  if (!(storeOrRepo instanceof IntegrationOutboxInboxStore)) {
    return resolveRepository(storeOrRepo).requeueDeadLetterEvents(params);
  }
  const { tenantId, eventIds, actorId, nowMs = Date.now() } = params;
  const targetIds = new Set((eventIds || []).map((id) => String(id).trim()).filter(Boolean));
  const requeued = [];
  const skipped = [];

  for (const rec of storeOrRepo.outbox.values()) {
    if (rec.tenantId !== tenantId) continue;
    if (targetIds.size > 0 && !targetIds.has(rec.eventId)) continue;
    if (rec.status === 'dead_letter' || rec.status === 'failed_permanent') {
      rec.status = 'pending';
      rec.nextAttemptAt = nowMs;
      rec.leaseOwner = null;
      rec.leaseExpiresAt = null;
      requeued.push(rec.eventId);
    } else {
      skipped.push(rec.eventId);
    }
  }

  storeOrRepo.auditLog.push({
    action: 'retry_dead_letter',
    tenantId,
    actorId,
    requeued,
    at: new Date(nowMs).toISOString(),
  });

  return { requeued, skipped };
}
