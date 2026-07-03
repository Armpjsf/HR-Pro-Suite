import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { addAuditEntry } from '@/lib/db';
import { notifyHr } from '@/lib/notifications';

const DEFAULT_OT_RATE = 1.5;
const WORK_DAYS_PER_MONTH = 30;
const WORK_HOURS_PER_DAY = 8;

/**
 * GET /api/me/ot — รายการ OT ของตัวเอง
 */
export async function GET(request) {
  const { user, error, status } = requireAuth(request);
  if (error) return NextResponse.json({ error }, { status });

  const { data, error: dbError } = await supabase
    .from('ot_records')
    .select('*')
    .eq('employee_id', user.employeeId)
    .order('ot_date', { ascending: false })
    .limit(50);
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  return NextResponse.json({ items: data || [] });
}

/**
 * POST /api/me/ot — พนักงานยื่นขอ OT (status = pending รอ HR อนุมัติ)
 * Body: { ot_date, hours, note }
 * amount ตั้งต้นคำนวณจากเงินเดือนฐาน (เดือน/30วัน/8ชม. × rate) — HR แก้ได้ก่อนอนุมัติ
 */
export async function POST(request) {
  const { user, error, status } = requireAuth(request);
  if (error) return NextResponse.json({ error }, { status });

  const body = await request.json();
  const { ot_date, hours, note } = body;

  if (!ot_date) return NextResponse.json({ error: 'กรุณาระบุวันที่ทำ OT' }, { status: 400 });
  const otHours = Number(hours);
  if (!otHours || otHours <= 0 || otHours > 12) {
    return NextResponse.json({ error: 'จำนวนชั่วโมงต้องอยู่ระหว่าง 0.5 - 12 ชั่วโมง' }, { status: 400 });
  }

  // กันยื่นซ้ำวันเดียวกันที่ยังค้างอยู่
  const { data: dup } = await supabase
    .from('ot_records')
    .select('id')
    .eq('employee_id', user.employeeId)
    .eq('ot_date', ot_date)
    .eq('status', 'pending')
    .maybeSingle();
  if (dup) return NextResponse.json({ error: 'คุณมีคำขอ OT วันนี้ที่รออนุมัติอยู่แล้ว' }, { status: 409 });

  const { data: rec } = await supabase
    .from('employee_records')
    .select('salary')
    .eq('employee_id', user.employeeId)
    .maybeSingle();
  const hourly = (Number(rec?.salary) || 0) / WORK_DAYS_PER_MONTH / WORK_HOURS_PER_DAY;
  const amount = Math.round(hourly * otHours * DEFAULT_OT_RATE);

  const { data, error: dbError } = await supabase
    .from('ot_records')
    .insert({
      employee_id: user.employeeId,
      ot_date,
      hours: otHours,
      rate: DEFAULT_OT_RATE,
      amount,
      status: 'pending',
      note: note || null,
    })
    .select()
    .single();
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  await addAuditEntry({
    user: user.name,
    action: `ยื่นขอ OT ${ot_date} จำนวน ${otHours} ชม.`,
    channel: 'ME',
  });

  await notifyHr('ot', {
    title: 'มีคำขอ OT ใหม่',
    body: `${user.name} ยื่นขอ OT วันที่ ${ot_date} จำนวน ${otHours} ชม.`,
    url: '/hr/ot',
    type: 'ot_pending',
  });

  return NextResponse.json({ item: data });
}
