import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// POST /api/interview/[id]/turn — บันทึกบทสนทนา (AI หรือ ผู้สมัคร)
export async function POST(request, { params }) {
  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'ไม่พบรหัสรอบสัมภาษณ์' }, { status: 400 });

  const body = await request.json();
  const { role, text, question_ref, turn_index } = body;

  if (!role || !text) {
    return NextResponse.json({ error: 'ข้อมูลไม่ครบถ้วน (ต้องมี role และ text)' }, { status: 400 });
  }

  // หา turn_index ล่าสุดหากไม่ได้ส่งมา
  let calculatedIndex = Number(turn_index);
  if (!calculatedIndex) {
    const { data: lastTurn } = await supabase
      .from('interview_turns')
      .select('turn_index')
      .eq('session_id', id)
      .order('turn_index', { ascending: false })
      .limit(1)
      .maybeSingle();
    calculatedIndex = (lastTurn?.turn_index || 0) + 1;
  }

  const { data: newTurn, error: tErr } = await supabase
    .from('interview_turns')
    .insert({
      session_id: id,
      turn_index: calculatedIndex,
      role: role === 'ai' ? 'ai' : 'applicant',
      question_ref: question_ref != null ? Number(question_ref) : null,
      text: String(text).trim(),
    })
    .select()
    .single();

  if (tErr) {
    return NextResponse.json({ error: tErr.message }, { status: 500 });
  }

  // อัปเดตสถานะ session เป็น in_progress เสมอ
  await supabase
    .from('interview_sessions')
    .update({ status: 'in_progress' })
    .eq('id', id)
    .in('status', ['queued', 'calling']);

  return NextResponse.json({ ok: true, turn: newTurn });
}
