import { NextResponse } from 'next/server';
import { requireMenu } from '@/lib/hr-access';
import { supabase } from '@/lib/supabase';

// ต้องตรงกับเกณฑ์ใน /api/me/evaluations
const EVAL_CRITERIA = [
  { key: 'teamwork', label: 'การทำงานเป็นทีม' },
  { key: 'communication', label: 'การสื่อสาร' },
  { key: 'responsibility', label: 'ความรับผิดชอบ' },
  { key: 'punctuality', label: 'ความตรงต่อเวลา' },
  { key: 'leadership', label: 'ภาวะผู้นำ' },
];

/**
 * GET /api/hr/peer-evaluations — สรุปผลประเมิน 360° รายพนักงาน (admin/hr อ่านอย่างเดียว)
 * ?period=2569-H1 (optional)
 */
export async function GET(request) {
  const { error, status } = await requireMenu(request, 'evaluation');
  if (error) return NextResponse.json({ error }, { status });

  const url = new URL(request.url);
  const period = url.searchParams.get('period');

  let q = supabase.from('peer_evaluations').select('*').eq('status', 'submitted');
  if (period) q = q.eq('period', period);
  const { data: rows, error: dbErr } = await q;
  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });

  const [{ data: users }] = await Promise.all([
    supabase.from('users').select('employee_id, name, department'),
  ]);
  const nameMap = new Map((users || []).map((u) => [u.employee_id, u]));

  // รวมคะแนนตาม target
  const byTarget = new Map();
  for (const r of rows || []) {
    if (!byTarget.has(r.target_id)) byTarget.set(r.target_id, []);
    byTarget.get(r.target_id).push(r);
  }

  const summary = [];
  for (const [targetId, list] of byTarget.entries()) {
    const u = nameMap.get(targetId) || {};
    const scores = {};
    let overallSum = 0, overallCount = 0;
    for (const c of EVAL_CRITERIA) {
      const vals = list.filter((e) => e.scores && e.scores[c.key] != null).map((e) => Number(e.scores[c.key]));
      const avg = vals.length ? +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2) : null;
      scores[c.key] = avg;
      if (avg != null) { overallSum += avg; overallCount++; }
    }
    summary.push({
      targetId,
      name: u.name || targetId,
      department: u.department || '',
      count: list.length,
      scores,
      overall: overallCount ? +(overallSum / overallCount).toFixed(2) : null,
    });
  }
  summary.sort((a, b) => (b.overall || 0) - (a.overall || 0));

  const periods = [...new Set((rows || []).map((r) => r.period))].sort().reverse();

  return NextResponse.json({ criteria: EVAL_CRITERIA, summary, periods });
}
