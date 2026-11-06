import { NextResponse } from 'next/server';
import { requireMenu } from '@/lib/hr-access';
import { supabase } from '@/lib/supabase';
import { createNotification, notifyHr } from '@/lib/notifications';
import { currentLeaveYear } from '@/lib/leave-balances';

const DAY = 86400000;
const fmt = (d) => d.toISOString().slice(0, 10);

function daysToAnniversary(dateStr, today) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  const next = new Date(today.getFullYear(), d.getMonth(), d.getDate());
  if (next < today) next.setFullYear(today.getFullYear() + 1);
  return Math.round((next - today) / DAY);
}

async function computeAlerts(branchId = 'all') {
  const today = new Date(fmt(new Date()));
  const in30 = fmt(new Date(today.getTime() + 30 * DAY));
  const todayStr = fmt(today);
  const month = today.getMonth() + 1;
  const year = currentLeaveYear();

  const [{ data: users }, { data: records }, { data: balances }] = await Promise.all([
    supabase.from('users').select('employee_id, name, branch_id, manager_id, status'),
    supabase.from('employee_records').select('*'),
    supabase.from('employee_leave_balances').select('*').eq('year', year).eq('leave_type', 'annual'),
  ]);

  const activeUsers = (users || []).filter((u) => !u.status || u.status === 'active');
  const filteredUsers = branchId !== 'all'
    ? activeUsers.filter((u) => String(u.branch_id || '') === String(branchId))
    : activeUsers;

  const userMap = new Map(filteredUsers.map((u) => [u.employee_id, u]));
  const annualBalMap = new Map((balances || []).map((b) => [b.employee_id, b]));

  const probation = [], contract = [], license = [], birthday = [], anniversary = [], leaveYearEnd = [];

  for (const r of records || []) {
    const u = userMap.get(r.employee_id);
    if (!u) continue;
    const name = u.name || r.employee_id;

    if (r.probation_end && r.probation_end >= todayStr && r.probation_end <= in30) {
      const daysLeft = Math.round((new Date(r.probation_end) - today) / DAY);
      probation.push({ employeeId: r.employee_id, name, date: r.probation_end, daysLeft, managerId: u.manager_id });
    }

    if (r.contract_end && r.contract_end <= in30) {
      const daysLeft = Math.round((new Date(r.contract_end) - today) / DAY);
      contract.push({ employeeId: r.employee_id, name, date: r.contract_end, daysLeft, expired: r.contract_end < todayStr, managerId: u.manager_id });
    }

    if (r.license_expiry && r.license_expiry <= in30) {
      const daysLeft = Math.round((new Date(r.license_expiry) - today) / DAY);
      license.push({ employeeId: r.employee_id, name, date: r.license_expiry, daysLeft, expired: r.license_expiry < todayStr, managerId: u.manager_id });
    }

    const dBirth = daysToAnniversary(r.birth_date, today);
    if (dBirth !== null && dBirth <= 7) birthday.push({ employeeId: r.employee_id, name, inDays: dBirth, date: r.birth_date });

    const dAnniv = daysToAnniversary(r.start_date, today);
    if (dAnniv !== null && dAnniv <= 7 && r.start_date) {
      const years = today.getFullYear() - new Date(r.start_date).getFullYear();
      if (years >= 1) anniversary.push({ employeeId: r.employee_id, name, inDays: dAnniv, years });
    }

    // เตือนใช้สิทธิ์ลาพักร้อนก่อนสิ้นปี (เฉพาะ พ.ย.-ธ.ค.) จากตาราง employee_leave_balances จริง
    if (month >= 11) {
      const bal = annualBalMap.get(r.employee_id);
      const total = bal ? Number(bal.total_days) || 0 : Number(r.leave_annual_total) || 0;
      const used = bal ? Number(bal.used_days) || 0 : Number(r.leave_annual_used) || 0;
      const remaining = total - used;
      if (remaining > 0) leaveYearEnd.push({ employeeId: r.employee_id, name, remaining });
    }
  }

  const totalCount = probation.length + contract.length + license.length + birthday.length + anniversary.length + leaveYearEnd.length;
  return { totalCount, alerts: { probation, contract, license, birthday, anniversary, leaveYearEnd } };
}

/**
 * GET /api/hr/alerts — รวมแจ้งเตือนอัตโนมัติสำหรับ HR (รองรับ ?branchId=)
 */
export async function GET(request) {
  const { error, status } = await requireMenu(request, 'dashboard');
  if (error) return NextResponse.json({ error }, { status });

  const url = new URL(request.url);
  const branchId = url.searchParams.get('branchId') || 'all';
  const result = await computeAlerts(branchId);
  return NextResponse.json(result);
}

/**
 * POST /api/hr/alerts — ส่ง Push Notification & In-App Notification เชิงรุกให้พนักงาน หัวหน้างาน และ HR
 * (แจ้งเตือนใบขับขี่ใกล้หมดอายุ, ครบกำหนดทดลองงาน, สัญญาจ้างใกล้หมด, และวันลาพักร้อนคงเหลือปลายปี)
 */
export async function POST(request) {
  const { error, status } = await requireMenu(request, 'dashboard');
  if (error) return NextResponse.json({ error }, { status });

  const body = await request.json().catch(() => ({}));
  const branchId = body.branchId || 'all';
  const { alerts } = await computeAlerts(branchId);

  let sentCount = 0;

  // 1. แจ้งเตือนใบอนุญาตขับขี่ใกล้หมด/หมดอายุ -> แจ้งพนักงาน + หัวหน้า + HR
  for (const item of alerts.license) {
    const statusText = item.expired ? 'หมดอายุแล้ว!' : `จะหมดอายุในอีก ${item.daysLeft} วัน (${item.date})`;
    await createNotification({
      employeeId: item.employeeId,
      title: '🚨 แจ้งเตือนใบอนุญาตขับขี่',
      body: `ใบอนุญาตขับขี่ของคุณ${statusText} กรุณาติดต่อต่ออายุและแจ้ง HR`,
      url: '/me',
      type: 'license_alert',
    });
    sentCount++;

    if (item.managerId) {
      await createNotification({
        employeeId: item.managerId,
        title: '🚗 ใบขับขี่ลูกทีมใกล้หมดอายุ',
        body: `${item.name} (${item.employeeId}) ใบขับขี่${statusText}`,
        url: '/me',
        type: 'license_alert_manager',
      });
      sentCount++;
    }
  }

  // 2. แจ้งเตือนครบกำหนดทดลองงาน -> แจ้งหัวหน้างาน + HR เพื่อประเมินบรรจุ
  for (const item of alerts.probation) {
    if (item.managerId) {
      await createNotification({
        employeeId: item.managerId,
        title: '⏳ แจ้งเตือนประเมินผ่านทดลองงาน',
        body: `${item.name} จะครบกำหนดทดลองงานวันที่ ${item.date} (อีก ${item.daysLeft} วัน)`,
        url: '/hr/evaluation',
        type: 'probation_alert',
      });
      sentCount++;
    }
  }

  // 3. แจ้งเตือนสัญญาจ้างใกล้หมด -> แจ้งพนักงาน + หัวหน้า
  for (const item of alerts.contract) {
    const statusText = item.expired ? 'สิ้นสุดแล้ว' : `จะสิ้นสุดวันที่ ${item.date}`;
    await createNotification({
      employeeId: item.employeeId,
      title: '📄 แจ้งเตือนสัญญาจ้างงาน',
      body: `สัญญาจ้างของคุณ${statusText} กรุณาติดต่อฝ่ายบุคคล`,
      url: '/me',
      type: 'contract_alert',
    });
    sentCount++;
  }

  // 4. แจ้งเตือนวันลาพักร้อนคงเหลือปลายปี -> แจ้งพนักงาน
  for (const item of alerts.leaveYearEnd) {
    await createNotification({
      employeeId: item.employeeId,
      title: '🏖️ แจ้งเตือนสิทธิ์ลาพักร้อนคงเหลือ',
      body: `คุณมีวันลาพักร้อนคงเหลือ ${item.remaining} วันก่อนสิ้นปี สามารถวางแผนยื่นลาได้ที่หน้าบริการตนเอง`,
      url: '/me',
      type: 'leave_yearend_alert',
    });
    sentCount++;
  }

  // 5. สรุปรวมแจ้ง HR ถ้ามีรายการสำคัญ
  const criticalTotal = alerts.license.length + alerts.probation.length + alerts.contract.length;
  if (criticalTotal > 0) {
    await notifyHr('employees', {
      title: `🔔 สรุปแจ้งเตือนสำคัญ (${criticalTotal} รายการ)`,
      body: `ใบขับขี่ใกล้หมด ${alerts.license.length} · ทดลองงาน ${alerts.probation.length} · สัญญาจ้าง ${alerts.contract.length} รายการ`,
      url: '/hr',
      type: 'hr_proactive_summary',
    });
    sentCount++;
  }

  return NextResponse.json({
    success: true,
    sentCount,
    message: `ส่ง Push & In-App Notification แจ้งเตือนผู้เกี่ยวข้องสำเร็จ (${sentCount} รายการ)`,
  });
}
