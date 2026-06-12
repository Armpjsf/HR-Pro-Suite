import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

/**
 * GET /api/me/attendance — ประวัติเข้า-ออกงานรายเดือน
 * Query: ?month=2026-06
 */
export async function GET(request) {
  const { user, error, status } = requireAuth(request);
  if (error) return NextResponse.json({ error }, { status });

  const url = new URL(request.url);
  const month = url.searchParams.get('month') || new Date().toISOString().slice(0, 7);
  const startDate = month + '-01';

  // คำนวณวันสุดท้ายของเดือน
  const [y, m] = month.split('-').map(Number);
  const endDate = new Date(y, m, 0).toISOString().slice(0, 10);

  const { data, error: dbError } = await supabase
    .from('time_records')
    .select('*')
    .eq('employee_id', user.employeeId)
    .gte('work_date', startDate)
    .lte('work_date', endDate)
    .order('work_date', { ascending: false });

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  // สรุปสถิติ
  const records = data || [];
  const stats = {
    totalDays: records.length,
    onTime: records.filter((r) => r.status === 'normal').length,
    late: records.filter((r) => r.status === 'late').length,
    absent: records.filter((r) => r.status === 'absent').length,
    wfh: records.filter((r) => r.check_type === 'wfh').length,
    offsite: records.filter((r) => r.check_type === 'offsite').length,
  };

  return NextResponse.json({ records, stats, month });
}
