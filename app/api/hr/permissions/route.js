import { NextResponse } from 'next/server';
import { requireMenu } from '@/lib/hr-access';
import { supabase } from '@/lib/supabase';

/**
 * GET /api/hr/permissions — สิทธิ์ของทุก role (admin เท่านั้น)
 */
export async function GET(request) {
  const { error, status } = await requireMenu(request, 'permissions');
  if (error) return NextResponse.json({ error }, { status });

  const [{ data: perms }, { data: users }] = await Promise.all([
    supabase.from('role_permissions').select('*'),
    supabase.from('users').select('role'),
  ]);

  // รวม role ที่มีในตารางสิทธิ์ + role ที่มีพนักงานใช้อยู่จริง (ยกเว้น admin)
  const rolesInUse = [...new Set((users || []).map((u) => u.role).filter((r) => r && r !== 'admin'))];
  const permMap = new Map((perms || []).map((p) => [p.role, p.menus || []]));
  for (const r of rolesInUse) if (!permMap.has(r)) permMap.set(r, []);

  const roles = [...permMap.entries()].map(([role, menus]) => ({ role, menus }));
  return NextResponse.json({ roles });
}

/**
 * PUT /api/hr/permissions — บันทึกสิทธิ์ของ role (admin เท่านั้น)
 * Body: { role, menus: string[] }  (menus มี '__all__' = ทุกเมนู)
 */
export async function PUT(request) {
  const { error, status } = await requireMenu(request, 'permissions');
  if (error) return NextResponse.json({ error }, { status });

  const { role, menus } = await request.json();
  if (!role || role === 'admin') {
    return NextResponse.json({ error: 'ระบุ role ไม่ถูกต้อง (admin มีสิทธิ์เต็มเสมอ)' }, { status: 400 });
  }

  const { error: e } = await supabase
    .from('role_permissions')
    .upsert({ role, menus: Array.isArray(menus) ? menus : [], updated_at: new Date().toISOString() });
  if (e) return NextResponse.json({ error: e.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
