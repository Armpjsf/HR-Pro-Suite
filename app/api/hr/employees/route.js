import { NextResponse } from 'next/server';
import { requireMenu, getAllowedMenus, isAllowed, canAccessHr } from '@/lib/hr-access';
import { getUserFromRequest } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

// ฟิลด์อ่อนไหว — เห็นได้เฉพาะคนที่มีสิทธิ์เมนู "พนักงาน"
const SENSITIVE = ['salary', 'nationalId', 'bankName', 'bankAccount', 'taxId', 'birthDate'];

/**
 * GET /api/hr/employees — รายชื่อพนักงาน (users ⋈ employee_records)
 * - มีสิทธิ์เมนู 'employees' → เห็นข้อมูลเต็ม
 * - มีสิทธิ์ HR เมนูอื่น (เช่น accounting) → เห็นเฉพาะชื่อ/แผนก/ตำแหน่ง (ไว้ทำ dropdown/รายงาน) ไม่เห็นข้อมูลอ่อนไหว
 */
export async function GET(request) {
  const u = getUserFromRequest(request);
  if (!u) return NextResponse.json({ error: 'กรุณาเข้าสู่ระบบ' }, { status: 401 });
  if (!(await canAccessHr(u.role))) return NextResponse.json({ error: 'คุณไม่มีสิทธิ์เข้าถึง' }, { status: 403 });
  const allowed = await getAllowedMenus(u.role);
  const full = isAllowed(allowed, 'employees');

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
      branchId: u.branch_id ?? '',
      managerId: u.manager_id || '',
      avatar: u.avatar || '👤',
      position: rec.position || '',
      startDate: rec.start_date || '',
      salary: Number(rec.salary) || 0,
      nationalId: rec.national_id || '',
      bankName: rec.bank_name || '',
      bankAccount: rec.bank_account || '',
      taxId: rec.tax_id || '',
      birthDate: rec.birth_date || '',
      probationEnd: rec.probation_end || '',
      contractEnd: rec.contract_end || '',
      licenseExpiry: rec.license_expiry || '',
      leaveAnnualTotal: Number(rec.leave_annual_total) || 0,
      leaveAnnualUsed: Number(rec.leave_annual_used) || 0,
      leaveSickTotal: Number(rec.leave_sick_total) || 0,
      leaveSickUsed: Number(rec.leave_sick_used) || 0,
      leavePersonalTotal: Number(rec.leave_personal_total) || 0,
      leavePersonalUsed: Number(rec.leave_personal_used) || 0,
    };
  });

  // ซ่อนข้อมูลอ่อนไหวถ้าไม่มีสิทธิ์เมนูพนักงาน
  const result = full
    ? employees
    : employees.map((e) => {
        const masked = { ...e };
        for (const k of SENSITIVE) delete masked[k];
        return masked;
      });

  return NextResponse.json({ employees: result, full });
}
