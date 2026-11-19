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
