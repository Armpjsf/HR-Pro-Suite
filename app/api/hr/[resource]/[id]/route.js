import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { RESOURCES } from '@/lib/hr-resources';

/**
 * GET /api/hr/[resource]/[id]
 */
export async function GET(request, { params }) {
  const { resource, id } = await params;
  const def = RESOURCES[resource];
  if (!def) return NextResponse.json({ error: 'ไม่พบ resource นี้' }, { status: 404 });

  const { error, status } = requireRole(request, def.readRoles);
  if (error) return NextResponse.json({ error }, { status });

  const { data, error: dbError } = await supabase.from(def.table).select('*').eq('id', id).maybeSingle();
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'ไม่พบข้อมูล' }, { status: 404 });

  return NextResponse.json({ item: data });
}

/**
 * PUT /api/hr/[resource]/[id] — update
 */
export async function PUT(request, { params }) {
  const { resource, id } = await params;
  const def = RESOURCES[resource];
  if (!def) return NextResponse.json({ error: 'ไม่พบ resource นี้' }, { status: 404 });

  const { error, status } = requireRole(request, def.writeRoles);
  if (error) return NextResponse.json({ error }, { status });

  const body = await request.json();
  const updates = {};
  for (const col of def.columns) {
    if (body[col] !== undefined) updates[col] = body[col] === '' ? null : body[col];
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'ไม่มีข้อมูลให้แก้ไข' }, { status: 400 });
  }

  const { data, error: dbError } = await supabase
    .from(def.table)
    .update(updates)
    .eq('id', id)
    .select()
    .maybeSingle();
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'ไม่พบข้อมูล' }, { status: 404 });

  return NextResponse.json({ item: data });
}

/**
 * DELETE /api/hr/[resource]/[id]
 */
export async function DELETE(request, { params }) {
  const { resource, id } = await params;
  const def = RESOURCES[resource];
  if (!def) return NextResponse.json({ error: 'ไม่พบ resource นี้' }, { status: 404 });

  const { error, status } = requireRole(request, def.writeRoles);
  if (error) return NextResponse.json({ error }, { status });

  const { error: dbError } = await supabase.from(def.table).delete().eq('id', id);
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
