const DAY = 86400000;
export const LEAVE_SESSIONS = ['full', 'half_morning', 'half_afternoon'];

export function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

export function calculateLeave({ start_date, end_date, session = 'full', workDays = [1, 2, 3, 4, 5], holidays = [], shifts = [] }) {
  if (!validDate(start_date) || !validDate(end_date) || start_date > end_date) throw new Error('กรุณาระบุช่วงวันที่ลาให้ถูกต้อง');
  if (start_date.slice(0, 4) !== end_date.slice(0, 4)) throw new Error('กรุณาแยกใบลาที่ข้ามปีเป็นปีละคำขอ');
  if (!LEAVE_SESSIONS.includes(session)) throw new Error('ช่วงเวลาการลาไม่ถูกต้อง');
  if (session !== 'full' && start_date !== end_date) throw new Error('ลาครึ่งวันต้องระบุวันที่เดียวกัน');
  const holidaySet = new Set(holidays);
  const shiftMap = new Map(shifts.map((s) => [s.shift_date, s]));
  const dates = [];
  for (let t = Date.parse(start_date); t <= Date.parse(end_date); t += DAY) {
    const date = new Date(t).toISOString().slice(0, 10);
    const shift = shiftMap.get(date);
    const working = shift ? !['off', 'holiday', 'rest'].includes(shift.shift_type) : workDays.includes(new Date(t).getUTCDay());
    if (working && !holidaySet.has(date)) dates.push(date);
  }
  if (!dates.length) throw new Error('ช่วงที่เลือกไม่มีวันทำงาน กรุณาตรวจตารางกะและวันหยุด');
  return { session, days: dates.length * (session === 'full' ? 1 : 0.5), work_dates: dates };
}

export function leaveDaysInPeriod(leave, start, end) {
  if (Array.isArray(leave.work_dates)) {
    return leave.work_dates.filter((d) => d >= start && d <= end).length * (leave.session === 'full' ? 1 : 0.5);
  }
  // Legacy rows have no daily allocation. Do not guess across payroll periods.
  if (leave.start_date < start || leave.end_date > end) throw new Error('พบใบลาเดิมข้ามงวดที่ยังไม่มีรายการวันลา กรุณาตรวจและจัดสรรก่อนคำนวณ');
  return Number(leave.days) || 0;
}

export function unpaidDaysByEmployee(timeRows, leaves, unpaidTypes, start, end) {
  const dates = new Map();
  const setDay = (employee, date, amount) => {
    if (!dates.has(employee)) dates.set(employee, new Map());
    const days = dates.get(employee);
    days.set(date, Math.max(days.get(date) || 0, amount));
  };
  for (const row of timeRows) if (row.status === 'absent') setDay(row.employee_id, row.work_date, 1);
  for (const leave of leaves) {
    if (!unpaidTypes.has(leave.leave_type)) continue;
    if (!Array.isArray(leave.work_dates)) throw new Error('พบใบลาไม่รับค่าจ้างเดิมที่ยังไม่มีรายการวันทำงาน กรุณาตรวจจัดสรรก่อนคำนวณเงินเดือน');
    for (const date of leave.work_dates) if (date >= start && date <= end) setDay(leave.employee_id, date, leave.session === 'full' ? 1 : 0.5);
  }
  return new Map([...dates].map(([employee, days]) => [employee, [...days.values()].reduce((a,b) => a+b, 0)]));
}
