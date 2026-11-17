import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

/**
 * GET /api/me/tax-cert?year=2569 — สรุปข้อมูลหนังสือรับรองหักภาษี ณ ที่จ่าย (50 ทวิ) ของตัวเอง
 * รวมรายได้ทั้งปี + ภาษีหัก + ปกส. จาก payroll_slips ในปีนั้น
 */
export async function GET(request) {
  const { user, error, status } = await requireAuth(request);
  if (error) return NextResponse.json({ error }, { status });

  const url = new URL(request.url);
  // ปีที่ขอ: รับเป็น พ.ศ. (เช่น 2569) แล้วแปลงเป็น ค.ศ. ใช้ match period 'YYYY-MM'
  const yearBE = Number(url.searchParams.get('year')) || (new Date().getFullYear() + 543);
  const yearCE = yearBE - 543;

  const { data: slips, error: dbErr } = await supabase
    .from('payroll_slips')
    .select('*')
    .eq('employee_id', user.employeeId)
    .eq('status', 'paid')
    .like('period', `${yearCE}-%`)
    .order('period');
  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });

  const rows = slips || [];
  const sum = (k) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  const totalIncome = sum('base_salary') + sum('ot_pay') + sum('bonus');
  const totalTax = sum('tax');
  const totalSso = sum('sso');

  const { data: empRec } = await supabase
    .from('employee_records')
    .select('address, national_id, tax_id')
    .eq('employee_id', user.employeeId)
    .maybeSingle();

  const { data: settings } = await supabase
    .from('work_settings')
    .select('*')
    .eq('id', 1)
    .maybeSingle();

  const sigId = settings?.tax_cert_signature_asset_id;
  const stampId = settings?.tax_cert_stamp_asset_id;
  const assetIds = [sigId, stampId].filter(Boolean);

  let signatureAsset = null;
  let stampAsset = null;

  if (assetIds.length > 0) {
    const { data: assets } = await supabase
      .from('document_assets')
      .select('*')
      .in('id', assetIds)
      .eq('active', true);

    if (assets) {
      signatureAsset = assets.find((a) => a.id === sigId && a.asset_type === 'signature') || null;
      stampAsset = assets.find((a) => a.id === stampId && a.asset_type === 'company_stamp') || null;
    }
  }

  return NextResponse.json({
    year: yearBE,
    months: rows.length,
    totalIncome,
    totalTax,
    totalSso,
    slips: rows,
    employee: {
      address: empRec?.address || '',
      taxId: empRec?.tax_id || '',
      nationalId: empRec?.national_id || '',
    },
    signatureAsset: signatureAsset || null,
    stampAsset: stampAsset || null,
  });
}
