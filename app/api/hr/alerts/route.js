import { NextResponse } from 'next/server';
import { requireMenu } from '@/lib/hr-access';
import { supabase } from '@/lib/supabase';

const DAY = 86400000;
const fmt = (d) => d.toISOString().slice(0, 10);

// จำนวนวันจนถึงวันเกิด/ครบรอบ (เดือน-วัน) ที่ใกล้ที่สุดในอนาคต
function daysToAnniversary(dateStr, today) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  const next = new Date(today.getFullYear(), d.getMonth(), d.getDate());
  if (next < today) next.setFullYear(today.getFullYear() + 1);
  return Math.round((next - today) / DAY);
}

/**
 * GET /api/hr/alerts — รวมแจ้งเตือนอัตโนมัติสำหรับ HR
 */
export async function GET(request) {
  const { error, status } = await requireMenu(request, 'dashboard');
  if (error) return NextResponse.json({ error }, { status });

  const today = new Date(fmt(new Date()));
  const in30 = fmt(new Date(today.getTime() + 30 * DAY));
  const todayStr = fmt(today);
  const month = today.getMonth() + 1;

  const [{ data: users }, { data: records }] = await Promise.all([
    supabase.from('users').select('employee_id, name'),
    supabase.from('employee_records').select('*'),
  ]);
  const nameMap = new Map((users || []).map((u) => [u.employee_id, u.name]));

  const probation = [], contract = [], license = [], birthday = [], anniversary = [], leaveYearEnd = [];

  for (const r of records || []) {
    const name = nameMap.get(r.employee_id) || r.employee_id;

    if (r.probation_end && r.probation_end >= todayStr && r.probation_end <= in30)
      probation.push({ employeeId: r.employee_id, name, date: r.probation_end });

    if (r.contract_end && r.contract_end <= in30)
      contract.push({ employeeId: r.employee_id, name, date: r.contract_end, expired: r.contract_end < todayStr });

    if (r.license_expiry && r.license_expiry <= in30)
      license.push({ employeeId: r.employee_id, name, date: r.license_expiry, expired: r.license_expiry < todayStr });

    const dBirth = daysToAnniversary(r.birth_date, today);
    if (dBirth !== null && dBirth <= 7) birthday.push({ employeeId: r.employee_id, name, inDays: dBirth, date: r.birth_date });

    const dAnniv = daysToAnniversary(r.start_date, today);
    if (dAnniv !== null && dAnniv <= 7 && r.start_date) {
      const years = today.getFullYear() - new Date(r.start_date).getFullYear();
      if (years >= 1) anniversary.push({ employeeId: r.employee_id, name, inDays: dAnniv, years });
    }

    // เตือนใช้สิทธิ์ลาพักร้อนก่อนสิ้นปี (เฉพาะ พ.ย.-ธ.ค.)
    if (month >= 11) {
      const remaining = (Number(r.leave_annual_total) || 0) - (Number(r.leave_annual_used) || 0);
      if (remaining > 0) leaveYearEnd.push({ employeeId: r.employee_id, name, remaining });
    }
  }

  const totalCount = probation.length + contract.length + license.length + birthday.length + anniversary.length + leaveYearEnd.length;

  return NextResponse.json({
    totalCount,
    alerts: { probation, contract, license, birthday, anniversary, leaveYearEnd },
  });
}
