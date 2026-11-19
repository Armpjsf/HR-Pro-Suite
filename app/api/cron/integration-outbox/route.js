import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { runIntegrationOutbox } from '@/lib/integration-outbox-worker';

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

export async function POST(request) {
  if (!isAuthorizedCron(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { return NextResponse.json(await runIntegrationOutbox()); }
  catch { return NextResponse.json({ error: 'Outbox worker failed' }, { status: 500 }); }
}
export const GET = POST;
