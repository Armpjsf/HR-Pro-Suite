import { runIntegrationOutbox } from '@/lib/integration-outbox-worker';
import { after, NextResponse } from 'next/server';
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

  const { data: slips, error: payError } = await supabase.rpc('confirm_payroll_payment', {
    p_period: period || null, p_slip_id: slipId || null,
  });
  if (payError) return NextResponse.json({ error: payError.code === 'P0001' && /ยอด OT|RECALCULATION_REQUIRED/.test(payError.message) ? payError.message : 'ยืนยันจ่ายไม่สำเร็จ กรุณาตรวจสลิปเดิมและ migration ก่อนลองใหม่' }, { status: 409 });
  try { after(async () => { try { await runIntegrationOutbox(); } catch { console.error('[payroll] TMS sync queued for retry'); } }); } catch { /* Test environments may not provide request lifecycle hooks. */ }
  if (!slips?.length) return NextResponse.json({ success: true, count: 0, inAppSentCount: 0, lineSentCount: 0, message: 'ไม่มีรายการใหม่ที่ต้องยืนยันจ่าย' });

  let lineMappings = {};
  try { lineMappings = await getLineMappings(); } catch { console.error('[payroll] payment committed; LINE mapping lookup failed'); }
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
          `• ค่าขับรถ/ค่าเที่ยว (TMS): +${fmt(slip.driving_pay)} บาท\n` +
          `• คืนค่าใช้จ่าย: +${fmt(slip.reimbursements)} บาท\n` +
          `• หักประกันสังคม: -${fmt(slip.sso)} บาท\n` +
          `• หักภาษี ณ ที่จ่าย: -${fmt(slip.tax)} บาท\n` +
          `• หักอื่นๆ: -${fmt(slip.deduction)} บาท\n` +
          `━━━━━━━━━━━━\n` +
          `💵 รับสุทธิ: ${netFormatted} บาท\n\n` +
          `📄 สามารถเปิดดูสลิปฉบับเต็มและดาวน์โหลดใบ 50 ทวิ ได้ที่เมนู "เงินเดือน" ในระบบพนักงานได้ทันทีค่ะ`;

        const lineResponse = await fetch('https://api.line.me/v2/bot/message/push', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
          },
          body: JSON.stringify({ to: lineUserId, messages: [{ type: 'text', text }] }),
        });
        if (!lineResponse.ok) throw new Error('LINE delivery failed');
        await supabase.from('payroll_slips').update({ notification_status: 'sent', notified_at: new Date().toISOString() }).eq('id', slip.id);
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
    message: `ยืนยันจ่าย ${slips.length} รายการ แจ้งในแอพ ${inAppSentCount} รายการ ส่ง LINE ${lineSentCount} รายการ`,
  });
}

export const maxDuration = 60;
