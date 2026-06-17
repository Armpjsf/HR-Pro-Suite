import { supabase } from './supabase';

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
  if (record.status === 'leave' || record.status === 'absent') return record.status;
  if (!record.clock_in) return record.status || 'absent';
  return isLateClockIn(record.clock_in, ws) ? 'late' : 'normal';
}
