import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { RESOURCES } from '@/lib/hr-resources';

/**
 * GET /api/hr/[resource] — list (รองรับ ?q= ค้นหา และ ?eq_<col>= filter)
 */
export async function GET(request, { params }) {
  const { resource } = await params;
  const def = RESOURCES[resource];
  if (!def) return NextResponse.json({ error: 'ไม่พบ resource นี้' }, { status: 404 });

  const { error, status } = requireRole(request, def.readRoles);
  if (error) return NextResponse.json({ error }, { status });

  const url = new URL(request.url);
  let query = supabase.from(def.table).select('*');

  const q = url.searchParams.get('q');
  if (q && def.searchCols.length > 0) {
    query = query.or(def.searchCols.map((c) => `${c}.ilike.%${q}%`).join(','));
  }

  for (const [key, value] of url.searchParams.entries()) {
    if (key.startsWith('eq_')) {
      const col = key.slice(3);
      if (def.columns.includes(col)) query = query.eq(col, value);
    }
  }

  query = query.order(def.orderBy.col, { ascending: def.orderBy.asc }).limit(1000);

  const { data, error: dbError } = await query;
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  return NextResponse.json({ items: data || [] });
}

/**
 * POST /api/hr/[resource] — create
 */
export async function POST(request, { params }) {
  const { resource } = await params;
  const def = RESOURCES[resource];
  if (!def) return NextResponse.json({ error: 'ไม่พบ resource นี้' }, { status: 404 });

  const { error, status } = requireRole(request, def.writeRoles);
  if (error) return NextResponse.json({ error }, { status });

  const body = await request.json();
  const row = {};
  for (const col of def.columns) {
    if (body[col] !== undefined && body[col] !== '') row[col] = body[col];
  }

  for (const col of def.required) {
    if (row[col] === undefined || row[col] === null || row[col] === '') {
      return NextResponse.json({ error: `กรุณากรอกข้อมูล: ${col}` }, { status: 400 });
    }
  }

  const { data, error: dbError } = await supabase.from(def.table).insert(row).select().single();
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  return NextResponse.json({ item: data });
}
