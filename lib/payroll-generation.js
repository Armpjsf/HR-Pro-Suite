// Imported trip pay still needs recalculation when the employee has no base wage.
export function selectPayrollRecords(records, activeUsers, existingSlips) {
  const active = new Set((activeUsers || [])
    .filter(user => !user.status || user.status === 'active')
    .map(user => user.employee_id));
  const withTripPay = new Set((existingSlips || [])
    .filter(slip => Number(slip.driving_pay) > 0)
    .map(slip => slip.employee_id));
  return (records || []).filter(record => active.has(record.employee_id)
    && (Number(record.salary) > 0 || (Number(record.salary || 0) === 0 && withTripPay.has(record.employee_id))));
}

const HALF_LEAVE_SESSIONS = new Set(['half_morning', 'half_afternoon']);
const WORKED_STATUSES = new Set(['normal', 'present', 'late']);

/**
 * Determine whether a leave type should be treated as unpaid leave.
 */
export function isUnpaidLeaveType(leaveType) {
  if (!leaveType) return false;
  return leaveType.paid === false || String(leaveType.name || '').includes('ไม่รับค่าจ้าง');
}

/**
 * Compute worked days (counting half-day leaves as 0.5) and absent days per employee.
 */
export function computeWorkDaysByEmployee(timeRows, leaveRows) {
  const halfLeaveKeys = new Set();
  for (const leave of leaveRows || []) {
    if (leave.status && leave.status !== 'approved') continue;
    if (!HALF_LEAVE_SESSIONS.has(leave.session)) continue;
    const dates = Array.isArray(leave.work_dates)
      ? leave.work_dates
      : (leave.start_date ? [leave.start_date] : []);
    for (const workDate of dates) {
      if (workDate) halfLeaveKeys.add(`${leave.employee_id}::${workDate}`);
    }
  }

  const workDaysMap = new Map();
  const absentDaysMap = new Map();
  const seenHalfLeaveKeys = new Set();

  for (const tr of timeRows || []) {
    if (tr.status === 'absent') {
      absentDaysMap.set(tr.employee_id, (absentDaysMap.get(tr.employee_id) || 0) + 1);
      continue;
    }
    if (tr.status === 'leave') {
      continue;
    }

    const key = `${tr.employee_id}::${tr.work_date}`;
    const hasHalfLeave = halfLeaveKeys.has(key);

    if (tr.status === 'half_leave' || (hasHalfLeave && (WORKED_STATUSES.has(tr.status) || tr.clock_in))) {
      if (tr.work_date && seenHalfLeaveKeys.has(key)) continue;
      if (tr.work_date) seenHalfLeaveKeys.add(key);
      workDaysMap.set(tr.employee_id, (workDaysMap.get(tr.employee_id) || 0) + 0.5);
    } else if (WORKED_STATUSES.has(tr.status) || tr.clock_in) {
      workDaysMap.set(tr.employee_id, (workDaysMap.get(tr.employee_id) || 0) + 1);
    }
  }

  return { workDaysMap, absentDaysMap };
}
