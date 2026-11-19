import { supabase } from './supabase.js';
import { processOutboxBatch, signWebhookPayload, SupabaseOutboxInboxRepository } from './integration-outbox-inbox.js';

function isAllowedTargetUrl(rawUrl) {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) return { valid: false, error: 'Target URL not configured' };
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, error: 'Malformed target URL' };
  }
  const host = parsed.hostname.toLowerCase();
  if (
    parsed.protocol !== 'https:' &&
    !(process.env.NODE_ENV !== 'production' && process.env.ALLOW_LOCAL_INTEGRATION_URL === 'true')
  ) {
    return { valid: false, error: 'HTTPS required for integration target URL' };
  }
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host.endsWith('.internal') ||
    host.endsWith('.local') ||
    /^169\.254\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host)
  ) {
    if (!(process.env.NODE_ENV !== 'production' && process.env.ALLOW_LOCAL_INTEGRATION_URL === 'true')) {
      return { valid: false, error: 'Private or loopback target host blocked' };
    }
  }
  return { valid: true, url: parsed.toString() };
}

async function resolveTargetForEvent(event) {
  let targetUrl = String(process.env.NEXUS_TMS_WEBHOOK_URL || process.env.NEXUS_TMS_URL || '').trim();
  try {
    const { data: conn } = await supabase
      .from('integration_connections')
      .select('target_base_url, status')
      .eq('connection_id', event.connectionId)
      .eq('tenant_id', event.tenantId)
      .maybeSingle();
    if (conn) {
      if (conn.status !== 'active') {
        return { error: `Connection ${event.connectionId} is ${conn.status}`, permanent: true };
      }
      if (conn.target_base_url) targetUrl = String(conn.target_base_url).trim();
    }
  } catch {
    // Fallback to configured env URL if integration_connections lookup is unavailable
  }

  const check = isAllowedTargetUrl(targetUrl);
  if (!check.valid) {
    return { error: check.error, permanent: true };
  }
  return { url: event.eventType === 'hr.payroll.paid' ? new URL('/api/external/v2/driver-earning-lines/paid', check.url).toString() : check.url };
}

async function processOneBatch() {

  const workerId = `hr-outbox-worker-${process.pid}-${Date.now()}`;
  const secret = String(process.env.NEXUS_SIGNING_SECRET || process.env.HR_INTEGRATION_SIGNING_SECRET || '').trim();
  const keyId = String(process.env.NEXUS_SIGNING_KEY_ID || 'key-v1').trim();
  const apiKey = String(process.env.NEXUS_TMS_API_KEY || '').trim();
  const repo = new SupabaseOutboxInboxRepository(supabase);

  try {
    const result = await processOutboxBatch(
      {
        workerId,
        limit: 3,
        leaseDurationMs: 30000,
        deliverFn: async (event, { rawBody, attemptTimestampSec }) => {
          const target = await resolveTargetForEvent(event);
          if (target.error) {
            return { ok: false, httpStatus: 422, permanent: true, error: target.error };
          }
          const sigHeaders = secret ? signWebhookPayload(rawBody, secret, keyId, attemptTimestampSec) : {};
          const headers = {
            'Content-Type': 'application/json',
            'Idempotency-Key': event.eventId,
            'X-Nexus-Event-Id': event.eventId,
            'X-Nexus-Connection-Id': event.connectionId,
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
            ...sigHeaders,
          };
          const res = await fetch(target.url, {
            method: 'POST',
            headers,
            body: rawBody,
            redirect: 'error',
            signal: AbortSignal.timeout(8000),
          });
          const errText = res.ok ? undefined : await res.text().catch(() => `HTTP ${res.status}`);
          return { ok: res.ok, httpStatus: res.status, error: errText };
        },
      },
      repo
    );

    return { success: true, workerId, ...result };
  } catch (err) {
    throw err;
  }
}

// Drain healthy queues promptly; failed events retain their stored retry schedule.
export async function runIntegrationOutbox() {
  const started = Date.now();
  const result = { success: true, claimedCount: 0, results: [] };
  for (let batch = 0; batch < 100 && Date.now() - started < 30000; batch++) {
    const current = await processOneBatch();
    result.claimedCount += current.claimedCount;
    result.results.push(...current.results);
    if (current.claimedCount < 3) break;
  }
  return result;
}
