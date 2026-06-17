import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export async function GET(request) {
  const { user, error, status } = requireAuth(request);
  if (error) return NextResponse.json({ error }, { status });

  const { data, error: dbError } = await supabase
    .from('notifications')
    .select('*')
    .eq('recipient_employee_id', user.employeeId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  const items = data || [];
  return NextResponse.json({
    items,
    unread: items.filter((item) => !item.read_at).length,
  });
}

export async function PATCH(request) {
  const { user, error, status } = requireAuth(request);
  if (error) return NextResponse.json({ error }, { status });

  const body = await request.json();
  let query = supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('recipient_employee_id', user.employeeId)
    .is('read_at', null);

  if (body.id) query = query.eq('id', body.id);
  const { error: dbError } = await query;
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
