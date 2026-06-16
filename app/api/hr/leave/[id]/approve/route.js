import { NextResponse } from 'next/server';
import { requireMenu } from '@/lib/hr-access';
import { supabase } from '@/lib/supabase';
import { addAuditEntry } from '@/lib/db';

const LEAVE_COL = {
  annual: 'leave_annual_used',
  sick: 'leave_sick_used',
  personal: 'leave_personal_used',
};

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

  const newStatus = action === 'approve' ? 'approved' : 'rejected';
  const { error: updErr } = await supabase
    .from('leave_requests')
    .update({ status: newStatus, approved_by: user.name, approved_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'pending');
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  if (action === 'approve') {
    const col = LEAVE_COL[req.leave_type];
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
  }

  await addAuditEntry({
    user: user.name,
    action: `${action === 'approve' ? 'อนุมัติ' : 'ปฏิเสธ'}ใบลา ${req.employee_id} (${req.leave_type} ${req.days} วัน)`,
    channel: 'HR',
  });

  return NextResponse.json({ success: true, status: newStatus });
}
