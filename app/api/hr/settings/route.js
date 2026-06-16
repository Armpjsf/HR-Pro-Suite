import { NextResponse } from 'next/server';
import { requireMenu } from '@/lib/hr-access';
import { supabase } from '@/lib/supabase';

/**
 * GET /api/hr/settings — ตั้งค่าเวลาทำงานบริษัท (แถวเดียว id=1)
 */
export async function GET(request) {
  const { error, status } = await requireMenu(request, 'settings');
  if (error) return NextResponse.json({ error }, { status });

  const { data } = await supabase.from('work_settings').select('*').eq('id', 1).maybeSingle();
  return NextResponse.json({
    settings: data || { standard_in: '08:00', standard_out: '17:00', late_grace_min: 15, work_days: '1,2,3,4,5' },
  });
}

/**
 * PUT /api/hr/settings — บันทึกตั้งค่าเวลาทำงาน
 */
export async function PUT(request) {
  const { error, status } = await requireMenu(request, 'settings');
  if (error) return NextResponse.json({ error }, { status });

  const body = await request.json();
  const row = {
    id: 1,
    standard_in: body.standard_in || '08:00',
    standard_out: body.standard_out || '17:00',
    late_grace_min: Number(body.late_grace_min) || 0,
    work_days: body.work_days || '1,2,3,4,5',
    updated_at: new Date().toISOString(),
  };
  const { error: e } = await supabase.from('work_settings').upsert(row);
  if (e) return NextResponse.json({ error: e.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
