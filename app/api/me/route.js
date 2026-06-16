import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { currentLeaveYear, formatLeaveBalanceMap, legacyLeaveRows } from '@/lib/leave-balances';

/**
 * GET /api/me — ข้อมูล self-service ของพนักงานที่ login อยู่ (ทุก role)
 * เห็นเฉพาะข้อมูลของตัวเองเท่านั้น
 */
export async function GET(request) {
  const { user, error, status } = requireAuth(request);
  if (error) return NextResponse.json({ error }, { status });

  const employeeId = user.employeeId;
  const monthStart = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }).slice(0, 7) + '-01';

  const year = currentLeaveYear();
  const [record, leaves, slips, shifts, announcements, todayClockResult, leaveTypes, leaveRows] = await Promise.all([
    supabase.from('employee_records').select('*').eq('employee_id', employeeId).maybeSingle(),
    supabase.from('leave_requests').select('*').eq('employee_id', employeeId).order('created_at', { ascending: false }).limit(20),
    supabase.from('payroll_slips').select('*').eq('employee_id', employeeId).order('period', { ascending: false }).limit(12),
    supabase.from('shifts').select('*').eq('employee_id', employeeId).gte('shift_date', monthStart).order('shift_date'),
    supabase.from('announcements').select('*').order('pinned', { ascending: false }).order('created_at', { ascending: false }).limit(10),
    supabase.from('time_records').select('*').eq('employee_id', employeeId).eq('work_date', new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })).maybeSingle(),
    supabase.from('leave_types').select('*').order('code'),
    supabase.from('employee_leave_balances').select('*').eq('employee_id', employeeId).eq('year', year),
  ]);

  // เป็นหัวหน้าหรือไม่ (มีลูกทีมที่ตั้ง manager_id เป็นเรา)
  const { count: reportCount } = await supabase
    .from('users')
    .select('*', { count: 'exact', head: true })
    .eq('manager_id', employeeId);

  const rec = record.data || {};
  const balanceRows = leaveRows.data?.length ? leaveRows.data : legacyLeaveRows(employeeId, rec, year);
  const leaveBalance = formatLeaveBalanceMap(balanceRows, leaveTypes.data || []);

  return NextResponse.json({
    profile: {
      employeeId,
      name: user.name,
      department: user.department || '',
      position: rec.position || '',
      startDate: rec.start_date || '',
      avatar: user.avatar || '👤',
      nationalId: rec.national_id || '',
      taxId: rec.tax_id || '',
      bankName: rec.bank_name || '',
      bankAccount: rec.bank_account || '',
    },
    leaveBalance,
    leaveTypes: leaveTypes.data || [],
    leaves: leaves.data || [],
    payslips: slips.data || [],
    shifts: shifts.data || [],
    announcements: announcements.data || [],
    todayClock: todayClockResult.data || null,
    isManager: (reportCount || 0) > 0,
  });
}
