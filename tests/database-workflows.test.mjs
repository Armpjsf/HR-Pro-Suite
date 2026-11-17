import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Real Postgres/PLpgSQL in WASM. No .env, network, Supabase credentials or live data.
test('phase21 transactional workflows on an isolated PostgreSQL database', async (t) => {
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role;');
    for (const file of ['schema.sql', 'schema-hr.sql', ...[1,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21].map((n) => `schema-phase${n}.sql`)]) {
      await db.exec(await fs.readFile(new URL(`../supabase/${file}`, import.meta.url), 'utf8'));
    }
    await db.exec(await fs.readFile(new URL('../supabase/schema-phase21.sql', import.meta.url),'utf8'));
    await db.exec(`insert into users(id,username,password,name,employee_id) values('test','test','fake','Test','TEST');
      insert into employee_records(employee_id) values('TEST');
      update leave_types set days_per_year=10,deduct_balance=true where code='annual';`);
    const draft = { employee_id: 'TEST', period: '2026-11', base_salary: 20000, ot_pay: 0, bonus: 500, reimbursements: 1000, tax: 0, sso: 875, deduction: 0, net: 20625 };
    await db.exec("insert into expense_claims(employee_id,category,amount,claim_date,status) values('TEST','other',1000,'2026-11-17','approved')");
    const save = () => db.query('select save_payroll_draft($1::jsonb,true) as result', [JSON.stringify(draft)]);
    await t.test('draft regeneration stays idempotent and paid rows cannot be overwritten', async () => {
      assert.equal((await save()).rows[0].result, 'created');
      assert.equal((await save()).rows[0].result, 'updated');
      const first = (await db.query('select * from payroll_slips')).rows[0];
      assert.equal(Number(first.bonus), 500); assert.equal(Number(first.reimbursements), 1000);
      assert.equal((await db.query("select * from confirm_payroll_payment('2026-11',null)")).rows.length, 1);
      assert.equal((await save()).rows[0].result, 'skipped');
      assert.equal((await db.query("select * from confirm_payroll_payment('2026-11',null)")).rows.length, 0);
      await db.exec("update payroll_slips set notification_status='sent' where period='2026-11'");
      assert.equal((await db.query("select status from payroll_slips where period='2026-11'")).rows[0].status, 'paid');
      await assert.rejects(db.query("update payroll_slips set net=1 where period='2026-11'"), /immutable/);
      await assert.rejects(db.query("insert into expense_claims(employee_id,category,amount,claim_date,status) values('TEST','other',10,'2026-11-18','approved')"), /งวดนี้จ่ายแล้ว/);
    });
    await t.test('leave reserves pending quota and keeps morning/afternoon distinct', async () => {
      const submit = (session) => db.query("select * from submit_leave_request('TEST','annual','2026-11-17','2026-11-17',$1,'Test')", [session]);
      const morning = (await submit('half_morning')).rows[0];
      const afternoon = (await submit('half_afternoon')).rows[0];
      assert.equal(Number(morning.days), 0.5); assert.notEqual(morning.session, afternoon.session);
      await assert.rejects(submit('half_morning'), /ซ้อน/);
      await db.query("select * from review_leave_request($1,'approve','Test HR')", [morning.id]);
      await assert.rejects(db.query("select * from review_leave_request($1,'approve','Test HR')", [morning.id]), /ดำเนินการไปแล้ว/);
      assert.equal(Number((await db.query("select used_days from employee_leave_balances where employee_id='TEST' and leave_type='annual'")).rows[0].used_days), 0.5);
      assert.equal((await db.query("select * from time_records where employee_id='TEST'")).rows.length, 0, 'half day must not create a full-day absence');
    });
    await t.test('failed approval rolls back status and all balance mutations', async () => {
      const r = (await db.query("select * from submit_leave_request('TEST','annual','2026-11-18','2026-11-18','full','Test')")).rows[0];
      await db.exec("update employee_leave_balances set total_days=0.5 where employee_id='TEST'");
      await assert.rejects(db.query("select * from review_leave_request($1,'approve','Test HR')", [r.id]), /สิทธิ์ลา/);
      assert.equal((await db.query('select status from leave_requests where id=$1', [r.id])).rows[0].status, 'pending');
      assert.equal(Number((await db.query("select used_days from employee_leave_balances where employee_id='TEST'")).rows[0].used_days), 0.5);
    });
    await t.test('legacy data and direct RPC calls from public roles fail safely', async () => {
      await db.exec("insert into payroll_slips(employee_id,period,bonus,status) values('TEST','2026-10',1000,'notified')");
      await assert.rejects(db.query("select * from confirm_payroll_payment('2026-10',null)"), /legacy/);
      await db.exec('set role authenticated');
      await assert.rejects(db.query("select * from review_leave_request(1,'approve','forged')"), /permission denied/);
      await db.exec('reset role');
    });
    await t.test('issued certificate cannot be rewritten after approval', async () => {
      await db.exec(`insert into document_requests(employee_id,document_type,status,issued_snapshot)
        values('TEST','salary_certificate','approved','{"version":1,"employeeProfile":{"salary":20000}}');`);
      await assert.rejects(db.query("update document_requests set issued_snapshot='{}' where employee_id='TEST'"), /immutable/);
    });
    await t.test('changed expense totals block payment without changing source status', async () => {
      await db.query('select save_payroll_draft($1::jsonb,false)', [JSON.stringify({ ...draft, period:'2026-12' })]);
      await assert.rejects(db.query("select * from confirm_payroll_payment('2026-12',null)"), /เปลี่ยนหลังคำนวณ/);
      assert.equal((await db.query("select status from payroll_slips where period='2026-12'")).rows[0].status,'draft');
      await db.exec("insert into leave_types(code,name,paid,deduct_balance) values('unpaid_test','Test unpaid',false,false)");
      const unpaid = (await db.query("select * from submit_leave_request('TEST','unpaid_test','2026-11-19','2026-11-19','full','Test')")).rows[0];
      await assert.rejects(db.query("select * from review_leave_request($1,'approve','Test HR')", [unpaid.id]), /งวดที่จ่ายแล้ว/);
      assert.equal((await db.query('select status from leave_requests where id=$1',[unpaid.id])).rows[0].status,'pending');
    });
  } finally { await db.close(); }
});
