import { NextResponse } from 'next/server';
import { requireMenu } from '@/lib/hr-access';
import { supabase } from '@/lib/supabase';
import { addAuditEntry } from '@/lib/db';
import { createNotification } from '@/lib/notifications';

/**
 * POST /api/hr/asset-requests/[id]/action — { action: 'approve' | 'reject' | 'deliver' }
 * approve(borrow/replace) → จองทรัพย์สินให้พนักงาน + ย้ายไปสาขาที่ขอ
 * approve(return)        → คืนสถานะว่าง
 * deliver               → ทำเครื่องหมายจัดส่งแล้ว
 */
export async function POST(request, { params }) {
  const { user, error, status } = await requireMenu(request, 'assets');
  if (error) return NextResponse.json({ error }, { status });

  const { id } = await params;
  const { action } = await request.json();
  if (!['approve', 'reject', 'deliver'].includes(action)) {
    return NextResponse.json({ error: 'action ไม่ถูกต้อง' }, { status: 400 });
  }

  const { data: req } = await supabase.from('asset_requests').select('*').eq('id', id).maybeSingle();
  if (!req) return NextResponse.json({ error: 'ไม่พบคำขอ' }, { status: 404 });

  if (action === 'reject') {
    await supabase.from('asset_requests').update({ status: 'rejected', approved_by: user.name }).eq('id', id);
  } else if (action === 'deliver') {
    await supabase.from('asset_requests').update({ status: 'delivered' }).eq('id', id);
  } else {
    // approve
    if (req.type === 'return') {
      await supabase.from('assets').update({ status: 'available', assigned_to: null }).eq('id', req.asset_id);
    } else {
      // borrow / replace → จองให้พนักงาน + ย้ายสาขา
      const upd = { status: 'assigned', assigned_to: req.employee_id, assigned_date: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }) };
      if (req.target_branch_id) upd.branch_id = req.target_branch_id;
      await supabase.from('assets').update(upd).eq('id', req.asset_id);
    }
    await supabase.from('asset_requests').update({ status: 'approved', approved_by: user.name }).eq('id', id);
  }

  await addAuditEntry({
    user: user.name,
    action: `${action} คำขอทรัพย์สิน #${req.asset_id} (${req.type}) โดย ${req.employee_id}`,
    channel: 'HR',
  });

  await createNotification({
    employeeId: req.employee_id,
    title: action === 'approve' ? 'อนุมัติคำขอทรัพย์สินแล้ว' : action === 'reject' ? 'ปฏิเสธคำขอทรัพย์สิน' : 'จัดส่งทรัพย์สินแล้ว',
    body: `คำขอ ${req.type} ทรัพย์สิน #${req.asset_id} ถูกอัปเดตเป็น ${action}`,
    url: '/me',
    type: `asset_request_${action}`,
  });

  return NextResponse.json({ success: true });
}
