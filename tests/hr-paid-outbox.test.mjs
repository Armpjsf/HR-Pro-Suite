import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('paid slip queues trip remuneration atomically, skips reversed imports and deduplicates retries', async () => {
 const db = new PGlite();
 try {
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
   CREATE TABLE payroll_slips(id bigint primary key,employee_id text,period text,status text,paid_at timestamptz,driving_pay numeric);
   CREATE TABLE payroll_import_batches(batch_id text,tenant_id text,connection_id text,status text);
   CREATE TABLE payroll_import_lines(batch_id text,tenant_id text,connection_id text,job_id text,tms_driver_id text,hr_employee_id text,period text,source_revision int,payable_minor bigint,disposition text,reversed boolean);
   CREATE TABLE integration_outbox(tenant_id text,connection_id text,event_id text,aggregate_id text,aggregate_version int,event_type text,schema_version text,payload jsonb,payload_hash text,UNIQUE(connection_id,event_id));
   INSERT INTO payroll_slips VALUES(6,'2502','2026-11','draft',NULL,600);
   INSERT INTO payroll_import_batches VALUES('B','tenant','conn','posted'),('OLD','tenant','conn','reversed');
   INSERT INTO payroll_import_lines VALUES('B','tenant','conn','J1','2502','2502','2026-11',11,60000,'imported_payable',false),('OLD','tenant','conn','J1','2502','2502','2026-11',10,40000,'imported_payable',true);`);
  await db.exec(await fs.readFile(new URL('../supabase/migrations/012_hr_payroll_paid_outbox.sql', import.meta.url), 'utf8'));
  await db.exec(`BEGIN;UPDATE payroll_slips SET status='paid',paid_at=now() WHERE id=6;ROLLBACK;`);
  assert.equal((await db.query('SELECT * FROM integration_outbox')).rows.length, 0);
  await db.exec(`UPDATE payroll_slips SET status='paid',paid_at=now() WHERE id=6;SELECT enqueue_hr_payroll_paid(6);`);
  const rows = (await db.query('SELECT * FROM integration_outbox')).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].payload.lines.length, 1);
  assert.equal(rows[0].payload.lines[0].amount_minor, 60000);
  assert.equal(rows[0].payload.slip_id, '6');
  assert.equal(rows[0].payload.period, '2026-11');
  assert.equal('net' in rows[0].payload, false);
 } finally { await db.close(); }
});
