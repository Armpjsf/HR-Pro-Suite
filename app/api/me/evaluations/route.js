import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { addAuditEntry } from '@/lib/db';

const EVAL_CRITERIA = [
  { key: 'teamwork', label: 'การทำงานเป็นทีม' },
  { key: 'communication', label: 'การสื่อสาร' },
  { key: 'responsibility', label: 'ความรับผิดชอบ' },
  { key: 'punctuality', label: 'ความตรงต่อเวลา' },
  { key: 'leadership', label: 'ภาวะผู้นำ' },
];

/**
 * GET /api/me/evaluations — ดูรายการที่ต้องประเมิน + ผลที่ถูกประเมิน
 */
export async function GET(request) {
  const { user, error, status } = requireAuth(request);
  if (error) return NextResponse.json({ error }, { status });

  // รายการที่ฉันต้องประเมิน (เป็น evaluator)
  const { data: pending } = await supabase
    .from('peer_evaluations')
    .select('*')
    .eq('evaluator_id', user.employeeId)
    .order('created_at', { ascending: false });

  // ผลที่ฉันถูกประเมิน (เป็น target) — เฉพาะ submitted
  const { data: received } = await supabase
    .from('peer_evaluations')
    .select('*')
    .eq('target_id', user.employeeId)
    .eq('status', 'submitted')
    .order('created_at', { ascending: false });

  // คำนวณคะแนนเฉลี่ยที่ถูกประเมิน
  const receivedList = received || [];
  let avgScores = null;
  if (receivedList.length > 0) {
    avgScores = {};
    for (const c of EVAL_CRITERIA) {
      const vals = receivedList
        .filter((e) => e.scores && e.scores[c.key] != null)
        .map((e) => Number(e.scores[c.key]));
      avgScores[c.key] = vals.length > 0 ? +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : null;
    }
  }

  return NextResponse.json({
    criteria: EVAL_CRITERIA,
    myEvaluations: pending || [],
    receivedEvaluations: receivedList,
    avgScores,
  });
}

/**
 * POST /api/me/evaluations — ส่งผลประเมินเพื่อนร่วมงาน
 * Body: { target_id, period, scores: { teamwork:5, communication:4, ... }, comments }
 */
export async function POST(request) {
  const { user, error, status } = requireAuth(request);
  if (error) return NextResponse.json({ error }, { status });

  const body = await request.json();
  const { target_id, period, scores, comments } = body;

  if (!target_id || !period) {
    return NextResponse.json({ error: 'กรุณาระบุผู้ถูกประเมินและรอบประเมิน' }, { status: 400 });
  }
  if (target_id === user.employeeId) {
    return NextResponse.json({ error: 'ไม่สามารถประเมินตัวเองได้' }, { status: 400 });
  }

  // ตรวจสอบว่าประเมินคนนี้ในรอบนี้แล้วยัง
  const { data: existing } = await supabase
    .from('peer_evaluations')
    .select('id')
    .eq('evaluator_id', user.employeeId)
    .eq('target_id', target_id)
    .eq('period', period)
    .maybeSingle();

  if (existing) {
    // อัปเดต
    const { data, error: dbError } = await supabase
      .from('peer_evaluations')
      .update({ scores, comments, status: 'submitted' })
      .eq('id', existing.id)
      .select()
      .single();
    if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
    return NextResponse.json({ item: data, updated: true });
  }

  const { data, error: dbError } = await supabase
    .from('peer_evaluations')
    .insert({
      evaluator_id: user.employeeId,
      target_id,
      period,
      scores,
      comments: comments || null,
      status: 'submitted',
    })
    .select()
    .single();

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  await addAuditEntry({
    user: user.name,
    action: `ส่งประเมินเพื่อนร่วมงาน ${target_id} รอบ ${period}`,
    channel: 'ME',
  });

  return NextResponse.json({ item: data });
}
