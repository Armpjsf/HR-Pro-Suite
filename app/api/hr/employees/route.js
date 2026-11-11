import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { addAuditEntry } from '@/lib/db';
import { requireMenu, getAllowedMenus, isAllowed, canAccessHr } from '@/lib/hr-access';
import { getUserFromRequest } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { currentLeaveYear, legacyLeaveRows } from '@/lib/leave-balances';

// ฟิลด์อ่อนไหว — เห็นได้เฉพาะคนที่มีสิทธิ์เมนู "พนักงาน"
const SENSITIVE = ['salary', 'nationalId', 'bankName', 'bankAccount', 'taxId', 'birthDate', 'address', 'emergencyName', 'emergencyPhone', 'emergencyRelation'];

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
      status: u.status || 'active',
      resignDate: u.resign_date || '',
      position: rec.position || '',
      phone: rec.phone || '',
      address: rec.address || '',
      emergencyName: rec.emergency_name || '',
      emergencyPhone: rec.emergency_phone || '',
      emergencyRelation: rec.emergency_relation || '',
      employmentType: String(rec.employment_type || '').startsWith('daily') ? 'daily' : (rec.employment_type || 'monthly'),
      payCycle: String(rec.employment_type || '').startsWith('daily:')
        ? String(rec.employment_type).split(':')[1]
        : (rec.employment_type === 'daily' ? 'end_month' : 'monthly'),
      photoUrl: rec.photo_url || '',
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


/**
 * POST /api/hr/employees — เพิ่มพนักงานใหม่ในขั้นตอนเดียว (users + employee_records + leave_balances)
 */
export async function POST(request) {
  const { user: currentUser, error, status } = await requireMenu(request, 'employees');
  if (error) return NextResponse.json({ error }, { status });

  try {
    const body = await request.json();
    const {
      name, nameEn, username, password, email, role = 'employee',
      department, branchId, managerId, position, startDate,
      salary = 0, nationalId, bankName, bankAccount, taxId, phone,
      address, emergencyName, emergencyPhone, emergencyRelation,
      employmentType = 'monthly', payCycle, employeeId: customEmpId,
      leaveAnnualTotal = 6, leaveSickTotal = 30, leavePersonalTotal = 3,
    } = body;

    if (!name || !name.trim()) {
      return NextResponse.json({ error: 'กรุณากรอกชื่อ-นามสกุลพนักงาน' }, { status: 400 });
    }

    // สร้างหรือตรวจสอบรหัสพนักงาน (ป้องกันรหัสชนกัน)
    let empId = customEmpId?.trim();
    if (!empId) {
      const { data: allUsers } = await supabase.from('users').select('employee_id');
      const maxNum = (allUsers || []).reduce((max, u) => {
        const m = (u.employee_id || '').match(/^(?:EMP|DD-)(\d+)$/i);
        return m ? Math.max(max, parseInt(m[1], 10)) : max;
      }, 0);
      empId = `EMP${String(maxNum + 1).padStart(3, '0')}`;
    }

    const { data: existingUser } = await supabase.from('users').select('id').eq('employee_id', empId).maybeSingle();
    if (existingUser) {
      return NextResponse.json({ error: `รหัสพนักงาน ${empId} มีอยู่ในระบบแล้ว` }, { status: 409 });
    }

    const finalUsername = (username && username.trim()) || empId.toLowerCase();
    const { data: existUsername } = await supabase.from('users').select('id').eq('username', finalUsername).maybeSingle();
    if (existUsername) {
      return NextResponse.json({ error: `Username ${finalUsername} มีผู้ใช้งานแล้ว` }, { status: 409 });
    }

    const finalPassword = password && password.length >= 6 ? password : '123456';
    const hash = bcrypt.hashSync(finalPassword, 10);

    // 1. Insert users
    const userRow = {
      id: `user-${Date.now()}`,
      username: finalUsername,
      password: hash,
      name: name.trim(),
      name_en: nameEn || null,
      email: email || null,
      role: role || 'employee',
      employee_id: empId,
      department: department || null,
      branch_id: branchId ? Number(branchId) : null,
      manager_id: managerId || null,
      avatar: role === 'admin' ? '👑' : role === 'hr' ? '👩‍💼' : '👤',
      status: 'active',
    };
    const { error: uErr } = await supabase.from('users').insert(userRow);
    if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });

    // 2. Insert employee_records
    const recRow = {
      employee_id: empId,
      position: position || '',
      start_date: startDate || new Date().toISOString().slice(0, 10),
      salary: Number(salary) || 0,
      national_id: nationalId || '',
      bank_name: bankName || '',
      bank_account: bankAccount || '',
      tax_id: taxId || '',
      phone: phone || '',
      address: address || '',
      emergency_name: emergencyName || '',
      emergency_phone: emergencyPhone || '',
      emergency_relation: emergencyRelation || '',
      employment_type: employmentType === 'daily'
        ? `daily:${payCycle || 'end_month'}`
        : (employmentType || 'monthly'),
      leave_annual_total: Number(leaveAnnualTotal) || 6,
      leave_sick_total: Number(leaveSickTotal) || 30,
      leave_personal_total: Number(leavePersonalTotal) || 3,
    };
    const { error: rErr } = await supabase.from('employee_records').insert(recRow);
    if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 });

    // 3. Grant initial leave balances for current year
    const year = currentLeaveYear();
    const { data: leaveTypes } = await supabase.from('leave_types').select('*');
    if (leaveTypes && leaveTypes.length > 0) {
      const balanceInserts = leaveTypes.map((t) => {
        let total = 0;
        if (t.code === 'annual') total = Number(leaveAnnualTotal) || Number(t.days_per_year) || 6;
        else if (t.code === 'sick') total = Number(leaveSickTotal) || Number(t.days_per_year) || 30;
        else if (t.code === 'personal') total = Number(leavePersonalTotal) || Number(t.days_per_year) || 3;
        else total = Number(t.days_per_year) || 0;
        return {
          employee_id: empId,
          leave_type: t.code,
          year,
          total_days: total,
          used_days: 0,
          note: 'สิทธิ์เริ่มต้นเมื่อสร้างพนักงาน',
        };
      });
      await supabase.from('employee_leave_balances').insert(balanceInserts);
    }

    await addAuditEntry({
      user: currentUser.name,
      action: `เพิ่มพนักงานใหม่ "${name}" (${empId})`,
      channel: 'HR',
    });

    return NextResponse.json({
      success: true,
      employeeId: empId,
      message: `เพิ่มพนักงาน ${name} (${empId}) สำเร็จ`,
    });
  } catch (err) {
    console.error('Create employee error:', err);
    return NextResponse.json({ error: 'เกิดข้อผิดพลาดในการสร้างพนักงาน' }, { status: 500 });
  }
}
