import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requireMenu } from '@/lib/hr-access';

// GET /api/hr/interviews/[id] — รายละเอียดรอบสัมภาษณ์ + บทสนทนา + ข้อมูลผู้สมัคร/ชุดคำถาม
export async function GET(request, { params }) {
  const { id } = await params;
  const { error, status } = await requireMenu(request, 'applicants');
  if (error) return NextResponse.json({ error }, { status });

  const { data: session, error: sErr } = await supabase
    .from('interview_sessions')
    .select('*')
    .eq('id', id)
    .single();
  if (sErr || !session) return NextResponse.json({ error: 'ไม่พบรอบสัมภาษณ์' }, { status: 404 });

  const [{ data: turns }, { data: applicant }, { data: qset }] = await Promise.all([
    supabase.from('interview_turns').select('*').eq('session_id', id).order('turn_index', { ascending: true }),
    supabase.from('applicants').select('id, name, phone, position_applied, status').eq('id', session.applicant_id).maybeSingle(),
    session.question_set_id
      ? supabase.from('interview_question_sets').select('*').eq('id', session.question_set_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return NextResponse.json({
    session,
    turns: turns || [],
    applicant: applicant || null,
    questionSet: qset || null,
  });
}

// DELETE /api/hr/interviews/[id] — ลบรอบสัมภาษณ์ (turns ลบตาม cascade)
export async function DELETE(request, { params }) {
  const { id } = await params;
  const { error, status } = await requireMenu(request, 'applicants');
  if (error) return NextResponse.json({ error }, { status });

  const { error: dbError } = await supabase.from('interview_sessions').delete().eq('id', id);
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
