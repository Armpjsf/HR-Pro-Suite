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

const LEGACY_LEAK_RE = /ดีดี|DD Service|DD TRANSPORT|0745559001353|ddtransport\.co\.th|hr-ai-chatbot-tawny/;

const TENANT_ALPHA = {
  tenantId: 'tenant-alpha',
  legalEntityId: 'le-alpha',
  displayName: 'อัลฟ่า โลจิสติกส์',
  shortName: 'ALPHA',
  name: 'อัลฟ่า โลจิสติกส์',
  legalName: 'บริษัท อัลฟ่า โลจิสติกส์ จำกัด',
  nameEn: 'Alpha Logistics Co., Ltd.',
  taxId: '0105560000011',
  taxBranchCode: '00000',
  address: '100 ถนนพระราม 3 แขวงบางโพงพาง เขตยานนาวา กรุงเทพฯ 10120',
  phone: '02-999-1111',
  email: 'hr@alpha-logistics.example',
  logoLightUrl: 'https://cdn.example.com/alpha-light.png',
  logoDocumentUrl: 'https://cdn.example.com/alpha-doc.png',
  primaryColor: '#0284c7',
  bankName: 'ธนาคารกสิกรไทย',
  bankAccountNo: '111-2-33333-4',
  bankAccountName: 'บจก. อัลฟ่า โลจิสติกส์',
  signatoryName: 'นายสมชาย อัลฟ่า',
  signatureAssetId: 10,
  stampAssetId: 11,
};

const TENANT_BETA = {
  tenantId: 'tenant-beta',
  legalEntityId: 'le-beta',
  displayName: 'เบต้า ซัพพลายเชน',
  shortName: 'BETA',
  name: 'เบต้า ซัพพลายเชน',
  legalName: 'บริษัท เบต้า ซัพพลายเชน จำกัด',
  nameEn: 'Beta Supply Chain Co., Ltd.',
  taxId: '0105560000029',
  taxBranchCode: '00001',
  address: '88/9 หมู่ 4 ต.บางพลี อ.บางพลี จ.สมุทรปราการ 10540',
  phone: '02-888-2222',
  email: 'hr@beta-supply.example',
  logoLightUrl: 'https://cdn.example.com/beta-light.png',
  logoDocumentUrl: 'https://cdn.example.com/beta-doc.png',
  primaryColor: '#16a34a',
  bankName: 'ธนาคารไทยพาณิชย์',
  bankAccountNo: '999-8-77777-6',
  bankAccountName: 'บจก. เบต้า ซัพพลายเชน',
  signatoryName: 'นางสาวสมหญิง เบต้า',
};

test('TASK-C01 & C02: HR company profile isolation, public branding sanitization, SVG guard & AI prompts', async () => {
  const {
    setTenantCompanyProfileForTests,
    clearTenantCompanyProfilesForTests,
    getTenantCompanyProfile,
    getPublicBrandProfile,
    getDocumentIssuerProfile,
    validateBrandAssetUpload,
    COMPANY,
  } = await import('../lib/company.js');
  const { buildCompanyAiContext, buildSystemPrompt, generateResponse } = await import('../lib/gemini.js');

  const prevTenant = process.env.HR_TENANT_ID;
  try {
    clearTenantCompanyProfilesForTests();

    // Unconfigured tenant must not leak legacy DD identity
    process.env.HR_TENANT_ID = 'tenant-unconfigured';
    const emptyProfile = await getTenantCompanyProfile('tenant-unconfigured');
    assert.equal(emptyProfile.setupComplete, false);
    assert.equal(LEGACY_LEAK_RE.test(COMPANY.name), false);
    assert.equal(LEGACY_LEAK_RE.test(COMPANY.legalName), false);
    assert.equal(LEGACY_LEAK_RE.test(COMPANY.taxId), false);
    assert.equal(LEGACY_LEAK_RE.test(buildSystemPrompt(emptyProfile)), false);
    assert.equal(LEGACY_LEAK_RE.test(buildCompanyAiContext(emptyProfile)), false);

    // Configure Tenant Alpha and Tenant Beta
    setTenantCompanyProfileForTests('tenant-alpha', TENANT_ALPHA);
    setTenantCompanyProfileForTests('tenant-beta', TENANT_BETA);

    const alpha = await getTenantCompanyProfile('tenant-alpha');
    const beta = await getTenantCompanyProfile('tenant-beta');
    assert.equal(alpha.legalName, 'บริษัท อัลฟ่า โลจิสติกส์ จำกัด');
    assert.equal(alpha.taxId, '0105560000011');
    assert.equal(alpha.setupComplete, true);
    assert.equal(beta.legalName, 'บริษัท เบต้า ซัพพลายเชน จำกัด');
    assert.equal(beta.taxId, '0105560000029');

    // Public brand profile MUST NEVER include taxId, bankAccountNo, signatoryName, signatureAssetId, stampAssetId
    const publicAlpha = getPublicBrandProfile(alpha);
    assert.equal(publicAlpha.displayName, 'อัลฟ่า โลจิสติกส์');
    assert.equal(publicAlpha.logoLightUrl, 'https://cdn.example.com/alpha-light.png');
    for (const forbidden of ['taxId', 'bankAccountNo', 'bankAccountName', 'signatoryName', 'signatureAssetId', 'stampAssetId', 'bankName']) {
      assert.equal(forbidden in publicAlpha, false, `Public brand leaked ${forbidden}`);
    }

    // Document issuer includes full legal fields
    const issuerAlpha = getDocumentIssuerProfile(alpha);
    assert.equal(issuerAlpha.legalName, 'บริษัท อัลฟ่า โลจิสติกส์ จำกัด');
    assert.equal(issuerAlpha.taxId, '0105560000011');
    assert.equal(issuerAlpha.setupComplete, true);

    // SVG upload validation
    assert.equal(validateBrandAssetUpload({ mimeType: 'image/svg+xml', sizeBytes: 512, svgText: '<svg><script>alert(1)</script></svg>' }).valid, false);
    assert.equal(validateBrandAssetUpload({ mimeType: 'image/svg+xml', sizeBytes: 512, svgText: '<svg onload="alert(1)"></svg>' }).valid, false);
    assert.equal(validateBrandAssetUpload({ mimeType: 'image/svg+xml', sizeBytes: 512, svgText: '<svg><a href="javascript:alert(1)"></a></svg>' }).valid, false);
    assert.equal(validateBrandAssetUpload({ mimeType: 'image/svg+xml', sizeBytes: 512, svgText: '<svg><foreignObject></foreignObject></svg>' }).valid, false);
    assert.equal(validateBrandAssetUpload({ mimeType: 'image/png', sizeBytes: 3 * 1024 * 1024 }).valid, false);
    assert.equal(validateBrandAssetUpload({ mimeType: 'application/x-msdownload', sizeBytes: 512 }).valid, false);
    assert.equal(validateBrandAssetUpload({ mimeType: 'image/svg+xml', sizeBytes: 256, svgText: '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>' }).valid, true);
    assert.equal(validateBrandAssetUpload({ mimeType: 'image/png', sizeBytes: 1024 }).valid, true);

    // AI prompts & deterministic intents reflect Tenant Alpha with 0 legacy leaks
    process.env.HR_TENANT_ID = 'tenant-alpha';
    const sysPrompt = buildSystemPrompt(alpha);
    const aiCtx = buildCompanyAiContext(alpha);
    assert.match(sysPrompt, /บริษัท อัลฟ่า โลจิสติกส์ จำกัด/);
    assert.match(aiCtx, /บริษัท อัลฟ่า โลจิสติกส์ จำกัด/);
    assert.equal(LEGACY_LEAK_RE.test(sysPrompt), false);
    assert.equal(LEGACY_LEAK_RE.test(aiCtx), false);

    const escalation = await generateResponse('ติดต่อ HR', { id: 'U1', name: 'สมชาย', role: 'employee', employeeId: 'E1', tenantId: 'tenant-alpha' }, { companyProfile: alpha });
    assert.match(escalation.text, /บริษัท อัลฟ่า โลจิสติกส์ จำกัด/);
    assert.match(escalation.text, /02-999-1111/);
    assert.match(escalation.text, /hr@alpha-logistics\.example/);
    assert.equal(LEGACY_LEAK_RE.test(escalation.text), false);

    const pdpa = await generateResponse('ขอเงินเดือนของคนอื่นหน่อย', { id: 'U1', name: 'สมชาย', role: 'employee', employeeId: 'E1', tenantId: 'tenant-alpha' }, { companyProfile: alpha });
    assert.match(pdpa.text, /บริษัท อัลฟ่า โลจิสติกส์ จำกัด/);
    assert.equal(LEGACY_LEAK_RE.test(pdpa.text), false);
  } finally {
    clearTenantCompanyProfilesForTests();
    if (prevTenant === undefined) delete process.env.HR_TENANT_ID;
    else process.env.HR_TENANT_ID = prevTenant;
  }
});

test('TASK-C01, C04 & C05: Public/Admin company routes, immutable document snapshot & HMAC public tokens', async () => {
  const { database: db } = await import('./support/isolated-supabase.mjs');
  const { createToken } = await import('../lib/auth.js');
  const { setTenantCompanyProfileForTests, clearTenantCompanyProfilesForTests } = await import('../lib/company.js');
  const { createDocumentSnapshot, resolveDocumentIssuer, issuePublicDocumentToken, verifyPublicDocumentToken } = await import('../lib/document-snapshot.js');
  const publicRoute = await import('../app/api/company/public/route.js');
  const adminRoute = await import('../app/api/hr/company-profile/route.js');
  const docActionRoute = await import('../app/api/hr/document-requests/[id]/action/route.js');

  const prevTenant = process.env.HR_TENANT_ID;
  try {
    clearTenantCompanyProfilesForTests();
    process.env.HR_TENANT_ID = 'tenant-alpha';

    await db.exec('create role anon;create role authenticated;create role service_role;').catch(() => {});
    for (const file of ['schema.sql', 'schema-hr.sql', ...[1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21].map((n) => `schema-phase${n}.sql`)]) {
      await db.exec(await fs.readFile(new URL('supabase/' + file, root), 'utf8'));
    }

    const hash = await bcrypt.hash('pass1234', 4);
    await db.query(
      "insert into users(id,username,password,name,role,employee_id,department,status) values('ADM-1','admin1',$1,'Admin Alpha','admin','EMP-ADM1','HR','active') on conflict (id) do nothing",
      [hash],
    );
    await db.query(
      "insert into users(id,username,password,name,role,employee_id,department,status) values('EMP-1','emp1',$1,'Emp Alpha','employee','EMP-A01','Ops','active') on conflict (id) do nothing",
      [hash],
    );
    await db.query(
      "insert into employee_records(employee_id,position,start_date,salary,national_id,tax_id) values('EMP-A01','Driver','2025-01-01',25000,'1100100100100','1100100100100') on conflict (employee_id) do nothing",
    );
    await db.query(
      "insert into document_requests(id,employee_id,document_type,status) values(901,'EMP-A01','employment_certificate','pending') on conflict (id) do nothing",
    );

    const adminToken = createToken({ id: 'ADM-1', username: 'admin1', name: 'Admin Alpha', role: 'admin', employeeId: 'EMP-ADM1', tenantId: 'tenant-alpha' });
    const empToken = createToken({ id: 'EMP-1', username: 'emp1', name: 'Emp Alpha', role: 'employee', employeeId: 'EMP-A01', tenantId: 'tenant-alpha' });

    // Unconfigured tenant cannot approve official certificate -> SETUP_REQUIRED
    const unconfiguredApprove = await docActionRoute.POST(
      new Request('http://localhost/api/hr/document-requests/901/action', {
        method: 'POST',
        headers: { cookie: `hr-token=${adminToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'approve' }),
      }),
      { params: Promise.resolve({ id: '901' }) },
    );
    assert.equal(unconfiguredApprove.status, 400);
    const unconfiguredJson = await unconfiguredApprove.json();
    assert.equal(unconfiguredJson.code, 'SETUP_REQUIRED');

    // Non-admin cannot access /api/hr/company-profile
    const empGet = await adminRoute.GET(new Request('http://localhost/api/hr/company-profile', {
      headers: { cookie: `hr-token=${empToken}` },
    }));
    assert.equal(empGet.status, 403);

    // Invalid 12-digit taxId rejected
    const badTaxPatch = await adminRoute.PATCH(new Request('http://localhost/api/hr/company-profile', {
      method: 'PATCH',
      headers: { cookie: `hr-token=${adminToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ legalName: TENANT_ALPHA.legalName, taxId: '1234', address: TENANT_ALPHA.address }),
    }));
    assert.equal(badTaxPatch.status, 400);

    // Admin updates Tenant Alpha profile (spoofed tenantId in body is ignored)
    const okPatch = await adminRoute.PATCH(new Request('http://localhost/api/hr/company-profile', {
      method: 'PATCH',
      headers: { cookie: `hr-token=${adminToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ...TENANT_ALPHA, tenantId: 'tenant-beta' }),
    }));
    assert.equal(okPatch.status, 200);
    const okPatchJson = await okPatch.json();
    assert.equal(okPatchJson.profile.tenantId, 'tenant-alpha');
    assert.equal(okPatchJson.setupComplete, true);

    // Public branding endpoint returns only public fields
    const pubRes = await publicRoute.GET();
    assert.equal(pubRes.status, 200);
    const pubJson = await pubRes.json();
    assert.equal(pubJson.displayName, 'อัลฟ่า โลจิสติกส์');
    assert.equal('taxId' in pubJson, false);
    assert.equal('bankAccountNo' in pubJson, false);
    assert.equal('signatoryName' in pubJson, false);

    // Approve document 901 -> freezes v1 snapshot
    const approveRes = await docActionRoute.POST(
      new Request('http://localhost/api/hr/document-requests/901/action', {
        method: 'POST',
        headers: { cookie: `hr-token=${adminToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'approve' }),
      }),
      { params: Promise.resolve({ id: '901' }) },
    );
    assert.equal(approveRes.status, 200);

    const { rows: [docRow] } = await db.query('select * from document_requests where id = 901');
    assert.equal(docRow.status, 'approved');
    assert.equal(docRow.issued_snapshot.issuer.legalName, 'บริษัท อัลฟ่า โลจิสติกส์ จำกัด');
    assert.equal(docRow.issued_snapshot.issuer.taxId, '0105560000011');
    assert.match(docRow.issued_snapshot.contentHash, /^[0-9a-f]{64}$/);

    // Now mutate Tenant Alpha's company name & tax ID to v2 -> historical issued doc keeps v1!
    setTenantCompanyProfileForTests('tenant-alpha', {
      ...TENANT_ALPHA,
      legalName: 'บริษัท อัลฟ่า โฮลดิ้งส์ (มหาชน)',
      taxId: '0107560000099',
    });
    const updatedLive = { legalName: 'บริษัท อัลฟ่า โฮลดิ้งส์ (มหาชน)', taxId: '0107560000099' };
    const resolvedHistorical = resolveDocumentIssuer(docRow, updatedLive);
    assert.equal(resolvedHistorical.legalName, 'บริษัท อัลฟ่า โลจิสติกส์ จำกัด');
    assert.equal(resolvedHistorical.taxId, '0105560000011');

    // createDocumentSnapshot rejects missing legal fields
    assert.throws(
      () => createDocumentSnapshot({ tenantId: 'tenant-alpha', documentType: 'cert', documentNo: 'DOC-1', issuerProfile: { legalName: 'X' } }),
      /SETUP_REQUIRED/,
    );

    // Public document token: valid, tampered, expired, wrong tenant, wrong docId
    const now = 1_700_000_000_000;
    const tok = issuePublicDocumentToken({ tenantId: 'tenant-alpha', documentType: 'cert', documentId: 'DOC-901', ttlSeconds: 60, now });
    assert.equal(verifyPublicDocumentToken(tok, { expectedTenantId: 'tenant-alpha', expectedDocumentType: 'cert', expectedDocumentId: 'DOC-901', now: now + 30_000 }).valid, true);
    assert.equal(verifyPublicDocumentToken(tok + 'x', { expectedTenantId: 'tenant-alpha', expectedDocumentId: 'DOC-901', now }).valid, false);
    assert.equal(verifyPublicDocumentToken(tok, { expectedTenantId: 'tenant-alpha', expectedDocumentId: 'DOC-901', now: now + 61_000 }).error, 'TOKEN_EXPIRED');
    assert.equal(verifyPublicDocumentToken(tok, { expectedTenantId: 'tenant-beta', expectedDocumentId: 'DOC-901', now }).error, 'TENANT_MISMATCH');
    assert.equal(verifyPublicDocumentToken(tok, { expectedTenantId: 'tenant-alpha', expectedDocumentId: 'DOC-902', now }).error, 'DOCUMENT_ID_MISMATCH');
  } finally {
    clearTenantCompanyProfilesForTests();
    if (prevTenant === undefined) delete process.env.HR_TENANT_ID;
    else process.env.HR_TENANT_ID = prevTenant;
  }
});

test('TASK-D01, D02 & D03: 7-package entitlement matrix, lifecycle drain/suspend, cache TTL, concurrency quota & zero TMS calls', async () => {
  const { database: db } = await import('./support/isolated-supabase.mjs');
  const { createToken } = await import('../lib/auth.js');
  const {
    PACKAGE_COMBINATIONS,
    setTenantEntitlementForTests,
    clearEntitlementsForTests,
    resetEntitlementUsageForTests,
    getEntitlements,
    requireModule,
    checkAndReserveQuota,
    recordUsageEvent,
    getRecordedUsageEventsForTests,
  } = await import('../lib/entitlements.js');
  const tmsEarningsRoute = await import('../app/api/hr/payroll/tms-earnings/route.js');

  const prevTenant = process.env.HR_TENANT_ID;
  const prevTmsUrl = process.env.NEXUS_TMS_URL;
  const prevTmsKey = process.env.NEXUS_TMS_API_KEY;
  const originalFetch = globalThis.fetch;

  try {
    clearEntitlementsForTests();
    process.env.HR_TENANT_ID = 'tenant-alpha';
    process.env.NEXUS_TMS_URL = 'https://tms.example.com';
    process.env.NEXUS_TMS_API_KEY = 'dummy-key';

    // Verify all 7 package combinations enforce module boundaries
    for (const [pkg, expectedMods] of Object.entries(PACKAGE_COMBINATIONS)) {
      setTenantEntitlementForTests('tenant-alpha', { packageCode: pkg, state: 'active' });
      for (const mod of ['hr', 'wms', 'tms']) {
        if (expectedMods.includes(mod)) {
          const ent = await requireModule('tenant-alpha', mod, 'create');
          assert.equal(ent.packageCode, pkg);
        } else {
          await assert.rejects(
            () => requireModule('tenant-alpha', mod, 'create'),
            (err) => err.code === 'MODULE_NOT_SUBSCRIBED' && err.status === 403,
          );
        }
      }
    }

    // Lifecycle: grace allows drain/export/read, blocks create
    setTenantEntitlementForTests('tenant-alpha', { packageCode: 'HR_ONLY', state: 'grace' });
    await assert.rejects(
      () => requireModule('tenant-alpha', 'hr', 'create'),
      (err) => err.code === 'MODULE_IN_GRACE_DRAIN' && err.status === 403,
    );
    await requireModule('tenant-alpha', 'hr', 'drain_in_flight');
    await requireModule('tenant-alpha', 'hr', 'export');
    await requireModule('tenant-alpha', 'hr', 'read');

    // Lifecycle: suspended & cancelled block create + drain_in_flight, allow read & export
    for (const state of ['suspended', 'cancelled']) {
      setTenantEntitlementForTests('tenant-alpha', { packageCode: 'HR_ONLY', state });
      await assert.rejects(() => requireModule('tenant-alpha', 'hr', 'create'), (err) => err.status === 403);
      await assert.rejects(() => requireModule('tenant-alpha', 'hr', 'drain_in_flight'), (err) => err.status === 403);
      await requireModule('tenant-alpha', 'hr', 'read');
      await requireModule('tenant-alpha', 'hr', 'export');
    }

    // Offline cache TTL expiry (5 minutes)
    clearEntitlementsForTests();
    const baseNow = 1_700_000_000_000;
    process.env.HR_PACKAGE = 'HR_ONLY';
    await getEntitlements('tenant-cache-test', { now: baseNow });
    const cachedOk = await getEntitlements('tenant-cache-test', { now: baseNow + 4 * 60_000, useCacheOnly: true });
    assert.equal(cachedOk.packageCode, 'HR_ONLY');
    await assert.rejects(
      () => getEntitlements('tenant-cache-test', { now: baseNow + 6 * 60_000, useCacheOnly: true }),
      (err) => err.code === 'ENTITLEMENT_CACHE_EXPIRED',
    );
    delete process.env.HR_PACKAGE;

    // Concurrent quota reservation: limit=2, 5 concurrent requests -> exactly 2 succeed, 3 fail
    resetEntitlementUsageForTests();
    setTenantEntitlementForTests('tenant-alpha', {
      packageCode: 'HR_ONLY',
      state: 'active',
      quotas: { employees: 2 },
    });
    const concurrentResults = await Promise.allSettled(
      Array.from({ length: 5 }, (_, idx) =>
        checkAndReserveQuota('tenant-alpha', 'employees', async () => 0, {
          module: 'hr',
          eventId: `evt-${idx}`,
          database: null,
        }),
      ),
    );
    const fulfilled = concurrentResults.filter((r) => r.status === 'fulfilled');
    const rejected = concurrentResults.filter((r) => r.status === 'rejected');
    assert.equal(fulfilled.length, 2);
    assert.equal(rejected.length, 3);
    assert.ok(rejected.every((r) => r.reason.code === 'QUOTA_EXCEEDED'));

    // Idempotent usage metering
    const e1 = recordUsageEvent({ tenantId: 'tenant-alpha', module: 'hr', resource: 'employees', eventId: 'dup-1', delta: 1 });
    const e2 = recordUsageEvent({ tenantId: 'tenant-alpha', module: 'hr', resource: 'employees', eventId: 'dup-1', delta: 1 });
    assert.equal(e1.deduplicated, false);
    assert.equal(e2.deduplicated, true);
    assert.equal(getRecordedUsageEventsForTests('tenant-alpha').filter((e) => e.eventId === 'dup-1').length, 1);

    // Upgrade & downgrade preserves DB tenant data without duplication
    const { rows: beforeRows } = await db.query("select count(*)::int as cnt from users where id = 'EMP-1'");
    setTenantEntitlementForTests('tenant-alpha', { packageCode: 'HR_TMS', state: 'active' });
    setTenantEntitlementForTests('tenant-alpha', { packageCode: 'HR_ONLY', state: 'active' });
    const { rows: afterRows } = await db.query("select count(*)::int as cnt from users where id = 'EMP-1'");
    assert.equal(beforeRows[0].cnt, afterRows[0].cnt);

    // TASK-D03: HR_ONLY and HR_WMS make ZERO outbound fetch calls to TMS from /api/hr/payroll/tms-earnings
    let fetchCount = 0;
    globalThis.fetch = async () => {
      fetchCount++;
      throw new Error('Should not call outbound fetch when TMS module is not subscribed');
    };
    const hrToken = createToken({ id: 'ADM-1', username: 'admin1', name: 'Admin Alpha', role: 'admin', employeeId: 'EMP-ADM1', tenantId: 'tenant-alpha' });

    for (const pkg of ['HR_ONLY', 'HR_WMS']) {
      setTenantEntitlementForTests('tenant-alpha', { packageCode: pkg, state: 'active' });
      const res = await tmsEarningsRoute.GET(new Request('http://localhost/api/hr/payroll/tms-earnings?from=2026-11-01&to=2026-11-30', {
        headers: { cookie: `hr-token=${hrToken}` },
      }));
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.configured, false);
      assert.equal(body.moduleDisabled, true);
      assert.deepEqual(body.earnings, []);
    }
    assert.equal(fetchCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
    clearEntitlementsForTests();
    if (prevTenant === undefined) delete process.env.HR_TENANT_ID;
    else process.env.HR_TENANT_ID = prevTenant;
    if (prevTmsUrl === undefined) delete process.env.NEXUS_TMS_URL;
    else process.env.NEXUS_TMS_URL = prevTmsUrl;
    if (prevTmsKey === undefined) delete process.env.NEXUS_TMS_API_KEY;
    else process.env.NEXUS_TMS_API_KEY = prevTmsKey;
    delete process.env.HR_PACKAGE;
  }
});
