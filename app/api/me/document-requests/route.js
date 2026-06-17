import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { addAuditEntry } from '@/lib/db';
import { attachDocumentRequestLookups, collectAssetIds, isDocumentType } from '@/lib/document-requests';

async function loadEmployeeLookups(employeeId, rows) {
  const assetIds = collectAssetIds(rows);
  const [{ data: users }, { data: records }, { data: assets }, { data: slips }] = await Promise.all([
    supabase.from('users').select('employee_id, name, department, branch_id, avatar').eq('employee_id', employeeId),
    supabase.from('employee_records').select('employee_id, position, start_date, salary, national_id, tax_id').eq('employee_id', employeeId),
    assetIds.length ? supabase.from('document_assets').select('*').in('id', assetIds) : Promise.resolve({ data: [] }),
    supabase
      .from('payroll_slips')
      .select('*')
      .eq('employee_id', employeeId)
      .in('status', ['paid', 'notified'])
      .order('period', { ascending: false })
      .limit(1),
  ]);

  const enriched = attachDocumentRequestLookups(rows, {
    users: users || [],
    records: records || [],
    assets: assets || [],
    latestSlips: slips || [],
  });

  return {
    requests: enriched,
    profile: enriched[0]?.employeeProfile || null,
    latestPayslip: slips?.[0] || null,
  };
}

export async function GET(request) {
  const { user, error, status } = requireAuth(request);
  if (error) return NextResponse.json({ error }, { status });

  const { data, error: dbError } = await supabase
    .from('document_requests')
    .select('*')
    .eq('employee_id', user.employeeId)
    .order('requested_at', { ascending: false })
    .limit(50);

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  const payload = await loadEmployeeLookups(user.employeeId, data || []);
  return NextResponse.json(payload);
}

export async function POST(request) {
  const { user, error, status } = requireAuth(request);
  if (error) return NextResponse.json({ error }, { status });

  const body = await request.json();
  const documentType = body.document_type;
  const purpose = String(body.purpose || '').trim();

  if (!isDocumentType(documentType)) {
    return NextResponse.json({ error: 'ประเภทเอกสารไม่ถูกต้อง' }, { status: 400 });
  }

  const { data, error: dbError } = await supabase
    .from('document_requests')
    .insert({
      employee_id: user.employeeId,
      document_type: documentType,
      purpose: purpose || null,
      status: 'pending',
    })
    .select()
    .single();

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  await addAuditEntry({
    user: user.name,
    action: `ยื่นคำขอเอกสาร ${documentType}`,
    channel: 'ME',
  });

  const payload = await loadEmployeeLookups(user.employeeId, [data]);
  return NextResponse.json({ item: payload.requests[0] });
}
