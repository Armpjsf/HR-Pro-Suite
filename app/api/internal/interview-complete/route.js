import { NextResponse } from 'next/server';
import { runScoring } from '@/lib/interview-scoring';

// POST /api/internal/interview-complete — voice-bridge เรียกหลังวางสาย (secret-guarded)
// header: x-bridge-secret: <BRIDGE_SECRET>   body: { sessionId }
export async function POST(request) {
  const secret = process.env.BRIDGE_SECRET;
  if (!secret || request.headers.get('x-bridge-secret') !== secret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body;
  try { body = await request.json(); } catch { body = {}; }
  const sessionId = body.sessionId;
  if (!sessionId) return NextResponse.json({ error: 'ต้องระบุ sessionId' }, { status: 400 });

  try {
    const result = await runScoring(sessionId, { notify: true });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
