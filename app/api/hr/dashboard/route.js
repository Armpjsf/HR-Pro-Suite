import { NextResponse } from 'next/server';
import { requireMenu } from '@/lib/hr-access';
import { supabase } from '@/lib/supabase';

/**
 * GET /api/hr/dashboard — สถิติรวมสำหรับหน้า Dashboard
 */
export async function GET(request) {
  const { error, status } = await requireMenu(request, 'dashboard');
  if (error) return NextResponse.json({ error }, { status });

  const today = new Date().toISOString().slice(0, 10);
  const period = today.slice(0, 7); // '2026-06'

  const [
    employees,
    pendingLeave,
    pendingExpenses,
    openJobs,
    todayBookings,
    payrollRows,
    announcements,
    leaveList,
  ] = await Promise.all([
    supabase.from('users').select('*', { count: 'exact', head: true }),
    supabase.from('leave_requests').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase.from('expense_claims').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase.from('job_openings').select('*', { count: 'exact', head: true }).eq('status', 'open'),
    supabase.from('room_bookings').select('*', { count: 'exact', head: true }).eq('book_date', today),
    supabase.from('payroll_slips').select('net').eq('period', period),
    supabase.from('announcements').select('*').order('created_at', { ascending: false }).limit(5),
    supabase.from('leave_requests').select('*').eq('status', 'pending').order('created_at', { ascending: false }).limit(5),
  ]);

  const payrollTotal = (payrollRows.data || []).reduce((sum, r) => sum + (Number(r.net) || 0), 0);

  return NextResponse.json({
    stats: {
      employees: employees.count || 0,
      pendingLeave: pendingLeave.count || 0,
      pendingExpenses: pendingExpenses.count || 0,
      openJobs: openJobs.count || 0,
      todayBookings: todayBookings.count || 0,
      payrollTotal,
      period,
    },
    announcements: announcements.data || [],
    pendingLeaveList: leaveList.data || [],
  });
}
