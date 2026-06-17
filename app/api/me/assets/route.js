import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { addAuditEntry } from '@/lib/db';
import { notifyHr } from '@/lib/notifications';

/**
 * GET /api/me/assets — รายการทรัพย์สิน (พนักงานดูเพื่อขอเบิก) + คำขอของตัวเอง
 */
export async function GET(request) {
  const { user, error, status } = requireAuth(request);
  if (error) return NextResponse.json({ error }, { status });

  const [{ data: assets }, { data: branches }, { data: myReqs }] = await Promise.all([
    supabase.from('assets').select('*').order('name'),
    supabase.from('branches').select('id, code, name'),
    supabase.from('asset_requests').select('*').eq('employee_id', user.employeeId).order('created_at', { ascending: false }).limit(50),
  ]);
  const bMap = new Map((branches || []).map((b) => [b.id, `${b.code} · ${b.name}`]));

  const list = (assets || []).map((a) => ({
    id: a.id,
    code: a.code,
    name: a.name,
    category: a.category || '',
    status: a.status,
    imageUrl: a.image_url || '',
    branchName: a.branch_id ? (bMap.get(a.branch_id) || '-') : '-',
    isMine: a.assigned_to === user.employeeId,
  }));

  return NextResponse.json({
    assets: list,
    branches: (branches || []).map((b) => ({ id: b.id, label: `${b.code} · ${b.name}` })),
    myRequests: myReqs || [],
  });
}

/**
 * POST /api/me/assets — พนักงานยื่นคำขอ เบิก/คืน/เปลี่ยน
 * Body: { asset_id, type: 'borrow'|'return'|'replace', target_branch_id?, reason? }
 */
export async function POST(request) {
  const { user, error, status } = requireAuth(request);
  if (error) return NextResponse.json({ error }, { status });

  const body = await request.json();
  const { asset_id, type = 'borrow', target_branch_id, reason } = body;
  if (!asset_id || !['borrow', 'return', 'replace'].includes(type)) {
    return NextResponse.json({ error: 'ข้อมูลคำขอไม่ถูกต้อง' }, { status: 400 });
  }

  // กันขอซ้ำที่ยังค้างอยู่
  const { data: dup } = await supabase
    .from('asset_requests')
    .select('id')
    .eq('asset_id', asset_id)
    .eq('employee_id', user.employeeId)
    .eq('status', 'pending')
    .maybeSingle();
  if (dup) return NextResponse.json({ error: 'คุณมีคำขอที่รออนุมัติสำหรับทรัพย์สินนี้อยู่แล้ว' }, { status: 409 });

  const { data, error: e } = await supabase
    .from('asset_requests')
    .insert({
      asset_id,
      employee_id: user.employeeId,
      type,
      target_branch_id: target_branch_id || null,
      reason: reason || null,
      status: 'pending',
    })
    .select()
    .single();
  if (e) return NextResponse.json({ error: e.message }, { status: 500 });

  const TYPE_TH = { borrow: 'ขอเบิก', return: 'ขอคืน', replace: 'ขอเปลี่ยน' };
  await addAuditEntry({ user: user.name, action: `${TYPE_TH[type]}ทรัพย์สิน #${asset_id}`, channel: 'ME' });

  await notifyHr('assets', {
    title: 'มีคำขอทรัพย์สินใหม่',
    body: `${user.name} ${TYPE_TH[type]}ทรัพย์สิน #${asset_id}`,
    url: '/hr/assets',
    type: 'asset_request_pending',
  });

  return NextResponse.json({ item: data });
}
