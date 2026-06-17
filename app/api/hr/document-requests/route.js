import { NextResponse } from 'next/server';
import { requireMenu } from '@/lib/hr-access';
import { supabase } from '@/lib/supabase';
import { attachDocumentRequestLookups, collectAssetIds } from '@/lib/document-requests';

export async function GET(request) {
  const { error, status } = await requireMenu(request, 'document-requests');
  if (error) return NextResponse.json({ error }, { status });

  const { data: rows, error: dbError } = await supabase
    .from('document_requests')
    .select('*')
    .order('requested_at', { ascending: false })
    .limit(200);

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  const employeeIds = [...new Set((rows || []).map((r) => r.employee_id).filter(Boolean))];
  const assetIds = collectAssetIds(rows || []);
  const [usersResult, recordsResult, rowAssetsResult, activeAssetsResult, slipsResult] = await Promise.all([
    employeeIds.length
      ? supabase.from('users').select('employee_id, name, department, branch_id, avatar').in('employee_id', employeeIds)
      : Promise.resolve({ data: [] }),
    employeeIds.length
      ? supabase.from('employee_records').select('employee_id, position, start_date, salary, national_id, tax_id').in('employee_id', employeeIds)
      : Promise.resolve({ data: [] }),
    assetIds.length ? supabase.from('document_assets').select('*').in('id', assetIds) : Promise.resolve({ data: [] }),
    supabase.from('document_assets').select('*').eq('active', true).order('asset_type').order('name'),
    employeeIds.length
      ? supabase.from('payroll_slips').select('*').in('employee_id', employeeIds).in('status', ['paid', 'notified']).order('period', { ascending: false })
      : Promise.resolve({ data: [] }),
  ]);

  const latestSlipByEmployee = [];
  const seen = new Set();
  for (const slip of slipsResult.data || []) {
    if (seen.has(slip.employee_id)) continue;
    seen.add(slip.employee_id);
    latestSlipByEmployee.push(slip);
  }

  const items = attachDocumentRequestLookups(rows || [], {
    users: usersResult.data || [],
    records: recordsResult.data || [],
    assets: rowAssetsResult.data || [],
    latestSlips: latestSlipByEmployee,
  });

  return NextResponse.json({ items, assets: activeAssetsResult.data || [] });
}
