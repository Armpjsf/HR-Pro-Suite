import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { registerHooks } from 'node:module';
import bcrypt from 'bcryptjs';

const root = new URL('../', import.meta.url);
const fixtureURL = new URL('./support/isolated-supabase.mjs', import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'next/server') return next('next/server.js', context);
    const target = specifier.startsWith('@/')
      ? new URL(specifier.slice(2) + (specifier.endsWith('.js') ? '' : '.js'), root).href
      : specifier.startsWith('.')
        ? new URL(specifier, context.parentURL).href
        : null;
    if (target === new URL('lib/supabase.js', root).href) {
      return { url: fixtureURL, shortCircuit: true };
    }
    if (specifier.startsWith('@/')) return { url: target, shortCircuit: true };
    return next(specifier, context);
  },
});

test('TASK-E01 & TASK-E02: Versioned contracts, external entity links, HMAC rotation, outbox/inbox guarantees', async () => {
  const {
    CONTRACT_VERSION,
    validateEnvelope,
    validateDriverEarningLineV2,
    ExternalEntityLinkStore,
    DriverEmployeeLinkStore,
    parseLegacyWmsNotesForBackfillOnly,
  } = await import('../lib/contracts/integration-contracts.js');

  const {
    signWebhookPayload,
    verifyWebhookSignature,
    IntegrationOutboxInboxStore,
    enqueueOutboxEvent,
    claimOutboxBatch,
    processOutboxBatch,
    receiveAndApplyInboxEvent,
    computeBackoffMs,
  } = await import('../lib/integration-outbox-inbox.js');

  assert.equal(CONTRACT_VERSION, '2.0.0');

  const validEnv = {
    event_id: 'evt-1',
    connection_id: 'conn-alpha',
    source_product: 'tms',
    target_product: 'hr',
    event_type: 'driver_earnings.verified',
    schema_version: '2.0.0',
    aggregate_id: 'JOB-001',
    aggregate_version: 1,
    occurred_at: '2026-11-18T10:00:00+07:00',
    correlation_id: 'corr-1',
    tenant_claim: 'tenant-alpha',
    payload: { job_id: 'JOB-001' },
  };
  assert.equal(validateEnvelope(validEnv).valid, true);
  assert.equal(validateEnvelope({ ...validEnv, aggregate_version: 0, source_product: 'erp' }).valid, false);
  assert.equal(
    validateDriverEarningLineV2({
      earning_line_id: 'EARN-1:v1',
      revision: 1,
      job_id: 'JOB-1',
      driver_id: 'DRV-1',
      driver_name: 'สมชาย',
      employment_type: 'employee',
      sub_id: null,
      plan_date: '2026-11-15',
      delivery_date: '2026-11-15',
      verified_at: '2026-11-16T10:00:00+07:00',
      payment_owner: 'hr_payroll',
      amount_minor: 125000,
      currency: 'THB',
      amount_decimal: 1250,
    }).valid,
    true
  );

  // ExternalEntityLinkStore uniqueness + cross-tenant rejection
  const linkStore = new ExternalEntityLinkStore();
  linkStore.linkExternalEntity({
    tenantId: 'tenant-alpha',
    connectionId: 'conn-alpha',
    sourceSystem: 'wms',
    sourceType: 'outbound_order',
    sourceId: 'ORD-001',
    targetSystem: 'tms',
    targetType: 'job',
    targetId: 'JOB-001',
  });
  assert.throws(
    () =>
      linkStore.linkExternalEntity({
        tenantId: 'tenant-alpha',
        connectionId: 'conn-alpha',
        sourceSystem: 'wms',
        sourceType: 'outbound_order',
        sourceId: 'ORD-001',
        targetSystem: 'tms',
        targetType: 'job',
        targetId: 'JOB-999',
      }),
    /conflict/i
  );
  assert.throws(
    () =>
      linkStore.resolveExternalEntity({
        tenantId: 'tenant-beta',
        connectionId: 'conn-alpha',
        sourceSystem: 'wms',
        sourceType: 'outbound_order',
        sourceId: 'ORD-001',
      }),
    /cross-tenant/i
  );

  // Legacy notes backfill parser
  const legacy = parseLegacyWmsNotesForBackfillOnly('[WMS: ORD-2026-0001] [Trip: TRIP-1] [Drop: 1/2]');
  assert.equal(legacy.backfillOnly, true);
  assert.deepEqual(legacy.wmsOrderNos, ['ORD-2026-0001']);
  assert.equal(legacy.dropIndex, 1);

  // DriverEmployeeLinkStore rejects unverified fuzzy linking
  const drvStore = new DriverEmployeeLinkStore();
  assert.throws(
    () =>
      drvStore.upsertVerifiedDriverEmployeeLink({
        tenantId: 'tenant-alpha',
        hrEmployeeId: 'EMP-A01',
        tmsDriverId: 'DRV-A01',
        employmentClassification: 'employee',
        verifiedBy: '',
      }),
    /UNVERIFIED_LINK_REJECTED/
  );

  // HMAC signing, key rotation, replay window
  const rawBody = JSON.stringify({ event_id: 'evt-1', amount: 1250 });
  const headersK1 = signWebhookPayload(rawBody, 'secret-k1', 'k1', 1_700_000_000);
  const secrets = { k1: 'secret-k1', k2: 'secret-k2' };
  assert.equal(
    verifyWebhookSignature({
      rawBody,
      signatureHeader: headersK1['x-nexus-signature'],
      timestampHeader: headersK1['x-nexus-timestamp'],
      keyIdHeader: headersK1['x-nexus-key-id'],
      secretsByKeyId: secrets,
      nowSec: 1_700_000_120,
    }).valid,
    true
  );
  // Outside 300s window -> rejected
  assert.equal(
    verifyWebhookSignature({
      rawBody,
      signatureHeader: headersK1['x-nexus-signature'],
      timestampHeader: headersK1['x-nexus-timestamp'],
      keyIdHeader: headersK1['x-nexus-key-id'],
      secretsByKeyId: secrets,
      nowSec: 1_700_000_400,
    }).valid,
    false
  );
  // Key rotation k2
  const headersK2 = signWebhookPayload(rawBody, 'secret-k2', 'k2', 1_700_000_100);
  assert.equal(
    verifyWebhookSignature({
      rawBody,
      signatureHeader: headersK2['x-nexus-signature'],
      timestampHeader: headersK2['x-nexus-timestamp'],
      keyIdHeader: headersK2['x-nexus-key-id'],
      secretsByKeyId: secrets,
      nowSec: 1_700_000_150,
    }).keyId,
    'k2'
  );

  // Outbox lease recovery, permanent 4xx vs transient 5xx -> dead_letter, error redaction, backoff
  assert.ok(computeBackoffMs(2, { baseMs: 1000, randomFn: () => 0.5 }) >= 2000);
  const store = new IntegrationOutboxInboxStore();
  enqueueOutboxEvent(
    {
      eventId: 'evt-perm',
      tenantId: 'tenant-alpha',
      connectionId: 'conn-1',
      aggregateId: 'AGG-1',
      payload: { ok: true },
      nowMs: 1000,
    },
    store
  );
  enqueueOutboxEvent(
    {
      eventId: 'evt-trans',
      tenantId: 'tenant-alpha',
      connectionId: 'conn-1',
      aggregateId: 'AGG-2',
      payload: { ok: true },
      nowMs: 1000,
    },
    store
  );

  const res1 = await processOutboxBatch(
    {
      workerId: 'w1',
      nowMs: 1000,
      maxAttempts: 2,
      signingConfig: { secret: 'secret-k1', keyId: 'k1' },
      backoffOptions: { baseMs: 500, randomFn: () => 0 },
      deliverFn: async (rec) => {
        if (rec.eventId === 'evt-perm') {
          return { ok: false, httpStatus: 422, error: 'Bad schema token=secret_xyz salary=50000' };
        }
        return { ok: false, httpStatus: 503, error: 'Upstream timeout Bearer abc.def.ghi' };
      },
    },
    store
  );

  const permRec = store.outbox.get('conn-1::evt-perm');
  assert.equal(permRec.status, 'failed_permanent');
  assert.ok(!permRec.lastErrorRedacted.includes('secret_xyz'));
  assert.ok(!permRec.lastErrorRedacted.includes('50000'));
  assert.equal(res1.claimedCount, 2);

  // Crash recovery: simulate stuck processing lease expired at t=50000
  const transRec = store.outbox.get('conn-1::evt-trans');
  transRec.status = 'processing';
  transRec.leaseOwner = 'crashed-worker';
  transRec.leaseExpiresAt = 5000;
  const recovered = claimOutboxBatch({ workerId: 'w2', nowMs: 6000 }, store);
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].eventId, 'evt-trans');

  // Re-run via processOutboxBatch -> hits maxAttempts=2 -> dead_letter and re-signs with current ts
  transRec.status = 'pending';
  transRec.nextAttemptAt = 6000;
  let capturedTs = null;
  await processOutboxBatch(
    {
      workerId: 'w2',
      nowMs: 7_000_000,
      maxAttempts: 2,
      signingConfig: { secret: 'secret-k2', keyId: 'k2' },
      deliverFn: async (_rec, meta) => {
        capturedTs = meta.attemptTimestampSec;
        return { ok: false, httpStatus: 500, error: 'still down' };
      },
    },
    store
  );
  assert.equal(capturedTs, 7000);
  assert.equal(store.outbox.get('conn-1::evt-trans').status, 'dead_letter');

  // Inbox dedup, 409 mismatch, stale version, 500 on persistence failure
  let applyCount = 0;
  const in1 = await receiveAndApplyInboxEvent(
    {
      connectionId: 'conn-1',
      tenantId: 'tenant-alpha',
      eventId: 'in-1',
      aggregateId: 'JOB-1',
      aggregateVersion: 2,
      payload: { status: 'Delivered', drop: 1 },
      applyFn: async () => {
        applyCount++;
      },
    },
    store
  );
  assert.equal(in1.status, 'applied');
  assert.equal(applyCount, 1);

  const inDup = await receiveAndApplyInboxEvent(
    {
      connectionId: 'conn-1',
      tenantId: 'tenant-alpha',
      eventId: 'in-1',
      aggregateId: 'JOB-1',
      aggregateVersion: 2,
      payload: { drop: 1, status: 'Delivered' }, // canonical match despite key order
      applyFn: async () => {
        applyCount++;
      },
    },
    store
  );
  assert.equal(inDup.status, 'duplicate_ignored');
  assert.equal(inDup.httpStatus, 200);
  assert.equal(applyCount, 1);

  const inMismatch = await receiveAndApplyInboxEvent(
    {
      connectionId: 'conn-1',
      tenantId: 'tenant-alpha',
      eventId: 'in-1',
      aggregateId: 'JOB-1',
      aggregateVersion: 2,
      payload: { status: 'Cancelled' },
    },
    store
  );
  assert.equal(inMismatch.status, 'conflict_payload_mismatch');
  assert.equal(inMismatch.httpStatus, 409);

  const inStale = await receiveAndApplyInboxEvent(
    {
      connectionId: 'conn-1',
      tenantId: 'tenant-alpha',
      eventId: 'in-2',
      aggregateId: 'JOB-1',
      aggregateVersion: 1,
      payload: { status: 'In Transit' },
      applyFn: async () => {
        applyCount++;
      },
    },
    store
  );
  assert.equal(inStale.status, 'rejected_stale_version');
  assert.equal(applyCount, 1);

  const inFailPersist = await receiveAndApplyInboxEvent(
    {
      connectionId: 'conn-1',
      tenantId: 'tenant-alpha',
      eventId: 'in-3',
      aggregateId: 'JOB-1',
      aggregateVersion: 3,
      payload: { status: 'Verified' },
      persistInboxFn: async () => {
        throw new Error('DB disk full');
      },
    },
    store
  );
  assert.equal(inFailPersist.httpStatus, 500);
});

test('TASK-E05, TASK-E06, TASK-F01 & TASK-F02: End-to-end HR critical flows, manuals filtering, controlled TMS payroll import & immutability', async () => {
  const { database: db, files } = await import('./support/isolated-supabase.mjs');
  const originalFetch = globalThis.fetch;
  const oldNexus = Object.fromEntries(['NEXUS_TMS_URL','NEXUS_TMS_API_KEY','NEXUS_TMS_CONNECTION_ID'].map(key => [key,process.env[key]]));
  let nexusLines = [];
  process.env.NEXUS_TMS_URL='https://nexus.example.test'; process.env.NEXUS_TMS_API_KEY='test-key'; process.env.NEXUS_TMS_CONNECTION_ID='conn-alpha';
  globalThis.fetch = async (url) => String(url).endsWith('/claim') ? Response.json({success:true}) : Response.json({version:2,tenantId:'tenant-alpha',connectionId:'conn-alpha',period:new URL(url).searchParams.get('period'),lines:nexusLines});
  const prevTenant = process.env.HR_TENANT_ID;
  const prevIntegrationKey = process.env.HR_INTEGRATION_KEY;
  const prevProfileEnv = process.env.HR_COMPANY_PROFILE_JSON;

  try {
    process.env.HR_TENANT_ID = 'tenant-alpha';
    process.env.HR_INTEGRATION_KEY = 'hr-tms-shared-key';
    process.env.HR_COMPANY_PROFILE_JSON = JSON.stringify({
      legalName: 'บริษัท อัลฟ่า โลจิสติกส์ จำกัด',
      name: 'Alpha Logistics',
      taxId: '0105560000099',
      address: '99 ถนนพระราม 9 กรุงเทพฯ 10310',
    });
    process.env.LINE_CHANNEL_ACCESS_TOKEN = '';

    await db.exec('create role anon;create role authenticated;create role service_role;');
    for (const file of [
      'schema.sql',
      'schema-hr.sql',
      ...[1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21].map((n) => `schema-phase${n}.sql`),
      'migrations/006_entitlements_and_quotas.sql',
      'migrations/007_integration_links_outbox_inbox.sql',
      'migrations/008_payroll_import_batches.sql',
      'migrations/010_driving_income.sql',
    ]) {
      await db.exec(await fs.readFile(new URL('supabase/' + file, root), 'utf8'));
    }

    const password = 'test-password-only';
    const hash = await bcrypt.hash(password, 4);
    for (const [id, role, name, manager] of [
      ['HR1', 'hr', 'HR Lead', null],
      ['ADMIN1', 'admin', 'Admin Lead', null],
      ['EMP-DRV1', 'employee', 'สมชาย ขับดี', null],
      ['EMP-RESIGNED', 'employee', 'สมศักดิ์ ลาออก', null],
    ]) {
      await db.query(
        'insert into users(id,username,password,name,role,employee_id,manager_id,status) values($1,$1,$2,$3,$4,$1,$5,$6)',
        [id, hash, name, role, manager, id === 'EMP-RESIGNED' ? 'resigned' : 'active']
      );
      await db.query('insert into employee_records(employee_id,salary) values($1,20000)', [id]);
    }
    await db.exec("insert into leave_types(code, name, days_per_year, paid, deduct_balance) values('unpaid','ลาไม่รับค่าจ้าง',10,false,false) on conflict (code) do update set days_per_year=10, deduct_balance=false, paid=false");

    // Seed manuals: one company-only, one shared/partner_driver with private stored file
    const manualFile = 'manuals/safety-driver.pdf';
    files.set(manualFile, Buffer.from('%PDF-1.4 driver safety manual'));
    await db.query(
      `insert into documents(id, name, file_name, stored_file_name, category, type, access_roles)
       values ('doc-co', 'Internal Company SOP', 'internal-sop.pdf', 'manuals/internal-sop.pdf', 'driver-manuals', 'pdf', array['employee'])`
    );
    await db.query(
      `insert into documents(id, name, file_name, stored_file_name, category, type, access_roles)
       values ('doc-sub', 'Partner Driver Manual', 'safety-driver.pdf', $1, 'driver-manuals', 'pdf', array['partner_driver', 'employee'])`,
      [manualFile]
    );

    const { clearEntitlementsForTests, setTenantEntitlementForTests } = await import('../lib/entitlements.js');
    const { clearDriverLinksForTests } = await import('../lib/driver-employee-links.js');
    const { clearPayrollImportsForTests, setPeriodLock, postImportBatchToPayroll } = await import('../lib/payroll-tms-import.js');
    const { clearIntegrationOpsForTests, getIntegrationOperationsSummary, runDryRunReconciliation, applyReconciliationRepair } = await import('../lib/integration-ops.js');

    clearEntitlementsForTests();
    clearDriverLinksForTests();
    clearPayrollImportsForTests();
    clearIntegrationOpsForTests();
    setTenantEntitlementForTests('tenant-alpha', { packageCode: 'FULL_SUITE', state: 'active' });

    const login = await import('../app/api/auth/login/route.js');
    const clock = await import('../app/api/me/clock/route.js');
    const leave = await import('../app/api/me/leave/route.js');
    const leaveReview = await import('../app/api/hr/leave/[id]/approve/route.js');
    const ot = await import('../app/api/me/ot/route.js');
    const driverLinksRoute = await import('../app/api/hr/driver-links/route.js');
    const driverManualsRoute = await import('../app/api/public/driver-manuals/route.js');
    const docDownloadRoute = await import('../app/api/documents/[id]/download/route.js');
    const tmsImportRoute = await import('../app/api/hr/payroll/tms-import/route.js');
    const generateRoute = await import('../app/api/hr/payroll/generate/route.js');
    const confirmPayRoute = await import('../app/api/hr/payroll/confirm-pay/route.js');
    const notifyRoute = await import('../app/api/hr/payroll/[id]/notify/route.js');
    const taxCertRoute = await import('../app/api/me/tax-cert/route.js');
    const exportRoute = await import('../app/api/hr/payroll/export/route.js');
    const opsRoute = await import('../app/api/hr/integrations/ops/route.js');

    const req = (path, cookie, body, extraHeaders = {}) => {
      // The mock remote owns the source; the request's amounts must be ignored by the handler.
      if (body?.lines) nexusLines = structuredClone(body.lines);
      return new Request('https://hr.test' + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { ...(cookie ? { cookie } : {}), 'Content-Type': 'application/json', ...extraHeaders },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    };

    const cookies = {};
    for (const id of ['HR1', 'ADMIN1', 'EMP-DRV1']) {
      const r = await login.POST(req('/api/auth/login', null, { username: id, password }));
      assert.equal(r.status, 200);
      cookies[id] = r.headers.get('set-cookie').split(';')[0];
    }

    // 1. TASK-E05: Server-side manual audience filtering & scoped download token
    const subManualRes = await driverManualsRoute.GET(
      req('/api/public/driver-manuals?audience=subcontractor', null, undefined, {
        'x-tms-api-key': 'hr-tms-shared-key',
      })
    );
    assert.equal(subManualRes.status, 200);
    const subManualJson = await subManualRes.json();
    assert.equal(subManualJson.manuals.length, 1);
    assert.equal(subManualJson.manuals[0].id, 'doc-sub');
    assert.ok(subManualJson.manuals[0].downloadUrl.includes('/api/documents/doc-sub/download?token='));

    const coManualRes = await driverManualsRoute.GET(
      req('/api/public/driver-manuals?audience=company', null, undefined, {
        Authorization: 'Bearer hr-tms-shared-key',
      })
    );
    assert.equal(coManualRes.status, 200);
    const coManualJson = await coManualRes.json();
    assert.equal(coManualJson.manuals.length, 2);

    // Download private manual via scoped token works without user cookie
    const dlRes = await docDownloadRoute.GET(
      req(subManualJson.manuals[0].downloadUrl, null),
      { params: Promise.resolve({ id: 'doc-sub' }) }
    );
    assert.equal(dlRes.status, 200);

    // 2. TASK-E05: Verified driver-employee link creation (rejects empty verifiedBy / unverified auto-link)
    const linkRes = await driverLinksRoute.POST(
      req('/api/hr/driver-links', cookies.HR1, {
        tmsDriverId: 'DRV-A01',
        hrEmployeeId: 'EMP-DRV1',
        employmentClassification: 'employee',
        connectionId: 'conn-alpha',
      })
    );
    assert.equal(linkRes.status, 201);

    // 3. TASK-F02: Attendance check-in -> partial unpaid leave + HR approval -> OT request & approval
    const clockInRes = await clock.POST(
      req('/api/me/clock', cookies['EMP-DRV1'], {
        action: 'in',
        check_type: 'offsite',
        latitude: 13.7563,
        longitude: 100.5018,
      })
    );
    assert.equal(clockInRes.status, 200);

    const leavePost = await leave.POST(
      req('/api/me/leave', cookies['EMP-DRV1'], {
        leave_type: 'unpaid',
        start_date: '2026-11-10',
        end_date: '2026-11-10',
        session: 'half_morning',
      })
    );
    assert.equal(leavePost.status, 200);
    const leaveId = (await leavePost.json()).item.id;
    const leaveApprove = await leaveReview.POST(
      req(`/api/hr/leave/${leaveId}/approve`, cookies.HR1, { action: 'approve' }),
      { params: Promise.resolve({ id: String(leaveId) }) }
    );
    assert.equal(leaveApprove.status, 200);

    const otPost = await ot.POST(
      req('/api/me/ot', cookies['EMP-DRV1'], { ot_date: '2026-11-11', hours: 3, note: 'Overtime trip' })
    );
    assert.equal(otPost.status, 200);
    const otId = (await otPost.json()).item.id;
    await db.query("update ot_records set status='approved', amount=500 where id=$1", [otId]);

    // 4. TASK-F01: Controlled payroll import state machine + all guards + reconciliation equation
    const draftRes = await tmsImportRoute.POST(
      req('/api/hr/payroll/tms-import', cookies.HR1, {
        action: 'create_draft',
        period: '2026-11',
        connectionId: 'conn-alpha',
        recognitionPolicy: 'verified_date',
        lines: [
          {
            earning_line_id: 'EARN-JOB-001:v1',
            revision: 1,
            job_id: 'JOB-001',
            driver_id: 'DRV-A01',
            verified_at: '2026-11-12T10:00:00+07:00',
            payment_owner: 'hr_payroll',
            amount_minor: 125000, // 1,250.00 THB
            currency: 'THB',
          },
          {
            // Duplicate of same earning_line_id + revision in same batch -> skipped!
            earning_line_id: 'EARN-JOB-001:v1',
            revision: 1,
            job_id: 'JOB-001',
            driver_id: 'DRV-A01',
            verified_at: '2026-11-12T10:00:00+07:00',
            payment_owner: 'hr_payroll',
            amount_minor: 125000,
            currency: 'THB',
          },
          {
            // Already paid by TMS -> excluded!
            earning_line_id: 'EARN-JOB-002:v1',
            revision: 1,
            job_id: 'JOB-002',
            driver_id: 'DRV-A01',
            verified_at: '2026-11-13T10:00:00+07:00',
            payment_owner: 'tms_paid',
            amount_minor: 90000,
            currency: 'THB',
          },
          {
            // Subcontractor -> excluded!
            earning_line_id: 'EARN-JOB-003:v1',
            revision: 1,
            job_id: 'JOB-003',
            driver_id: 'DRV-SUB-01',
            employment_type: 'subcontractor',
            sub_id: 'SUB-01',
            verified_at: '2026-11-14T10:00:00+07:00',
            payment_owner: 'hr_payroll',
            amount_minor: 420000,
            currency: 'THB',
          },
          {
            // Unmapped / inactive driver -> hold!
            earning_line_id: 'EARN-JOB-004:v1',
            revision: 1,
            job_id: 'JOB-004',
            driver_id: 'DRV-UNMAPPED',
            verified_at: '2026-11-14T10:00:00+07:00',
            payment_owner: 'hr_payroll',
            amount_minor: 60000,
            currency: 'THB',
          },
        ],
      })
    );
    assert.equal(draftRes.status, 201);
    const { batch: draftBatch } = await draftRes.json();
    assert.equal(draftBatch.status, 'draft');
    assert.equal(draftBatch.reconciliation.balanced, true);
    assert.equal(draftBatch.reconciliation.sourceTotalMinor, 820000);
    assert.equal(draftBatch.reconciliation.importedPayableMinor, 125000);
    assert.equal(draftBatch.reconciliation.duplicateSkippedMinor, 125000);
    assert.equal(draftBatch.reconciliation.excludedTmsPaidMinor, 90000);
    assert.equal(draftBatch.reconciliation.excludedSubcontractorMinor, 420000);
    assert.equal(draftBatch.reconciliation.unmappedHoldMinor, 60000);
    assert.equal(draftBatch.lines[1].disposition, 'duplicate_skipped');
    assert.equal(draftBatch.lines[2].disposition, 'excluded_already_paid_in_tms');
    assert.equal(draftBatch.lines[3].disposition, 'excluded_subcontractor');
    assert.equal(draftBatch.lines[4].disposition, 'unmapped_or_inactive_hold');

    // Review -> Approve -> Post
    assert.equal(
      (await tmsImportRoute.POST(req('/api/hr/payroll/tms-import', cookies.HR1, { action: 'review', batchId: draftBatch.id }))).status,
      200
    );
    assert.equal(
      (await tmsImportRoute.POST(req('/api/hr/payroll/tms-import', cookies.HR1, { action: 'approve', batchId: draftBatch.id }))).status,
      200
    );
    const postRes = await tmsImportRoute.POST(
      req('/api/hr/payroll/tms-import', cookies.HR1, { action: 'post', batchId: draftBatch.id })
    );
    assert.equal(postRes.status, 200);
    assert.equal((await postRes.json()).batch.status, 'posted');

    // Revision 2 delta adjustment (+250 THB = 25000 satang) while period is still open
    const rev2DraftRes = await tmsImportRoute.POST(
      req('/api/hr/payroll/tms-import', cookies.HR1, {
        action: 'create_draft',
        period: '2026-11',
        connectionId: 'conn-alpha',
        lines: [
          {
            earning_line_id: 'EARN-JOB-001:v1',
            revision: 2,
            job_id: 'JOB-001',
            driver_id: 'DRV-A01',
            verified_at: '2026-11-12T10:00:00+07:00',
            payment_owner: 'hr_payroll',
            amount_minor: 150000, // revised from 1250 -> 1500
            currency: 'THB',
          },
        ],
      })
    );
    assert.equal(rev2DraftRes.status, 201);
    const { batch: rev2Batch } = await rev2DraftRes.json();
    assert.equal(rev2Batch.lines[0].disposition, 'imported_revision_delta');
    assert.equal(rev2Batch.reconciliation.importedPayableMinor, 25000);
    assert.equal(rev2Batch.reconciliation.balanced, true);

    await tmsImportRoute.POST(req('/api/hr/payroll/tms-import', cookies.HR1, { action: 'review', batchId: rev2Batch.id }));
    await tmsImportRoute.POST(req('/api/hr/payroll/tms-import', cookies.HR1, { action: 'approve', batchId: rev2Batch.id }));
    await tmsImportRoute.POST(req('/api/hr/payroll/tms-import', cookies.HR1, { action: 'post', batchId: rev2Batch.id }));

    // Reversal test: reverse rev2Batch before paying -> removes the 250 delta cleanly & preserves audit
    const revRes = await tmsImportRoute.POST(
      req('/api/hr/payroll/tms-import', cookies.HR1, {
        action: 'reverse',
        batchId: rev2Batch.id,
        reason: 'Correction requested by fleet manager',
      })
    );
    assert.equal(revRes.status, 200);
    assert.equal((await revRes.json()).batch.status, 'reversed');

    const slipAfterRev = (await db.query("select * from payroll_slips where employee_id='EMP-DRV1' and period='2026-11'")).rows[0];
    assert.equal(Number(slipAfterRev.driving_pay), 1250);

    assert.equal(Number(slipAfterRev.bonus), 0);
    assert.equal(slipAfterRev.recalculation_required, true);
    const blockedPayment = await confirmPayRoute.POST(req('/api/hr/payroll/confirm-pay', cookies.HR1, {period:'2026-11'}));
    assert.equal(blockedPayment.status, 409, 'An imported amount cannot be paid before tax recalculation');
    // Generate full payroll while retaining driving pay separately from bonus.
    const genRes = await generateRoute.POST(
      req('/api/hr/payroll/generate', cookies.HR1, { period: '2026-11', overwrite: true })
    );
    assert.equal(genRes.status, 200);
    const slipBeforePay = (await db.query("select * from payroll_slips where employee_id='EMP-DRV1' and period='2026-11'")).rows[0];
    assert.equal(Number(slipBeforePay.driving_pay), 1250);
    assert.equal(Number(slipBeforePay.ot_pay), 500);

    // Confirm payment -> status becomes 'paid'
    const payRes = await confirmPayRoute.POST(
      req('/api/hr/payroll/confirm-pay', cookies.HR1, { slipId: slipBeforePay.id })
    );
    assert.equal(payRes.status, 200);

    // Paid slip immutability: regenerate with overwrite=true must NOT alter paid slip
    await db.query("update employee_records set salary=50000 where employee_id='EMP-DRV1'");
    await generateRoute.POST(req('/api/hr/payroll/generate', cookies.HR1, { period: '2026-11', overwrite: true }));
    const slipAfterRegen = (await db.query("select * from payroll_slips where id=$1", [slipBeforePay.id])).rows[0];
    assert.equal(slipAfterRegen.status, 'paid');
    assert.equal(Number(slipAfterRegen.base_salary), 20000);

    // Late notification failure (503 LINE unconfigured) must NOT revert paid status
    const notifyRes = await notifyRoute.POST(
      req(`/api/hr/payroll/${slipBeforePay.id}/notify`, cookies.HR1, {}),
      { params: Promise.resolve({ id: String(slipBeforePay.id) }) }
    );
    assert.equal(notifyRes.status, 503);
    assert.equal((await db.query('select status from payroll_slips where id=$1', [slipBeforePay.id])).rows[0].status, 'paid');

    // Period lock / paid slip blocks posting new batch into closed period (409 PERIOD_LOCKED)
    const lockedDraft = await tmsImportRoute.POST(
      req('/api/hr/payroll/tms-import', cookies.HR1, {
        action: 'create_draft',
        period: '2026-11',
        connectionId: 'conn-alpha',
        lines: [
          {
            earning_line_id: 'EARN-JOB-009:v1',
            revision: 1,
            job_id: 'JOB-009',
            driver_id: 'DRV-A01',
            verified_at: '2026-11-18T10:00:00+07:00',
            payment_owner: 'hr_payroll',
            amount_minor: 50000,
            currency: 'THB',
          },
        ],
      })
    );
    const lockedBatchId = (await lockedDraft.json()).batch.id;
    await tmsImportRoute.POST(req('/api/hr/payroll/tms-import', cookies.HR1, { action: 'review', batchId: lockedBatchId }));
    await tmsImportRoute.POST(req('/api/hr/payroll/tms-import', cookies.HR1, { action: 'approve', batchId: lockedBatchId }));
    await setPeriodLock('tenant-alpha', '2026-11', true, 'HR1');
    await assert.rejects(
      () => postImportBatchToPayroll({ tenantId: 'tenant-alpha', batchId: lockedBatchId, actorId: 'HR1' }),
      (err) => err.code === 'PERIOD_LOCKED' && err.status === 409
    );

    // Tax 50 Tawi & PND1 export reflect paid taxable income (20000 + 500 OT + 1250 bonus = 21750)
    const taxRes = await taxCertRoute.GET(req('/api/me/tax-cert?year=2569', cookies['EMP-DRV1']));
    assert.equal(taxRes.status, 200);
    const taxData = await taxRes.json();
    assert.equal(taxData.totalIncome, 21750);

    const pndRes = await exportRoute.GET(req('/api/hr/payroll/export?period=2026-11&format=pnd1', cookies.HR1));
    assert.equal(pndRes.status, 200);
    const pndCsv = await pndRes.text();
    assert.ok(pndCsv.includes('EMP-DRV1'));
    assert.ok(pndCsv.includes('21750'));

    // 5. TASK-E06: Integration ops summary + dry-run reconciliation + explicit repair approval
    const opsSummaryRes = await opsRoute.GET(req('/api/hr/integrations/ops', cookies.HR1));
    assert.equal(opsSummaryRes.status, 200);
    const opsSummary = await opsSummaryRes.json();
    assert.equal(opsSummary.tenantId, 'tenant-alpha');

    const dryRun = runDryRunReconciliation(
      { tenantId: 'tenant-alpha' },
      {
        sourceItems: [
          { id: 'EARN-1', status: 'verified', amountMinor: 125000 },
          { id: 'EARN-2', status: 'verified', amountMinor: 50000, requiresIdentityMapping: true },
        ],
        localItems: [{ id: 'EARN-1', status: 'draft', amountMinor: 100000, authoritative: true }],
      }
    );
    assert.equal(dryRun.dryRun, true);
    assert.equal(dryRun.driftCount, 3); // status_mismatch + amount_mismatch + unmapped_identity

    const repairRes = await applyReconciliationRepair(
      { tenantId: 'tenant-alpha', role: 'hr', userId: 'HR1' },
      { approvedIds: ['EARN-1'], actorId: 'HR1', drifts: dryRun.drifts }
    );
    // Authoritative records are protected from silent overwrite
    assert.equal(repairRes.repaired.length, 0);
    assert.equal(repairRes.skipped[0].reason, 'authoritative_record_protected');
    assert.ok((await getIntegrationOperationsSummary({ tenantId: 'tenant-alpha' })).tenantId === 'tenant-alpha');
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key,value] of Object.entries(oldNexus)) { if (value === undefined) delete process.env[key]; else process.env[key]=value; }
    if (prevTenant === undefined) delete process.env.HR_TENANT_ID;
    else process.env.HR_TENANT_ID = prevTenant;
    if (prevIntegrationKey === undefined) delete process.env.HR_INTEGRATION_KEY;
    else process.env.HR_INTEGRATION_KEY = prevIntegrationKey;
    if (prevProfileEnv === undefined) delete process.env.HR_COMPANY_PROFILE_JSON;
    else process.env.HR_COMPANY_PROFILE_JSON = prevProfileEnv;
    await db.close();
    hooks.deregister();
  }
});
