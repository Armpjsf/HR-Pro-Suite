import { NextResponse } from 'next/server';
import { requireMenu } from '@/lib/hr-access';
import { supabase } from '@/lib/supabase';
import { getLineMappings, findUserByEmployeeId, addAuditEntry } from '@/lib/db';

const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';

function fmt(n) {
  return Number(n || 0).toLocaleString('th-TH');
}

/**
 * POST /api/hr/payroll/[id]/notify — ส่งสลิปเงินเดือนให้พนักงานทาง LINE
 */
export async function POST(request, { params }) {
  const { user, error, status } = await requireMenu(request, 'payroll');
  if (error) return NextResponse.json({ error }, { status });

  const { id } = await params;

  const { data: slip, error: findErr } = await supabase
    .from('payroll_slips')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (findErr) return NextResponse.json({ error: findErr.message }, { status: 500 });
  if (!slip) return NextResponse.json({ error: 'ไม่พบสลิปเงินเดือน' }, { status: 404 });

  // หา LINE user id ของพนักงานคนนี้
  const mappings = await getLineMappings();
  const lineUserId = Object.keys(mappings).find(
    (key) => mappings[key].employeeId === slip.employee_id
  );
  if (!lineUserId) {
    return NextResponse.json(
      { error: `พนักงาน ${slip.employee_id} ยังไม่ได้ลงทะเบียน LINE — ให้พนักงานพิมพ์ "ลงทะเบียน ${slip.employee_id}" ใน LINE ก่อน` },
      { status: 400 }
    );
  }

  const emp = await findUserByEmployeeId(slip.employee_id);
  const text =
    `💰 สลิปเงินเดือน งวด ${slip.period}\n` +
    `คุณ${emp?.name || slip.employee_id}\n\n` +
    `เงินเดือนฐาน: ${fmt(slip.base_salary)} บาท\n` +
    `ค่าล่วงเวลา (OT): +${fmt(slip.ot_pay)} บาท\n` +
    `โบนัส: +${fmt(slip.bonus)} บาท\n` +
    `หัก: -${fmt(slip.deduction)} บาท\n` +
    `━━━━━━━━━━━━\n` +
    `รับสุทธิ: ${fmt(slip.net)} บาท`;

  if (!LINE_CHANNEL_ACCESS_TOKEN) {
    console.log('[LINE Mock] Push payslip:', text);
  } else {
    const res = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({ to: lineUserId, messages: [{ type: 'text', text }] }),
    });
    if (!res.ok) {
      const detail = await res.text();
      return NextResponse.json({ error: `ส่ง LINE ไม่สำเร็จ: ${detail}` }, { status: 502 });
    }
  }

  await supabase
    .from('payroll_slips')
    .update({ status: 'notified', notified_at: new Date().toISOString() })
    .eq('id', id);

  await addAuditEntry({
    user: user.name,
    action: `แจ้งสลิปเงินเดือน ${slip.employee_id} งวด ${slip.period} ทาง LINE`,
    channel: 'HR',
  });

  return NextResponse.json({ success: true });
}
