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
