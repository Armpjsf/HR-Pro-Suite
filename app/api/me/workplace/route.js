import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

/**
 * GET /api/me/workplace — ข้อมูลกิจกรรมองค์กรฝั่งพนักงาน
 * คืน: อบรม (ทั้งหมดล่าสุด), ทริปบริษัท, OKR ของตัวเอง
 */
export async function GET(request) {
  const { user, error, status } = requireAuth(request);
  if (error) return NextResponse.json({ error }, { status });

  const [{ data: trainings }, { data: trips }, { data: okrs }] = await Promise.all([
    supabase.from('trainings').select('*').neq('status', 'cancelled').order('train_date', { ascending: false }).limit(20),
    supabase.from('company_trips').select('*').order('start_date', { ascending: false }).limit(20),
    supabase.from('okrs').select('*').eq('employee_id', user.employeeId).order('created_at', { ascending: false }).limit(20),
  ]);

  // ติดธงอบรมที่ตัวเองมีชื่อ (participants เป็น text รายชื่อ/รหัส)
  const myId = user.employeeId || '';
  const myName = user.name || '';
  const list = (trainings || []).map((t) => ({
    ...t,
    isMine: Boolean(
      (myId && (t.participants || '').includes(myId)) ||
      (myName && (t.participants || '').includes(myName)),
    ),
  }));

  return NextResponse.json({ trainings: list, trips: trips || [], okrs: okrs || [] });
}
