import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requireMenu } from '@/lib/hr-access';
import { normalizeQuestions } from '../route';

// PUT /api/hr/interviews/question-sets/[id] — แก้ไขชุดคำถาม
export async function PUT(request, { params }) {
  const { id } = await params;
  const { error, status } = await requireMenu(request, 'interviews');
  if (error) return NextResponse.json({ error }, { status });

  const body = await request.json();
  const row = {};
  if (body.name !== undefined) row.name = body.name;
  if (body.position !== undefined) row.position = body.position || null;
  if (body.lang !== undefined) row.lang = body.lang || 'th';
  if (body.intro_script !== undefined) row.intro_script = body.intro_script || null;
  if (body.consent_script !== undefined) row.consent_script = body.consent_script || null;
  if (body.questions !== undefined) row.questions = normalizeQuestions(body.questions);
  if (body.active !== undefined) row.active = body.active !== false;

  const { data, error: dbError } = await supabase
    .from('interview_question_sets')
    .update(row)
    .eq('id', id)
    .select()
    .single();
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  return NextResponse.json({ item: data });
}

// DELETE /api/hr/interviews/question-sets/[id]
export async function DELETE(request, { params }) {
  const { id } = await params;
  const { error, status } = await requireMenu(request, 'interviews');
  if (error) return NextResponse.json({ error }, { status });

  const { error: dbError } = await supabase
    .from('interview_question_sets')
    .delete()
    .eq('id', id);
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
