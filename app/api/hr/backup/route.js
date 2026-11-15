import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export async function GET(request) {
  const { error, status } = requireRole(request, ['admin']);
  if (error) return NextResponse.json({ error }, { status });

  try {
    const [
      employeesRes,
      usersRes,
      employeeRecordsRes,
      payrollRes,
      payrollSlipsRes,
      leavesRes,
      leaveRequestsRes,
      documentsRes,
      announcementsRes,
      auditLogsRes,
    ] = await Promise.all([
      supabase.from('employees').select('*'),
      supabase.from('users').select('*'),
      supabase.from('employee_records').select('*'),
      supabase.from('payroll').select('*'),
      supabase.from('payroll_slips').select('*'),
      supabase.from('leaves').select('*'),
      supabase.from('leave_requests').select('*'),
      supabase
        .from('documents')
        .select('id,name,file_name,category,type,size,updated_at,access_roles,uploaded_by'),
      supabase.from('announcements').select('*'),
      supabase.from('audit_logs').select('*').limit(1000),
    ]);

    const today = new Date().toISOString().split('T')[0];
    const payload = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      employees: employeesRes?.data || usersRes?.data || [],
      employee_records: employeeRecordsRes?.data || [],
      payroll: payrollRes?.data || payrollSlipsRes?.data || [],
      leaves: leavesRes?.data || leaveRequestsRes?.data || [],
      documents: documentsRes?.data || [],
      announcements: announcementsRes?.data || [],
      audit_logs: auditLogsRes?.data || [],
    };

    return new NextResponse(JSON.stringify(payload, null, 2), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="hr-backup-${today}.json"`,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: err.message || 'Backup failed' }, { status: 500 });
  }
}
