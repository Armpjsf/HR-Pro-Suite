import { NextResponse } from 'next/server';
import { requireMenu } from '@/lib/hr-access';
import { supabase } from '@/lib/supabase';
import { computeSlip } from '@/lib/payroll';
import { addAuditEntry } from '@/lib/db';

/**
 * POST /api/hr/payroll/generate — สร้างสลิปอัตโนมัติทั้งงวดจากเงินเดือนฐานพนักงาน
 * Body: { period: '2026-06', overwrite?: boolean }
 * คำนวณ ปกส. + ภาษี จากเงินเดือน + ค่าลดหย่อน (ลย.01)
 * รวม OT ที่อนุมัติแล้วในงวด และหักงวดผ่อนเงินกู้ (benefits_loans type=loan) ที่ยัง active
 */
function lastDayOfPeriod(period) {
  const [y, m] = period.split('-').map(Number);
  return `${period}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
}
export async function POST(request) {
  const { user, error, status } = await requireMenu(request, 'payroll');
  if (error) return NextResponse.json({ error }, { status });

  const { period, overwrite } = await request.json();
  if (!period || !/^\d{4}-\d{2}$/.test(period)) {
    return NextResponse.json({ error: 'กรุณาระบุงวดในรูปแบบ YYYY-MM' }, { status: 400 });
  }
  const yearBE = Number(period.slice(0, 4)) + 543;

  const periodStart = `${period}-01`;
  const periodEnd = lastDayOfPeriod(period);

  const [{ data: allRecords }, { data: activeUsers }, { data: existing }, { data: allowances }, { data: otRows }, { data: loanRows }] = await Promise.all([
    supabase.from('employee_records').select('employee_id, salary').gt('salary', 0),
    supabase.from('users').select('employee_id, status'),
    supabase.from('payroll_slips').select('id, employee_id').eq('period', period),
    supabase.from('tax_allowances').select('employee_id, data').eq('year', yearBE),
    supabase.from('ot_records').select('employee_id, amount')
      .eq('status', 'approved').gte('ot_date', periodStart).lte('ot_date', periodEnd),
    supabase.from('benefits_loans').select('employee_id, amount, start_date, end_date')
      .eq('type', 'loan').eq('status', 'active'),
  ]);

  // ตัดพนักงานที่พ้นสภาพ/ถูกระงับออกจากงวด
  const activeSet = new Set(
    (activeUsers || []).filter((u) => !u.status || u.status === 'active').map((u) => u.employee_id),
  );
  const records = (allRecords || []).filter((r) => activeSet.has(r.employee_id));

  const existMap = new Map((existing || []).map((s) => [s.employee_id, s.id]));
  const allowMap = new Map((allowances || []).map((a) => [a.employee_id, a.data || {}]));

  // รวม OT อนุมัติแล้วของงวดนี้ รายพนักงาน
  const otMap = new Map();
  for (const ot of otRows || []) {
    otMap.set(ot.employee_id, (otMap.get(ot.employee_id) || 0) + (Number(ot.amount) || 0));
  }

  // เงินกู้ active ที่คาบเกี่ยวงวดนี้ — ถือ amount เป็นยอดผ่อนต่อเดือน
  const loanMap = new Map();
  for (const loan of loanRows || []) {
    const started = !loan.start_date || loan.start_date <= periodEnd;
    const notEnded = !loan.end_date || loan.end_date >= periodStart;
    if (!started || !notEnded) continue;
    loanMap.set(loan.employee_id, (loanMap.get(loan.employee_id) || 0) + (Number(loan.amount) || 0));
  }

  let created = 0, updated = 0, skipped = 0;
  for (const rec of records || []) {
    const slipData = computeSlip({
      monthlySalary: rec.salary,
      otMonthly: otMap.get(rec.employee_id) || 0,
      otherDeduction: loanMap.get(rec.employee_id) || 0,
      allowances: allowMap.get(rec.employee_id) || {},
    });
    const row = { employee_id: rec.employee_id, period, status: 'draft', ...slipData };

    if (existMap.has(rec.employee_id)) {
      if (!overwrite) { skipped++; continue; }
      const { error: e } = await supabase.from('payroll_slips').update(row).eq('id', existMap.get(rec.employee_id));
      if (!e) updated++;
    } else {
      const { error: e } = await supabase.from('payroll_slips').insert(row);
      if (!e) created++;
    }
  }

  await addAuditEntry({ user: user.name, action: `สร้างสลิปอัตโนมัติงวด ${period} (ใหม่ ${created}, อัปเดต ${updated})`, channel: 'HR' });

  return NextResponse.json({ success: true, created, updated, skipped, period });
}
