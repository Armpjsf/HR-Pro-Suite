import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { requireMenu } from '@/lib/hr-access';
import { supabase } from '@/lib/supabase';
import { addAuditEntry } from '@/lib/db';

const MENU_BY_TYPE = { employees: 'employees', branches: 'branches', holidays: 'holidays' };

const str = (v) => (v === undefined || v === null ? '' : String(v).trim());
const num = (v) => (v === '' || v === undefined || v === null ? 0 : Number(v));

/**
 * POST /api/hr/import — นำเข้าข้อมูลทีละหลายรายการจาก Excel
 * Body: { type: 'employees'|'branches'|'holidays', rows: [...] }
 */
export async function POST(request) {
  const { type, rows } = await request.json();
  const menu = MENU_BY_TYPE[type];
  if (!menu) return NextResponse.json({ error: 'ประเภทนำเข้าไม่ถูกต้อง' }, { status: 400 });

  const { user, error, status } = await requireMenu(request, menu);
  if (error) return NextResponse.json({ error }, { status });
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: 'ไม่มีข้อมูลให้นำเข้า' }, { status: 400 });
  }

  const result = { created: 0, updated: 0, errors: [] };

  // map รหัสสาขา → id (ใช้ทั้ง employees และ holidays)
  let branchMap = new Map();
  if (type === 'employees' || type === 'holidays') {
    const { data: branches } = await supabase.from('branches').select('id, code');
    branchMap = new Map((branches || []).map((b) => [String(b.code).toUpperCase(), b.id]));
  }

  if (type === 'branches') {
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const code = str(r.code);
      const name = str(r.name);
      if (!code || !name) { result.errors.push(`แถว ${i + 2}: ต้องมีรหัสและชื่อสาขา`); continue; }
      const row = {
        code, name,
        province: str(r.province) || null,
        phone: str(r.phone) || null,
        address: str(r.address) || null,
        work_days: str(r.work_days) || '1,2,3,4,5',
        standard_in: str(r.standard_in) || '08:00',
        standard_out: str(r.standard_out) || '17:00',
        late_grace_min: r.late_grace_min === undefined || r.late_grace_min === '' ? 15 : num(r.late_grace_min),
      };
      const { data: existing } = await supabase.from('branches').select('id').eq('code', code).maybeSingle();
      const { error: e } = await supabase.from('branches').upsert(row, { onConflict: 'code' });
      if (e) result.errors.push(`แถว ${i + 2} (${code}): ${e.message}`);
      else existing ? result.updated++ : result.created++;
    }
  } else if (type === 'holidays') {
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const date = str(r.holiday_date);
      const name = str(r.name);
      if (!date || !name) { result.errors.push(`แถว ${i + 2}: ต้องมีวันที่และชื่อวันหยุด`); continue; }
      const bcode = str(r.branch_code).toUpperCase();
      const branch_id = bcode ? (branchMap.get(bcode) ?? null) : null;
      if (bcode && branch_id === null) { result.errors.push(`แถว ${i + 2}: ไม่พบสาขา "${bcode}"`); continue; }
      const { error: e } = await supabase.from('holidays').insert({ holiday_date: date, name, branch_id, note: str(r.note) || null });
      if (e) result.errors.push(`แถว ${i + 2} (${name}): ${e.message}`);
      else result.created++;
    }
  } else if (type === 'employees') {
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const empId = str(r.employee_id);
      const name = str(r.name);
      if (!empId || !name) { result.errors.push(`แถว ${i + 2}: ต้องมีรหัสพนักงานและชื่อ`); continue; }

      const role = str(r.role) || 'employee';
      if (!/^[a-z0-9_-]{2,20}$/i.test(role)) { result.errors.push(`แถว ${i + 2}: role ไม่ถูกต้อง`); continue; }

      const bcode = str(r.branch_code).toUpperCase();
      const branch_id = bcode ? (branchMap.get(bcode) ?? null) : null;
      if (bcode && branch_id === null) { result.errors.push(`แถว ${i + 2}: ไม่พบสาขา "${bcode}"`); continue; }

      const { data: existing } = await supabase.from('users').select('id').eq('employee_id', empId).maybeSingle();

      const userRow = {
        username: str(r.username) || empId,
        name,
        name_en: str(r.name_en) || null,
        email: str(r.email) || null,
        role,
        employee_id: empId,
        department: str(r.department) || null,
        branch_id,
        avatar: role === 'admin' ? '👑' : role === 'hr' ? '👩‍💼' : '👤',
      };

      if (existing) {
        const { error: e } = await supabase.from('users').update(userRow).eq('employee_id', empId);
        if (e) { result.errors.push(`แถว ${i + 2} (${empId}): ${e.message}`); continue; }
        result.updated++;
      } else {
        const password = str(r.password) || 'emp123';
        const { error: e } = await supabase.from('users').insert({
          id: `user-${Date.now()}-${i}`,
          password: bcrypt.hashSync(password, 10),
          ...userRow,
        });
        if (e) { result.errors.push(`แถว ${i + 2} (${empId}): ${e.message}`); continue; }
        result.created++;
      }

      // employee_records (position/start_date/salary/master fields)
      const recRow = {
        employee_id: empId,
        position: str(r.position) || null,
        start_date: str(r.start_date) || null,
        salary: num(r.salary),
        national_id: str(r.national_id) || null,
        bank_name: str(r.bank_name) || null,
        bank_account: str(r.bank_account) || null,
        tax_id: str(r.tax_id) || null,
        birth_date: str(r.birth_date) || null,
        updated_at: new Date().toISOString(),
      };
      await supabase.from('employee_records').upsert(recRow);
    }
  }

  await addAuditEntry({ user: user.name, action: `นำเข้าข้อมูล ${type} (ใหม่ ${result.created}, อัปเดต ${result.updated})`, channel: 'HR' });
  return NextResponse.json(result);
}
