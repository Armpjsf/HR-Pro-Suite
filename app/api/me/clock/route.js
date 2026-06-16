import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { addAuditEntry } from '@/lib/db';

/**
 * Haversine formula — คำนวณระยะทางระหว่างพิกัด 2 จุด (เมตร)
 */
function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000; // Earth radius in meters
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * GET /api/me/clock — สถานะเข้างานวันนี้
 */
export async function GET(request) {
  const { user, error, status } = requireAuth(request);
  if (error) return NextResponse.json({ error }, { status });

  const today = new Date().toISOString().slice(0, 10);
  const { data } = await supabase
    .from('time_records')
    .select('*')
    .eq('employee_id', user.employeeId)
    .eq('work_date', today)
    .maybeSingle();

  // ดึงรายชื่อจุดปักหมุด
  const { data: locations } = await supabase
    .from('check_locations')
    .select('*')
    .eq('is_active', true);

  return NextResponse.json({
    today: data || null,
    clockedIn: !!data?.clock_in,
    clockedOut: !!data?.clock_out,
    locations: locations || [],
  });
}

/**
 * POST /api/me/clock — เข้างาน / ออกงาน
 * Body: { action: 'in'|'out', latitude, longitude, check_type: 'office'|'offsite'|'wfh' }
 */
export async function POST(request) {
  const { user, error, status } = requireAuth(request);
  if (error) return NextResponse.json({ error }, { status });

  const body = await request.json();
  const { action, latitude, longitude, check_type = 'office' } = body;

  if (!['in', 'out'].includes(action)) {
    return NextResponse.json({ error: 'action ต้องเป็น in หรือ out' }, { status: 400 });
  }

  const today = new Date().toISOString().slice(0, 10);
  const nowTime = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

  // Geofencing สำหรับ office check-in
  let locationName = check_type === 'wfh' ? 'Work From Home' : check_type === 'offsite' ? 'นอกสถานที่' : '';

  if (check_type === 'office') {
    if (latitude == null || longitude == null) {
      return NextResponse.json({ error: 'กรุณาเปิด GPS เพื่อเช็คอิน' }, { status: 400 });
    }

    const { data: locations } = await supabase
      .from('check_locations')
      .select('*')
      .eq('is_active', true);

    if (!locations || locations.length === 0) {
      return NextResponse.json({ error: 'ยังไม่มีจุดปักหมุดในระบบ กรุณาแจ้ง HR' }, { status: 400 });
    }

    let nearest = null;
    let nearestDist = Infinity;

    for (const loc of locations) {
      const dist = haversineDistance(latitude, longitude, Number(loc.latitude), Number(loc.longitude));
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = loc;
      }
    }

    if (nearestDist > nearest.radius_meters) {
      return NextResponse.json({
        error: `ตำแหน่งของคุณอยู่ห่างจาก "${nearest.name}" ${Math.round(nearestDist)} เมตร (รัศมีที่อนุญาต ${nearest.radius_meters} เมตร)`,
        distance: Math.round(nearestDist),
        allowed: nearest.radius_meters,
      }, { status: 403 });
    }

    locationName = nearest.name;
  }

  // ดึง record วันนี้
  const { data: existing } = await supabase
    .from('time_records')
    .select('*')
    .eq('employee_id', user.employeeId)
    .eq('work_date', today)
    .maybeSingle();

  if (action === 'in') {
    if (existing?.clock_in) {
      return NextResponse.json({ error: 'คุณเข้างานวันนี้แล้ว' }, { status: 400 });
    }

    // ตรวจสาย จากตั้งค่าเวลาทำงานบริษัท
    let clockStatus = 'normal';
    const { data: ws } = await supabase.from('work_settings').select('*').eq('id', 1).maybeSingle();
    if (ws?.standard_in) {
      const [sh, sm] = ws.standard_in.split(':').map(Number);
      const [nh, nm] = nowTime.split(':').map(Number);
      const limit = sh * 60 + sm + (Number(ws.late_grace_min) || 0);
      if (nh * 60 + nm > limit) clockStatus = 'late';
    }

    const insertData = {
      employee_id: user.employeeId,
      work_date: today,
      clock_in: nowTime,
      clock_in_lat: latitude || null,
      clock_in_lng: longitude || null,
      check_type,
      location_name: locationName,
      status: clockStatus,
    };

    const { data: record, error: dbError } = await supabase
      .from('time_records')
      .insert(insertData)
      .select()
      .single();

    if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

    await addAuditEntry({
      user: user.name,
      action: `เข้างาน ${nowTime} (${check_type}) ${locationName}`,
      channel: 'ME',
    });

    return NextResponse.json({ message: clockStatus === 'late' ? 'บันทึกเข้างานเรียบร้อย (มาสาย)' : 'บันทึกเข้างานเรียบร้อย', record });
  }

  // action === 'out'
  if (!existing?.clock_in) {
    return NextResponse.json({ error: 'คุณยังไม่ได้เข้างานวันนี้' }, { status: 400 });
  }
  if (existing.clock_out) {
    return NextResponse.json({ error: 'คุณออกงานวันนี้แล้ว' }, { status: 400 });
  }

  const { data: record, error: dbError } = await supabase
    .from('time_records')
    .update({
      clock_out: nowTime,
      clock_out_lat: latitude || null,
      clock_out_lng: longitude || null,
    })
    .eq('id', existing.id)
    .select()
    .single();

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  await addAuditEntry({
    user: user.name,
    action: `ออกงาน ${nowTime}`,
    channel: 'ME',
  });

  return NextResponse.json({ message: 'บันทึกออกงานเรียบร้อย', record });
}
