import { NextResponse } from 'next/server';
import { requireMenu } from '@/lib/hr-access';
import { supabase } from '@/lib/supabase';

/**
 * PUT /api/hr/employees/[employeeId] — แก้ไขข้อมูลพนักงาน
 * เขียนทั้ง users (name, name_en, email, department) และ
 * employee_records (position, start_date, leave totals)
 * ไม่แตะ username/password/role — ไปจัดการที่ /admin/users
 */
export async function PUT(request, { params }) {
  const { error, status } = await requireMenu(request, 'employees');
  if (error) return NextResponse.json({ error }, { status });

  const { employeeId } = await params;
  const body = await request.json();

  const { data: existing, error: findErr } = await supabase
    .from('users')
    .select('employee_id')
    .eq('employee_id', employeeId)
    .maybeSingle();
  if (findErr) return NextResponse.json({ error: findErr.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: 'ไม่พบพนักงาน' }, { status: 404 });

  const userUpdates = {};
  if (body.name !== undefined) userUpdates.name = body.name;
  if (body.nameEn !== undefined) userUpdates.name_en = body.nameEn || null;
  if (body.email !== undefined) userUpdates.email = body.email || null;
  if (body.department !== undefined) userUpdates.department = body.department || null;
  if (body.branchId !== undefined) userUpdates.branch_id = body.branchId === '' ? null : Number(body.branchId);
  if (body.managerId !== undefined) userUpdates.manager_id = body.managerId || null;

  if (Object.keys(userUpdates).length > 0) {
    const { error: uErr } = await supabase
      .from('users')
      .update(userUpdates)
      .eq('employee_id', employeeId);
    if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });
  }

  const recRow = {
    employee_id: employeeId,
    position: body.position || null,
    start_date: body.startDate || null,
    salary: Number(body.salary) || 0,
    national_id: body.nationalId || null,
    bank_name: body.bankName || null,
    bank_account: body.bankAccount || null,
    tax_id: body.taxId || null,
    birth_date: body.birthDate || null,
    probation_end: body.probationEnd || null,
    contract_end: body.contractEnd || null,
    license_expiry: body.licenseExpiry || null,
    leave_annual_total: Number(body.leaveAnnualTotal) || 0,
    leave_annual_used: Number(body.leaveAnnualUsed) || 0,
    leave_sick_total: Number(body.leaveSickTotal) || 0,
    leave_sick_used: Number(body.leaveSickUsed) || 0,
    leave_personal_total: Number(body.leavePersonalTotal) || 0,
    leave_personal_used: Number(body.leavePersonalUsed) || 0,
    updated_at: new Date().toISOString(),
  };
  const { error: rErr } = await supabase.from('employee_records').upsert(recRow);
  if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
