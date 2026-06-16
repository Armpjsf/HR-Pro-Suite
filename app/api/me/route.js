import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { currentLeaveYear, formatLeaveBalanceMap, legacyLeaveRows } from '@/lib/leave-balances';
import { getWorkSettingsForEmployee } from '@/lib/work-calendar';

function addDays(dateString, days) {
  const [y, m, d] = dateString.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

function dayOfWeek(dateString) {
  const [y, m, d] = dateString.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function isDateInLeave(dateString, leaves) {
  return leaves.some((leave) => leave.start_date <= dateString && leave.end_date >= dateString);
}

function buildAttendanceStats({ records, shifts, holidays, approvedLeaves, workSettings, startDate, today }) {
  const recordByDate = new Map((records || []).map((r) => [r.work_date, r]));
  const shiftByDate = new Map((shifts || []).map((s) => [s.shift_date, s]));
  const holidayDates = new Set((holidays || []).map((h) => h.holiday_date));
  const workDays = new Set(String(workSettings?.work_days || '1,2,3,4,5').split(',').filter(Boolean).map(Number));
  const absentDates = new Set((records || []).filter((r) => r.status === 'absent').map((r) => r.work_date));
  let plannedDays = 0;

  for (let date = startDate; date <= today; date = addDays(date, 1)) {
    const shift = shiftByDate.get(date);
    const isPlannedWork = shift ? shift.shift_type !== 'off' : (workDays.has(dayOfWeek(date)) && !holidayDates.has(date));
    if (!isPlannedWork) continue;
    plannedDays += 1;
    if (!recordByDate.has(date) && !isDateInLeave(date, approvedLeaves || [])) {
      absentDates.add(date);
    }
  }

  return {
    month: startDate.slice(0, 7),
    plannedDays,
    onTime: (records || []).filter((r) => r.status === 'normal').length,
    late: (records || []).filter((r) => r.status === 'late').length,
    absent: absentDates.size,
  };
}

/**
 * GET /api/me — ข้อมูล self-service ของพนักงานที่ login อยู่ (ทุก role)
 * เห็นเฉพาะข้อมูลของตัวเองเท่านั้น
 */
export async function GET(request) {
  const { user, error, status } = requireAuth(request);
  if (error) return NextResponse.json({ error }, { status });

  const employeeId = user.employeeId;
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
  const monthStart = today.slice(0, 7) + '-01';

  const year = currentLeaveYear();
  const { data: me } = await supabase
    .from('users')
    .select('branch_id')
    .eq('employee_id', employeeId)
    .maybeSingle();
  const branchId = me?.branch_id ?? null;

  let holidayQuery = supabase
    .from('holidays')
    .select('holiday_date')
    .gte('holiday_date', monthStart)
    .lte('holiday_date', today);
  holidayQuery = branchId ? holidayQuery.or(`branch_id.is.null,branch_id.eq.${branchId}`) : holidayQuery.is('branch_id', null);

  const [record, leaves, slips, shifts, announcements, todayClockResult, leaveTypes, leaveRows, attendance, holidays, workSettings, approvedLeaves] = await Promise.all([
    supabase.from('employee_records').select('*').eq('employee_id', employeeId).maybeSingle(),
    supabase.from('leave_requests').select('*').eq('employee_id', employeeId).order('created_at', { ascending: false }).limit(20),
    supabase
      .from('payroll_slips')
      .select('*')
      .eq('employee_id', employeeId)
      .in('status', ['paid', 'notified'])
      .order('period', { ascending: false })
      .limit(12),
    supabase.from('shifts').select('*').eq('employee_id', employeeId).gte('shift_date', monthStart).order('shift_date'),
    supabase.from('announcements').select('*').order('pinned', { ascending: false }).order('created_at', { ascending: false }).limit(10),
    supabase.from('time_records').select('*').eq('employee_id', employeeId).eq('work_date', today).maybeSingle(),
    supabase.from('leave_types').select('*').order('code'),
    supabase.from('employee_leave_balances').select('*').eq('employee_id', employeeId).eq('year', year),
    supabase.from('time_records').select('*').eq('employee_id', employeeId).gte('work_date', monthStart).lte('work_date', today),
    holidayQuery,
    getWorkSettingsForEmployee(employeeId),
    supabase
      .from('leave_requests')
      .select('start_date, end_date')
      .eq('employee_id', employeeId)
      .eq('status', 'approved')
      .lte('start_date', today)
      .gte('end_date', monthStart),
  ]);

  // เป็นหัวหน้าหรือไม่ (มีลูกทีมที่ตั้ง manager_id เป็นเรา)
  const { count: reportCount } = await supabase
    .from('users')
    .select('*', { count: 'exact', head: true })
    .eq('manager_id', employeeId);

  const rec = record.data || {};
  const balanceRows = leaveRows.data?.length ? leaveRows.data : legacyLeaveRows(employeeId, rec, year);
  const leaveBalance = formatLeaveBalanceMap(balanceRows, leaveTypes.data || []);
  const attendanceStats = buildAttendanceStats({
    records: attendance.data || [],
    shifts: shifts.data || [],
    holidays: holidays.data || [],
    approvedLeaves: approvedLeaves.data || [],
    workSettings,
    startDate: monthStart,
    today,
  });

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
    attendanceStats,
    isManager: (reportCount || 0) > 0,
  });
}
