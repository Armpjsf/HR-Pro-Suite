import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { addAuditEntry } from '@/lib/db';

/**
 * GET /api/me/allowances?year=2569 — ดูแบบลดหย่อนภาษี (ลย.01) ของตัวเอง
 */
export async function GET(request) {
  const { user, error, status } = requireAuth(request);
  if (error) return NextResponse.json({ error }, { status });

  const url = new URL(request.url);
  const year = Number(url.searchParams.get('year')) || (new Date().getFullYear() + 543);

  const { data } = await supabase
    .from('tax_allowances')
    .select('*')
    .eq('employee_id', user.employeeId)
    .eq('year', year)
    .maybeSingle();

  return NextResponse.json({ year, allowance: data || null });
}

/**
 * POST /api/me/allowances — บันทึกแบบลดหย่อนภาษีของตัวเอง
 * Body: { year, data: { spouse, children, parents, life_insurance, health_insurance, provident_fund, donation, mortgage, ... } }
 */
export async function POST(request) {
  const { user, error, status } = requireAuth(request);
  if (error) return NextResponse.json({ error }, { status });

  const body = await request.json();
  const year = Number(body.year) || (new Date().getFullYear() + 543);

  const { data, error: dbErr } = await supabase
    .from('tax_allowances')
    .upsert(
      { employee_id: user.employeeId, year, data: body.data || {}, status: 'submitted', updated_at: new Date().toISOString() },
      { onConflict: 'employee_id,year' }
    )
    .select()
    .single();
  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });

  await addAuditEntry({ user: user.name, action: `ส่งแบบลดหย่อนภาษี (ลย.01) ปี ${year}`, channel: 'ME' });

  return NextResponse.json({ allowance: data });
}
