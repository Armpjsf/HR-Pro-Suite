import { NextResponse } from 'next/server';
import { requireMenu } from '@/lib/hr-access';
import { supabase } from '@/lib/supabase';

/**
 * GET /api/hr/payroll/export?period=YYYY-MM&format=bank|pnd1|sso
 * ส่งออกไฟล์สำหรับยื่นธนาคาร (โอนเงินเดือน), ภ.ง.ด.1, หรือ สปส.1-10
 */
export async function GET(request) {
  const { user, error, status } = await requireMenu(request, 'payroll');
  if (error) return NextResponse.json({ error }, { status });

  const url = new URL(request.url);
  const period = url.searchParams.get('period') || new Date().toISOString().slice(0, 7);
  const format = url.searchParams.get('format') || 'bank';

  const [{ data: slips }, { data: emps }] = await Promise.all([
    supabase.from('payroll_slips').select('*').eq('period', period),
    supabase.from('employee_records').select('employee_id, national_id, bank_name, bank_account'),
  ]);

  const empMap = new Map((emps || []).map((e) => [e.employee_id, e]));
  const rows = slips || [];

  if (format === 'bank') {
    // Bank Payroll Export (CSV)
    const header = 'EmployeeID,BankAccount,BankName,NetSalary,Period\n';
    const body = rows.map((s) => {
      const e = empMap.get(s.employee_id);
      return `"${s.employee_id}","${e?.bank_account || ''}","${e?.bank_name || 'KBANK'}",${s.net},"${s.period}"`;
    }).join('\n');

    return new NextResponse('\uFEFF' + header + body, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="payroll-bank-${period}.csv"`,
      },
    });
  }

  if (format === 'pnd1') {
    // ภ.ง.ด.1 Export (CSV)
    const header = 'ลำดับ,รหัสพนักงาน,เลขประจำตัวประชาชน,เงินได้พึงประเมิน,ภาษีที่หักและนำส่ง\n';
    const body = rows.map((s, idx) => {
      const e = empMap.get(s.employee_id);
      const income = (Number(s.base_salary) || 0) + (Number(s.ot_pay) || 0) + (Number(s.bonus) || 0);
      return `${idx + 1},"${s.employee_id}","${e?.national_id || ''}",${income},${s.tax}`;
    }).join('\n');

    return new NextResponse('\uFEFF' + header + body, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="pnd1-${period}.csv"`,
      },
    });
  }

  if (format === 'sso') {
    // สปส.1-10 Export (CSV)
    const header = 'ลำดับ,รหัสพนักงาน,เลขประจำตัวประชาชน,ค่าจ้างจริง,เงินสมทบผู้ประกันตน\n';
    const body = rows.map((s, idx) => {
      const e = empMap.get(s.employee_id);
      return `${idx + 1},"${s.employee_id}","${e?.national_id || ''}",${s.base_salary},${s.sso}`;
    }).join('\n');

    return new NextResponse('\uFEFF' + header + body, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="sso-1-10-${period}.csv"`,
      },
    });
  }

  return NextResponse.json({ error: 'รูปแบบไฟล์ไม่ถูกต้อง (bank, pnd1, sso)' }, { status: 400 });
}
