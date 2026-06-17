import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export async function POST(request) {
  const { user, error, status } = requireAuth(request);
  if (error) return NextResponse.json({ error }, { status });

  const body = await request.json();
  const subscription = body.subscription || body;
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    return NextResponse.json({ error: 'subscription ไม่ถูกต้อง' }, { status: 400 });
  }

  const { error: dbError } = await supabase.from('push_subscriptions').upsert({
    employee_id: user.employeeId,
    endpoint: subscription.endpoint,
    p256dh: subscription.keys.p256dh,
    auth: subscription.keys.auth,
    user_agent: request.headers.get('user-agent') || null,
    active: true,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'endpoint' });
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
