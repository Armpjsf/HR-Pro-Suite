import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { addAuditEntry } from '@/lib/db';
import { createNotification, notifyHr } from '@/lib/notifications';
import { validDate, LEAVE_SESSIONS } from '@/lib/leave-policy';

export async function POST(request) {
  const { user, error, status } = await requireAuth(request);
  if (error) return NextResponse.json({ error }, { status });
  const { leave_type, start_date, end_date, session = 'full', reason = '' } = await request.json();
  if (!validDate(start_date) || !validDate(end_date) || start_date > end_date || !LEAVE_SESSIONS.includes(session)) {
    return NextResponse.json({ error: 'กรุณาระบุวันที่และช่วงเวลาการลาให้ถูกต้อง' }, { status: 400 });
  }
  const { data: item, error: dbError } = await supabase.rpc('submit_leave_request', {
    p_employee: user.employeeId, p_type: leave_type, p_start: start_date, p_end: end_date,
    p_session: session, p_reason: String(reason).trim().slice(0, 4000),
  });
  if (dbError) return NextResponse.json({ error: dbError.code === 'P0001' ? dbError.message : 'ไม่สามารถยื่นใบลาได้ กรุณาตรวจการเชื่อมต่อและ migration แล้วลองใหม่' }, { status: dbError.code === 'P0001' ? 409 : 503 });
  try {
    await addAuditEntry({ user: user.name, action: `ยื่นใบลา #${item.id} ${leave_type} ${item.days} วัน (${session})`, channel: 'ME' });
    if (item.manager_id) {
      await createNotification({ employeeId: item.manager_id, title: 'มีใบลารอหัวหน้าอนุมัติ', body: `${user.name} ยื่นใบลา ${item.days} วัน`, url: '/me#more/teamleave', type: 'leave_manager_pending', audience: 'manager' });
    } else {
      await notifyHr('leave', { title: 'มีใบลารอ HR อนุมัติ', body: `${user.name} ยื่นใบลา ${item.days} วัน`, url: '/hr/leave', type: 'leave_pending' });
    }
  } catch (e) { console.error('[leave] notification/audit failed after submission:', e.message); }
  return NextResponse.json({ item });
}
