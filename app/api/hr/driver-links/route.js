import { requireMenu } from '@/lib/hr-access';
import { supabase } from '@/lib/supabase';
import { NextResponse } from 'next/server';
import { requireTenantContext, TenantContextError } from '@/lib/tenantContext';
import { requireModule, EntitlementError } from '@/lib/entitlements';
import {
  upsertVerifiedDriverEmployeeLink,
  listDriverEmployeeLinks,
  ContractValidationError,
  CrossTenantLinkError,
} from '@/lib/driver-employee-links';
import { addAuditEntry } from '@/lib/db';

export async function GET(request) {
  let ctx;
  try {
    ctx = await requireTenantContext(request, { allowedRoles: ['admin', 'hr'] });
    const access = await requireMenu(request, 'payroll');
    if (access.error) return NextResponse.json({ error: access.error }, { status: access.status });
    await requireModule(ctx, 'hr', 'read');
  } catch (err) {
    if (err instanceof TenantContextError || err instanceof EntitlementError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    throw err;
  }

  const url = new URL(request.url);
  const connectionId = url.searchParams.get('connectionId') || undefined;
  const activeOnly = url.searchParams.get('activeOnly') === 'true';

  try {
    const links = await listDriverEmployeeLinks({
      tenantId: ctx.tenantId,
      connectionId,
      activeOnly,
    });
    return NextResponse.json({ tenantId: ctx.tenantId, links });
  } catch (err) {
    if (err instanceof ContractValidationError || err instanceof CrossTenantLinkError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return NextResponse.json({ error: err.message || 'Failed to list driver links' }, { status: 500 });
  }
}

export async function POST(request) {
  let ctx;
  try {
    ctx = await requireTenantContext(request, { allowedRoles: ['admin', 'hr'] });
    const access = await requireMenu(request, 'payroll');
    if (access.error) return NextResponse.json({ error: access.error }, { status: access.status });
    await requireModule(ctx, 'hr', 'write');
  } catch (err) {
    if (err instanceof TenantContextError || err instanceof EntitlementError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    throw err;
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    const { data: employee, error: employeeError } = await supabase.from('users').select('employee_id,status').eq('employee_id', body.hrEmployeeId).maybeSingle();
    if (employeeError || !employee || employee.status !== 'active') return NextResponse.json({ error: 'กรุณาเลือกพนักงานที่ยังทำงานอยู่' }, { status: 400 });
    const link = await upsertVerifiedDriverEmployeeLink({
      ...body,
      tenantId: ctx.tenantId,
      verifiedBy: ctx.user?.id || ctx.userId,
    });

    try {
      await addAuditEntry({
        user: ctx.user?.name || ctx.userId,
        action: `Verified driver-employee link ${link.tmsDriverId} -> ${link.hrEmployeeId} (${link.employmentClassification})`,
        channel: 'HR',
      });
    } catch {
      // non-fatal audit write
    }

    return NextResponse.json({ success: true, link }, { status: 201 });
  } catch (err) {
    if (err instanceof ContractValidationError || err instanceof CrossTenantLinkError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return NextResponse.json({ error: err.message || 'Failed to save driver link' }, { status: 500 });
  }
}
