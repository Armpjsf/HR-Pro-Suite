import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getAllowedMenus } from '@/lib/hr-access';

/**
 * GET /api/hr/access — เมนูที่ผู้ใช้ปัจจุบันเข้าได้ (ใช้กรอง sidebar + กั้นการเข้า /hr)
 */
export async function GET(request) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const allowed = await getAllowedMenus(user.role);
  return NextResponse.json({
    allowed,                       // '__all__' หรือ array ของ key
    isAdmin: user.role === 'admin',
    role: user.role,
  });
}
