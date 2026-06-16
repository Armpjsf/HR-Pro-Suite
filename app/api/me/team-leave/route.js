import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { addAuditEntry } from '@/lib/db';

/**
 * GET /api/me/team-leave — ใบลาของลูกทีมที่รออนุมัติจากหัวหน้า (ผู้ใช้เป็นหัวหน้า)
 */
export async function GET(request) {
  const { user, error, status } = requireAuth(request);
  if (error) return NextResponse.json({ error }, { status });

  const { data: leaves } = await supabase
    .from('leave_requests')
    .select('*')
    .eq('manager_id', user.employeeId)
    .order('created_at', { ascending: false })
    .limit(50);

  const ids = [...new Set((leaves || []).map((l) => l.employee_id))];
  let nameMap = new Map();
  if (ids.length) {
    const { data: users } = await supabase.from('users').select('employee_id, name').in('employee_id', ids);
    nameMap = new Map((users || []).map((u) => [u.employee_id, u.name]));
  }

  return NextResponse.json({
    items: (leaves || []).map((l) => ({ ...l, employeeName: nameMap.get(l.employee_id) || l.employee_id })),
  });
}

/**
 * POST /api/me/team-leave — หัวหน้าอนุมัติ/ปฏิเสธใบลาของลูกทีม (ลำดับแรก ก่อนส่ง HR)
 * Body: { id, action: 'approve'|'reject' }
 */
export async function POST(request) {
  const { user, error, status } = requireAuth(request);
  if (error) return NextResponse.json({ error }, { status });

  const { id, action } = await request.json();
  if (action !== 'approve' && action !== 'reject') {
    return NextResponse.json({ error: 'action ไม่ถูกต้อง' }, { status: 400 });
  }

  // ต้องเป็นหัวหน้าของใบลานี้จริง และยังรออนุมัติ
  const { data: leave } = await supabase.from('leave_requests').select('*').eq('id', id).maybeSingle();
  if (!leave) return NextResponse.json({ error: 'ไม่พบใบลา' }, { status: 404 });
  if (leave.manager_id !== user.employeeId) {
    return NextResponse.json({ error: 'คุณไม่ใช่หัวหน้าของใบลานี้' }, { status: 403 });
  }
  if (leave.manager_status !== 'pending') {
    return NextResponse.json({ error: 'ใบลานี้ดำเนินการไปแล้ว' }, { status: 409 });
  }

  const updates = action === 'approve'
    ? { manager_status: 'approved', manager_approved_at: new Date().toISOString() }
    : { manager_status: 'rejected', status: 'rejected', manager_approved_at: new Date().toISOString() };

  const { error: e } = await supabase.from('leave_requests').update(updates).eq('id', id).eq('manager_status', 'pending');
  if (e) return NextResponse.json({ error: e.message }, { status: 500 });

  await addAuditEntry({
    user: user.name,
    action: `หัวหน้า${action === 'approve' ? 'อนุมัติ' : 'ปฏิเสธ'}ใบลา ${leave.employee_id} (${leave.leave_type} ${leave.days} วัน)`,
    channel: 'ME',
  });

  return NextResponse.json({ success: true });
}
