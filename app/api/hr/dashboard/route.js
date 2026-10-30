import { NextResponse } from 'next/server';
import { requireMenu } from '@/lib/hr-access';
import { supabase } from '@/lib/supabase';

/**
 * GET /api/hr/dashboard — สถิติรวมสำหรับหน้า Dashboard
 * เสริม: Real-time Attendance เข้างานวันนี้, สถิติแยกตามสาขา, และ Alerts ใบขับขี่คนขับรถ
 */
export async function GET(request) {
  const { error, status } = await requireMenu(request, 'dashboard');
  if (error) return NextResponse.json({ error }, { status });

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
  const period = today.slice(0, 7);

  const [
    employees,
    activeUsers,
    pendingLeave,
    pendingExpenses,
    openJobs,
    todayBookings,
    payrollRows,
    announcements,
    leaveList,
    todayTimes,
    branches,
    driverRecords,
  ] = await Promise.all([
    supabase.from('users').select('*', { count: 'exact', head: true }),
    supabase.from('users').select('id, employee_id, name, branch_id, status'),
    supabase.from('leave_requests').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase.from('expense_claims').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase.from('job_openings').select('*', { count: 'exact', head: true }).eq('status', 'open'),
    supabase.from('room_bookings').select('*', { count: 'exact', head: true }).eq('book_date', today),
    supabase.from('payroll_slips').select('net').eq('period', period),
    supabase.from('announcements').select('*').order('created_at', { ascending: false }).limit(5),
    supabase.from('leave_requests').select('*').eq('status', 'pending').order('created_at', { ascending: false }).limit(5),
    supabase.from('time_records').select('*').eq('work_date', today),
    supabase.from('branches').select('id, code, name'),
    supabase.from('employee_records').select('employee_id, position, license_expiry').not('license_expiry', 'is', null),
  ]);

  const payrollTotal = (payrollRows.data || []).reduce((sum, r) => sum + (Number(r.net) || 0), 0);

  // 1. คำนวณสถิติเข้างานวันนี้ (Real-Time Attendance)
  const totalEmployees = employees.count || 0;
  const times = todayTimes.data || [];
  let presentCount = 0;
  let lateCount = 0;
  let leaveCount = 0;

  for (const t of times) {
    if (t.status === 'leave') leaveCount++;
    else if (t.status === 'late') lateCount++;
    else if (t.clock_in) presentCount++;
  }
  const notInYet = Math.max(0, totalEmployees - (presentCount + lateCount + leaveCount));

  // 2. คำนวณพนักงานแยกตามสาขา (Branch Breakdown)
  const userList = activeUsers.data || [];
  const branchList = branches.data || [];
  const branchStats = branchList.map((b) => {
    const count = userList.filter((u) => String(u.branch_id) === String(b.id)).length;
    return {
      id: b.id,
      code: b.code,
      name: b.name,
      count,
    };
  });
  // สาขาที่ยังไม่ได้ระบุ
  const unassignedBranchCount = userList.filter((u) => !u.branch_id).length;
  if (unassignedBranchCount > 0) {
    branchStats.push({ id: 0, code: 'OTHER', name: 'ยังไม่ระบุสาขา', count: unassignedBranchCount });
  }

  // 3. แจ้งเตือนใบขับขี่คนขับรถใกล้หมดอายุ (ภายใน 90 วัน)
  const userMap = new Map(userList.map((u) => [u.employee_id, u.name]));
  const todayMs = new Date(today).getTime();
  const driverAlerts = [];

  for (const dr of driverRecords.data || []) {
    if (!dr.license_expiry) continue;
    const expMs = new Date(dr.license_expiry).getTime();
    const daysLeft = Math.ceil((expMs - todayMs) / (1000 * 60 * 60 * 24));
    if (daysLeft <= 90) {
      driverAlerts.push({
        employeeId: dr.employee_id,
        name: userMap.get(dr.employee_id) || dr.employee_id,
        position: dr.position || 'พนักงานขับรถ',
        licenseExpiry: dr.license_expiry,
        daysLeft,
      });
    }
  }

  return NextResponse.json({
    stats: {
      employees: totalEmployees,
      pendingLeave: pendingLeave.count || 0,
      pendingExpenses: pendingExpenses.count || 0,
      openJobs: openJobs.count || 0,
      todayBookings: todayBookings.count || 0,
      payrollTotal,
      period,
    },
    attendance: {
      present: presentCount,
      late: lateCount,
      leave: leaveCount,
      notInYet,
      total: totalEmployees,
    },
    branchStats,
    driverAlerts,
    announcements: announcements.data || [],
    pendingLeaveList: leaveList.data || [],
  });
}
