import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export async function GET(request) {
  const { user, error, status } = await requireAuth(request);
  if (error) return NextResponse.json({ error }, { status });
  const { data, error: dbError } = await supabase.from('onboarding_checklists')
    .select('id,item,due_date,done,assigned_to').eq('employee_id', user.employeeId).order('id');
  if (dbError) return NextResponse.json({ error: 'โหลดรายการปฐมนิเทศไม่สำเร็จ กรุณาลองใหม่' }, { status: 503 });
  return NextResponse.json({ items: data || [] });
}
