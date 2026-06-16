import { NextResponse } from 'next/server';
import { requireMenu } from '@/lib/hr-access';
import { supabase } from '@/lib/supabase';

/**
 * GET /api/hr/locations — รายการจุดปักหมุด GPS
 */
export async function GET(request) {
  const { user, error, status } = await requireMenu(request, 'locations');
  if (error) return NextResponse.json({ error }, { status });

  const { data, error: dbError } = await supabase
    .from('check_locations')
    .select('*')
    .order('created_at', { ascending: false });

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  return NextResponse.json({ items: data || [] });
}

/**
 * POST /api/hr/locations — เพิ่มจุดปักหมุดใหม่
 */
export async function POST(request) {
  const { user, error, status } = await requireMenu(request, 'locations');
  if (error) return NextResponse.json({ error }, { status });

  const body = await request.json();
  const { name, latitude, longitude, radius_meters = 200 } = body;

  if (!name || latitude == null || longitude == null) {
    return NextResponse.json({ error: 'กรุณาระบุชื่อ, ละติจูด, ลองจิจูด' }, { status: 400 });
  }

  const { data, error: dbError } = await supabase
    .from('check_locations')
    .insert({ name, latitude: Number(latitude), longitude: Number(longitude), radius_meters: Number(radius_meters) })
    .select()
    .single();

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  return NextResponse.json({ item: data });
}

/**
 * PUT /api/hr/locations — อัปเดตจุดปักหมุด
 */
export async function PUT(request) {
  const { user, error, status } = await requireMenu(request, 'locations');
  if (error) return NextResponse.json({ error }, { status });

  const body = await request.json();
  const { id, ...updates } = body;
  if (!id) return NextResponse.json({ error: 'ต้องระบุ id' }, { status: 400 });

  const { data, error: dbError } = await supabase
    .from('check_locations')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  return NextResponse.json({ item: data });
}

/**
 * DELETE /api/hr/locations — ลบจุดปักหมุด
 */
export async function DELETE(request) {
  const { user, error, status } = await requireMenu(request, 'locations');
  if (error) return NextResponse.json({ error }, { status });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'ต้องระบุ id' }, { status: 400 });

  const { error: dbError } = await supabase.from('check_locations').delete().eq('id', id);
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
