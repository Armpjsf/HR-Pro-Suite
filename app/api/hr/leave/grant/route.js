import { NextResponse } from 'next/server';
import { requireMenu } from '@/lib/hr-access';
import { supabase } from '@/lib/supabase';
import { addAuditEntry } from '@/lib/db';
import { currentLeaveYear } from '@/lib/leave-balances';

/**
 * POST /api/hr/leave/grant — แจกสิทธิ์ลาประจำปีอัตโนมัติ
 * Body: { year? }
 * สร้างยอดโควต้า (employee_leave_balances) ให้พนักงาน active ทุกคน
 * ตาม days_per_year ของประเภทลาที่ตัดยอด (deduct_balance) — เฉพาะคนที่ยังไม่มียอดของปีนั้น
 * ไม่ทับยอดที่ HR ตั้งเองไว้แล้ว
 */
export async function POST(request) {
  const { user, error, status } = await requireMenu(request, 'leave');
  if (error) return NextResponse.json({ error }, { status });

  const body = await request.json().catch(() => ({}));
  const year = Number(body.year) || currentLeaveYear();

  const [{ data: users, error: uErr }, { data: leaveTypes, error: ltErr }, { data: existing, error: exErr }] = await Promise.all([
    supabase.from('users').select('employee_id, status'),
    supabase.from('leave_types').select('code, name, days_per_year, deduct_balance').eq('deduct_balance', true),
    supabase.from('employee_leave_balances').select('employee_id, leave_type').eq('year', year),
  ]);
  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });
  if (ltErr) return NextResponse.json({ error: ltErr.message }, { status: 500 });
  if (exErr) return NextResponse.json({ error: exErr.message }, { status: 500 });

  const grantTypes = (leaveTypes || []).filter((t) => Number(t.days_per_year) > 0);
  if (grantTypes.length === 0) {
    return NextResponse.json({
      error: 'ยังไม่มีประเภทลาที่กำหนด "สิทธิ์ต่อปี" ไว้ — ตั้งค่า days_per_year ที่เมนูตั้งค่าประเภทการลาก่อน',
    }, { status: 400 });
  }

  const existSet = new Set((existing || []).map((r) => `${r.employee_id}|${r.leave_type}`));
  const activeUsers = (users || []).filter((u) => !u.status || u.status === 'active');

  const rows = [];
  for (const u of activeUsers) {
    for (const t of grantTypes) {
      if (existSet.has(`${u.employee_id}|${t.code}`)) continue;
      rows.push({
        employee_id: u.employee_id,
        leave_type: t.code,
        year,
        total_days: Number(t.days_per_year),
        used_days: 0,
        note: `แจกอัตโนมัติปี ${year}`,
        updated_at: new Date().toISOString(),
      });
    }
  }

  if (rows.length > 0) {
    const { error: insErr } = await supabase.from('employee_leave_balances').insert(rows);
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  await addAuditEntry({
    user: user.name,
    action: `แจกสิทธิ์ลาประจำปี ${year} (${rows.length} รายการ, ${activeUsers.length} พนักงาน)`,
    channel: 'HR',
  });

  return NextResponse.json({
    success: true,
    year,
    granted: rows.length,
    employees: activeUsers.length,
    types: grantTypes.map((t) => `${t.name} ${t.days_per_year} วัน`),
  });
}
