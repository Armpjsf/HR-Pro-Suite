import { supabase } from './supabase.js';
import { getVerifiedDriverEmployeeLink } from './driver-employee-links.js';
import { isValidPeriod } from './payroll.js';
import { addAuditEntry } from './db.js';

export class PayrollImportError extends Error {
  constructor(message, code = 'PAYROLL_IMPORT_ERROR', status = 400) {
    super(message);
    this.name = 'PayrollImportError';
    this.code = code;
    this.status = status;
  }
}

// In-memory test/benchmark adapter ONLY (used when database === null)
const batchesByTenant = new Map();
const importedLineRevisionsByTenant = new Map();
const lockedPeriodsByTenant = new Map();
const postedAdjustmentsByBatch = new Map();

function getTenantBatches(tenantId) {
  if (!batchesByTenant.has(tenantId)) batchesByTenant.set(tenantId, new Map());
  return batchesByTenant.get(tenantId);
}

function getTenantLineHistory(tenantId) {
  if (!importedLineRevisionsByTenant.has(tenantId)) importedLineRevisionsByTenant.set(tenantId, new Map());
  return importedLineRevisionsByTenant.get(tenantId);
}

function getTenantLocks(tenantId) {
  if (!lockedPeriodsByTenant.has(tenantId)) lockedPeriodsByTenant.set(tenantId, new Map());
  return lockedPeriodsByTenant.get(tenantId);
}

export function clearPayrollImportsForTests() {
  batchesByTenant.clear();
  importedLineRevisionsByTenant.clear();
  lockedPeriodsByTenant.clear();
  postedAdjustmentsByBatch.clear();
}

function hasDbClient(database) {
  return Boolean(database && typeof database.from === 'function');
}

function isUndefinedFunctionError(err) {
  if (!err) return false;
  const code = String(err.code || '');
  const msg = String(err.message || '');
  return code === '42883' || /does not exist|could not find/i.test(msg);
}

function isTableMissingError(err) {
  if (!err) return false;
  const code = String(err.code || '');
  const msg = String(err.message || '');
  return code === '42P01' || /relation .* does not exist/i.test(msg);
}

function mapRpcException(err) {
  const msg = String(err?.message || 'Payroll import RPC failed');
  if (msg.includes('INBOX_LEASE_LOST:')) return new PayrollImportError(msg, 'INBOX_LEASE_LOST', 409);
  if (msg.includes('PERIOD_LOCKED:')) return new PayrollImportError(msg, 'PERIOD_LOCKED', 409);
  if (msg.includes('NOT_FOUND:')) return new PayrollImportError(msg, 'NOT_FOUND', 404);
  if (msg.includes('INVALID_STATE:')) return new PayrollImportError(msg, 'INVALID_STATE', 409);
  if (msg.includes('ACTOR_REQUIRED:')) return new PayrollImportError(msg, 'ACTOR_REQUIRED', 400);
  if (msg.includes('REASON_REQUIRED:')) return new PayrollImportError(msg, 'REASON_REQUIRED', 400);
  return new PayrollImportError(msg, 'PAYROLL_IMPORT_ERROR', 500);
}

function mapDbLineRow(row) {
  return {
    id: row.id,
    sourceEarningLineId: row.source_earning_line_id,
    sourceRevision: Number(row.source_revision),
    jobId: row.job_id,
    tmsDriverId: row.tms_driver_id || '',
    hrEmployeeId: row.hr_employee_id || null,
    period: row.period,
    recognitionDate: row.recognition_date || null,
    paymentOwner: row.payment_owner || 'hr_payroll',
    amountMinor: Number(row.amount_minor),
    amountDecimal: Number(row.amount_decimal),
    currency: row.currency || 'THB',
    payableMinor: Number(row.payable_minor || 0),
    disposition: row.disposition,
    reason: row.reason || null,
    reversed: Boolean(row.reversed),
  };
}

function mapDbBatchRow(row, lines = []) {
  return {
    id: row.batch_id,
    batchId: row.batch_id,
    tenantId: row.tenant_id,
    connectionId: row.connection_id || 'default',
    period: row.period,
    recognitionPolicy: row.recognition_policy || 'verified_date',
    status: row.status,
    lines,
    reconciliation: row.reconciliation_json || {},
    adjustments: row.adjustments_json || [],
    createdBy: row.created_by,
    createdAt: row.created_at,
    reviewedBy: row.reviewed_by || null,
    reviewedAt: row.reviewed_at || null,
    approvedBy: row.approved_by || null,
    approvedAt: row.approved_at || null,
    postedBy: row.posted_by || null,
    postedAt: row.posted_at || null,
    reversedBy: row.reversed_by || null,
    reversedAt: row.reversed_at || null,
    reversalReason: row.reversal_reason || null,
  };
}

export async function setPeriodLock(tenantId, period, locked = true, actorId = 'system', database = supabase) {
  const tid = String(tenantId || '').trim();
  if (!tid || !isValidPeriod(period)) {
    throw new PayrollImportError('Valid tenantId and period (YYYY-MM) are required', 'INVALID_PERIOD', 400);
  }
  const actor = String(actorId || 'system').trim() || 'system';
  const lockFlag = Boolean(locked);

  if (!hasDbClient(database)) {
    const locks = getTenantLocks(tid);
    if (lockFlag) {
      locks.set(period, { locked: true, lockedBy: actor, lockedAt: new Date().toISOString() });
    } else {
      locks.delete(period);
    }
    return { tenantId: tid, period, locked: lockFlag };
  }

  const { error } = await database.from('payroll_period_locks').upsert(
    {
      tenant_id: tid,
      period,
      locked: lockFlag,
      locked_by: actor,
      locked_at: new Date().toISOString(),
    },
    { onConflict: 'tenant_id,period' }
  );

  if (error) {
    throw new PayrollImportError(`Failed to persist period lock: ${error.message}`, 'PERIOD_LOCK_DB_ERROR', 500);
  }

  return { tenantId: tid, period, locked: lockFlag };
}

export async function isPeriodLocked(tenantId, period, database = supabase, options = {}) {
  const tid = String(tenantId || '').trim();
  if (!tid || !period) return false;

  if (!hasDbClient(database)) {
    return Boolean(getTenantLocks(tid).get(period)?.locked);
  }

  const { data, error } = await database
    .from('payroll_period_locks')
    .select('locked')
    .eq('tenant_id', tid)
    .eq('period', period)
    .maybeSingle();

  if (error) {
    if (options.ignoreMissingTable && isTableMissingError(error)) {
      return false;
    }
    throw new PayrollImportError(`Failed to check period lock: ${error.message}`, 'PERIOD_LOCK_DB_ERROR', 500);
  }

  return Boolean(data?.locked);
}

function resolveRecognitionDate(rawLine, policy = 'verified_date') {
  const verified = rawLine.verified_at || rawLine.verifiedAt || rawLine.verifiedDate || null;
  const delivery = rawLine.delivery_date || rawLine.deliveryDate || null;
  const plan = rawLine.plan_date || rawLine.planDate || null;

  let chosen = null;
  if (policy === 'delivery_date') chosen = delivery || verified || plan;
  else if (policy === 'plan_date') chosen = plan || delivery || verified;
  else chosen = verified || delivery || plan;

  if (!chosen) return null;
  if (String(chosen).length === 10) return String(chosen);
  const date = new Date(chosen);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).format(date) : null;
}

function resolveAmountMinor(rawLine) {
  if (rawLine.amount_minor !== undefined && rawLine.amount_minor !== null) {
    const n = Number(rawLine.amount_minor);
    if (!Number.isInteger(n) || n < 0) {
      throw new PayrollImportError(`Invalid amount_minor for line ${rawLine.earning_line_id || rawLine.sourceEarningLineId}`, 'INVALID_AMOUNT', 400);
    }
    return n;
  }
  if (rawLine.amountMinor !== undefined && rawLine.amountMinor !== null) {
    const n = Number(rawLine.amountMinor);
    if (!Number.isInteger(n) || n < 0) {
      throw new PayrollImportError(`Invalid amountMinor for line ${rawLine.earning_line_id || rawLine.sourceEarningLineId}`, 'INVALID_AMOUNT', 400);
    }
    return n;
  }
  const dec = rawLine.amount_decimal ?? rawLine.amountDecimal ?? rawLine.totalDriverCost ?? rawLine.amount;
  const num = Number(dec);
  if (!Number.isFinite(num) || num < 0) {
    throw new PayrollImportError(`Invalid amountDecimal for line ${rawLine.earning_line_id || rawLine.sourceEarningLineId}`, 'INVALID_AMOUNT', 400);
  }
  return Math.round(num * 100);
}

function isEmployeeActiveOnDate(emp, recognitionDate) {
  if (!emp) return false;
  if (emp.status && emp.status !== 'active') return false;
  if (recognitionDate && emp.resignDate && recognitionDate > String(emp.resignDate).slice(0, 10)) {
    return false;
  }
  return true;
}

async function loadExistingLineHistory(tid, connId, database) {
  if (!hasDbClient(database)) {
    return getTenantLineHistory(tid);
  }

  const { data, error } = await database
    .from('payroll_import_lines')
    .select('batch_id, source_earning_line_id, source_revision, period, hr_employee_id, tms_driver_id, amount_minor, payable_minor, disposition, reversed')
    .eq('tenant_id', tid)
    .eq('connection_id', connId)
    .eq('reversed', false)
    .in('disposition', ['imported_payable', 'imported_revision_delta']);

  if (error) {
    throw new PayrollImportError(`Failed to load prior payroll import lines: ${error.message}`, 'IMPORT_DB_ERROR', 500);
  }

  const {data: batches, error: batchError} = await database.from('payroll_import_batches').select('batch_id,status').eq('tenant_id',tid);
  if (batchError) throw new PayrollImportError('อ่านสถานะชุดนำเข้าเดิมไม่สำเร็จ', 'IMPORT_DB_ERROR', 503);
  const states = new Map((batches || []).map(batch => [batch.batch_id,batch.status]));
  const map = new Map();
  for (const row of data || []) {
    const key = row.source_earning_line_id;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push({
      batchId: row.batch_id,
      status: states.get(row.batch_id),
      hrEmployeeId: row.hr_employee_id,
      tmsDriverId: row.tms_driver_id,
      revision: Number(row.source_revision),
      period: row.period,
      importedTotalMinor: Number(row.amount_minor),
      payableMinor: Number(row.payable_minor),
      reversed: Boolean(row.reversed),
    });
  }
  return map;
}

export async function createPayrollImportBatch({
  tenantId,
  period,
  recognitionPolicy = 'verified_date',
  lines = [],
  employees = [],
  explicitLinks = [],
  createdBy,
  connectionId = 'default',
  database = supabase,
}) {
  const tid = String(tenantId || '').trim();
  const connId = String(connectionId || 'default').trim() || 'default';
  const actor = String(createdBy || '').trim();
  if (!tid) throw new PayrollImportError('tenantId is required', 'TENANT_REQUIRED', 401);
  if (!isValidPeriod(period)) throw new PayrollImportError('period must be YYYY-MM', 'INVALID_PERIOD', 400);
  if (!actor) throw new PayrollImportError('createdBy is required', 'ACTOR_REQUIRED', 400);
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new PayrollImportError('At least one earning line is required', 'EMPTY_LINES', 400);
  }

  const empMap = new Map();
  for (const emp of employees || []) {
    const eid = String(emp.employeeId || emp.employee_id || '').trim();
    if (eid) empMap.set(eid, emp);
  }

  if (empMap.size === 0 && hasDbClient(database)) {
    const { data: dbUsers, error: uErr } = await database
      .from('users')
      .select('employee_id, name, status, resign_date');
    if (uErr) throw new PayrollImportError('อ่านข้อมูลพนักงานไม่สำเร็จ', 'IMPORT_DB_ERROR', 503);
    for (const u of dbUsers || []) {
      if (u.employee_id) {
        empMap.set(u.employee_id, {
          employeeId: u.employee_id,
          name: u.name,
          status: u.status || 'active',
          resignDate: u.resign_date || null,
        });
      }
    }
  }

  const explicitLinkMap = new Map();
  for (const link of explicitLinks || []) {
    if (link.tenantId && link.tenantId !== tid) continue;
    if (link.active === false) continue;
    const dId = String(link.tmsDriverId || link.tms_driver_id || '').trim();
    if (dId) explicitLinkMap.set(dId, link);
  }

  const history = await loadExistingLineHistory(tid, connId, database);
  const seenInBatch = new Set();
  const sourceInBatch = new Set();

  let sourceTotalMinor = 0;
  let importedPayableMinor = 0;
  let excludedSubcontractorMinor = 0;
  let excludedTmsPaidMinor = 0;
  let unmappedHoldMinor = 0;
  let duplicateSkippedMinor = 0;

  const processedLines = [];

  for (const raw of lines) {
    const sourceEarningLineId = String(raw.sourceEarningLineId || raw.earning_line_id || '').trim();
    const sourceRevision = Number(raw.sourceRevision ?? raw.revision ?? 1);
    const jobId = String(raw.jobId || raw.job_id || '').trim();
    const tmsDriverId = String(raw.tmsDriverId || raw.driverId || raw.driver_id || '').trim();
    const paymentOwner = String(raw.paymentOwner || raw.payment_owner || 'hr_payroll').trim();
    const recognitionDate = resolveRecognitionDate(raw, recognitionPolicy);
    const linePeriod = String(raw.period || (recognitionDate ? recognitionDate.slice(0, 7) : period)).trim();
    const amountMinor = resolveAmountMinor(raw);
    const amountDecimal = Math.round(amountMinor) / 100;
    const currency = String(raw.currency || 'THB').trim();

    if (!sourceEarningLineId || !Number.isInteger(sourceRevision) || sourceRevision < 1 || !jobId) {
      throw new PayrollImportError('Each line requires sourceEarningLineId, integer sourceRevision >= 1, and jobId', 'INVALID_LINE', 400);
    }
    if (currency !== 'THB') {
      throw new PayrollImportError(`Unsupported currency ${currency}; only THB is supported`, 'UNSUPPORTED_CURRENCY', 400);
    }

    sourceTotalMinor += amountMinor;

    const baseLine = {
      sourceEarningLineId,
      sourceRevision,
      jobId,
      tmsDriverId,
      period: linePeriod,
      recognitionDate,
      paymentOwner,
      amountMinor,
      amountDecimal,
      currency,
      hrEmployeeId: null,
      payableMinor: 0,
      disposition: 'unmapped_or_inactive_hold',
      reason: null,
    };

    if (paymentOwner === 'tms_paid' || raw.paidInTms === true) {
      baseLine.disposition = 'excluded_already_paid_in_tms';
      baseLine.reason = 'Already paid by TMS';
      excludedTmsPaidMinor += amountMinor;
      processedLines.push(baseLine);
      continue;
    }

    let verifiedLink = explicitLinkMap.get(tmsDriverId) || null;
    if (!verifiedLink && tmsDriverId) {
      verifiedLink = await getVerifiedDriverEmployeeLink(
        {
          tenantId: tid,
          connectionId: connId,
          tmsDriverId,
          asOfDate: recognitionDate || undefined,
        },
        database
      );
    }

    const isSub =
      raw.employment_type === 'subcontractor' ||
      raw.employmentType === 'subcontractor' ||
      raw.isSubcontractor === true ||
      Boolean(raw.sub_id || raw.subId) ||
      verifiedLink?.employmentClassification === 'subcontractor';

    if (isSub) {
      baseLine.disposition = 'excluded_subcontractor';
      baseLine.reason = 'Subcontractor earnings excluded from HR payroll';
      excludedSubcontractorMinor += amountMinor;
      processedLines.push(baseLine);
      continue;
    }

    const hrEmployeeId = verifiedLink?.hrEmployeeId || verifiedLink?.hr_employee_id || null;
    const emp = hrEmployeeId ? empMap.get(hrEmployeeId) : null;
    if (!verifiedLink || !verifiedLink.verifiedBy || !hrEmployeeId || !isEmployeeActiveOnDate(emp, recognitionDate)) {
      baseLine.disposition = 'unmapped_or_inactive_hold';
      baseLine.reason = !verifiedLink
        ? 'Missing verified driver-employee link'
        : 'Employee inactive or resigned on recognition date';
      unmappedHoldMinor += amountMinor;
      processedLines.push(baseLine);
      continue;
    }

    baseLine.hrEmployeeId = hrEmployeeId;

    const revKey = `${sourceEarningLineId}::${sourceRevision}`;
    const priorRevs = history.get(sourceEarningLineId) || [];
    const activeSameRev = priorRevs.find((r) => r.revision === sourceRevision && !r.reversed);

    if (seenInBatch.has(revKey) || activeSameRev) {
      baseLine.disposition = 'duplicate_skipped';
      baseLine.reason = 'Duplicate sourceEarningLineId and revision already imported';
      duplicateSkippedMinor += amountMinor;
      processedLines.push(baseLine);
      continue;
    }
    seenInBatch.add(revKey);
    if (sourceInBatch.has(sourceEarningLineId)) throw new PayrollImportError('Multiple revisions of one job in the same source response', 'INVALID_SOURCE_LINE', 409);
    sourceInBatch.add(sourceEarningLineId);

    const activePriorLower = priorRevs
      .filter((r) => r.revision < sourceRevision && !r.reversed)
      .sort((a, b) => b.revision - a.revision)[0];

    const unsafePrior = priorRevs.some(prior => prior.revision > sourceRevision || (prior.revision < sourceRevision && ((prior.status && prior.status !== 'posted') || prior.period !== period || (prior.hrEmployeeId && prior.hrEmployeeId !== hrEmployeeId) || (prior.tmsDriverId && prior.tmsDriverId !== tmsDriverId))));
    if (linePeriod !== period || unsafePrior) {
      baseLine.disposition = 'prior_period_adjustment_required';
      baseLine.reason = 'Previous revision is pending, newer, or belongs to another employee/period; reconcile before importing';
      unmappedHoldMinor += amountMinor; processedLines.push(baseLine); continue;
    }
    if (activePriorLower) {
      const priorPeriodLocked = await isPeriodLocked(tid, activePriorLower.period, database);
      if (priorPeriodLocked) {
        baseLine.disposition = 'prior_period_adjustment_required';
        baseLine.reason = `Original period ${activePriorLower.period} is locked/paid; requires manual adjustment`;
        unmappedHoldMinor += amountMinor;
        processedLines.push(baseLine);
        continue;
      }

      const deltaMinor = amountMinor - activePriorLower.importedTotalMinor;
      baseLine.disposition = 'imported_revision_delta';
      baseLine.payableMinor = deltaMinor;
      baseLine.reason = `Revision ${sourceRevision} delta against revision ${activePriorLower.revision}`;
      importedPayableMinor += deltaMinor;
      duplicateSkippedMinor += activePriorLower.importedTotalMinor;
      processedLines.push(baseLine);
      continue;
    }

    baseLine.disposition = 'imported_payable';
    baseLine.payableMinor = amountMinor;
    importedPayableMinor += amountMinor;
    processedLines.push(baseLine);
  }

  const reconciliation = {
    sourceTotalMinor,
    importedPayableMinor,
    excludedSubcontractorMinor,
    excludedTmsPaidMinor,
    unmappedHoldMinor,
    duplicateSkippedMinor,
    balanced:
      sourceTotalMinor ===
      importedPayableMinor +
        excludedSubcontractorMinor +
        excludedTmsPaidMinor +
        unmappedHoldMinor +
        duplicateSkippedMinor,
  };

  if (!reconciliation.balanced) {
    throw new PayrollImportError('Reconciliation equation mismatch detected', 'RECONCILIATION_MISMATCH', 500);
  }

  const batchId = `IMP-${period}-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
  const nowIso = new Date().toISOString();

  if (!hasDbClient(database)) {
    const batch = {
      id: batchId,
      batchId,
      tenantId: tid,
      connectionId: connId,
      period,
      recognitionPolicy,
      status: 'draft',
      lines: processedLines,
      reconciliation,
      createdBy: actor,
      createdAt: nowIso,
      reviewedBy: null,
      reviewedAt: null,
      approvedBy: null,
      approvedAt: null,
      postedBy: null,
      postedAt: null,
      reversedBy: null,
      reversedAt: null,
      reversalReason: null,
    };

    getTenantBatches(tid).set(batchId, batch);
    for (const l of processedLines) {
      if (l.disposition === 'imported_payable' || l.disposition === 'imported_revision_delta') {
        if (!history.has(l.sourceEarningLineId)) history.set(l.sourceEarningLineId, []);
        history.get(l.sourceEarningLineId).push({
          batchId,
          revision: l.sourceRevision,
          period: batch.period,
          importedTotalMinor: l.amountMinor,
          payableMinor: l.payableMinor,
          reversed: false,
        });
      }
    }
    return structuredClone(batch);
  }

  const { data: insertedBatch, error: batchErr } = await database
    .from('payroll_import_batches')
    .insert({
      batch_id: batchId,
      tenant_id: tid,
      connection_id: connId,
      period,
      recognition_policy: recognitionPolicy,
      status: 'draft',
      reconciliation_json: reconciliation,
      adjustments_json: [],
      created_by: actor,
      created_at: nowIso,
    })
    .select('*')
    .single();

  if (batchErr || !insertedBatch) {
    throw new PayrollImportError(`Failed to persist payroll import batch: ${batchErr?.message || 'unknown error'}`, 'IMPORT_DB_ERROR', 500);
  }

  const lineRows = processedLines.map((l) => ({
    batch_id: batchId,
    tenant_id: tid,
    connection_id: connId,
    source_earning_line_id: l.sourceEarningLineId,
    source_revision: l.sourceRevision,
    job_id: l.jobId,
    tms_driver_id: l.tmsDriverId || null,
    hr_employee_id: l.hrEmployeeId || null,
    period: l.period,
    recognition_date: l.recognitionDate || null,
    payment_owner: l.paymentOwner,
    amount_minor: l.amountMinor,
    amount_decimal: l.amountDecimal,
    currency: l.currency,
    payable_minor: l.payableMinor,
    disposition: l.disposition,
    reason: l.reason || null,
    reversed: false,
  }));

  const { data: insertedLines, error: linesErr } = await database
    .from('payroll_import_lines')
    .insert(lineRows)
    .select('*');

  if (linesErr) {
    await database.from('payroll_import_batches').delete().eq('batch_id', batchId).eq('tenant_id', tid);
    const isDup = String(linesErr.code || '') === '23505' || /duplicate|unique/i.test(String(linesErr.message || ''));
    throw new PayrollImportError(
      isDup ? 'Concurrent duplicate earning line detected' : `Failed to persist payroll import lines: ${linesErr.message}`,
      isDup ? 'DUPLICATE_LINE_CONFLICT' : 'IMPORT_DB_ERROR',
      isDup ? 409 : 500
    );
  }

  return mapDbBatchRow(insertedBatch, (insertedLines || []).map(mapDbLineRow));
}

export async function getImportBatch(tenantId, batchId, database = supabase) {
  const tid = String(tenantId || '').trim();
  const bid = String(batchId || '').trim();
  if (!tid || !bid) return null;

  if (!hasDbClient(database)) {
    const b = getTenantBatches(tid).get(bid);
    return b ? structuredClone(b) : null;
  }

  const { data: batchRow, error: bErr } = await database
    .from('payroll_import_batches')
    .select('*')
    .eq('tenant_id', tid)
    .eq('batch_id', bid)
    .maybeSingle();

  if (bErr) {
    throw new PayrollImportError(`Failed to read import batch: ${bErr.message}`, 'IMPORT_DB_ERROR', 500);
  }
  if (!batchRow) return null;

  const { data: lineRows, error: lErr } = await database
    .from('payroll_import_lines')
    .select('*')
    .eq('tenant_id', tid)
    .eq('batch_id', bid)
    .order('created_at', { ascending: true });

  if (lErr) {
    throw new PayrollImportError(`Failed to read import lines: ${lErr.message}`, 'IMPORT_DB_ERROR', 500);
  }

  return mapDbBatchRow(batchRow, (lineRows || []).map(mapDbLineRow));
}

export async function listImportBatches(tenantId, database = supabase) {
  const tid = String(tenantId || '').trim();
  if (!tid) return [];

  if (!hasDbClient(database)) {
    return [...getTenantBatches(tid).values()].map((b) => structuredClone(b));
  }

  const { data: batchRows, error: bErr } = await database
    .from('payroll_import_batches')
    .select('*')
    .eq('tenant_id', tid)
    .order('created_at', { ascending: false });

  if (bErr) {
    throw new PayrollImportError(`Failed to list import batches: ${bErr.message}`, 'IMPORT_DB_ERROR', 500);
  }
  if (!batchRows || batchRows.length === 0) return [];

  const batchIds = batchRows.map((b) => b.batch_id);
  const { data: lineRows, error: lErr } = await database
    .from('payroll_import_lines')
    .select('*')
    .eq('tenant_id', tid)
    .in('batch_id', batchIds);

  if (lErr) {
    throw new PayrollImportError(`Failed to list import lines: ${lErr.message}`, 'IMPORT_DB_ERROR', 500);
  }

  const linesByBatch = new Map();
  for (const l of lineRows || []) {
    if (!linesByBatch.has(l.batch_id)) linesByBatch.set(l.batch_id, []);
    linesByBatch.get(l.batch_id).push(mapDbLineRow(l));
  }

  return batchRows.map((b) => mapDbBatchRow(b, linesByBatch.get(b.batch_id) || []));
}

export async function reviewPayrollImportBatch({ tenantId, batchId, actorId, database = supabase }) {
  const tid = String(tenantId || '').trim();
  const actor = String(actorId || '').trim();
  if (!actor) throw new PayrollImportError('actorId is required', 'ACTOR_REQUIRED', 400);

  if (!hasDbClient(database)) {
    const batch = getTenantBatches(tid).get(batchId);
    if (!batch) throw new PayrollImportError('Import batch not found', 'NOT_FOUND', 404);
    if (batch.status !== 'draft') {
      throw new PayrollImportError(`Cannot review batch in status '${batch.status}'`, 'INVALID_STATE', 409);
    }
    batch.status = 'reviewed';
    batch.reviewedBy = actor;
    batch.reviewedAt = new Date().toISOString();
    return structuredClone(batch);
  }

  const existing = await getImportBatch(tid, batchId, database);
  if (!existing) throw new PayrollImportError('Import batch not found', 'NOT_FOUND', 404);
  if (existing.status !== 'draft') {
    throw new PayrollImportError(`Cannot review batch in status '${existing.status}'`, 'INVALID_STATE', 409);
  }

  const nowIso = new Date().toISOString();
  const { data: updated, error } = await database
    .from('payroll_import_batches')
    .update({ status: 'reviewed', reviewed_by: actor, reviewed_at: nowIso })
    .eq('tenant_id', tid)
    .eq('batch_id', batchId)
    .eq('status', 'draft')
    .select('*')
    .maybeSingle();

  if (error) throw new PayrollImportError(`Failed to review batch: ${error.message}`, 'IMPORT_DB_ERROR', 500);
  if (!updated) throw new PayrollImportError('Batch state changed concurrently during review', 'INVALID_STATE', 409);

  return mapDbBatchRow(updated, existing.lines);
}

export async function approvePayrollImportBatch({ tenantId, batchId, actorId, database = supabase }) {
  const tid = String(tenantId || '').trim();
  const actor = String(actorId || '').trim();
  if (!actor) throw new PayrollImportError('actorId is required', 'ACTOR_REQUIRED', 400);

  if (!hasDbClient(database)) {
    const batch = getTenantBatches(tid).get(batchId);
    if (!batch) throw new PayrollImportError('Import batch not found', 'NOT_FOUND', 404);
    if (batch.status !== 'reviewed') {
      throw new PayrollImportError(`Cannot approve batch in status '${batch.status}'; must be reviewed first`, 'INVALID_STATE', 409);
    }
    batch.status = 'approved';
    batch.approvedBy = actor;
    batch.approvedAt = new Date().toISOString();
    return structuredClone(batch);
  }

  const existing = await getImportBatch(tid, batchId, database);
  if (!existing) throw new PayrollImportError('Import batch not found', 'NOT_FOUND', 404);
  if (existing.status !== 'reviewed') {
    throw new PayrollImportError(`Cannot approve batch in status '${existing.status}'; must be reviewed first`, 'INVALID_STATE', 409);
  }

  const nowIso = new Date().toISOString();
  const { data: updated, error } = await database
    .from('payroll_import_batches')
    .update({ status: 'approved', approved_by: actor, approved_at: nowIso })
    .eq('tenant_id', tid)
    .eq('batch_id', batchId)
    .eq('status', 'reviewed')
    .select('*')
    .maybeSingle();

  if (error) throw new PayrollImportError(`Failed to approve batch: ${error.message}`, 'IMPORT_DB_ERROR', 500);
  if (!updated) throw new PayrollImportError('Batch state changed concurrently during approval', 'INVALID_STATE', 409);

  return mapDbBatchRow(updated, existing.lines);
}

export async function postImportBatchToPayroll({
  tenantId,
  batchId,
  actorId,
  database = supabase,
  eventId,
  connectionId,
  inboxId,
  workerId,
  fencingToken,
  onAfterCommit,
}) {
  const tid = String(tenantId || '').trim();
  const actor = String(actorId || '').trim();
  if (!actor) throw new PayrollImportError('actorId is required', 'ACTOR_REQUIRED', 400);

  if (!hasDbClient(database)) {
    const batch = getTenantBatches(tid).get(batchId);
    if (!batch) throw new PayrollImportError('Import batch not found', 'NOT_FOUND', 404);
    if (batch.status !== 'approved') {
      throw new PayrollImportError(`Cannot post batch in status '${batch.status}'; must be approved first`, 'INVALID_STATE', 409);
    }
    if (await isPeriodLocked(tid, batch.period, database)) {
      throw new PayrollImportError(`PERIOD_LOCKED: Payroll period ${batch.period} is closed/locked`, 'PERIOD_LOCKED', 409);
    }
    postedAdjustmentsByBatch.set(batchId, []);
    batch.status = 'posted';
    batch.postedBy = actor;
    batch.postedAt = new Date().toISOString();
    return structuredClone(batch);
  }

  // Primary atomic PostgreSQL transaction via RPC
  if (typeof database.rpc === 'function') {
    const rpcArgs = {
      p_tenant_id: tid,
      p_batch_id: batchId,
      p_actor_id: actor,
    };
    if (eventId !== undefined || inboxId !== undefined) {
      rpcArgs.p_event_id = eventId ?? null;
      rpcArgs.p_connection_id = connectionId ?? null;
      rpcArgs.p_inbox_id = inboxId ?? null;
      rpcArgs.p_worker_id = workerId ?? null;
      rpcArgs.p_fencing_token = fencingToken ?? null;
    }

    const { data: rpcData, error: rpcError } = await database.rpc('post_payroll_import_batch', rpcArgs);

    if (!rpcError && rpcData) {
      const afterCommitHook =
        typeof onAfterCommit === 'function' ? onAfterCommit : globalThis.__NEXUS_TEST_ON_AFTER_HR_POST_COMMIT;
      if (typeof afterCommitHook === 'function') {
        await afterCommitHook({ tenantId: tid, batchId, eventId, inboxId, rpcData });
      }
      const hydrated = await getImportBatch(tid, batchId, database);
      try {
        await addAuditEntry({
          user: actor,
          action: `Posted TMS payroll import batch ${batchId} for period ${hydrated.period} (${(hydrated.reconciliation?.importedPayableMinor || 0) / 100} THB)`,
          channel: 'HR',
        });
      } catch {
        // non-fatal
      }
      return hydrated;
    }

    if (rpcError && !isUndefinedFunctionError(rpcError)) {
      throw mapRpcException(rpcError);
    }
  }

  throw new PayrollImportError('กรุณาติดตั้ง migration ค่าเที่ยวก่อนลงสลิป', 'IMPORT_RPC_REQUIRED', 503);
}

export async function reverseImportBatch({ tenantId, batchId, actorId, reason, database = supabase }) {
  const tid = String(tenantId || '').trim();
  const actor = String(actorId || '').trim();
  const cleanReason = String(reason || '').trim();
  if (!actor) throw new PayrollImportError('actorId is required', 'ACTOR_REQUIRED', 400);
  if (!cleanReason) throw new PayrollImportError('reversal reason is required', 'REASON_REQUIRED', 400);

  if (!hasDbClient(database)) {
    const batch = getTenantBatches(tid).get(batchId);
    if (!batch) throw new PayrollImportError('Import batch not found', 'NOT_FOUND', 404);
    if (!['draft', 'reviewed', 'approved', 'posted'].includes(batch.status)) {
      throw new PayrollImportError(`Cannot reverse batch in status '${batch.status}'`, 'INVALID_STATE', 409);
    }
    if (await isPeriodLocked(tid, batch.period, database)) {
      throw new PayrollImportError(`PERIOD_LOCKED: Cannot reverse batch in locked period ${batch.period}`, 'PERIOD_LOCKED', 409);
    }
    const history = getTenantLineHistory(tid);
    for (const entries of history.values()) {
      for (const entry of entries) {
        if (entry.batchId === batchId) entry.reversed = true;
      }
    }
    batch.status = 'reversed';
    batch.reversedBy = actor;
    batch.reversedAt = new Date().toISOString();
    batch.reversalReason = cleanReason;
    return structuredClone(batch);
  }

  if (typeof database.rpc === 'function') {
    const { data: rpcData, error: rpcError } = await database.rpc('reverse_payroll_import_batch', {
      p_tenant_id: tid,
      p_batch_id: batchId,
      p_actor_id: actor,
      p_reason: cleanReason,
    });

    if (!rpcError && rpcData) {
      const hydrated = await getImportBatch(tid, batchId, database);
      try {
        await addAuditEntry({
          user: actor,
          action: `Reversed TMS payroll import batch ${batchId} (${cleanReason})`,
          channel: 'HR',
        });
      } catch {
        // non-fatal
      }
      return hydrated;
    }

    if (rpcError) {
      throw mapRpcException(rpcError);
    }
  }

  throw new PayrollImportError('กรุณาติดตั้ง migration ค่าเที่ยวก่อนกลับรายการ', 'IMPORT_RPC_REQUIRED', 503);
}
