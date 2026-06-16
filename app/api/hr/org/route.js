import { NextResponse } from 'next/server';
import { requireMenu } from '@/lib/hr-access';
import { supabase } from '@/lib/supabase';

function buildTree(nodes) {
  const byId = new Map(nodes.map((n) => [n.employeeId, { ...n, children: [] }]));
  const roots = [];
  for (const node of byId.values()) {
    if (node.parentEmployeeId && byId.has(node.parentEmployeeId) && node.parentEmployeeId !== node.employeeId) {
      byId.get(node.parentEmployeeId).children.push(node);
    } else {
      roots.push(node);
    }
  }
  const sortNodes = (items) => {
    items.sort((a, b) => (a.sortOrder - b.sortOrder) || a.name.localeCompare(b.name, 'th'));
    for (const item of items) sortNodes(item.children);
  };
  sortNodes(roots);
  return roots;
}

function hasCycle(nodes) {
  const parent = new Map(nodes.map((n) => [n.employee_id, n.parent_employee_id || null]));
  for (const node of nodes) {
    const seen = new Set([node.employee_id]);
    let cursor = node.parent_employee_id;
    while (cursor) {
      if (seen.has(cursor)) return true;
      seen.add(cursor);
      cursor = parent.get(cursor);
    }
  }
  return false;
}

/**
 * GET /api/hr/org — ผังองค์กรจาก master data org_chart_nodes
 */
export async function GET(request) {
  const { error, status } = await requireMenu(request, 'org');
  if (error) return NextResponse.json({ error }, { status });

  const [{ data: users, error: userErr }, { data: records, error: recordErr }, { data: chartRows, error: chartErr }] = await Promise.all([
    supabase.from('users').select('employee_id, name, department').order('employee_id'),
    supabase.from('employee_records').select('employee_id, position'),
    supabase.from('org_chart_nodes').select('*').order('sort_order'),
  ]);
  if (userErr) return NextResponse.json({ error: userErr.message }, { status: 500 });
  if (recordErr) return NextResponse.json({ error: recordErr.message }, { status: 500 });
  if (chartErr) return NextResponse.json({ error: chartErr.message }, { status: 500 });

  const posMap = new Map((records || []).map((r) => [r.employee_id, r.position]));
  const chartMap = new Map((chartRows || []).map((r) => [r.employee_id, r]));

  const nodes = (users || []).map((u) => ({
    employeeId: u.employee_id,
    name: u.name,
    defaultDepartment: u.department || '',
    defaultPosition: posMap.get(u.employee_id) || '',
    orgDepartment: chartMap.get(u.employee_id)?.org_department || u.department || '',
    orgTitle: chartMap.get(u.employee_id)?.org_title || posMap.get(u.employee_id) || '',
    parentEmployeeId: chartMap.get(u.employee_id)?.parent_employee_id || null,
    sortOrder: Number(chartMap.get(u.employee_id)?.sort_order) || 0,
    isVisible: chartMap.has(u.employee_id) ? chartMap.get(u.employee_id).is_visible !== false : true,
  }));

  const visibleNodes = nodes.filter((node) => node.isVisible);
  const roots = buildTree(visibleNodes);

  return NextResponse.json({ roots, nodes });
}

/**
 * PUT /api/hr/org — บันทึก master ผังองค์กร ไม่กระทบ users.manager_id หรือสิทธิ์ระบบ
 */
export async function PUT(request) {
  const { error, status } = await requireMenu(request, 'org');
  if (error) return NextResponse.json({ error }, { status });

  const body = await request.json();
  const nodes = Array.isArray(body.nodes) ? body.nodes : [];
  const rows = nodes
    .filter((node) => node.employeeId)
    .map((node, index) => ({
      employee_id: node.employeeId,
      parent_employee_id: node.parentEmployeeId && node.parentEmployeeId !== node.employeeId ? node.parentEmployeeId : null,
      org_title: node.orgTitle || null,
      org_department: node.orgDepartment || null,
      sort_order: Number(node.sortOrder) || index + 1,
      is_visible: node.isVisible !== false,
      updated_at: new Date().toISOString(),
    }));

  if (hasCycle(rows)) {
    return NextResponse.json({ error: 'ผังองค์กรมีการอ้างอิงวนกัน กรุณาตรวจหัวหน้าของแต่ละคน' }, { status: 400 });
  }

  const { error: dbError } = await supabase.from('org_chart_nodes').upsert(rows);
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
