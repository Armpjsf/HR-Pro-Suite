import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { runScoring } from '@/lib/interview-scoring';

// POST /api/interview/[id]/complete — สัมภาษณ์เสร็จสมบูรณ์ -> ปิดรอบ & สั่ง LLM ประเมินคะแนนทันที
export async function POST(request, { params }) {
  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'ไม่พบรหัสรอบสัมภาษณ์' }, { status: 400 });

  const { data: session, error: sErr } = await supabase
    .from('interview_sessions')
    .select('id, started_at, status')
    .eq('id', id)
    .maybeSingle();

  if (sErr || !session) {
    return NextResponse.json({ error: 'ไม่พบรอบสัมภาษณ์' }, { status: 404 });
  }

  const now = new Date();
  const startTime = session.started_at ? new Date(session.started_at) : now;
  const durationSec = Math.max(0, Math.round((now.getTime() - startTime.getTime()) / 1000));

  await supabase
    .from('interview_sessions')
    .update({
      status: 'completed',
      ended_at: now.toISOString(),
      duration_sec: durationSec,
    })
    .eq('id', id);

  // ประเมินผลอัตโนมัติด้วย LLM (Gemini / Ollama)
  let scoringResult = null;
  try {
    scoringResult = await runScoring(id, { notify: true });
  } catch (err) {
    console.error('Auto-scoring error:', err.message);
    // แม้ scoring ล้มเหลว ก็ยังถือว่า session จบสมบูรณ์แล้ว (HR สามารถกดประเมินใหม่ในระบบได้)
  }

  return NextResponse.json({
    ok: true,
    status: 'completed',
    duration_sec: durationSec,
    scoring: scoringResult,
  });
}
