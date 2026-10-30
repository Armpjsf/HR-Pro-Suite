import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requireMenu } from '@/lib/hr-access';

// GET /api/hr/interviews/question-sets — รายชุดคำถามทั้งหมด
export async function GET(request) {
  const { error, status } = await requireMenu(request, 'interviews');
  if (error) return NextResponse.json({ error }, { status });

  const { data, error: dbError } = await supabase
    .from('interview_question_sets')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1000);
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  return NextResponse.json({ items: data || [] });
}

// POST /api/hr/interviews/question-sets — สร้างชุดคำถามใหม่
export async function POST(request) {
  const { error, status } = await requireMenu(request, 'interviews');
  if (error) return NextResponse.json({ error }, { status });

  const body = await request.json();
  if (!body.name) return NextResponse.json({ error: 'กรุณากรอกชื่อชุดคำถาม' }, { status: 400 });

  const row = {
    name: body.name,
    position: body.position || null,
    lang: body.lang || 'th',
    intro_script: body.intro_script || null,
    consent_script: body.consent_script || null,
    questions: normalizeQuestions(body.questions),
    active: body.active !== false,
  };

  const { data, error: dbError } = await supabase
    .from('interview_question_sets')
    .insert(row)
    .select()
    .single();
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  return NextResponse.json({ item: data });
}

// ทำให้ questions เป็น [{ q, weight }] เสมอ
export function normalizeQuestions(input) {
  if (!Array.isArray(input)) return [];
  return input
    .map((it) => {
      if (typeof it === 'string') return { q: it.trim(), weight: 1 };
      const q = (it?.q || '').toString().trim();
      const weight = Number(it?.weight) > 0 ? Number(it.weight) : 1;
      return q ? { q, weight } : null;
    })
    .filter(Boolean);
}
