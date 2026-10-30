import { NextResponse } from 'next/server';
import { requireMenu } from '@/lib/hr-access';
import { supabase } from '@/lib/supabase';
import { getLineMappings, findUserByEmployeeId, addAuditEntry } from '@/lib/db';
import { createNotification } from '@/lib/notifications';

const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';

function fmt(n) {
  return Number(n || 0).toLocaleString('th-TH');
}

export async function POST(request) {
  const { user, error, status } = await requireMenu(request, 'payroll');
  if (error) return NextResponse.json({ error }, { status });

  const body = await request.json();
  const { period, slipId } = body;

  let query = supabase.from('payroll_slips').select('*');
  if (slipId) {
    query = query.eq('id', slipId);
  } else if (period) {
    query = query.eq('period', period);
  } else {
    return NextResponse.json({ error: 'กรุณาระบุงวด (period) หรือ slipId' }, { status: 400 });
  }

  const { data: slips, error: fetchErr } = await query;
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!slips || slips.length === 0) {
    return NextResponse.json({ error: 'ไม่พบรายการสลิปเงินเดือน' }, { status: 404 });
  }

  const slipIds = slips.map((s) => s.id);
  const now = new Date().toISOString();

  // 1. ปรับสถานะเป็น 'paid' พร้อมเวลาจ่าย
  const { error: updateErr } = await supabase
    .from('payroll_slips')
    .update({ status: 'paid', paid_at: now })
    .in('id', slipIds);
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  const lineMappings = await getLineMappings();
  let lineSentCount = 0;
  let inAppSentCount = 0;

  // 2. ส่งแจ้งเตือนอัตโนมัติให้พนักงานทุกคน
  for (const slip of slips) {
    const netFormatted = fmt(slip.net);

    // 2.1 In-App Notification (เข้ากระดิ่งแจ้งเตือน & แอพมือถือ)
    try {
      await createNotification({
        employeeId: slip.employee_id,
        title: `💰 เงินเดือนงวด ${slip.period} เข้าบัญชีแล้ว`,
        body: `เงินเดือนสุทธิ ${netFormatted} บาท สลิปเงินเดือนและเอกสารภาษีพร้อมให้ตรวจสอบในระบบแล้วค่ะ`,
        url: '/me',
        type: 'payroll_paid',
        audience: 'employee',
      });
      inAppSentCount++;
    } catch (err) {
      console.warn('Failed in-app notify for:', slip.employee_id, err);
    }

    // 2.2 LINE Notification (ถ้าพนักงานผูก LINE ไว้)
    const lineUserId = Object.keys(lineMappings).find(
      (key) => lineMappings[key].employeeId === slip.employee_id
    );

    if (lineUserId && LINE_CHANNEL_ACCESS_TOKEN) {
      try {
        const emp = await findUserByEmployeeId(slip.employee_id);
        const text =
          `💰 เงินเดือนงวด ${slip.period} โอนเข้าบัญชีแล้ว\n` +
          `คุณ${emp?.name || slip.employee_id}\n\n` +
          `• เงินเดือนฐาน: ${fmt(slip.base_salary)} บาท\n` +
          `• ค่าล่วงเวลา (OT): +${fmt(slip.ot_pay)} บาท\n` +
          `• โบนัส/เบี้ยเลี้ยง: +${fmt(slip.bonus)} บาท\n` +
          `• หักประกันสังคม: -${fmt(slip.sso)} บาท\n` +
          `• หักภาษี ณ ที่จ่าย: -${fmt(slip.tax)} บาท\n` +
          `• หักอื่นๆ: -${fmt(slip.deduction)} บาท\n` +
          `━━━━━━━━━━━━\n` +
          `💵 รับสุทธิ: ${netFormatted} บาท\n\n` +
          `📄 สามารถเปิดดูสลิปฉบับเต็มและดาวน์โหลดใบ 50 ทวิ ได้ที่เมนู "เงินเดือน" ในระบบพนักงานได้ทันทีค่ะ`;

        await fetch('https://api.line.me/v2/bot/message/push', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
          },
          body: JSON.stringify({ to: lineUserId, messages: [{ type: 'text', text }] }),
        });
        lineSentCount++;
      } catch (err) {
        console.warn('Failed LINE push for:', slip.employee_id, err);
      }
    }
  }

  // 3. บันทึก Audit Log
  await addAuditEntry({
    user: user.name,
    action: `ยืนยันจ่ายเงินเดือนงวด ${period || slips[0]?.period} (${slips.length} คน, แจ้งในแอพ ${inAppSentCount}, แจ้ง LINE ${lineSentCount})`,
    channel: 'HR',
  });

  return NextResponse.json({
    success: true,
    count: slips.length,
    inAppSentCount,
    lineSentCount,
    message: `ยืนยันจ่ายเงินเดือนเรียบร้อยแล้ว (${slips.length} รายการ) ระบบได้ส่งสลิปและแจ้งเตือนพนักงานอัตโนมัติแล้วค่ะ`,
  });
}
