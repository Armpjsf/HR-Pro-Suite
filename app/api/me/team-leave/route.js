import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { addAuditEntry } from '@/lib/db';
import { createNotification, notifyHr } from '@/lib/notifications';

/**
 * GET /api/me/team-leave — คำขอของลูกทีม (ใบลา, OT, เบิกค่าใช้จ่าย) ที่รออนุมัติจากหัวหน้า
 */
export async function GET(request) {
  const { user, error, status } = requireAuth(request);
  if (error) return NextResponse.json({ error }, { status });

  const { data: subordinates } = await supabase
    .from('users')
    .select('employee_id, name')
    .eq('manager_id', user.employeeId);

  let subIds = (subordinates || []).map((u) => u.employee_id);
  const isHrOrAdmin = ['admin', 'hr', 'manager'].includes(user.role);

  let leavesQuery = supabase.from('leave_requests').select('*').order('created_at', { ascending: false }).limit(50);
  if (subIds.length > 0) {
    leavesQuery = leavesQuery.or(`manager_id.eq.${user.employeeId},employee_id.in.(${subIds.join(',')})`);
  } else if (!isHrOrAdmin) {
    leavesQuery = leavesQuery.eq('manager_id', user.employeeId);
  }
  const { data: leaves } = await leavesQuery;

  let otItems = [];
  let expenseItems = [];
  if (subIds.length > 0 || isHrOrAdmin) {
    let otQ = supabase.from('ot_records').select('*').order('created_at', { ascending: false }).limit(40);
    let expQ = supabase.from('expense_claims').select('*').order('created_at', { ascending: false }).limit(40);
    if (subIds.length > 0) {
      otQ = otQ.in('employee_id', subIds);
      expQ = expQ.in('employee_id', subIds);
    }
    const [otRes, expRes] = await Promise.all([otQ, expQ]);
    otItems = otRes.data || [];
    expenseItems = expRes.data || [];
  }

  const allEmpIds = [
    ...new Set([
      ...(leaves || []).map((l) => l.employee_id),
      ...otItems.map((o) => o.employee_id),
      ...expenseItems.map((e) => e.employee_id),
    ]),
  ];
  let nameMap = new Map((subordinates || []).map((u) => [u.employee_id, u.name]));
  if (allEmpIds.length > 0) {
    const { data: users } = await supabase.from('users').select('employee_id, name').in('employee_id', allEmpIds);
    for (const u of users || []) nameMap.set(u.employee_id, u.name);
  }

  return NextResponse.json({
    items: (leaves || []).map((l) => ({ ...l, employeeName: nameMap.get(l.employee_id) || l.employee_id })),
    otItems: otItems.map((o) => ({ ...o, employeeName: nameMap.get(o.employee_id) || o.employee_id })),
    expenseItems: expenseItems.map((e) => ({ ...e, employeeName: nameMap.get(e.employee_id) || e.employee_id })),
  });
}

/**
 * POST /api/me/team-leave — หัวหน้าอนุมัติ/ปฏิเสธ คำขอของลูกทีม (ลำดับที่ 1 ก่อนส่งต่อ HR)
 * Body: { id, action: 'approve'|'reject', type?: 'leave'|'ot'|'expense' }
 */
export async function POST(request) {
  const { user, error, status } = requireAuth(request);
  if (error) return NextResponse.json({ error }, { status });

  const { id, action, type = 'leave' } = await request.json();
  if (action !== 'approve' && action !== 'reject') {
    return NextResponse.json({ error: 'action ไม่ถูกต้อง' }, { status: 400 });
  }

  if (type === 'ot') {
    const { data: ot } = await supabase.from('ot_records').select('*').eq('id', id).maybeSingle();
    if (!ot) return NextResponse.json({ error: 'ไม่พบคำขอ OT' }, { status: 404 });
    if (ot.status !== 'pending') return NextResponse.json({ error: 'รายการนี้ดำเนินการไปแล้ว' }, { status: 409 });

    const tag = `[หัวหน้าอนุมัติ: ${user.name}]`;
    const updates = action === 'approve'
      ? { note: `${String(ot.note || '').replace(/\[หัวหน้าอนุมัติ:[^\]]+\]/g, '').trim()} ${tag}`.trim() }
      : { status: 'rejected', approved_by: user.name };

    const { error: updErr } = await supabase.from('ot_records').update(updates).eq('id', id);
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

    await addAuditEntry({
      user: user.name,
      action: `หัวหน้า${action === 'approve' ? 'อนุมัติขั้นต้น' : 'ปฏิเสธ'} OT ${ot.employee_id} (${ot.hours} ชม.)`,
      channel: 'ME',
    });

    await createNotification({
      employeeId: ot.employee_id,
      title: action === 'approve' ? 'หัวหน้าอนุมัติ OT แล้ว' : 'หัวหน้าปฏิเสธคำขอ OT',
      body: `คำขอ OT วันที่ ${ot.ot_date} (${ot.hours} ชม.) ${action === 'approve' ? 'ถูกส่งต่อให้ HR พิจารณาขั้นสุดท้าย' : 'ไม่ผ่านการอนุมัติ'}`,
      url: '/me',
      type: action === 'approve' ? 'ot_manager_approved' : 'ot_rejected',
    });

    if (action === 'approve') {
      await notifyHr('ot', {
        title: 'มีคำขอ OT ผ่านหัวหน้าแล้ว รอ HR อนุมัติ',
        body: `OT ของ ${ot.employee_id} วันที่ ${ot.ot_date} (${ot.hours} ชม.) ผ่านการอนุมัติจาก ${user.name}`,
        url: '/hr/ot',
        type: 'ot_pending',
      });
    }
    return NextResponse.json({ success: true });
  }

  if (type === 'expense') {
    const { data: exp } = await supabase.from('expense_claims').select('*').eq('id', id).maybeSingle();
    if (!exp) return NextResponse.json({ error: 'ไม่พบรายการเบิกค่าใช้จ่าย' }, { status: 404 });
    if (exp.status !== 'pending') return NextResponse.json({ error: 'รายการนี้ดำเนินการไปแล้ว' }, { status: 409 });

    const tag = `[หัวหน้าอนุมัติ: ${user.name}]`;
    const updates = action === 'approve'
      ? { description: `${String(exp.description || '').replace(/\[หัวหน้าอนุมัติ:[^\]]+\]/g, '').trim()} ${tag}`.trim() }
      : { status: 'rejected', approved_by: user.name };

    const { error: updErr } = await supabase.from('expense_claims').update(updates).eq('id', id);
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

    await addAuditEntry({
      user: user.name,
      action: `หัวหน้า${action === 'approve' ? 'อนุมัติขั้นต้น' : 'ปฏิเสธ'}เบิกจ่าย ${exp.employee_id} (${exp.amount} บาท)`,
      channel: 'ME',
    });

    await createNotification({
      employeeId: exp.employee_id,
      title: action === 'approve' ? 'หัวหน้าอนุมัติเบิกจ่ายแล้ว' : 'หัวหน้าปฏิเสธคำขอเบิกจ่าย',
      body: `รายการเบิก ${Number(exp.amount).toLocaleString()} บาท ${action === 'approve' ? 'ถูกส่งต่อให้ HR พิจารณาอนุมัติ' : 'ไม่ผ่านการอนุมัติ'}`,
      url: '/me',
      type: action === 'approve' ? 'expense_manager_approved' : 'expense_rejected',
    });

    if (action === 'approve') {
      await notifyHr('expenses', {
        title: 'มีคำขอเบิกจ่ายผ่านหัวหน้าแล้ว รอ HR อนุมัติ',
        body: `เบิกค่าใช้จ่ายของ ${exp.employee_id} จำนวน ${Number(exp.amount).toLocaleString()} บาท ผ่านหัวหน้า (${user.name}) แล้ว`,
        url: '/hr/expenses',
        type: 'expense_pending',
      });
    }
    return NextResponse.json({ success: true });
  }

  // Default: leave_requests
  const { data: leave } = await supabase.from('leave_requests').select('*').eq('id', id).maybeSingle();
  if (!leave) return NextResponse.json({ error: 'ไม่พบใบลา' }, { status: 404 });
  const isHrOrAdmin = ['admin', 'hr', 'manager'].includes(user.role);
  if (leave.manager_id && leave.manager_id !== user.employeeId && !isHrOrAdmin) {
    return NextResponse.json({ error: 'คุณไม่ใช่หัวหน้าของใบลานี้' }, { status: 403 });
  }
  if (leave.manager_status !== 'pending') {
    return NextResponse.json({ error: 'ใบลานี้ดำเนินการไปแล้ว' }, { status: 409 });
  }

  const updates = action === 'approve'
    ? { manager_status: 'approved', manager_approved_at: new Date().toISOString(), manager_approved_by: user.name }
    : { manager_status: 'rejected', status: 'rejected', manager_approved_at: new Date().toISOString(), manager_approved_by: user.name };

  const { error: e } = await supabase.from('leave_requests').update(updates).eq('id', id).eq('manager_status', 'pending');
  if (e) return NextResponse.json({ error: e.message }, { status: 500 });

  await addAuditEntry({
    user: user.name,
    action: `หัวหน้า${action === 'approve' ? 'อนุมัติ' : 'ปฏิเสธ'}ใบลา ${leave.employee_id} (${leave.leave_type} ${leave.days} วัน)`,
    channel: 'ME',
  });

  await createNotification({
    employeeId: leave.employee_id,
    title: action === 'approve' ? 'หัวหน้าอนุมัติใบลาแล้ว' : 'หัวหน้าปฏิเสธใบลา',
    body: `ใบลา ${leave.leave_type} ${leave.days} วัน ${action === 'approve' ? 'ถูกส่งต่อให้ HR แล้ว' : 'ไม่ผ่านการอนุมัติ'}`,
    url: '/me',
    type: action === 'approve' ? 'leave_manager_approved' : 'leave_rejected',
  });

  if (action === 'approve') {
    await notifyHr('leave', {
      title: 'มีใบลารอ HR อนุมัติ',
      body: `ใบลา ${leave.leave_type} ${leave.days} วัน ของ ${leave.employee_id} ผ่านหัวหน้าแล้ว`,
      url: '/hr/leave',
      type: 'leave_pending',
    });
  }

  return NextResponse.json({ success: true });
}
