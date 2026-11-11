import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// POST /api/interview/[id]/consent — ผู้สมัครยืนยันยินยอม หรือ ปฏิเสธ
export async function POST(request, { params }) {
  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'ไม่พบรหัสรอบสัมภาษณ์' }, { status: 400 });

  const body = await request.json();
  const consent = Boolean(body.consent);

  const { data: session, error: sErr } = await supabase
    .from('interview_sessions')
    .select('id, applicant_id, status')
    .eq('id', id)
    .maybeSingle();

  if (sErr || !session) {
    return NextResponse.json({ error: 'ไม่พบรอบสัมภาษณ์' }, { status: 404 });
  }

  const now = new Date().toISOString();

  if (consent) {
    // ผู้สมัครยินยอม -> ปรับสถานะเป็น in_progress
    await supabase
      .from('interview_sessions')
      .update({
        status: 'in_progress',
        started_at: session.started_at || now,
      })
      .eq('id', id);

    // บันทึก turn ยินยอม
    await supabase.from('interview_turns').insert({
      session_id: id,
      turn_index: 1,
      role: 'applicant',
      text: 'ยินยอมดำเนินการสัมภาษณ์และบันทึกเสียง',
      question_ref: 0,
    });

    return NextResponse.json({ ok: true, status: 'in_progress' });
  } else {
    // ผู้สมัครไม่ยินยอม -> ปรับสถานะเป็น no_consent
    await supabase
      .from('interview_sessions')
      .update({
        status: 'no_consent',
        ended_at: now,
      })
      .eq('id', id);

    await supabase.from('interview_turns').insert({
      session_id: id,
      turn_index: 1,
      role: 'applicant',
      text: 'ผู้สมัครไม่ยินยอมให้บันทึกเสียง หรือไม่สะดวกสัมภาษณ์ในขณะนี้',
      question_ref: 0,
    });

    return NextResponse.json({ ok: true, status: 'no_consent' });
  }
}
