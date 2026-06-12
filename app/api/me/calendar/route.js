import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

/**
 * GET /api/me/calendar — ปฏิทินการทำงานรายเดือน (shifts + leave + attendance)
 * Query: ?month=2026-06
 */
export async function GET(request) {
  const { user, error, status } = requireAuth(request);
  if (error) return NextResponse.json({ error }, { status });

  const url = new URL(request.url);
  const month = url.searchParams.get('month') || new Date().toISOString().slice(0, 7);
  const startDate = month + '-01';
  const [y, m] = month.split('-').map(Number);
  const endDate = new Date(y, m, 0).toISOString().slice(0, 10);

  const [shifts, leaves, attendance] = await Promise.all([
    supabase
      .from('shifts')
      .select('*')
      .eq('employee_id', user.employeeId)
      .gte('shift_date', startDate)
      .lte('shift_date', endDate)
      .order('shift_date'),
    supabase
      .from('leave_requests')
      .select('*')
      .eq('employee_id', user.employeeId)
      .in('status', ['approved', 'pending'])
      .gte('start_date', startDate)
      .lte('end_date', endDate)
      .order('start_date'),
    supabase
      .from('time_records')
      .select('*')
      .eq('employee_id', user.employeeId)
      .gte('work_date', startDate)
      .lte('work_date', endDate)
      .order('work_date'),
  ]);

  return NextResponse.json({
    month,
    shifts: shifts.data || [],
    leaves: leaves.data || [],
    attendance: attendance.data || [],
  });
}
