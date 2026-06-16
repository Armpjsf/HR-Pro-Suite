import { NextResponse } from 'next/server';
import { requireMenu, getAllowedMenus, isAllowed, canAccessHr } from '@/lib/hr-access';
import { getUserFromRequest } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { currentLeaveYear, legacyLeaveRows } from '@/lib/leave-balances';

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

  const year = Number(new URL(request.url).searchParams.get('year')) || currentLeaveYear();

  const [
    { data: users, error: uErr },
    { data: records, error: rErr },
    { data: leaveTypes, error: ltErr },
    { data: balances, error: bErr },
  ] = await Promise.all([
    supabase.from('users').select('*').order('employee_id'),
    supabase.from('employee_records').select('*'),
    supabase.from('leave_types').select('*').order('code'),
    supabase.from('employee_leave_balances').select('*').eq('year', year),
  ]);
  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });
  if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 });
  if (ltErr) return NextResponse.json({ error: ltErr.message }, { status: 500 });
  if (bErr) return NextResponse.json({ error: bErr.message }, { status: 500 });

  const recMap = new Map((records || []).map((r) => [r.employee_id, r]));
  const balanceMap = new Map();
  for (const row of balances || []) {
    if (!balanceMap.has(row.employee_id)) balanceMap.set(row.employee_id, []);
    balanceMap.get(row.employee_id).push(row);
  }

  const employees = (users || []).map((u) => {
    const rec = recMap.get(u.employee_id) || {};
    const leaveBalances = balanceMap.get(u.employee_id) || legacyLeaveRows(u.employee_id, rec, year);
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
      leaveBalances,
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

  return NextResponse.json({ employees: result, leaveTypes: leaveTypes || [], year, full });
}
