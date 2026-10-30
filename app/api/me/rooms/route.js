import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { addAuditEntry } from '@/lib/db';
import { notifyHr, createNotification } from '@/lib/notifications';

/**
 * GET /api/me/rooms?date=YYYY-MM-DD — รายการห้องประชุม + การจองของวันนั้น + การจองของตัวเอง
 */
export async function GET(request) {
  const { user, error, status } = requireAuth(request);
  if (error) return NextResponse.json({ error }, { status });

  const url = new URL(request.url);
  const date = url.searchParams.get('date') || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });

  const [{ data: rooms }, { data: bookings }, { data: mine }] = await Promise.all([
    supabase.from('meeting_rooms').select('*').order('name'),
    supabase.from('room_bookings').select('*').eq('book_date', date).neq('status', 'cancelled').order('start_time'),
    supabase.from('room_bookings').select('*').eq('employee_id', user.employeeId).order('book_date', { ascending: false }).limit(20),
  ]);

  return NextResponse.json({ rooms: rooms || [], bookings: bookings || [], myBookings: mine || [], date });
}

/**
 * POST /api/me/rooms — พนักงานจองห้องประชุม (ตรวจเวลาชนกันก่อนบันทึก)
 * Body: { room_id, book_date, start_time, end_time, title }
 */
export async function POST(request) {
  const { user, error, status } = requireAuth(request);
  if (error) return NextResponse.json({ error }, { status });

  const body = await request.json();
  const { room_id, book_date, start_time, end_time, title } = body;

  if (!room_id || !book_date || !start_time || !end_time) {
    return NextResponse.json({ error: 'กรุณาระบุห้อง วันที่ และช่วงเวลาให้ครบ' }, { status: 400 });
  }
  if (end_time <= start_time) {
    return NextResponse.json({ error: 'เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่ม' }, { status: 400 });
  }

  const { data: room } = await supabase.from('meeting_rooms').select('id, name, status').eq('id', room_id).maybeSingle();
  if (!room) return NextResponse.json({ error: 'ไม่พบห้องประชุม' }, { status: 404 });
  if (room.status !== 'available') {
    return NextResponse.json({ error: `ห้อง ${room.name} ไม่เปิดให้จองขณะนี้` }, { status: 400 });
  }

  // ตรวจการจองซ้อน: ช่วงเวลา overlap = start ใหม่ < end เดิม และ end ใหม่ > start เดิม
  const { data: clash } = await supabase
    .from('room_bookings')
    .select('id, start_time, end_time')
    .eq('room_id', room_id)
    .eq('book_date', book_date)
    .neq('status', 'cancelled')
    .lt('start_time', end_time)
    .gt('end_time', start_time)
    .limit(1);
  if (clash && clash.length > 0) {
    return NextResponse.json(
      { error: `ห้องถูกจองแล้วช่วง ${clash[0].start_time.slice(0, 5)} - ${clash[0].end_time.slice(0, 5)} กรุณาเลือกเวลาอื่น` },
      { status: 409 },
    );
  }

  const { data, error: dbError } = await supabase
    .from('room_bookings')
    .insert({
      room_id,
      employee_id: user.employeeId,
      title: title || `ประชุมโดย ${user.name}`,
      book_date,
      start_time,
      end_time,
      status: 'booked',
    })
    .select()
    .single();
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  await addAuditEntry({
    user: user.name,
    action: `จองห้อง ${room.name} วันที่ ${book_date} เวลา ${start_time}-${end_time}`,
    channel: 'ME',
  });

  await notifyHr('rooms', {
    title: 'มีการจองห้องประชุมใหม่',
    body: `${user.name} จอง ${room.name} วันที่ ${book_date} (${start_time.slice(0, 5)} - ${end_time.slice(0, 5)} น.) หัวข้อ: ${title || 'ประชุมทั่วไป'}`,
    url: '/hr/rooms?tab=bookings',
    type: 'room_booking_pending',
  });

  return NextResponse.json({ item: data });
}
