import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { registerHooks } from 'node:module';
import bcrypt from 'bcryptjs';

const root = new URL('../', import.meta.url);
const fixtureURL = new URL('./support/isolated-supabase.mjs', import.meta.url).href;
registerHooks({
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

test('TASK-B06: mapTmsEarningsToHr fixes totalDriverCost, v2 amountMinor, strict identity, and subcontractor separation', async () => {
  const { mapTmsEarningsToHr, validateTmsUrl } = await import('../lib/tms-earnings-mapper.js');

  const employees = [
    { employeeId: 'EMP-A01', name: 'สมชาย ทดสอบ', department: 'Fleet' },
    { employeeId: 'EMP-A02', name: 'สมชาย ทดสอบ', department: 'Ops' },
    { employeeId: 'EMP-A03', name: '', department: 'Temp' },
  ];

  const explicitLinks = [
    { tmsDriverId: 'DRV-A01', hrEmployeeId: 'EMP-A01', active: true },
  ];

  const rawList = [
    // 1. v1 totalDriverCost with verified explicit link -> 1250 (never 0!)
    { Driver_ID: 'DRV-A01', Driver_Name: 'สมชาย ทดสอบ', tripCount: 3, totalDriverCost: 1250 },
    // 2. v2 amountMinor -> 1250.50
    { driverId: 'DRV-A01', driverName: 'สมชาย ทดสอบ', tripCount: 1, amountMinor: 125050 },
    // 3. Empty driverName must NOT match EMP-A01 or EMP-A03
    { Driver_ID: 'DRV-EMPTY-NAME', Driver_Name: '', tripCount: 2, totalDriverCost: 800 },
    // 4. Duplicate/substring name without verified link -> unmapped_review_required
    { Driver_ID: 'DRV-A03', Driver_Name: 'สมชาย', tripCount: 2, totalDriverCost: 600 },
    // 5. Subcontractor driver -> excluded_subcontractor
    { Driver_ID: 'DRV-A02', Driver_Name: 'รถร่วม สมชาย', Sub_ID: 'SUB-01', isSubcontractor: true, tripCount: 4, totalDriverCost: 4200 },
    // 6. Negative / NaN amounts -> invalid_amount
    { Driver_ID: 'DRV-A01', Driver_Name: 'สมชาย ทดสอบ', tripCount: 1, totalDriverCost: -100 },
    { Driver_ID: 'DRV-A01', Driver_Name: 'สมชาย ทดสอบ', tripCount: 1, totalDriverCost: 'not-a-number' },
  ];

  const result = mapTmsEarningsToHr(rawList, employees, explicitLinks);
  assert.equal(result.autoImportEnabled, false);

  const [v1Row, v2Row, emptyRow, fuzzyRow, subRow, negRow, nanRow] = result.earnings;

  assert.equal(v1Row.matched, true);
  assert.equal(v1Row.employeeId, 'EMP-A01');
  assert.equal(v1Row.driverCost, 1250);

  assert.equal(v2Row.matched, true);
  assert.equal(v2Row.driverCost, 1250.5);

  assert.equal(emptyRow.matched, false);
  assert.equal(emptyRow.employeeId, null);
  assert.equal(emptyRow.disposition, 'unmapped_review_required');

  assert.equal(fuzzyRow.matched, false);
  assert.equal(fuzzyRow.employeeId, null);
  assert.equal(fuzzyRow.disposition, 'unmapped_review_required');

  assert.equal(subRow.matched, false);
  assert.equal(subRow.isSubcontractor, true);
  assert.equal(subRow.employmentType, 'subcontractor');
  assert.equal(subRow.disposition, 'excluded_subcontractor');

  assert.equal(negRow.valid, false);
  assert.equal(negRow.status, 'invalid_amount');
  assert.equal(negRow.driverCost, null);

  assert.equal(nanRow.valid, false);
  assert.equal(nanRow.status, 'invalid_amount');
  assert.equal(nanRow.driverCost, null);

  assert.equal(result.summary.matchedEmployeeCount, 2);
  assert.equal(result.summary.unmappedCount, 2);
  assert.equal(result.summary.subcontractorCount, 1);
  assert.equal(result.summary.invalidCount, 2);
  assert.equal(result.summary.totalMatchedAmount, 2500.5);
  assert.equal(result.summary.totalSubcontractorAmount, 4200);

  // SSRF URL validation
  assert.equal(validateTmsUrl('http://127.0.0.1:3000').valid, false);
  assert.equal(validateTmsUrl('https://169.254.169.254').valid, false);
  assert.equal(validateTmsUrl('https://tms.example.com').valid, true);
});

test('TASK-B02 & TASK-B06: requireTenantContext and /api/hr/payroll/tms-earnings handler with isolated DB', async () => {
  const { database: db } = await import('./support/isolated-supabase.mjs');
  const prevTenantEnv = process.env.HR_TENANT_ID;
  const prevTmsUrl = process.env.NEXUS_TMS_URL;
  const prevTmsKey = process.env.NEXUS_TMS_API_KEY;
  const prevAllowLocal = process.env.ALLOW_LOCAL_INTEGRATION_URL;
  const originalFetch = globalThis.fetch;

  try {
    process.env.HR_TENANT_ID = 'tenant-alpha';

    await db.exec('create role anon;create role authenticated;create role service_role;');
    for (const file of ['schema.sql', 'schema-hr.sql', ...[1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21].map(n => `schema-phase${n}.sql`)]) {
      await db.exec(await fs.readFile(new URL('supabase/' + file, root), 'utf8'));
    }

    const hash = await bcrypt.hash('pass1234', 4);
    await db.query(
      "insert into users(id,username,password,name,role,employee_id,department,status) values('HR-1','hr1',$1,'HR Lead','hr','EMP-HR1','HR','active')",
      [hash]
    );
    await db.query(
      "insert into users(id,username,password,name,role,employee_id,department,status) values('EMP-A01','somchai',$1,'สมชาย ทดสอบ','employee','EMP-A01','Fleet','active')",
      [hash]
    );

    const { createToken } = await import('../lib/auth.js');
    const { requireTenantContext, TenantContextError } = await import('../lib/tenantContext.js');
    const tmsEarningsRoute = await import('../app/api/hr/payroll/tms-earnings/route.js');

    // Unauthenticated rejected
    await assert.rejects(
      () => requireTenantContext(new Request('https://hr.test/api/hr/payroll/tms-earnings')),
      TenantContextError
    );

    // Mismatched tenant token rejected
    const betaToken = createToken({ id: 'HR-1', role: 'hr', tenantId: 'tenant-beta' });
    await assert.rejects(
      () => requireTenantContext(new Request('https://hr.test/api/hr/payroll/tms-earnings', {
        headers: { Authorization: `Bearer ${betaToken}` },
      })),
      (err) => err instanceof TenantContextError && err.status === 401
    );

    // Valid tenant token succeeds and ignores body tenant_id spoofing
    const alphaToken = createToken({ id: 'HR-1', role: 'hr', tenantId: 'tenant-alpha' });
    const ctx = await requireTenantContext(new Request('https://hr.test/api/hr/payroll/tms-earnings', {
      method: 'POST',
      headers: { Authorization: `Bearer ${alphaToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenant_id: 'tenant-beta' }),
    }));
    assert.equal(ctx.tenantId, 'tenant-alpha');
    assert.equal(Object.isFrozen(ctx), true);

    // Route handler end-to-end with mocked fetch returning TMS v1 totalDriverCost + empty driverName
    process.env.NEXUS_TMS_URL = 'https://tms.tenant-alpha.example';
    process.env.NEXUS_TMS_API_KEY = 'tms_key_alpha';
    globalThis.fetch = async () => new Response(JSON.stringify({
      earnings: [
        { Driver_ID: 'EMP-A01', Driver_Name: 'สมชาย ทดสอบ', tripCount: 2, totalDriverCost: 1250 },
        { Driver_ID: 'DRV-EMPTY', Driver_Name: '', tripCount: 1, totalDriverCost: 500 },
      ],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });

    const res = await tmsEarningsRoute.GET(
      new Request('https://hr.test/api/hr/payroll/tms-earnings?from=2026-11-01&to=2026-11-30', {
        headers: { Authorization: `Bearer ${alphaToken}` },
      })
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.configured, true);
    assert.equal(body.autoImportEnabled, false);
    assert.equal(body.earnings[0].driverCost, 1250);
    assert.equal(body.earnings[0].matched, true);
    assert.equal(body.earnings[1].matched, false);
    assert.equal(body.earnings[1].employeeId, null);
  } finally {
    globalThis.fetch = originalFetch;
    if (prevTenantEnv === undefined) delete process.env.HR_TENANT_ID;
    else process.env.HR_TENANT_ID = prevTenantEnv;
    if (prevTmsUrl === undefined) delete process.env.NEXUS_TMS_URL;
    else process.env.NEXUS_TMS_URL = prevTmsUrl;
    if (prevTmsKey === undefined) delete process.env.NEXUS_TMS_API_KEY;
    else process.env.NEXUS_TMS_API_KEY = prevTmsKey;
    if (prevAllowLocal === undefined) delete process.env.ALLOW_LOCAL_INTEGRATION_URL;
    else process.env.ALLOW_LOCAL_INTEGRATION_URL = prevAllowLocal;
  }
});
