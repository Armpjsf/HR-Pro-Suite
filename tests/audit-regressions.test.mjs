import test from 'node:test';
import assert from 'node:assert/strict';
import { computeSlip, calcSso, isValidPeriod, preparePayrollDraft, isFinalPayroll } from '../lib/payroll.js';
import { calculateLeave, leaveDaysInPeriod, unpaidDaysByEmployee } from '../lib/leave-policy.js';
import { validateClockInput } from '../lib/clock-policy.js';
import { attachDocumentRequestLookups, createIssuedSnapshot } from '../lib/document-requests.js';
import { createToken, createDownloadToken, verifyRequestToken, resolveActiveUser, getTokenUser } from '../lib/auth.js';
import { readBackupTable, createLogicalBackup } from '../lib/backup.js';

test('regenerating a payroll draft keeps reimbursement separate and net stable', () => {
  const a = computeSlip({ monthlySalary: 20000, bonusMonthly: 500, reimbursements: 1000, period: '2026-11' });
  const b = computeSlip({ monthlySalary: 20000, bonusMonthly: a.bonus, reimbursements: 1000, period: '2026-11' });
  assert.deepEqual(b, a);
  assert.equal(a.bonus, 500);
  assert.equal(a.reimbursements, 1000);
  const noReimbursement = computeSlip({ monthlySalary: 20000, bonusMonthly: 500, period: '2026-11' });
  assert.equal(a.tax, noReimbursement.tax);
  assert.equal(a.net - noReimbursement.net, 1000);
});

test('SSO uses the payroll period at year boundaries', () => {
  assert.equal(calcSso(30000, '2025-12'), 750);
  assert.equal(calcSso(30000, '2026-01'), 875);
  assert.equal(calcSso(30000, '2029-01'), 1000);
  assert.equal(calcSso(30000, '2032-01'), 1150);
});

test('manual payroll rejects invalid values and computes net server-side', () => {
  assert.equal(isValidPeriod('2026-13'), false);
  assert.equal(isValidPeriod('2026-00'), false);
  assert.throws(() => preparePayrollDraft({ employee_id: 'TEST', period: '2026-11', tax: 'bad' }));
  assert.throws(() => preparePayrollDraft({ employee_id: 'TEST', period: '2026-11', bonus: -1 }));
  assert.equal(preparePayrollDraft({ employee_id: 'TEST', period: '2026-11', base_salary: 1000, reimbursements: 200, net: 999999 }).net, 1200);
  assert.ok(isFinalPayroll('paid'));
  assert.ok(isFinalPayroll('notified'));
});

test('leave counts actual work dates, holidays and half-day sessions', () => {
  const full = calculateLeave({ start_date: '2026-11-13', end_date: '2026-11-17', holidays: ['2026-11-16'] });
  assert.deepEqual(full.work_dates, ['2026-11-13', '2026-11-17']);
  assert.equal(full.days, 2);
  assert.equal(calculateLeave({ start_date: '2026-11-17', end_date: '2026-11-17', session: 'half_morning' }).days, 0.5);
  assert.throws(() => calculateLeave({ start_date: '2026-11-17', end_date: '2026-11-18', session: 'half_afternoon' }));
  assert.throws(() => calculateLeave({ start_date: '2026-02-30', end_date: '2026-03-01' }));
  assert.throws(() => calculateLeave({ start_date: '2026-12-31', end_date: '2027-01-01' }));
});

test('unpaid leave is allocated only to work dates within each payroll period', () => {
  const leave = { session: 'full', work_dates: ['2026-10-30', '2026-11-02', '2026-11-03'] };
  assert.equal(leaveDaysInPeriod(leave, '2026-10-01', '2026-10-31'), 1);
  assert.equal(leaveDaysInPeriod(leave, '2026-11-01', '2026-11-30'), 2);
  assert.throws(() => leaveDaysInPeriod({ start_date: '2026-10-30', end_date: '2026-11-03', days: 3 }, '2026-11-01', '2026-11-30'));
});

test('monthly deductions do not double-count absence and unpaid leave on the same date', () => {
  const result = unpaidDaysByEmployee([{ employee_id:'TEST',work_date:'2026-11-17',status:'absent' }],
    [{ employee_id:'TEST',leave_type:'unpaid',session:'full',work_dates:['2026-11-17','2026-11-18'] }], new Set(['unpaid']), '2026-11-01','2026-11-30');
  assert.equal(result.get('TEST'),2);
});

test('clock rejects unknown modes and forged/invalid coordinate types', () => {
  const valid = { action: 'in', check_type: 'office', latitude: 13.7, longitude: 100.5 };
  assert.equal(validateClockInput(valid), null);
  for (const patch of [{ check_type: 'anything' }, { check_type: 'wfh' }, { latitude: '13.7' }, { longitude: Infinity }, { latitude: 91 }, { action: 'update' }]) {
    assert.ok(validateClockInput({ ...valid, ...patch }));
  }
});

test('issued certificate stays unchanged after profile/company/asset edits', () => {
  const row = { id: 1, employee_id: 'TEST', status: 'pending', signature_asset_id: 1 };
  const lookups = { users: [{ employee_id: 'TEST', name: 'Before' }], records: [{ employee_id: 'TEST', salary: 20000 }], assets: [{ id: 1, name: 'Signer before', image_url: 'document-assets/version1.png' }] };
  const [item] = attachDocumentRequestLookups([row], lookups);
  const company = { legalName: 'Original company' };
  const snapshot = createIssuedSnapshot(item, company);
  company.legalName = 'Changed'; lookups.users[0].name = 'After'; lookups.records[0].salary = 30000; lookups.assets[0].name = 'Signer after';
  const [issued] = attachDocumentRequestLookups([{ ...row, status: 'approved', issued_snapshot: snapshot }], lookups);
  assert.equal(issued.employeeProfile.salary, 20000);
  assert.equal(issued.employeeName, 'Before');
  assert.equal(issued.signatureAsset.name, 'Signer before');
  assert.equal(issued.company.legalName, 'Original company');
});

test('download tokens cannot authenticate other API endpoints or documents', () => {
  const user = { id: 'synthetic' };
  const token = createDownloadToken(user, 'DOC1');
  assert.ok(verifyRequestToken(token, new Request('https://hr.test/api/documents/DOC1/download'), true));
  assert.equal(verifyRequestToken(token, new Request('https://hr.test/api/documents/DOC2/download'), true), null);
  assert.equal(verifyRequestToken(token, new Request('https://hr.test/api/me')), null);
  assert.equal(verifyRequestToken(token, new Request('https://hr.test/api/documents/DOC1/download', { method: 'POST' })), null);
  assert.equal(verifyRequestToken(createToken(user), new Request('https://hr.test/api/documents/DOC1/download'), true), null);
  const withExpiredCookie = new Request(`https://hr.test/api/documents/DOC1/download?token=${encodeURIComponent(token)}`, { headers: { Cookie:'hr-token=expired' } });
  assert.equal(getTokenUser(withExpiredCookie).id, user.id);
});

test('identity validation denies removed/inactive users and DB failures, and uses fresh role', async () => {
  const database = (result) => ({ from() { return { select() { return { eq() { return { maybeSingle: async () => result }; } }; } }; } });
  const oldToken = { id: 'test', role: 'admin', employeeId: 'OLD' };
  for (const result of [{ data: null }, { error: new Error('unavailable') }, { data: { status: 'suspended' } }, { data: { status: 'resigned' } }]) {
    assert.equal(await resolveActiveUser(oldToken, database(result)), null);
  }
  const active = await resolveActiveUser(oldToken, database({ data: { id: 'test', status: 'active', role: 'employee', employee_id: 'NEW' } }));
  assert.equal(active.role, 'employee'); assert.equal(active.employeeId, 'NEW');
});

test('logical export paginates tables, includes files and fails on incomplete data', async () => {
  const source = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const db = { from() { return { select() { return { order() { return { range: async (a,b) => ({ data: source.slice(a,b+1) }) }; } }; } }; } };
  assert.deepEqual(await readBackupTable(db,'users',2), source);
  const bucket = { list: async () => ({ data: [{ id: 'file', name: 'example.txt' }] }), download: async () => ({ data: new Blob(['test']) }) };
  const backup = await createLogicalBackup(db,bucket,{ tables:['users'] });
  assert.deepEqual(backup.tables.users,source);
  assert.equal(Buffer.from(backup.files[0].contentBase64,'base64').toString(),'test');
  assert.equal(backup.files[0].sha256,'9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08');
  await assert.rejects(createLogicalBackup(db,{ ...bucket, download: async () => ({ error: true }) },{ tables:['users'] }), /ไม่ครบ/);
  await assert.rejects(createLogicalBackup(db,bucket,{ tables:['users'],maxBytes:1 }), /เกินขนาด/);
});
