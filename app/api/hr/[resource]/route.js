import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { RESOURCES } from '@/lib/hr-resources';
import { requireMenu, resourceMenuKey } from '@/lib/hr-access';
import { createNotification } from '@/lib/notifications';

/**
 * GET /api/hr/[resource] — list (รองรับ ?q= ค้นหา และ ?eq_<col>= filter)
 */
export async function GET(request, { params }) {
  const { resource } = await params;
  const def = RESOURCES[resource];
  if (!def) return NextResponse.json({ error: 'ไม่พบ resource นี้' }, { status: 404 });

  const { error, status } = await requireMenu(request, resourceMenuKey(resource));
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

  const { error, status } = await requireMenu(request, resourceMenuKey(resource));
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

  // ป้องกันการจองห้องประชุมชนกันกรณี resource === 'bookings'
  if (def.table === 'room_bookings' && row.room_id && row.book_date && row.start_time && row.end_time) {
    if (row.end_time <= row.start_time) {
      return NextResponse.json({ error: 'เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่ม' }, { status: 400 });
    }
    const { data: conflict } = await supabase
      .from('room_bookings')
      .select('id, title, start_time, end_time')
      .eq('room_id', row.room_id)
      .eq('book_date', row.book_date)
      .neq('status', 'cancelled')
      .lt('start_time', row.end_time)
      .gt('end_time', row.start_time)
      .limit(1);

    if (conflict && conflict.length > 0) {
      const c = conflict[0];
      return NextResponse.json({
        error: `ห้องนี้ถูกจองแล้วในช่วงเวลาดังกล่าว (${c.start_time.slice(0, 5)} - ${c.end_time.slice(0, 5)}: ${c.title || 'ไม่มีชื่อ'})`,
      }, { status: 409 });
    }
  }

  const { data, error: dbError } = await supabase.from(def.table).insert(row).select().single();
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  // กรณีโพสต์ประกาศใหม่ (announcements) ให้ส่งแจ้งเตือน In-App ให้พนักงานทุกคนอัตโนมัติ
  if (def.table === 'announcements' && data?.title) {
    try {
      const { data: allUsers } = await supabase.from('users').select('employee_id').eq('status', 'active');
      for (const u of allUsers || []) {
        await createNotification({
          employeeId: u.employee_id,
          title: `📢 ประกาศบริษัทใหม่: ${data.title}`,
          body: data.body ? data.body.slice(0, 100) : 'มีประกาศใหม่จากฝ่ายบริหาร/HR กรุณาตรวจสอบในระบบ',
          url: '/me',
          type: 'announcement',
          audience: 'all',
        }).catch(() => {});
      }
    } catch (err) {
      console.warn('Auto notification for announcement failed:', err);
    }
  }

  return NextResponse.json({ item: data });
}
