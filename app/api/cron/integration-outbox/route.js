import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { supabase } from '@/lib/supabase';
import {
  processOutboxBatch,
  signWebhookPayload,
  SupabaseOutboxInboxRepository,
} from '@/lib/integration-outbox-inbox';

export const dynamic = 'force-dynamic';

function isAuthorizedCron(request) {
  const expected = String(process.env.CRON_SECRET || '').trim();
  if (!expected) return false;
  const auth = String(request.headers.get('authorization') || '');
  const provided = auth.startsWith('Bearer ') ? auth.slice(7).trim() : auth.trim();
  if (!provided) return false;
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

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
  return { url: check.url };
}

export async function POST(request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const workerId = `hr-outbox-worker-${process.pid}-${Date.now()}`;
  const secret = String(process.env.NEXUS_SIGNING_SECRET || process.env.HR_INTEGRATION_SIGNING_SECRET || '').trim();
  const keyId = String(process.env.NEXUS_SIGNING_KEY_ID || 'key-v1').trim();
  const apiKey = String(process.env.NEXUS_TMS_API_KEY || '').trim();
  const repo = new SupabaseOutboxInboxRepository(supabase);

  try {
    const result = await processOutboxBatch(
      {
        workerId,
        limit: 25,
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

    return NextResponse.json({ success: true, workerId, ...result });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Outbox worker failed' }, { status: 500 });
  }
}

export const GET = POST;
