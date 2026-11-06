import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getAllowedMenus } from '@/lib/hr-access';
import { supabase } from '@/lib/supabase';

/**
 * GET /api/hr/access — เมนูที่ผู้ใช้ปัจจุบันเข้าได้ (ใช้กรอง sidebar + กั้นการเข้า /hr)
 */
export async function GET(request) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // ดึง role และ status ล่าสุดจากฐานข้อมูลเสมอ เพื่อให้การเปลี่ยนบทบาทมีผลทันที Real-time
  // โดยไม่ต้องรอให้ session/JWT token เดิมหมดอายุ
  let currentRole = user.role;
  let status = 'active';

  if (user.id || user.username) {
    let query = supabase.from('users').select('role, status');
    if (user.id) query = query.eq('id', user.id);
    else query = query.eq('username', user.username);

    const { data: dbUser } = await query.maybeSingle();

    if (dbUser) {
      currentRole = dbUser.role || currentRole;
      status = dbUser.status || status;
    }
  }

  if (status !== 'active') {
    return NextResponse.json({ error: 'account_inactive', allowed: [], isAdmin: false }, { status: 403 });
  }

  const allowed = await getAllowedMenus(currentRole);
  return NextResponse.json({
    allowed,                       // '__all__' หรือ array ของ key
    isAdmin: currentRole === 'admin',
    role: currentRole,
  });
}
