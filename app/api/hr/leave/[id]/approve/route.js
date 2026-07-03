import { NextResponse } from 'next/server';
import { requireMenu } from '@/lib/hr-access';
import { supabase } from '@/lib/supabase';
import { addAuditEntry } from '@/lib/db';
import { currentLeaveYear } from '@/lib/leave-balances';
import { createNotification } from '@/lib/notifications';
import { getWorkSettingsForEmployee } from '@/lib/work-calendar';

const LEAVE_COL = {
  annual: 'leave_annual_used',
  sick: 'leave_sick_used',
  personal: 'leave_personal_used',
};

/**
 * ลงสถานะ 'leave' ใน time_records สำหรับทุกวันทำงานในช่วงลาที่อนุมัติ
 * ข้ามวันหยุดนักขัตฤกษ์ (ของสาขาตัวเอง/ส่วนกลาง) วันที่ไม่ใช่วันทำงาน และวันที่มี record อยู่แล้ว
 * ความล้มเหลวในขั้นนี้ไม่ทำให้การอนุมัติล้ม (best-effort)
 */
async function markLeaveInTimeRecords(req) {
  try {
    const [ws, { data: me }] = await Promise.all([
      getWorkSettingsForEmployee(req.employee_id),
      supabase.from('users').select('branch_id').eq('employee_id', req.employee_id).maybeSingle(),
    ]);
    const workDays = new Set((ws?.work_days || '1,2,3,4,5').split(',').filter(Boolean).map(Number));

    let holidayQuery = supabase
      .from('holidays')
      .select('holiday_date')
      .gte('holiday_date', req.start_date)
      .lte('holiday_date', req.end_date);
    holidayQuery = me?.branch_id
      ? holidayQuery.or(`branch_id.is.null,branch_id.eq.${me.branch_id}`)
      : holidayQuery.is('branch_id', null);
    const { data: holidays } = await holidayQuery;
    const holidaySet = new Set((holidays || []).map((h) => h.holiday_date));

    const { data: existing } = await supabase
      .from('time_records')
      .select('work_date')
      .eq('employee_id', req.employee_id)
      .gte('work_date', req.start_date)
      .lte('work_date', req.end_date);
    const existingSet = new Set((existing || []).map((r) => r.work_date));

    const rows = [];
    for (let d = new Date(`${req.start_date}T00:00:00`); ; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toLocaleDateString('en-CA');
      if (dateStr > req.end_date) break;
      if (!workDays.has(d.getDay()) || holidaySet.has(dateStr) || existingSet.has(dateStr)) continue;
      rows.push({
        employee_id: req.employee_id,
        work_date: dateStr,
        status: 'leave',
        note: `ลา (${req.leave_type})`,
      });
    }
    if (rows.length > 0) await supabase.from('time_records').insert(rows);
  } catch (e) {
    console.error('[leave approve] markLeaveInTimeRecords failed:', e?.message || e);
  }
}

/**
 * POST /api/hr/leave/[id]/approve — { action: 'approve' | 'reject' }
 * อนุมัติแล้วจะบวกวันลาที่ใช้ใน employee_records ให้อัตโนมัติ (chatbot อ่านค่าเดียวกัน)
 */
export async function POST(request, { params }) {
  const { user, error, status } = await requireMenu(request, 'leave');
  if (error) return NextResponse.json({ error }, { status });

  const { id } = await params;
  const { action } = await request.json();
  if (action !== 'approve' && action !== 'reject') {
    return NextResponse.json({ error: 'action ต้องเป็น approve หรือ reject' }, { status: 400 });
  }

  const { data: req, error: findErr } = await supabase
    .from('leave_requests')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (findErr) return NextResponse.json({ error: findErr.message }, { status: 500 });
  if (!req) return NextResponse.json({ error: 'ไม่พบใบลา' }, { status: 404 });
  if (req.status !== 'pending') {
    return NextResponse.json({ error: 'ใบลานี้ถูกดำเนินการไปแล้ว' }, { status: 409 });
  }
  // บังคับลำดับอนุมัติ: ถ้าใบลามีหัวหน้า ต้องรอหัวหน้าอนุมัติก่อน HR
  if (action === 'approve' && req.manager_id && req.manager_status === 'pending') {
    return NextResponse.json({ error: 'ใบลานี้ยังรอหัวหน้าอนุมัติ กรุณารอหัวหน้าพิจารณาก่อน' }, { status: 409 });
  }

  const newStatus = action === 'approve' ? 'approved' : 'rejected';
  const { error: updErr } = await supabase
    .from('leave_requests')
    .update({ status: newStatus, approved_by: user.name, approved_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'pending');
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  if (action === 'approve') {
    const { data: leaveType, error: typeErr } = await supabase
      .from('leave_types')
      .select('code, deduct_balance')
      .eq('code', req.leave_type)
      .maybeSingle();
    if (typeErr) return NextResponse.json({ error: typeErr.message }, { status: 500 });

    const shouldDeduct = leaveType ? leaveType.deduct_balance : !!LEAVE_COL[req.leave_type];
    if (shouldDeduct) {
      const year = Number(new Date(req.start_date).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }).slice(0, 4)) || currentLeaveYear();
      const { data: balance, error: balanceErr } = await supabase
        .from('employee_leave_balances')
        .select('*')
        .eq('employee_id', req.employee_id)
        .eq('leave_type', req.leave_type)
        .eq('year', year)
        .maybeSingle();
      if (balanceErr) return NextResponse.json({ error: balanceErr.message }, { status: 500 });

      const usedDays = (Number(balance?.used_days) || 0) + Number(req.days);
      const { error: balanceUpsertErr } = await supabase.from('employee_leave_balances').upsert({
        employee_id: req.employee_id,
        leave_type: req.leave_type,
        year,
        total_days: Number(balance?.total_days) || 0,
        used_days: usedDays,
        note: balance?.note || null,
        updated_at: new Date().toISOString(),
      });
      if (balanceUpsertErr) return NextResponse.json({ error: balanceUpsertErr.message }, { status: 500 });
    }

    const col = shouldDeduct ? LEAVE_COL[req.leave_type] : null;
    if (col) {
      const { data: rec, error: recErr } = await supabase
        .from('employee_records')
        .select(`employee_id, ${col}`)
        .eq('employee_id', req.employee_id)
        .maybeSingle();
      if (recErr) return NextResponse.json({ error: recErr.message }, { status: 500 });

      const current = Number(rec?.[col]) || 0;
      const newUsed = current + Number(req.days);
      const { error: upsertErr } = await supabase.from('employee_records').upsert({
        employee_id: req.employee_id,
        [col]: newUsed,
        updated_at: new Date().toISOString(),
      });
      if (upsertErr) return NextResponse.json({ error: upsertErr.message }, { status: 500 });
    }

    // บันทึกสถานะ "ลา" ลง time_records ทุกวันทำงานในช่วงลา (ไม่ทับ record ที่มีอยู่)
    await markLeaveInTimeRecords(req);
  }

  await addAuditEntry({
    user: user.name,
    action: `${action === 'approve' ? 'อนุมัติ' : 'ปฏิเสธ'}ใบลา ${req.employee_id} (${req.leave_type} ${req.days} วัน)`,
    channel: 'HR',
  });

  await createNotification({
    employeeId: req.employee_id,
    title: action === 'approve' ? 'HR อนุมัติใบลาแล้ว' : 'HR ปฏิเสธใบลา',
    body: `ใบลา ${req.leave_type} ${req.days} วัน สถานะ: ${newStatus}`,
    url: '/me',
    type: action === 'approve' ? 'leave_approved' : 'leave_rejected',
  });

  return NextResponse.json({ success: true, status: newStatus });
}
