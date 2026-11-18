import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { registerHooks } from 'node:module';

const root = new URL('../', import.meta.url);
const fixture = new URL('./support/isolated-supabase.mjs', import.meta.url).href;
const hooks = registerHooks({ resolve(specifier, context, next) {
  if (specifier === 'next/server') return next('next/server.js', context);
  const target = specifier.startsWith('@/') ? new URL(specifier.slice(2) + (specifier.endsWith('.js') ? '' : '.js'), root).href
    : specifier.startsWith('.') ? new URL(specifier, context.parentURL).href : null;
  if (target === new URL('lib/supabase.js', root).href) return { url: fixture, shortCircuit: true };
  return specifier.startsWith('@/') ? { url: target, shortCircuit: true } : next(specifier, context);
} });

test('warehouse employee receives reviewed Nexus trips separately, with duplicates, revisions and payment guards', async () => {
  const { database: db } = await import('./support/isolated-supabase.mjs');
  const originalFetch = globalThis.fetch;
  const keys = ['HR_TENANT_ID', 'NEXUS_TMS_URL', 'NEXUS_TMS_API_KEY', 'NEXUS_TMS_CONNECTION_ID', 'LINE_CHANNEL_ACCESS_TOKEN'];
  const oldEnv = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  let amount = 125000, revision = 1, claims = 0;
  try {
    process.env.HR_TENANT_ID = 'test-tenant';
    process.env.NEXUS_TMS_URL = 'https://nexus.example.test';
    process.env.NEXUS_TMS_API_KEY = 'isolated-test-key';
    process.env.NEXUS_TMS_CONNECTION_ID = 'test-connection';
    process.env.LINE_CHANNEL_ACCESS_TOKEN = '';
    globalThis.fetch = async url => {
      if (String(url).endsWith('/claim')) { claims++; return Response.json({ success: true }); }
      assert.ok(String(url).startsWith('https://nexus.example.test/'), 'No external network calls are allowed');
      const line = { earning_line_id: 'job:J1:driver', job_id: 'J1', revision, driver_id: 'D1', verified_at: '2026-11-10T05:00:00Z', payment_owner: 'hr_payroll', amount_minor: amount, currency: 'THB' };
      return Response.json({ version: 2, tenantId: 'test-tenant', connectionId: 'test-connection', period: '2026-11', lines: [line,
        { ...line, earning_line_id: 'job:J2:driver', job_id: 'J2', payment_owner: 'tms_paid', amount_minor: 90000 },
        { ...line, earning_line_id: 'job:J3:driver', job_id: 'J3', employment_type: 'subcontractor', sub_id: 'SUB1', amount_minor: 420000 },
        { ...line, earning_line_id: 'job:J4:driver', job_id: 'J4', driver_id: 'UNMAPPED', amount_minor: 60000 },
      ] });
    };
    await db.exec('create role anon;create role authenticated;create role service_role;');
    for (const file of ['schema.sql', 'schema-hr.sql', ...[1,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21].map(n => `schema-phase${n}.sql`),
      'migrations/006_entitlements_and_quotas.sql', 'migrations/007_integration_links_outbox_inbox.sql', 'migrations/008_payroll_import_batches.sql', 'migrations/009_inbox_leases_and_quota_accounting_fix.sql', 'migrations/010_driving_income.sql']) {
      await db.exec(await fs.readFile(new URL('supabase/' + file, root), 'utf8'));
    }
    await db.exec(`insert into users(id,username,password,name,role,employee_id,department) values
      ('HR','HR','unused','HR','admin','HR','HR'),('WAREHOUSE','WAREHOUSE','unused','Warehouse employee','employee','WAREHOUSE','Warehouse');
      insert into employee_records(employee_id,salary,employment_type) values ('WAREHOUSE',40000,'monthly');`);
    const { createToken } = await import('../lib/auth.js');
    const { computeSlip } = await import('../lib/payroll.js');
    const { supabase } = await import('./support/isolated-supabase.mjs');
    const cookie = 'hr-token=' + createToken({ id: 'HR', name: 'HR', role: 'admin', employeeId: 'HR' });
    const request = (body, method = 'POST') => new Request('https://hr.example.test/api/hr/payroll/tms-import', { method, headers: { cookie, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const imports = await import('../app/api/hr/payroll/tms-import/route.js');
    const links = await import('../app/api/hr/driver-links/route.js');
    const generate = await import('../app/api/hr/payroll/generate/route.js');
    const payment = await import('../app/api/hr/payroll/confirm-pay/route.js');
    const manual = await import('../app/api/hr/[resource]/[id]/route.js');
    const linkResult = await links.POST(request({ tmsDriverId: 'D1', hrEmployeeId: 'WAREHOUSE', connectionId: 'test-connection', employmentClassification: 'employee', effectiveFrom: '2026-11-01' }));
    assert.equal(linkResult.status, 201);
    const slipData = computeSlip({ monthlySalary: 40000, bonusMonthly: 500, period: '2026-11' });
    assert.equal((await supabase.rpc('save_payroll_draft', { p_row: { employee_id: 'WAREHOUSE', period: '2026-11', calculation_version: 2, ...slipData }, p_overwrite: false })).error, null);
    const draft = async () => {
      const response = await imports.POST(request({ action: 'fetch_draft', period: '2026-11', lines: [{ amount_minor: 999999999 }], employees: [{ employeeId: 'ATTACKER' }], explicitLinks: [{ hrEmployeeId: 'ATTACKER' }] }));
      const result = await response.json(); assert.equal(response.status, 201, JSON.stringify(result)); return result.batch;
    };
    const action = (action, batch, extra = {}) => imports.POST(request({ action, batchId: batch.id, ...extra }));
    const approve = async batch => { assert.equal((await action('review', batch)).status, 200); assert.equal((await action('approve', batch)).status, 200); };
    const readSlip = async () => (await db.query("select * from payroll_slips where employee_id='WAREHOUSE' and period='2026-11'")).rows[0];
    const batch = await draft();
    assert.equal(batch.reconciliation.importedPayableMinor, 125000, 'Untrusted request amounts and recipient mappings must be ignored');
    assert.equal(batch.reconciliation.excludedTmsPaidMinor, 90000);
    assert.equal(batch.reconciliation.excludedSubcontractorMinor, 420000);
    assert.equal(batch.reconciliation.unmappedHoldMinor, 60000);
    assert.equal((await action('post', batch)).status, 409, 'Unapproved batches cannot be posted');
    await approve(batch);
    amount = 150000;
    assert.equal((await action('post', batch)).status, 409, 'A changed source amount invalidates the approved snapshot');
    assert.equal(claims, 0);
    amount = 125000;
    assert.equal((await action('post', batch)).status, 200);
    let slip = await readSlip();
    assert.equal(Number(slip.bonus), 500);
    assert.equal(Number(slip.driving_pay), 1250);
    assert.equal(slip.recalculation_required, true);
    assert.equal((await payment.POST(request({ slipId: slip.id }))).status, 409);
    const manualResult = await manual.PUT(request({ driving_pay: 999999, recalculation_required: false }, 'PUT'), { params: Promise.resolve({ resource: 'payroll', id: String(slip.id) }) });
    assert.equal(manualResult.status, 200);
    assert.equal(Number((await readSlip()).driving_pay), 1250);
    assert.equal((await readSlip()).recalculation_required, true);
    const duplicate = await draft();
    assert.equal(duplicate.reconciliation.importedPayableMinor, 0);
    assert.equal(duplicate.reconciliation.duplicateSkippedMinor, 125000);
    amount = 150000; revision = 2;
    const revised = await draft();
    assert.equal(revised.reconciliation.importedPayableMinor, 25000);
    await approve(revised);
    assert.equal((await action('post', revised)).status, 200);
    assert.equal(Number((await readSlip()).driving_pay), 1500);
    assert.equal((await action('reverse', batch, { reason: 'Must reverse newer revision first' })).status, 409);
    assert.equal((await action('reverse', revised, { reason: 'Correction' })).status, 200);
    assert.equal(Number((await readSlip()).driving_pay), 1250);
    assert.equal((await generate.POST(request({ period: '2026-11', overwrite: true }))).status, 200);
    slip = await readSlip();
    assert.equal(slip.recalculation_required, false);
    assert.equal(Number(slip.bonus), 500);
    assert.equal(Number(slip.driving_pay), 1250);
    assert.equal(Number(slip.base_salary), 40000);
    const expected = computeSlip({ monthlySalary: 40000, bonusMonthly: 500, drivingPay: 1250, period: '2026-11' });
    assert.equal(Number(slip.net), expected.net);
    await generate.POST(request({ period: '2026-11', overwrite: true }));
    assert.equal(Number((await readSlip()).net), expected.net, 'Regeneration is idempotent');
    assert.equal((await payment.POST(request({ slipId: slip.id }))).status, 200);
    assert.equal((await action('reverse', batch, { reason: 'Paid slips are immutable' })).status, 409);
    assert.equal((await readSlip()).status, 'paid');
    assert.equal((await db.query("select department from users where employee_id='WAREHOUSE'")).rows[0].department, 'Warehouse');
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(oldEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await db.close(); hooks.deregister();
  }
});
