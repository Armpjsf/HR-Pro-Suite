import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

/**
 * GET /api/hr/employees — รายชื่อพนักงาน (users ⋈ employee_records)
 */
export async function GET(request) {
  const { error, status } = requireRole(request, ['admin', 'hr']);
  if (error) return NextResponse.json({ error }, { status });

  const [{ data: users, error: uErr }, { data: records, error: rErr }] = await Promise.all([
    supabase.from('users').select('*').order('employee_id'),
    supabase.from('employee_records').select('*'),
  ]);
  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });
  if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 });

  const recMap = new Map((records || []).map((r) => [r.employee_id, r]));

  const employees = (users || []).map((u) => {
    const rec = recMap.get(u.employee_id) || {};
    return {
      employeeId: u.employee_id,
      name: u.name,
      nameEn: u.name_en || '',
      email: u.email || '',
      role: u.role,
      department: u.department || '',
      avatar: u.avatar || '👤',
      position: rec.position || '',
      startDate: rec.start_date || '',
      leaveAnnualTotal: Number(rec.leave_annual_total) || 0,
      leaveAnnualUsed: Number(rec.leave_annual_used) || 0,
      leaveSickTotal: Number(rec.leave_sick_total) || 0,
      leaveSickUsed: Number(rec.leave_sick_used) || 0,
      leavePersonalTotal: Number(rec.leave_personal_total) || 0,
      leavePersonalUsed: Number(rec.leave_personal_used) || 0,
    };
  });

  return NextResponse.json({ employees });
}
