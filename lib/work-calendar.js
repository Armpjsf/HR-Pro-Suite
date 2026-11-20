import { supabase } from './supabase.js';

export async function getWorkSettingsForEmployee(employeeId) {
  const [{ data: user }, { data: defaults, error: defaultsErr }] = await Promise.all([
    supabase.from('users').select('branch_id').eq('employee_id', employeeId).maybeSingle(),
    supabase.from('work_settings').select('*').eq('id', 1).maybeSingle(),
  ]);
  if (defaultsErr) throw defaultsErr;

  let branch = null;
  if (user?.branch_id) {
    const { data, error } = await supabase
      .from('branches')
      .select('id, standard_in, standard_out, late_grace_min, work_days')
      .eq('id', user.branch_id)
      .maybeSingle();
    if (error) throw error;
    branch = data;
  }

  return {
    standard_in: branch?.standard_in || defaults?.standard_in || '08:00',
    standard_out: branch?.standard_out || defaults?.standard_out || '17:00',
    late_grace_min: branch?.late_grace_min ?? defaults?.late_grace_min ?? 15,
    work_days: branch?.work_days || defaults?.work_days || '1,2,3,4,5',
    source: branch ? 'branch' : 'company',
  };
}

// คำนวณว่าเวลาเข้างาน (HH:MM[:SS]) ถือเป็น "สาย" ตามตั้งค่าหรือไม่
export function isLateClockIn(clockIn, ws) {
  if (!clockIn || !ws?.standard_in) return false;
  const [sh, sm] = ws.standard_in.split(':').map(Number);
  const [nh, nm] = clockIn.split(':').map(Number);
  if ([sh, sm, nh, nm].some((n) => Number.isNaN(n))) return false;
  const limit = sh * 60 + sm + (Number(ws.late_grace_min) || 0);
  return nh * 60 + nm > limit;
}

// คืน effective status จากเวลาเข้าจริง (ใช้ตอนแสดงผล เพื่อไม่ให้พึ่ง status ที่อาจค้าง)
export function effectiveStatus(record, ws) {
  if (!record) return 'absent';
  if (record.status === 'leave' || record.status === 'half_leave' || record.status === 'absent') return record.status;
  if (!record.clock_in) return record.status || 'absent';
  return isLateClockIn(record.clock_in, ws) ? 'late' : 'normal';
}

// ผสานข้อมูลใบลาครึ่งวันที่อนุมัติแล้วเข้ากับรายการเวลาเข้า-ออกงาน (time_records)
export function enrichHalfDayLeaves(timeRows, halfLeaves) {
  if (!Array.isArray(timeRows) || timeRows.length === 0) return timeRows || [];
  if (!Array.isArray(halfLeaves) || halfLeaves.length === 0) return timeRows;

  const leaveMap = new Map();
  for (const leave of halfLeaves) {
    if (!leave?.employee_id) continue;
    if (leave.session !== 'half_morning' && leave.session !== 'half_afternoon') continue;
    const dates = Array.isArray(leave.work_dates)
      ? leave.work_dates
      : leave.start_date
        ? [leave.start_date]
        : [];
    for (const workDate of dates) {
      if (!workDate) continue;
      leaveMap.set(`${leave.employee_id}::${workDate}`, leave);
    }
  }

  if (leaveMap.size === 0) return timeRows;

  return timeRows.map((row) => {
    if (!row || row.status === 'leave' || row.status === 'absent') return row;
    const leave = leaveMap.get(`${row.employee_id}::${row.work_date}`);
    if (!leave) return row;

    const sessionLabel = leave.session === 'half_morning' ? 'ลาครึ่งเช้า' : 'ลาครึ่งบ่าย';
    const leaveLabel = leave.leave_type ? `${sessionLabel} (${leave.leave_type})` : sessionLabel;

    const parts = [];
    if (row.status === 'late') parts.push('มาสาย');
    parts.push(leaveLabel);

    const existingNote = typeof row.note === 'string' ? row.note.trim() : '';
    if (existingNote && !existingNote.includes(leaveLabel)) {
      parts.push(existingNote);
    }

    return {
      ...row,
      status: 'half_leave',
      note: parts.join(' · '),
    };
  });
}
