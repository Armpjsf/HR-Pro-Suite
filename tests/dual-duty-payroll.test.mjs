import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { computeSlip, preparePayrollDraft } from '../lib/payroll.js';
import { fetchNexusPayrollLines, claimNexusPayrollBatch } from '../lib/nexus-payroll-source.js';

test('warehouse salary, normal bonus, driving pay and reimbursement remain separate and taxable totals include driving pay', () => {
  const inputs = { monthlySalary: 40000, bonusMonthly: 500, drivingPay: 1250, reimbursements: 300, period: '2026-11' };
  const slip = computeSlip(inputs);
  const equivalent = computeSlip({ ...inputs, bonusMonthly: 1750, drivingPay: 0 });
  assert.equal(slip.base_salary, 40000);
  assert.equal(slip.bonus, 500);
  assert.equal(slip.driving_pay, 1250);
  assert.equal(slip.tax, equivalent.tax);
  assert.equal(slip.net, equivalent.net);
  assert.equal(preparePayrollDraft({ employee_id: 'WAREHOUSE-1', period: '2026-11', ...slip }).net, slip.net);
});

test('HR checks source identity, verification month and fresh amounts before claiming any payment', async () => {
  const originalFetch = globalThis.fetch;
  const envKeys = ['NEXUS_TMS_URL', 'NEXUS_TMS_API_KEY', 'NEXUS_TMS_CONNECTION_ID'];
  const oldEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  let claims = 0;
  const line = { earning_line_id: 'job:J1:driver', revision: 1, job_id: 'J1', driver_id: 'D1', amount_minor: 125000, currency: 'THB', payment_owner: 'hr_payroll', verified_at: '2026-10-31T18:00:00Z' };
  let payload = { version: 2, tenantId: 'tenant1', connectionId: 'conn1', period: '2026-11', lines: [line] };
  try {
    process.env.NEXUS_TMS_URL = 'https://nexus.example.test';
    process.env.NEXUS_TMS_API_KEY = 'test';
    process.env.NEXUS_TMS_CONNECTION_ID = 'conn1';
    globalThis.fetch = async url => {
      if (String(url).endsWith('/claim')) { claims++; return Response.json({ success: true }); }
      return Response.json(payload);
    };
    assert.equal((await fetchNexusPayrollLines('tenant1', '2026-11')).lines.length, 1, 'Bangkok verification month includes UTC October 31 after 17:00');
    payload = { ...payload, tenantId: 'other-company' };
    await assert.rejects(fetchNexusPayrollLines('tenant1', '2026-11'), /ไม่ตรงบริษัท/);
    payload = { ...payload, tenantId: 'tenant1', lines: [{ ...line, verified_at: null }] };
    await assert.rejects(fetchNexusPayrollLines('tenant1', '2026-11'), /ตรวจรับ/);
    payload = { ...payload, lines: [line] };
    const batch = { status: 'approved', connectionId: 'conn1', period: '2026-11', lines: [{ sourceEarningLineId: line.earning_line_id, sourceRevision: 1, jobId: 'J1', tmsDriverId: 'D1', amountMinor: 999999, disposition: 'imported_payable' }] };
    await assert.rejects(claimNexusPayrollBatch('tenant1', batch), /ค่าเที่ยวเปลี่ยน/);
    assert.equal(claims, 0);
    batch.lines[0].amountMinor = 125000;
    await claimNexusPayrollBatch('tenant1', batch);
    assert.equal(claims, 1);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(oldEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test('TMS payment claims are atomic, scoped and exclusive; source revisions advance only on income changes', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role;
      create table "Jobs_Main" ("Job_ID" text primary key,"Driver_ID" text,"Sub_ID" text,"Branch_ID" text,
      "Cost_Driver_Total" numeric,"Cost_Driver_Extra" numeric,"Driver_Payment_ID" text,"Job_Status" text,"Remark" text);
      insert into "Jobs_Main" values ('J1','D1',null,'B1',1000,250,null,'Verified',null),('J2','D1',null,'B1',900,0,'PAY1','Verified',null);`);
    await db.exec(await fs.readFile(new URL('../../nexus-tms-core/supabase/migrations/202611180001_driver_earning_lines.sql', import.meta.url), 'utf8'));
    await db.exec(`update "Jobs_Main" set "Verified_At"='2026-11-01T00:00:00Z';`);
    const revision = async () => (await db.query('select "Driver_Earning_Revision" as rev from "Jobs_Main" where "Job_ID"=$1', ['J1'])).rows[0].rev;
    const rev = await revision();
    const line = { job_id: 'J1', driver_id: 'D1', revision: rev, amount_minor: 125000 };
    const claim = (lines, connection = 'tenant:connection', branches = ['B1']) => db.query('select claim_driver_earnings_for_hr($1,$2,$3::jsonb)', [connection, branches, JSON.stringify(lines)]);
    await assert.rejects(claim([line], 'tenant:connection', ['OTHER']), /conflict/);
    await assert.rejects(claim([{ ...line, amount_minor: 999999 }]), /conflict/);
    await assert.rejects(claim([line, { ...line, job_id: 'J2', amount_minor: 90000 }]), /conflict/);
    assert.equal((await db.query('select "Driver_Earning_HR_Claim" as claim from "Jobs_Main" where "Job_ID"=$1', ['J1'])).rows[0].claim, null, 'A failed multi-job reservation must roll back every job');
    await claim([line]);
    await claim([line]); // retries are idempotent
    assert.equal(await revision(), rev, 'Claiming the channel does not change the source revision');
    await assert.rejects(claim([line], 'other:connection'), /conflict/);
    await assert.rejects(db.exec(`update "Jobs_Main" set "Driver_Payment_ID"='PAY2' where "Job_ID"='J1'`), /reserved for HR/);
    await db.exec(`update "Jobs_Main" set "Remark"='unrelated update' where "Job_ID"='J1'`);
    assert.equal(await revision(), rev);
    await db.exec(`update "Jobs_Main" set "Cost_Driver_Extra"=500 where "Job_ID"='J1'`);
    assert.equal(await revision(), rev + 1);
    await assert.rejects(claim([line]), /conflict/, 'Stale reviewed amounts cannot reserve newer source data');
    await claim([{ ...line, revision: rev + 1, amount_minor: 150000 }]);
  } finally { await db.close(); }
});
