import { NextResponse } from 'next/server';
import { requireMenu } from '@/lib/hr-access';
import { supabase } from '@/lib/supabase';
import { computeSlip } from '@/lib/payroll';
import { addAuditEntry } from '@/lib/db';

/**
 * POST /api/hr/payroll/generate — สร้างสลิปอัตโนมัติทั้งงวดจากเงินเดือนฐานพนักงาน
 * Body: { period: '2026-06', overwrite?: boolean }
 * คำนวณ ปกส. + ภาษี จากเงินเดือน + ค่าลดหย่อน (ลย.01) ของแต่ละคน
 */
export async function POST(request) {
  const { user, error, status } = await requireMenu(request, 'payroll');
  if (error) return NextResponse.json({ error }, { status });

  const { period, overwrite } = await request.json();
  if (!period || !/^\d{4}-\d{2}$/.test(period)) {
    return NextResponse.json({ error: 'กรุณาระบุงวดในรูปแบบ YYYY-MM' }, { status: 400 });
  }
  const yearBE = Number(period.slice(0, 4)) + 543;

  const [{ data: records }, { data: existing }, { data: allowances }] = await Promise.all([
    supabase.from('employee_records').select('employee_id, salary').gt('salary', 0),
    supabase.from('payroll_slips').select('id, employee_id').eq('period', period),
    supabase.from('tax_allowances').select('employee_id, data').eq('year', yearBE),
  ]);

  const existMap = new Map((existing || []).map((s) => [s.employee_id, s.id]));
  const allowMap = new Map((allowances || []).map((a) => [a.employee_id, a.data || {}]));

  let created = 0, updated = 0, skipped = 0;
  for (const rec of records || []) {
    const slipData = computeSlip({
      monthlySalary: rec.salary,
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
