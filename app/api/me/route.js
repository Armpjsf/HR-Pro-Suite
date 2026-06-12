import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

/**
 * GET /api/me — ข้อมูล self-service ของพนักงานที่ login อยู่ (ทุก role)
 * เห็นเฉพาะข้อมูลของตัวเองเท่านั้น
 */
export async function GET(request) {
  const { user, error, status } = requireAuth(request);
  if (error) return NextResponse.json({ error }, { status });

  const employeeId = user.employeeId;
  const monthStart = new Date().toISOString().slice(0, 7) + '-01';

  const [record, leaves, slips, shifts, announcements, todayClockResult] = await Promise.all([
    supabase.from('employee_records').select('*').eq('employee_id', employeeId).maybeSingle(),
    supabase.from('leave_requests').select('*').eq('employee_id', employeeId).order('created_at', { ascending: false }).limit(20),
    supabase.from('payroll_slips').select('*').eq('employee_id', employeeId).order('period', { ascending: false }).limit(12),
    supabase.from('shifts').select('*').eq('employee_id', employeeId).gte('shift_date', monthStart).order('shift_date'),
    supabase.from('announcements').select('*').order('pinned', { ascending: false }).order('created_at', { ascending: false }).limit(10),
    supabase.from('time_records').select('*').eq('employee_id', employeeId).eq('work_date', new Date().toISOString().slice(0, 10)).maybeSingle(),
  ]);

  const rec = record.data || {};
  const leaveBalance = {
    annual: {
      total: Number(rec.leave_annual_total) || 0,
      used: Number(rec.leave_annual_used) || 0,
    },
    sick: {
      total: Number(rec.leave_sick_total) || 0,
      used: Number(rec.leave_sick_used) || 0,
    },
    personal: {
      total: Number(rec.leave_personal_total) || 0,
      used: Number(rec.leave_personal_used) || 0,
    },
  };
  for (const key of Object.keys(leaveBalance)) {
    leaveBalance[key].remaining = leaveBalance[key].total - leaveBalance[key].used;
  }

  return NextResponse.json({
    profile: {
      employeeId,
      name: user.name,
      department: user.department || '',
      position: rec.position || '',
      startDate: rec.start_date || '',
      avatar: user.avatar || '👤',
    },
    leaveBalance,
    leaves: leaves.data || [],
    payslips: slips.data || [],
    shifts: shifts.data || [],
    announcements: announcements.data || [],
    todayClock: todayClockResult.data || null,
  });
}
