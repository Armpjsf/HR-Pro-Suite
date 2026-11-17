import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { getWorkSettingsForEmployee } from '@/lib/work-calendar';
import { calculateLeave, validDate } from '@/lib/leave-policy';

export async function POST(request) {
  const { user, error, status } = await requireAuth(request);
  if (error) return NextResponse.json({ error }, { status });
  const body = await request.json();
  if (!validDate(body.start_date) || !validDate(body.end_date)) return NextResponse.json({ error: 'กรุณาเลือกวันที่ให้ครบ' }, { status: 400 });
  try {
    const ws = await getWorkSettingsForEmployee(user.employeeId);
    const { data: me, error: userError } = await supabase.from('users').select('branch_id').eq('employee_id', user.employeeId).single();
    if (userError) throw userError;
    let q = supabase.from('holidays').select('holiday_date').gte('holiday_date', body.start_date).lte('holiday_date', body.end_date);
    q = me.branch_id ? q.or(`branch_id.is.null,branch_id.eq.${me.branch_id}`) : q.is('branch_id', null);
    const [holidays, shifts] = await Promise.all([q, supabase.from('shifts').select('shift_date,shift_type').eq('employee_id', user.employeeId).gte('shift_date', body.start_date).lte('shift_date', body.end_date)]);
    if (holidays.error || shifts.error) throw new Error('อ่านปฏิทินงานไม่สำเร็จ กรุณาลองใหม่');
    return NextResponse.json(calculateLeave({ ...body, workDays: ws.work_days.split(',').map(Number), holidays: holidays.data.map((h) => h.holiday_date), shifts: shifts.data }));
  } catch (e) { return NextResponse.json({ error: e.message }, { status: 400 }); }
}
