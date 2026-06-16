import { NextResponse } from 'next/server';
import { requireMenu } from '@/lib/hr-access';
import { supabase } from '@/lib/supabase';

/**
 * GET /api/hr/org — ผังองค์กร (โครงสร้างสายบังคับบัญชาจาก users.manager_id)
 */
export async function GET(request) {
  const { error, status } = await requireMenu(request, 'org');
  if (error) return NextResponse.json({ error }, { status });

  const [{ data: users }, { data: records }] = await Promise.all([
    supabase.from('users').select('employee_id, name, department, manager_id, role'),
    supabase.from('employee_records').select('employee_id, position'),
  ]);
  const posMap = new Map((records || []).map((r) => [r.employee_id, r.position]));

  const nodes = (users || []).map((u) => ({
    employeeId: u.employee_id,
    name: u.name,
    department: u.department || '',
    position: posMap.get(u.employee_id) || '',
    managerId: u.manager_id || null,
    children: [],
  }));

  const byId = new Map(nodes.map((n) => [n.employeeId, n]));
  const roots = [];
  for (const n of nodes) {
    if (n.managerId && byId.has(n.managerId) && n.managerId !== n.employeeId) {
      byId.get(n.managerId).children.push(n);
    } else {
      roots.push(n);
    }
  }

  return NextResponse.json({ roots });
}
