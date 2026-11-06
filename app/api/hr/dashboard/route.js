import { NextResponse } from 'next/server';
import { requireMenu } from '@/lib/hr-access';
import { supabase } from '@/lib/supabase';

/**
 * GET /api/hr/dashboard — สถิติรวมสำหรับหน้า Dashboard (รองรับ ?branchId= กรองตามสาขา)
 * เสริม: Real-time Attendance เข้างานวันนี้, สถิติแยกตามสาขา, และ Alerts ใบขับขี่คนขับรถ
 */
export async function GET(request) {
  const { error, status } = await requireMenu(request, 'dashboard');
  if (error) return NextResponse.json({ error }, { status });

  const url = new URL(request.url);
  const branchId = url.searchParams.get('branchId') || 'all';

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
  const period = today.slice(0, 7);

  const [
    activeUsers,
    pendingLeave,
    pendingExpenses,
    openJobs,
    todayBookings,
    payrollRows,
    announcements,
    todayTimes,
    branches,
    driverRecords,
    meetingRooms,
  ] = await Promise.all([
    supabase.from('users').select('id, employee_id, name, branch_id, status'),
    supabase.from('leave_requests').select('*').eq('status', 'pending').order('created_at', { ascending: false }),
    supabase.from('expense_claims').select('id, employee_id, status').eq('status', 'pending'),
    supabase.from('job_openings').select('*', { count: 'exact', head: true }).eq('status', 'open'),
    supabase.from('room_bookings').select('*').eq('book_date', today).order('start_time'),
    supabase.from('payroll_slips').select('employee_id, net').eq('period', period),
    supabase.from('announcements').select('*').order('created_at', { ascending: false }).limit(5),
    supabase.from('time_records').select('*').eq('work_date', today),
    supabase.from('branches').select('id, code, name'),
    supabase.from('employee_records').select('employee_id, position, license_expiry').not('license_expiry', 'is', null),
    supabase.from('meeting_rooms').select('id, name'),
  ]);

  const allUserList = (activeUsers.data || []).filter((u) => !u.status || u.status === 'active');
  const filteredUsers = branchId !== 'all'
    ? allUserList.filter((u) => String(u.branch_id || '') === String(branchId))
    : allUserList;

  const branchEmpSet = new Set(filteredUsers.map((u) => u.employee_id));
  const inBranch = (empId) => branchId === 'all' || branchEmpSet.has(empId);

  const payrollTotal = (payrollRows.data || [])
    .filter((r) => inBranch(r.employee_id))
    .reduce((sum, r) => sum + (Number(r.net) || 0), 0);

  // 1. คำนวณสถิติเข้างานวันนี้ (Real-Time Attendance)
  const totalEmployees = filteredUsers.length;
  const times = (todayTimes.data || []).filter((t) => inBranch(t.employee_id));
  let presentCount = 0;
  let lateCount = 0;
  let leaveCount = 0;

  for (const t of times) {
    if (t.status === 'leave') leaveCount++;
    else if (t.status === 'late') lateCount++;
    else if (t.clock_in) presentCount++;
  }
  const notInYet = Math.max(0, totalEmployees - (presentCount + lateCount + leaveCount));

  // 2. คำนวณพนักงานแยกตามสาขา (Branch Breakdown ทั้งบริษัท)
  const branchList = branches.data || [];
  const branchStats = branchList.map((b) => {
    const count = allUserList.filter((u) => String(u.branch_id) === String(b.id)).length;
    return {
      id: b.id,
      code: b.code,
      name: b.name,
      count,
    };
  });
  const unassignedBranchCount = allUserList.filter((u) => !u.branch_id).length;
  if (unassignedBranchCount > 0) {
    branchStats.push({ id: 0, code: 'OTHER', name: 'ยังไม่ระบุสาขา', count: unassignedBranchCount });
  }

  // 3. แจ้งเตือนใบขับขี่คนขับรถใกล้หมดอายุ (ภายใน 90 วัน)
  const userMap = new Map(allUserList.map((u) => [u.employee_id, u.name]));
  const todayMs = new Date(today).getTime();
  const driverAlerts = [];

  for (const dr of driverRecords.data || []) {
    if (!dr.license_expiry || !inBranch(dr.employee_id)) continue;
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

  // 4. สรุปตารางจองห้องประชุมวันนี้
  const roomMap = new Map((meetingRooms.data || []).map((r) => [r.id, r.name]));
  const todayBookingList = (todayBookings.data || [])
    .filter((b) => inBranch(b.employee_id))
    .map((b) => ({
      id: b.id,
      roomId: b.room_id,
      roomName: roomMap.get(b.room_id) || `ห้อง #${b.room_id}`,
      employeeId: b.employee_id,
      employeeName: userMap.get(b.employee_id) || b.employee_id,
      title: b.title,
      bookDate: b.book_date,
      startTime: b.start_time,
      endTime: b.end_time,
      status: b.status,
    }));

  const filteredPendingLeaves = (pendingLeave.data || []).filter((l) => inBranch(l.employee_id));
  const filteredPendingExpenses = (pendingExpenses.data || []).filter((e) => inBranch(e.employee_id));

  return NextResponse.json({
    stats: {
      employees: totalEmployees,
      pendingLeave: filteredPendingLeaves.length,
      pendingExpenses: filteredPendingExpenses.length,
      openJobs: openJobs.count || 0,
      todayBookings: todayBookingList.length,
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
    todayBookingList,
    announcements: announcements.data || [],
    pendingLeaveList: filteredPendingLeaves.slice(0, 5).map((l) => ({
      ...l,
      employeeName: userMap.get(l.employee_id) || l.employee_id,
    })),
  });
}
