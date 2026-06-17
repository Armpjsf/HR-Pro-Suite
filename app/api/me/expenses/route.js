import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { addAuditEntry } from '@/lib/db';
import { notifyHr } from '@/lib/notifications';

const CATEGORIES = ['travel', 'meal', 'allowance', 'accommodation', 'other'];

/**
 * GET /api/me/expenses — รายการเบิกค่าใช้จ่ายของตัวเอง
 */
export async function GET(request) {
  const { user, error, status } = requireAuth(request);
  if (error) return NextResponse.json({ error }, { status });

  const { data, error: dbError } = await supabase
    .from('expense_claims')
    .select('*')
    .eq('employee_id', user.employeeId)
    .order('created_at', { ascending: false })
    .limit(50);

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  return NextResponse.json({ items: data || [] });
}

/**
 * POST /api/me/expenses — ยื่นเบิกค่าใช้จ่ายใหม่
 * Body: { category, amount, description, claim_date }
 */
export async function POST(request) {
  const { user, error, status } = requireAuth(request);
  if (error) return NextResponse.json({ error }, { status });

  const body = await request.json();
  const { category, amount, description, claim_date } = body;

  if (!CATEGORIES.includes(category)) {
    return NextResponse.json({ error: `หมวดหมู่ไม่ถูกต้อง (${CATEGORIES.join(', ')})` }, { status: 400 });
  }
  if (!amount || Number(amount) <= 0) {
    return NextResponse.json({ error: 'กรุณาระบุจำนวนเงิน' }, { status: 400 });
  }

  const { data, error: dbError } = await supabase
    .from('expense_claims')
    .insert({
      employee_id: user.employeeId,
      category,
      amount: Number(amount),
      description: description || null,
      claim_date: claim_date || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }),
      status: 'pending',
    })
    .select()
    .single();

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  await addAuditEntry({
    user: user.name,
    action: `ยื่นเบิกค่าใช้จ่าย ${category} ${Number(amount).toLocaleString()} ฿`,
    channel: 'ME',
  });

  await notifyHr('expenses', {
    title: 'มีคำขอเบิกค่าใช้จ่ายใหม่',
    body: `${user.name} ยื่นเบิก ${category} ${Number(amount).toLocaleString()} บาท`,
    url: '/hr/expenses',
    type: 'expense_pending',
  });

  return NextResponse.json({ item: data });
}
