import { NextResponse } from 'next/server';
import { requireMenu } from '@/lib/hr-access';
import { supabase } from '@/lib/supabase';

/**
 * GET /api/hr/asset-requests — คำขอเบิก/คืน/เปลี่ยนทรัพย์สินทั้งหมด (เมนู assets)
 */
export async function GET(request) {
  const { error, status } = await requireMenu(request, 'assets');
  if (error) return NextResponse.json({ error }, { status });

  const { data: reqs } = await supabase
    .from('asset_requests')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200);

  const assetIds = [...new Set((reqs || []).map((r) => r.asset_id))];
  const empIds = [...new Set((reqs || []).map((r) => r.employee_id))];
  const branchIds = [...new Set((reqs || []).map((r) => r.target_branch_id).filter(Boolean))];

  const [{ data: assets }, { data: users }, { data: branches }] = await Promise.all([
    assetIds.length ? supabase.from('assets').select('id, code, name').in('id', assetIds) : Promise.resolve({ data: [] }),
    empIds.length ? supabase.from('users').select('employee_id, name').in('employee_id', empIds) : Promise.resolve({ data: [] }),
    branchIds.length ? supabase.from('branches').select('id, code, name').in('id', branchIds) : Promise.resolve({ data: [] }),
  ]);
  const aMap = new Map((assets || []).map((a) => [a.id, a]));
  const uMap = new Map((users || []).map((u) => [u.employee_id, u.name]));
  const bMap = new Map((branches || []).map((b) => [b.id, `${b.code} · ${b.name}`]));

  const items = (reqs || []).map((r) => ({
    ...r,
    assetCode: aMap.get(r.asset_id)?.code || '',
    assetName: aMap.get(r.asset_id)?.name || `#${r.asset_id}`,
    employeeName: uMap.get(r.employee_id) || r.employee_id,
    targetBranchName: r.target_branch_id ? (bMap.get(r.target_branch_id) || '-') : '-',
  }));

  return NextResponse.json({ items });
}
