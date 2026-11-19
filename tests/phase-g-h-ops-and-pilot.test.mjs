import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHmac } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import {
  runTenantProvisioning,
  clearProvisioningStateForTests,
} from '../lib/provisioning.js';
import {
  computeMigrationChecksum,
  verifyMigrationLedger,
  planProvenanceBackfill,
} from '../lib/migration-runner.js';
import {
  grantSupportAccessToken,
  verifySupportAccess,
  redactAuditEvent,
  initiateTenantExitExport,
  getImmutableAuditLog,
  clearOpsPrivacySupportForTests,
} from '../lib/ops-privacy-support.js';
import {
  createPlatformSubscriptionInvoice,
  applyPlatformPaymentWebhook,
  clearCommercialControlForTests,
} from '../lib/commercial-control.js';

const execFileAsync = promisify(execFile);

test('TASK-G01 (HR): runTenantProvisioning resumes idempotently after mid-way failure without duplicating records', async () => {
  clearProvisioningStateForTests();
  let tenantCreateCalls = 0;
  let adminAttempts = 0;

  const firstRun = await runTenantProvisioning({
    tenantId: 'tenant-alpha',
    idempotencyKey: 'prov-alpha-001',
    orgName: 'Alpha Logistics',
    adminUsername: 'admin@alpha.test',
    seedDemo: false,
    handlers: {
      create_tenant_and_binding: () => {
        tenantCreateCalls++;
      },
      invite_first_admin: () => {
        adminAttempts++;
        if (adminAttempts === 1) {
          throw new Error('SMTP gateway temporarily unavailable');
        }
      },
    },
  });

  assert.equal(firstRun.ok, false);
  assert.equal(firstRun.failedStep, 'invite_first_admin');
  assert.equal(tenantCreateCalls, 1);

  const resumedRun = await runTenantProvisioning({
    tenantId: 'tenant-alpha',
    idempotencyKey: 'prov-alpha-001',
    orgName: 'Alpha Logistics',
    adminUsername: 'admin@alpha.test',
    seedDemo: false,
    handlers: {
      create_tenant_and_binding: () => {
        tenantCreateCalls++;
      },
      invite_first_admin: () => {
        adminAttempts++;
      },
    },
  });

  assert.equal(resumedRun.ok, true);
  assert.equal(resumedRun.resumed, true);
  assert.equal(resumedRun.status, 'completed');
  assert.equal(tenantCreateCalls, 1, 'Completed step must not re-run or duplicate tenant');
  assert.equal(resumedRun.state.createdRecords.demoSeeded, false);
});

test('TASK-G02 (HR): verifyMigrationLedger detects pending & checksum drift, and planProvenanceBackfill quarantines ambiguous rows', async () => {
  const migrationsDir = path.resolve('..', 'reports', 'antigravity-nexus', 'migrations');
  const files = (await fs.readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
  assert.ok(files.length >= 8, 'Expected 001..008 SQL migration files');

  const available = await Promise.all(
    files.map(async (f) => ({
      version: f.slice(0, 3),
      name: f,
      content: await fs.readFile(path.join(migrationsDir, f), 'utf8'),
    })),
  );

  // 1) Missing latest migration -> pending detected
  const appliedPartial = available.slice(0, available.length - 1).map((m) => ({
    version: m.version,
    checksum: computeMigrationChecksum(m.content),
    status: 'applied',
  }));
  const pendingCheck = verifyMigrationLedger(appliedPartial, available);
  assert.equal(pendingCheck.ok, false);
  assert.equal(pendingCheck.pending.length, 1);
  assert.equal(pendingCheck.hasDrift, false);

  // 2) Tampered checksum -> checksumDrift detected & canProceed false
  const appliedTampered = available.map((m, idx) => ({
    version: m.version,
    checksum: idx === 0 ? 'deadbeef0000' : computeMigrationChecksum(m.content),
    status: 'applied',
  }));
  const driftCheck = verifyMigrationLedger(appliedTampered, available);
  assert.equal(driftCheck.ok, false);
  assert.equal(driftCheck.hasDrift, true);
  assert.equal(driftCheck.canProceed, false);
  assert.equal(driftCheck.checksumDrift[0].version, available[0].version);

  // 3) Provenance backfill validator never dumps ambiguous rows into DEFAULT_ORG
  const backfillPlan = planProvenanceBackfill(
    [
      { id: 'r1', branch_id: 'BR-ALPHA-1' },
      { id: 'r2', candidateTenantIds: ['tenant-alpha', 'tenant-beta'] },
      { id: 'r3' },
    ],
    {
      validTenantIds: ['tenant-alpha', 'tenant-beta'],
      branchTenantMap: { 'BR-ALPHA-1': 'tenant-alpha' },
    },
  );
  assert.equal(backfillPlan.mapped.length, 1);
  assert.equal(backfillPlan.mapped[0].resolvedTenantId, 'tenant-alpha');
  assert.equal(backfillPlan.quarantine.length, 2);
  assert.equal(backfillPlan.quarantine[0].reason, 'AMBIGUOUS_PROVENANCE');
  assert.equal(backfillPlan.quarantine[1].reason, 'MISSING_PROVENANCE');
});

test('TASK-G04 (HR): bounded support access logs redacted audits & tenant exit revokes credentials while preserving statutory docs', () => {
  clearOpsPrivacySupportForTests();

  assert.throws(
    () =>
      grantSupportAccessToken({
        tenantId: 'tenant-alpha',
        supportActorId: 'sup-1',
        reason: 'short',
        ttlMinutes: 15,
      }),
    /at least 10 characters/,
  );

  assert.throws(
    () =>
      grantSupportAccessToken({
        tenantId: 'tenant-alpha',
        supportActorId: 'sup-1',
        reason: 'Investigate ticket INC-991 payroll mismatch',
        ttlMinutes: 120,
      }),
    /between 1 and 60/,
  );

  const t0 = 1_700_000_000_000;
  const grant = grantSupportAccessToken({
    tenantId: 'tenant-alpha',
    supportActorId: 'sup-1',
    reason: 'Investigate ticket INC-991 payroll mismatch',
    ttlMinutes: 30,
    nowMs: t0,
  });

  const verified = verifySupportAccess(grant.token, {
    tenantId: 'tenant-alpha',
    action: 'READ_PAYROLL_DIAGNOSTIC',
    nowMs: t0 + 5 * 60 * 1000,
  });
  assert.equal(verified.authorized, true);
  assert.equal(verified.supportAccess, true);

  assert.throws(
    () =>
      verifySupportAccess(grant.token, {
        tenantId: 'tenant-beta',
        nowMs: t0 + 5 * 60 * 1000,
      }),
    /not valid for this tenant/,
  );

  assert.throws(
    () =>
      verifySupportAccess(grant.token, {
        tenantId: 'tenant-alpha',
        nowMs: t0 + 31 * 60 * 1000,
      }),
    /expired/,
  );

  const redacted = redactAuditEvent({
    tenantId: 'tenant-alpha',
    salary: 85000,
    bankAccountNo: '1234567890',
    tax_id: '0105560001111',
    correlationId: grant.correlationId,
  });
  assert.equal(redacted.salary, '[REDACTED]');
  assert.equal(redacted.bankAccountNo, '[REDACTED]');
  assert.equal(redacted.tax_id, '[REDACTED]');
  assert.equal(redacted.correlationId, grant.correlationId);

  const exitStore = {
    businessRecords: [{ id: 'emp-1', tenantId: 'tenant-alpha', salary: 50000 }],
    documentSnapshots: [{ id: 'snap-1', tenantId: 'tenant-alpha', number: 'DOC-1' }],
    statutoryDocuments: [{ id: 'tax-50tawi-1', tenantId: 'tenant-alpha', year: 2026 }],
    integrationCredentials: [{ keyId: 'k1', tenantId: 'tenant-alpha', status: 'active' }],
    pushSubscriptions: [{ id: 'sub-1', tenantId: 'tenant-alpha', active: true, quarantined: false }],
    tenantLifecycle: { state: 'active' },
  };

  const exitRes = initiateTenantExitExport({
    tenantId: 'tenant-alpha',
    actorId: 'platform-admin-1',
    reason: 'Contract ended by customer request',
    store: exitStore,
  });

  assert.equal(exitRes.lifecycleState, 'cancelled');
  assert.equal(exitRes.exitStatus, 'archived_pending_retention');
  assert.equal(exitRes.revokedCredentialsCount, 1);
  assert.equal(exitRes.disabledPushCount, 1);
  assert.equal(exitRes.retainedStatutoryDocumentsCount, 1);
  assert.equal(exitRes.autoDeletedStatutoryDocuments, false);
  assert.equal(exitStore.statutoryDocuments[0].retentionLocked, true);
  assert.equal(exitStore.integrationCredentials[0].status, 'revoked');
  assert.equal(exitStore.pushSubscriptions[0].quarantined, true);
  assert.ok(getImmutableAuditLog('tenant-alpha').some((e) => e.action === 'TENANT_EXIT_EXPORT_INITIATED'));
});

test('TASK-H02 & TASK-H03 (HR): capacity benchmark runs cleanly & commercial control separates platform issuer and rejects tenant admins', async () => {
  clearCommercialControlForTests();

  const benchPath = path.resolve('..', 'reports', 'antigravity-nexus', 'benchmarks', 'capacity-benchmark.mjs');
  const { stdout } = await execFileAsync(process.execPath, [benchPath]);
  const parsed = JSON.parse(stdout);
  assert.ok(parsed.benchmarks.concurrentQuotaReservation.opsPerSec > 0);
  assert.ok(parsed.benchmarks.outboxInboxHmacAndDedup.opsPerSec > 0);
  assert.ok(parsed.benchmarks.payrollImport100LinesReconcile.p95Ms >= 0);
  assert.equal(parsed.benchmarks.wmsSkuMutexContention.finalStock, 250);

  const contract = { contractId: 'CTR-ALPHA-1', tenantId: 'tenant-alpha', packageCode: 'FULL_SUITE', currency: 'THB' };
  const platformVendor = {
    entityId: 'ENT-PLATFORM-VENDOR',
    legalName: 'Antigravity Nexus Platform Co., Ltd.',
    taxId: '0105599990001',
  };
  const tenantEntity = {
    entityId: 'ENT-ALPHA-FREIGHT',
    tenantId: 'tenant-alpha',
    legalName: 'Alpha Freight & Logistics Co., Ltd.',
    taxId: '0105561112222',
  };

  // Tenant admin must NEVER self-approve or issue platform subscription invoices
  assert.throws(
    () =>
      createPlatformSubscriptionInvoice({
        actor: { id: 'u-alpha-admin', role: 'Super Admin', isTenantScoped: true },
        contract,
        platformVendorEntity: platformVendor,
        tenantLegalEntity: tenantEntity,
        billingItems: [{ code: 'RENT-SUITE', unitAmountMinor: 1000000 }],
      }),
    /cannot modify platform contracts|Platform operator role required/,
  );

  // Platform issuer cannot collide with tenant freight issuer
  assert.throws(
    () =>
      createPlatformSubscriptionInvoice({
        actor: { id: 'plat-1', role: 'platform_admin', isPlatformOperator: true },
        contract,
        platformVendorEntity: tenantEntity,
        tenantLegalEntity: tenantEntity,
        billingItems: [{ code: 'RENT-SUITE', unitAmountMinor: 1000000 }],
      }),
    /strictly separate/,
  );

  const invoice = createPlatformSubscriptionInvoice({
    actor: { id: 'plat-1', role: 'platform_admin', isPlatformOperator: true },
    contract,
    platformVendorEntity: platformVendor,
    tenantLegalEntity: tenantEntity,
    period: '2026-11',
    billingItems: [{ code: 'RENT-SUITE', description: 'Monthly SaaS Rent', unitAmountMinor: 1000000 }],
  });

  assert.equal(invoice.invoiceDomain, 'PLATFORM_SAAS_RENT');
  assert.equal(invoice.issuerRole, 'PLATFORM_VENDOR');
  assert.equal(invoice.issuerEntity.taxId, platformVendor.taxId);
  assert.equal(invoice.customerEntity.taxId, tenantEntity.taxId);
  assert.equal(invoice.totalMinor, 1070000);

  // Payment webhook verification + dedup + cross-tenant isolation
  const contracts = new Map([['CTR-ALPHA-1', contract]]);
  const secret = 'pay-wh-secret-1';
  const nowSec = 1_700_000_000;
  const event = {
    tenantId: 'tenant-alpha',
    eventId: 'pay-evt-1',
    contractId: 'CTR-ALPHA-1',
    amountMinor: 1070000,
    paymentStatus: 'paid',
  };
  const rawBody = JSON.stringify(event);
  const sig = `v1=${createHmac('sha256', secret).update(`${nowSec}.${rawBody}`).digest('hex')}`;
  const headers = {
    'x-nexus-signature': sig,
    'x-nexus-timestamp': String(nowSec),
    'x-nexus-key-id': 'pk1',
  };

  const payRes = applyPlatformPaymentWebhook({
    rawBody,
    signatureHeaders: headers,
    secretsByKeyId: { pk1: secret },
    contractStore: contracts,
    nowSec,
  });
  assert.equal(payRes.status, 'applied');
  assert.equal(contract.paymentStatus, 'paid');

  const dupRes = applyPlatformPaymentWebhook({
    rawBody,
    signatureHeaders: headers,
    secretsByKeyId: { pk1: secret },
    contractStore: contracts,
    nowSec,
  });
  assert.equal(dupRes.status, 'duplicate_ignored');

  // Cross-tenant payment payload rejected
  const crossEvent = {
    tenantId: 'tenant-beta',
    eventId: 'pay-evt-cross',
    contractId: 'CTR-ALPHA-1',
    amountMinor: 1070000,
  };
  const crossBody = JSON.stringify(crossEvent);
  const crossSig = `v1=${createHmac('sha256', secret).update(`${nowSec}.${crossBody}`).digest('hex')}`;
  assert.throws(
    () =>
      applyPlatformPaymentWebhook({
        rawBody: crossBody,
        signatureHeaders: {
          'x-nexus-signature': crossSig,
          'x-nexus-timestamp': String(nowSec),
          'x-nexus-key-id': 'pk1',
        },
        secretsByKeyId: { pk1: secret },
        contractStore: contracts,
        nowSec,
      }),
    /Cross-tenant payment webhook rejected/,
  );
});
