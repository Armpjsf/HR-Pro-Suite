import { NextResponse } from 'next/server';
import { requireMenu } from '@/lib/hr-access';
import { supabase } from '@/lib/supabase';
import { addAuditEntry } from '@/lib/db';
import { createNotification } from '@/lib/notifications';

export async function POST(request, { params }) {
  const { user, error, status } = await requireMenu(request, 'leave');
  if (error) return NextResponse.json({ error }, { status });
  const { id } = await params;
  const { action } = await request.json();
  if (!['approve', 'reject'].includes(action)) return NextResponse.json({ error: 'การดำเนินการไม่ถูกต้อง' }, { status: 400 });
  const { data: item, error: dbError } = await supabase.rpc('review_leave_request', { p_id: id, p_action: action, p_reviewer: user.name }).single();
  if (dbError) return NextResponse.json({ error: dbError.code === 'P0001' ? dbError.message : 'ไม่สามารถบันทึกการพิจารณาได้ กรุณาตรวจ migration และลองใหม่' }, { status: dbError.code === 'P0001' ? 409 : 503 });
  try {
    await addAuditEntry({ user: user.name, action: `${action} ใบลา #${id} ${item.employee_id} ${item.days} วัน`, channel: 'HR' });
    await createNotification({ employeeId: item.employee_id, title: action === 'approve' ? 'HR อนุมัติใบลาแล้ว' : 'HR ปฏิเสธใบลา', body: `ใบลา ${item.days} วัน สถานะ: ${item.status}`, url: '/me#leave', type: `leave_${item.status}` });
  } catch (e) { console.error('[leave] notification/audit failed after review:', e.message); }
  return NextResponse.json({ success: true, status: item.status });
}
