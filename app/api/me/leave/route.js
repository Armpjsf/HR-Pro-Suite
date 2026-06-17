import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { addAuditEntry } from '@/lib/db';
import { currentLeaveYear } from '@/lib/leave-balances';
import { createNotification, notifyHr } from '@/lib/notifications';

/**
 * POST /api/me/leave — พนักงานยื่นใบลาของตัวเอง (status = pending รอ HR อนุมัติ)
 */
export async function POST(request) {
  const { user, error, status } = requireAuth(request);
  if (error) return NextResponse.json({ error }, { status });

  const body = await request.json();
  const { leave_type, start_date, end_date, days, reason } = body;

  const { data: leaveType, error: typeErr } = await supabase
    .from('leave_types')
    .select('code, name, deduct_balance')
    .eq('code', leave_type)
    .maybeSingle();
  if (typeErr) return NextResponse.json({ error: typeErr.message }, { status: 500 });
  if (!leaveType) {
    return NextResponse.json({ error: 'ประเภทการลาไม่ถูกต้อง' }, { status: 400 });
  }
  if (!start_date || !end_date || !days || Number(days) <= 0) {
    return NextResponse.json({ error: 'กรุณาระบุวันที่และจำนวนวันให้ครบ' }, { status: 400 });
  }

  if (leaveType.deduct_balance) {
    const year = Number(new Date(start_date).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }).slice(0, 4)) || currentLeaveYear();
    const { data: balance, error: balanceErr } = await supabase
      .from('employee_leave_balances')
      .select('total_days, used_days')
      .eq('employee_id', user.employeeId)
      .eq('leave_type', leave_type)
      .eq('year', year)
      .maybeSingle();
    if (balanceErr) return NextResponse.json({ error: balanceErr.message }, { status: 500 });
    if (!balance) return NextResponse.json({ error: 'คุณยังไม่มีสิทธิ์ลาประเภทนี้ กรุณาติดต่อ HR' }, { status: 400 });
    const remaining = (Number(balance.total_days) || 0) - (Number(balance.used_days) || 0);
    if (Number(days) > remaining) {
      return NextResponse.json({ error: `สิทธิ์ลาคงเหลือไม่พอ (เหลือ ${remaining} วัน)` }, { status: 400 });
    }
  }

  // หาหัวหน้าของผู้ยื่น เพื่อกำหนดผู้อนุมัติลำดับแรก
  const { data: me } = await supabase
    .from('users')
    .select('manager_id')
    .eq('employee_id', user.employeeId)
    .maybeSingle();

  const { data, error: dbError } = await supabase
    .from('leave_requests')
    .insert({
      employee_id: user.employeeId, // บังคับเป็นของตัวเองเสมอ
      leave_type,
      start_date,
      end_date,
      days: Number(days),
      reason: reason || null,
      status: 'pending',
      manager_id: me?.manager_id || null,
      manager_status: me?.manager_id ? 'pending' : 'approved', // ไม่มีหัวหน้า = ข้ามไป HR เลย
    })
    .select()
    .single();
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  await addAuditEntry({
    user: user.name,
    action: `ยื่นใบลา ${leave_type} ${days} วัน (${start_date})`,
    channel: 'ME',
  });

  if (me?.manager_id) {
    await createNotification({
      employeeId: me.manager_id,
      title: 'มีใบลารอหัวหน้าอนุมัติ',
      body: `${user.name} ยื่นใบลา ${leaveType.name || leave_type} ${days} วัน`,
      url: '/me',
      type: 'leave_manager_pending',
      audience: 'manager',
    });
  } else {
    await notifyHr('leave', {
      title: 'มีใบลารอ HR อนุมัติ',
      body: `${user.name} ยื่นใบลา ${leaveType.name || leave_type} ${days} วัน`,
      url: '/hr/leave',
      type: 'leave_pending',
    });
  }

  return NextResponse.json({ item: data });
}
