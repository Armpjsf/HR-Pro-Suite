import { NextResponse } from 'next/server';
import { requireMenu } from '@/lib/hr-access';
import { runScoring } from '@/lib/interview-scoring';

// POST /api/hr/interviews/[id]/score — สั่งประเมินผล/ให้คะแนนใหม่ (HR กดเอง)
export async function POST(request, { params }) {
  const { id } = await params;
  const { error, status } = await requireMenu(request, 'applicants');
  if (error) return NextResponse.json({ error }, { status });

  try {
    const result = await runScoring(id, { notify: false });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
