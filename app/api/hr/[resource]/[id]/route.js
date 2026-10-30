import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { RESOURCES } from '@/lib/hr-resources';
import { requireMenu, resourceMenuKey } from '@/lib/hr-access';
import { HR_MENUS } from '@/lib/hr-menus';
import { createNotification } from '@/lib/notifications';

const STATUS_TH = { 
  approved: 'อนุมัติแล้ว', 
  rejected: 'ไม่อนุมัติ', 
  paid: 'จ่ายแล้ว',
  confirmed: 'ยืนยันการจองแล้ว',
  cancelled: 'ยกเลิกการจอง'
};

function resourceLabel(resource) {
  const menu = HR_MENUS.find((m) => m.key === resourceMenuKey(resource));
  return menu?.label || resource;
}

/**
 * GET /api/hr/[resource]/[id]
 */
export async function GET(request, { params }) {
  const { resource, id } = await params;
  const def = RESOURCES[resource];
  if (!def) return NextResponse.json({ error: 'ไม่พบ resource นี้' }, { status: 404 });

  const { user, error, status } = await requireMenu(request, resourceMenuKey(resource));
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

  const { user, error, status } = await requireMenu(request, resourceMenuKey(resource));
  if (error) return NextResponse.json({ error }, { status });

  const body = await request.json();
  const updates = {};
  for (const col of def.columns) {
    if (body[col] !== undefined) updates[col] = body[col] === '' ? null : body[col];
  }
  if (
    def.columns.includes('approved_by') &&
    updates.status &&
    ['approved', 'rejected', 'paid'].includes(updates.status) &&
    !updates.approved_by
  ) {
    updates.approved_by = user.name;
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

  // แจ้งพนักงานเจ้าของรายการเมื่อสถานะถูกเปลี่ยนเป็น อนุมัติ/ไม่อนุมัติ/จ่ายแล้ว
  if (STATUS_TH[updates.status] && data.employee_id) {
    await createNotification({
      employeeId: data.employee_id,
      title: `${resourceLabel(resource)}: ${STATUS_TH[updates.status]}`,
      body: `รายการ${resourceLabel(resource)}ของคุณ สถานะ: ${STATUS_TH[updates.status]}`,
      url: '/me',
      type: `${resource}_${updates.status}`,
    });
  }

  return NextResponse.json({ item: data });
}

/**
 * DELETE /api/hr/[resource]/[id]
 */
export async function DELETE(request, { params }) {
  const { resource, id } = await params;
  const def = RESOURCES[resource];
  if (!def) return NextResponse.json({ error: 'ไม่พบ resource นี้' }, { status: 404 });

  const { error, status } = await requireMenu(request, resourceMenuKey(resource));
  if (error) return NextResponse.json({ error }, { status });

  const { error: dbError } = await supabase.from(def.table).delete().eq('id', id);
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
