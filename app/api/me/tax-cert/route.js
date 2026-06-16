import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

/**
 * GET /api/me/tax-cert?year=2569 — สรุปข้อมูลหนังสือรับรองหักภาษี ณ ที่จ่าย (50 ทวิ) ของตัวเอง
 * รวมรายได้ทั้งปี + ภาษีหัก + ปกส. จาก payroll_slips ในปีนั้น
 */
export async function GET(request) {
  const { user, error, status } = requireAuth(request);
  if (error) return NextResponse.json({ error }, { status });

  const url = new URL(request.url);
  // ปีที่ขอ: รับเป็น พ.ศ. (เช่น 2569) แล้วแปลงเป็น ค.ศ. ใช้ match period 'YYYY-MM'
  const yearBE = Number(url.searchParams.get('year')) || (new Date().getFullYear() + 543);
  const yearCE = yearBE - 543;

  const { data: slips, error: dbErr } = await supabase
    .from('payroll_slips')
    .select('*')
    .eq('employee_id', user.employeeId)
    .like('period', `${yearCE}-%`)
    .order('period');
  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });

  const rows = slips || [];
  const sum = (k) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  const totalIncome = sum('base_salary') + sum('ot_pay') + sum('bonus');
  const totalTax = sum('tax');
  const totalSso = sum('sso');

  return NextResponse.json({
    year: yearBE,
    months: rows.length,
    totalIncome,
    totalTax,
    totalSso,
    slips: rows,
  });
}
