import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { addAuditEntry } from '@/lib/db';

const VALID_TYPES = ['annual', 'sick', 'personal'];

/**
 * POST /api/me/leave — พนักงานยื่นใบลาของตัวเอง (status = pending รอ HR อนุมัติ)
 */
export async function POST(request) {
  const { user, error, status } = requireAuth(request);
  if (error) return NextResponse.json({ error }, { status });

  const body = await request.json();
  const { leave_type, start_date, end_date, days, reason } = body;

  if (!VALID_TYPES.includes(leave_type)) {
    return NextResponse.json({ error: 'ประเภทการลาไม่ถูกต้อง' }, { status: 400 });
  }
  if (!start_date || !end_date || !days || Number(days) <= 0) {
    return NextResponse.json({ error: 'กรุณาระบุวันที่และจำนวนวันให้ครบ' }, { status: 400 });
  }

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
    })
    .select()
    .single();
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  await addAuditEntry({
    user: user.name,
    action: `ยื่นใบลา ${leave_type} ${days} วัน (${start_date})`,
    channel: 'ME',
  });

  return NextResponse.json({ item: data });
}
