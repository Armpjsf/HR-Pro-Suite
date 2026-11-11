import { NextResponse } from 'next/server';
import { requireMenu } from '@/lib/hr-access';
import { supabase } from '@/lib/supabase';
import { computeSlip } from '@/lib/payroll';
import { addAuditEntry } from '@/lib/db';

/**
 * POST /api/hr/payroll/generate — สร้างสลิปอัตโนมัติทั้งงวด
 * Body: { period: '2026-06', overwrite?: boolean }
 * - รองรับพนักงานรายเดือน (monthly) และรายวัน (daily: คูณวันมาทำงานจริงจาก time_records)
 * - คำนวณ ปกส. + ภาษี จากเงินเดือน + ค่าลดหย่อน (ลย.01)
 * - รวม OT ที่อนุมัติแล้วในงวด
 * - รวมยอดเบิกค่าใช้จ่าย/เบี้ยเลี้ยง (expense_claims) ที่อนุมัติแล้วในงวดเข้าช่องเงินได้พิเศษ/โบนัส
 * - หักวันลาไม่รับค่าจ้าง (leave_types ที่ paid = false) และหักงวดผ่อนเงินกู้ (benefits_loans type=loan)
 * - ปกป้องสลิปที่สถานะ 'paid' ไม่ให้ถูกเขียนทับ
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

  const [
    { data: allRecords },
    { data: activeUsers },
    { data: existing },
    { data: allowances },
    { data: otRows },
    { data: loanRows },
    { data: timeRows },
    { data: leaveRows },
    { data: leaveTypes },
    { data: expenseRows },
    { data: ssoRows },
  ] = await Promise.all([
    supabase.from('employee_records').select('employee_id, salary, employment_type').gt('salary', 0),
    supabase.from('users').select('employee_id, status'),
    supabase.from('payroll_slips').select('id, employee_id, status, bonus').eq('period', period),
    supabase.from('tax_allowances').select('employee_id, data').eq('year', yearBE),
    supabase.from('ot_records').select('employee_id, amount')
      .eq('status', 'approved').gte('ot_date', periodStart).lte('ot_date', periodEnd),
    supabase.from('benefits_loans').select('employee_id, amount, start_date, end_date')
      .eq('type', 'loan').eq('status', 'active'),
    supabase.from('time_records').select('employee_id, work_date, status, clock_in')
      .gte('work_date', periodStart).lte('work_date', periodEnd),
    supabase.from('leave_requests').select('employee_id, leave_type, days, start_date')
      .eq('status', 'approved').gte('start_date', periodStart).lte('start_date', periodEnd),
    supabase.from('leave_types').select('code, paid'),
    supabase.from('expense_claims').select('employee_id, amount')
      .eq('status', 'approved').gte('claim_date', periodStart).lte('claim_date', periodEnd),
    supabase.from('social_security').select('employee_id, status, monthly_contribution'),
  ]);

  // ตัดพนักงานที่พ้นสภาพ/ถูกระงับออกจากงวด
  const activeSet = new Set(
    (activeUsers || []).filter((u) => !u.status || u.status === 'active').map((u) => u.employee_id),
  );
  const records = (allRecords || []).filter((r) => activeSet.has(r.employee_id));

  const existMap = new Map((existing || []).map((s) => [s.employee_id, s]));
  const allowMap = new Map((allowances || []).map((a) => [a.employee_id, a.data || {}]));
  const unpaidLeaveTypes = new Set(
    (leaveTypes || []).filter((lt) => lt.paid === false).map((lt) => lt.code),
  );

  // 1. รวม OT อนุมัติแล้วของงวดนี้ รายพนักงาน
  const otMap = new Map();
  for (const ot of otRows || []) {
    otMap.set(ot.employee_id, (otMap.get(ot.employee_id) || 0) + (Number(ot.amount) || 0));
  }

  // 2. รวมยอดเบิกค่าใช้จ่าย/เบี้ยเลี้ยงที่อนุมัติแล้วในงวดนี้
  const expenseMap = new Map();
  for (const ex of expenseRows || []) {
    expenseMap.set(ex.employee_id, (expenseMap.get(ex.employee_id) || 0) + (Number(ex.amount) || 0));
  }

  // 3. นับวันทำงานจริงสำหรับพนักงานรายวัน (daily) และวันขาดงาน (absent)
  const workDaysMap = new Map();
  const absentDaysMap = new Map();
  for (const tr of timeRows || []) {
    if (tr.status === 'absent') {
      absentDaysMap.set(tr.employee_id, (absentDaysMap.get(tr.employee_id) || 0) + 1);
    } else if (tr.status === 'normal' || tr.status === 'present' || tr.status === 'late' || tr.clock_in) {
      workDaysMap.set(tr.employee_id, (workDaysMap.get(tr.employee_id) || 0) + 1);
    }
  }

  // 4. นับวันลาไม่รับค่าจ้าง (Leave Without Pay)
  const unpaidLeaveDaysMap = new Map();
  for (const lv of leaveRows || []) {
    if (unpaidLeaveTypes.has(lv.leave_type)) {
      unpaidLeaveDaysMap.set(lv.employee_id, (unpaidLeaveDaysMap.get(lv.employee_id) || 0) + (Number(lv.days) || 0));
    }
  }

  // 5. เงินกู้ active ที่คาบเกี่ยวงวดนี้ — คำนวณยอดผ่อนต่อเดือนอัตโนมัติจากระยะเวลาสัญญา
  const loanMap = new Map();
  for (const loan of loanRows || []) {
    const started = !loan.start_date || loan.start_date <= periodEnd;
    const notEnded = !loan.end_date || loan.end_date >= periodStart;
    if (!started || !notEnded) continue;

    let monthlyInstallment = Number(loan.amount) || 0;
    if (loan.start_date && loan.end_date) {
      const sDate = new Date(loan.start_date);
      const eDate = new Date(loan.end_date);
      const diffMonths = Math.max(1, (eDate.getFullYear() - sDate.getFullYear()) * 12 + (eDate.getMonth() - sDate.getMonth()) + 1);
      // หาก amount เป็นยอดกู้รวมเกิน 5,000 บาท ให้แบ่งตามจำนวนเดือนผ่อน
      if (monthlyInstallment > 5000 && diffMonths > 1) {
        monthlyInstallment = Math.round(monthlyInstallment / diffMonths);
      }
    }
    loanMap.set(loan.employee_id, (loanMap.get(loan.employee_id) || 0) + monthlyInstallment);
  }

  // 6. แผนผังประกันสังคม (กรณี inactive ให้ sso = 0)
  const ssoMap = new Map();
  for (const s of ssoRows || []) {
    if (s.status === 'inactive') {
      ssoMap.set(s.employee_id, 0);
    } else if (s.monthly_contribution !== null && s.monthly_contribution !== undefined) {
      ssoMap.set(s.employee_id, Number(s.monthly_contribution));
    }
  }

  let created = 0, updated = 0, skipped = 0;
  for (const rec of records || []) {
    const rawSalary = Number(rec.salary) || 0;
    const isDaily = String(rec.employment_type || '').startsWith('daily');
    const workDays = workDaysMap.get(rec.employee_id) || 0;

    // หากเป็นพนักงานรายวัน (Daily): จ่ายเฉพาะวันที่เช็คอินเข้างานจริง (workDays) เท่านั้น
    // หากไม่มีการเช็คอินเข้างาน หรือเป็นวันลาหยุด/ขาดงาน จะไม่จ่ายค่าจ้างวันนั้น (baseSalary = 0)
    let baseSalary = rawSalary;
    let dailyRate = rawSalary / 30;
    if (isDaily) {
      dailyRate = rawSalary <= 3000 ? rawSalary : Math.round(rawSalary / 30);
      // คิดค่าจ้างตามจำนวนวันที่เข้างานจริงเท่านั้น
      baseSalary = Math.round(dailyRate * workDays);
    }

    const unpaidDays = (unpaidLeaveDaysMap.get(rec.employee_id) || 0) + (absentDaysMap.get(rec.employee_id) || 0);
    const unpaidDeduction = Math.round(dailyRate * unpaidDays);
    const totalDeduction = (loanMap.get(rec.employee_id) || 0) + unpaidDeduction;
    const approvedExpenses = expenseMap.get(rec.employee_id) || 0;
    const prevBonus = existMap.get(rec.employee_id)?.bonus || 0;

    const slipData = computeSlip({
      monthlySalary: baseSalary,
      otMonthly: otMap.get(rec.employee_id) || 0,
      bonusMonthly: prevBonus,
      reimbursements: approvedExpenses,
      otherDeduction: totalDeduction,
      allowances: allowMap.get(rec.employee_id) || {},
      ssoCustom: ssoMap.has(rec.employee_id) ? ssoMap.get(rec.employee_id) : null,
    });
    const row = { employee_id: rec.employee_id, period, status: 'draft', ...slipData };

    if (existMap.has(rec.employee_id)) {
      const prevSlip = existMap.get(rec.employee_id);
      if (prevSlip.status === 'paid' || !overwrite) {
        skipped++;
        continue;
      }
      const { error: e } = await supabase.from('payroll_slips').update(row).eq('id', prevSlip.id);
      if (!e) updated++;
    } else {
      const { error: e } = await supabase.from('payroll_slips').insert(row);
      if (!e) created++;
    }
  }

  await addAuditEntry({
    user: user.name,
    action: `คำนวณสลิปอัตโนมัติงวด ${period} (ใหม่ ${created}, อัปเดต ${updated}, ข้าม ${skipped})`,
    channel: 'HR',
  });

  return NextResponse.json({ success: true, created, updated, skipped, period });
}
