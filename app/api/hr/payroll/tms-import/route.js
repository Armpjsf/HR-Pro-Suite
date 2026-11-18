import { requireMenu } from '@/lib/hr-access';
import { listDriverEmployeeLinks, getVerifiedDriverEmployeeLink } from '@/lib/driver-employee-links';
import { fetchNexusPayrollLines, claimNexusPayrollBatch } from '@/lib/nexus-payroll-source';
import { NextResponse } from 'next/server';
import { requireTenantContext, TenantContextError } from '@/lib/tenantContext';
import { requireModule, isOperationAllowedInState, EntitlementError } from '@/lib/entitlements';
import {
  createPayrollImportBatch,
  reviewPayrollImportBatch,
  approvePayrollImportBatch,
  postImportBatchToPayroll,
  reverseImportBatch,
  setPeriodLock,
  getImportBatch,
  listImportBatches,
  PayrollImportError,
} from '@/lib/payroll-tms-import';

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

  try {
    const url = new URL(request.url);
    const period = url.searchParams.get('period');
    if (period) {
      const entitlement = await requireModule(ctx, 'hr', 'read');
      if (!entitlement.modules.includes('tms') || !isOperationAllowedInState(entitlement.state, 'integration')) return NextResponse.json({ error: 'การเชื่อมต่อ TMS ยังไม่เปิดใช้งาน' }, { status: 403 });
      const source = await fetchNexusPayrollLines(ctx.tenantId, period);
      const links = await listDriverEmployeeLinks({ tenantId: ctx.tenantId, connectionId: source.connectionId, activeOnly: true });
      return NextResponse.json({ ...source, links });
    }
    const batchId = url.searchParams.get('batchId');
    if (batchId) {
      const batch = await getImportBatch(ctx.tenantId, batchId);
      if (!batch) return NextResponse.json({ error: 'Import batch not found' }, { status: 404 });
      return NextResponse.json({ batch });
    }

    const batches = await listImportBatches(ctx.tenantId);
    return NextResponse.json({ batches });
  } catch (err) {
    if (err instanceof PayrollImportError || err instanceof EntitlementError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return NextResponse.json({ error: err.message || 'Failed to load payroll import batches' }, { status: 500 });
  }
}

export async function POST(request) {
  let ctx;
  try {
    ctx = await requireTenantContext(request, { allowedRoles: ['admin', 'hr'] });
    const access = await requireMenu(request, 'payroll');
    if (access.error) return NextResponse.json({ error: access.error }, { status: access.status });
    const entitlement = await requireModule(ctx, 'hr', 'write');
    if (!entitlement.modules.includes('tms') || !isOperationAllowedInState(entitlement.state, 'integration')) return NextResponse.json({ error: 'การเชื่อมต่อ TMS ยังไม่เปิดใช้งาน' }, { status: 403 });
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

  const action = String(body?.action || 'create_draft').trim();
  const actorId = ctx.user?.name || ctx.userId;

  try {
    if (action === 'create_draft' || action === 'fetch_draft') {
      const source = await fetchNexusPayrollLines(ctx.tenantId, body.period);
      const batch = await createPayrollImportBatch({
        tenantId: ctx.tenantId,
        period: body.period,
        recognitionPolicy: 'verified_date',
        lines: source.lines,
        employees: [],
        explicitLinks: [],
        createdBy: actorId,
        connectionId: source.connectionId,
      });
      return NextResponse.json({ success: true, batch }, { status: 201 });
    }

    if (action === 'review') {
      const batch = await reviewPayrollImportBatch({
        tenantId: ctx.tenantId,
        batchId: body.batchId,
        actorId,
      });
      return NextResponse.json({ success: true, batch });
    }

    if (action === 'approve') {
      const batch = await approvePayrollImportBatch({
        tenantId: ctx.tenantId,
        batchId: body.batchId,
        actorId,
      });
      return NextResponse.json({ success: true, batch });
    }

    if (action === 'post') {
      const pending = await getImportBatch(ctx.tenantId, body.batchId);
      for (const line of pending?.lines || []) {
        if (!['imported_payable', 'imported_revision_delta'].includes(line.disposition)) continue;
        const link = await getVerifiedDriverEmployeeLink({ tenantId: ctx.tenantId, connectionId: pending.connectionId, tmsDriverId: line.tmsDriverId, asOfDate: line.recognitionDate });
        if (!link?.verifiedBy || link.hrEmployeeId !== line.hrEmployeeId || link.employmentClassification === 'subcontractor') {
          throw new PayrollImportError('การจับคู่พนักงานเปลี่ยนหลังตรวจยอด กรุณาสร้างชุดใหม่', 'RECIPIENT_CHANGED', 409);
        }
      }
      await claimNexusPayrollBatch(ctx.tenantId, pending);
      const batch = await postImportBatchToPayroll({ tenantId: ctx.tenantId, batchId: body.batchId, actorId });
      return NextResponse.json({ success: true, batch });
    }

    if (action === 'reverse') {
      const batch = await reverseImportBatch({
        tenantId: ctx.tenantId,
        batchId: body.batchId,
        actorId,
        reason: body.reason,
      });
      return NextResponse.json({ success: true, batch });
    }

    if (action === 'lock_period' || action === 'unlock_period') {
      const lockRes = await setPeriodLock(
        ctx.tenantId,
        body.period,
        action === 'lock_period',
        actorId
      );
      return NextResponse.json({ success: true, ...lockRes });
    }

    return NextResponse.json({ error: 'Unsupported action' }, { status: 400 });
  } catch (err) {
    if (err instanceof PayrollImportError || err instanceof EntitlementError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return NextResponse.json({ error: err.message || 'Payroll import failed' }, { status: 500 });
  }
}
