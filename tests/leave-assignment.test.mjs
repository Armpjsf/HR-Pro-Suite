import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { formatLeaveBalanceMap } from '../lib/leave-balances.js';

test('formatLeaveBalanceMap does not grant days_per_year when employee_leave_balances row is missing', () => {
  const leaveTypes = [
    { code: 'annual', name: 'ลาพักร้อน', days_per_year: 6, deduct_balance: true },
    { code: 'sick', name: 'ลาป่วย', days_per_year: 30, deduct_balance: true },
    { code: 'personal', name: 'ลากิจ', days_per_year: 6, deduct_balance: true },
  ];

  const emptyResult = formatLeaveBalanceMap([], leaveTypes);
  assert.deepEqual(emptyResult.annual, {
    code: 'annual',
    label: 'ลาพักร้อน',
    total: 0,
    used: 0,
    remaining: 0,
    assigned: false,
  });
  assert.equal(emptyResult.sick.total, 0);
  assert.equal(emptyResult.sick.remaining, 0);
  assert.equal(emptyResult.sick.assigned, false);
  assert.equal(emptyResult.personal.total, 0);
  assert.equal(emptyResult.personal.assigned, false);

  const partialResult = formatLeaveBalanceMap(
    [
      { leave_type: 'annual', total_days: 6, used_days: 2 },
      { leave_type: 'sick', total_days: 0, used_days: 0 },
    ],
    leaveTypes
  );
  assert.deepEqual(partialResult.annual, {
    code: 'annual',
    label: 'ลาพักร้อน',
    total: 6,
    used: 2,
    remaining: 4,
    assigned: true,
  });
  assert.equal(partialResult.sick.total, 0);
  assert.equal(partialResult.sick.assigned, false);
  assert.equal(partialResult.personal.total, 0);
  assert.equal(partialResult.personal.assigned, false);

  // Default fallback leave types when leaveTypes is empty must also default to total 0
  const fallbackTypesResult = formatLeaveBalanceMap([], []);
  assert.equal(fallbackTypesResult.annual.total, 0);
  assert.equal(fallbackTypesResult.annual.assigned, false);
});

test('submit_leave_request rejects unassigned deduct_balance leave types and allows assigned or non-deduct types', async () => {
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role;');
    for (const file of ['schema.sql', 'schema-hr.sql', ...[1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21].map((n) => `schema-phase${n}.sql`)]) {
      await db.exec(await fs.readFile(new URL(`../supabase/${file}`, import.meta.url), 'utf8'));
    }
    await db.exec(`
      insert into users(id, username, password, name, employee_id) values('emp1', 'emp1', 'fake', 'Emp One', 'EMP1');
      insert into employee_records(employee_id) values('EMP1');
      update leave_types set days_per_year=10, deduct_balance=true where code='annual';
      insert into leave_types(code, name, days_per_year, paid, deduct_balance)
        values('unpaid_custom', 'ลาไม่รับค่าจ้าง', 0, false, false)
        on conflict (code) do update set deduct_balance=false;
    `);

    // 1. Missing balance row for deduct_balance=true leave type must reject and NOT auto-insert
    await assert.rejects(
      db.query("select * from submit_leave_request('EMP1', 'annual', '2026-11-17', '2026-11-17', 'full', 'Test unassigned')"),
      /ยังไม่ได้รับสิทธิ์การลาประเภทนี้/
    );
    const balancesAfterUnassigned = await db.query("select * from employee_leave_balances where employee_id='EMP1'");
    assert.equal(balancesAfterUnassigned.rows.length, 0);
    const requestsAfterUnassigned = await db.query("select * from leave_requests where employee_id='EMP1'");
    assert.equal(requestsAfterUnassigned.rows.length, 0);

    // 2. Balance row with total_days = 0 must also reject
    await db.exec("insert into employee_leave_balances(employee_id, leave_type, year, total_days, used_days) values('EMP1', 'annual', 2026, 0, 0)");
    await assert.rejects(
      db.query("select * from submit_leave_request('EMP1', 'annual', '2026-11-17', '2026-11-17', 'full', 'Test zero quota')"),
      /ยังไม่ได้รับสิทธิ์การลาประเภทนี้/
    );

    // 3. Assigned positive balance allows submission
    await db.exec("update employee_leave_balances set total_days=5 where employee_id='EMP1' and leave_type='annual' and year=2026");
    const assignedRes = await db.query("select * from submit_leave_request('EMP1', 'annual', '2026-11-17', '2026-11-17', 'full', 'Test assigned')");
    assert.equal(Number(assignedRes.rows[0].days), 1);

    // 4. Non-deducting leave type (deduct_balance=false) works without an employee_leave_balances row
    const unpaidRes = await db.query("select * from submit_leave_request('EMP1', 'unpaid_custom', '2026-11-18', '2026-11-18', 'full', 'Test unpaid')");
    assert.equal(Number(unpaidRes.rows[0].days), 1);
  } finally {
    await db.close();
  }
});
