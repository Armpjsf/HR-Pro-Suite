import { NextResponse } from 'next/server';
import { requireMenu } from '@/lib/hr-access';
import { getDeploymentTenantId } from '@/lib/tenantContext';
import { supabase } from '@/lib/supabase';
import { runIntegrationOutbox } from '@/lib/integration-outbox-worker';

export async function GET(request) {
  const auth = await requireMenu(request, 'payroll');
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const period = new URL(request.url).searchParams.get('period');
  const { data, error } = await supabase.from('integration_outbox')
    .select('event_id,status,attempt_count,delivered_at,created_at,payload')
    .eq('tenant_id', auth.user?.tenantId || getDeploymentTenantId()).eq('event_type', 'hr.payroll.paid')
    .order('created_at', { ascending: false }).limit(200);
  if (error) return NextResponse.json({ error: 'อ่านสถานะซิงก์ไม่สำเร็จ' }, { status: 503 });
  return NextResponse.json({ events: (data || []).filter(e => !period || e.payload?.period === period)
    .map(e => ({ id: e.event_id, status: e.status, attempts: e.attempt_count, deliveredAt: e.delivered_at, slipId: e.payload?.slip_id, period: e.payload?.period })) });
}
export async function POST(request) {
  const auth = await requireMenu(request, 'payroll');
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { error } = await supabase.from('integration_outbox').update({ status: 'pending', next_attempt_at: new Date().toISOString(), last_error: null })
    .eq('tenant_id', auth.user?.tenantId || getDeploymentTenantId()).eq('event_type', 'hr.payroll.paid')
    .in('status', ['pending', 'failed_permanent', 'dead_letter']);
  if (error) return NextResponse.json({ error: 'เตรียมส่งซ้ำไม่สำเร็จ' }, { status: 503 });
  try { return NextResponse.json(await runIntegrationOutbox()); }
  catch { return NextResponse.json({ error: 'ยังส่งไม่สำเร็จ ระบบจะลองใหม่ตามรอบ' }, { status: 503 }); }
}

export const maxDuration = 60;
