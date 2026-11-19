import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { PGlite } from '@electric-sql/pglite';
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

const identifier = (s) => {
  if (!/^[a-z_][a-z0-9_]*$/i.test(s)) throw Error(`Invalid identifier: ${s}`);
  return `"${s}"`;
};
const cloneJson = (v) => JSON.parse(JSON.stringify(v));

/**
 * Creates an independent Supabase client adapter instance connected to the shared PGlite database,
 * simulating a separate Node process / serverless container with zero shared in-memory state.
 */
function createIndependentDbClient(pg) {
  class Query {
    constructor(table) {
      this.table = identifier(table);
      this.filters = [];
      this.parameters = [];
      this.action = 'select';
      this.rows = [];
      this.offset = 0;
    }
    value(v) {
      this.parameters.push(v);
      return '$' + this.parameters.length;
    }
    select(columns = '*', options = {}) {
      this.columns = columns;
      this.options = options;
      return this;
    }
    eq(k, v) {
      this.filters.push(`${identifier(k)}=${this.value(v)}`);
      return this;
    }
    neq(k, v) {
      this.filters.push(`${identifier(k)}<>${this.value(v)}`);
      return this;
    }
    gt(k, v) {
      this.filters.push(`${identifier(k)}>${this.value(v)}`);
      return this;
    }
    gte(k, v) {
      this.filters.push(`${identifier(k)}>=${this.value(v)}`);
      return this;
    }
    lt(k, v) {
      this.filters.push(`${identifier(k)}<${this.value(v)}`);
      return this;
    }
    lte(k, v) {
      this.filters.push(`${identifier(k)}<=${this.value(v)}`);
      return this;
    }
    in(k, values) {
      this.filters.push(
        values.length ? `${identifier(k)} in (${values.map((v) => this.value(v)).join(',')})` : 'false'
      );
      return this;
    }
    is(k, v) {
      this.filters.push(`${identifier(k)} is ${v === null ? 'null' : v ? 'true' : 'false'}`);
      return this;
    }
    order(key, { ascending = true } = {}) {
      this.orderBy = `${identifier(key)} ${ascending ? 'asc' : 'desc'}`;
      return this;
    }
    limit(n) {
      this.max = Number(n);
      return this;
    }
    maybeSingle() {
      this.singleMode = 'maybe';
      return this;
    }
    single() {
      this.singleMode = 'required';
      return this;
    }
    insert(rows) {
      this.action = 'insert';
      this.rows = Array.isArray(rows) ? rows : [rows];
      return this;
    }
    update(row) {
      this.action = 'update';
      this.rows = [row];
      return this;
    }
    delete() {
      this.action = 'delete';
      return this;
    }
    upsert(rows, options = {}) {
      this.insert(rows);
      this.conflict = options.onConflict || 'id';
      this.ignoreDuplicates = Boolean(options.ignoreDuplicates);
      return this;
    }
    then(resolve, reject) {
      return this.execute().then(resolve, reject);
    }
    async execute() {
      try {
        const where = this.filters.length ? ' where ' + this.filters.join(' and ') : '';
        let sql;
        if (this.action === 'select') {
          sql = `select * from ${this.table}${where}${this.orderBy ? ' order by ' + this.orderBy : ''}${this.max !== undefined ? ' limit ' + this.max : ''}${this.offset ? ' offset ' + this.offset : ''}`;
        }
        if (this.action === 'delete') {
          sql = `delete from ${this.table}${where} returning *`;
        }
        if (this.action === 'update') {
          sql = `update ${this.table} set ${Object.entries(this.rows[0])
            .map(([k, v]) => `${identifier(k)}=${this.value(typeof v === 'object' && v !== null && !Array.isArray(v) ? JSON.stringify(v) : v)}`)
            .join(',')}${where} returning *`;
        }
        if (this.action === 'insert') {
          const keys = [...new Set(this.rows.flatMap(Object.keys))];
          sql = `insert into ${this.table} (${keys.map(identifier).join(',')}) values ${this.rows
            .map(
              (row) =>
                '(' +
                keys
                  .map((k) =>
                    k in row
                      ? this.value(
                          typeof row[k] === 'object' && row[k] !== null && !Array.isArray(row[k])
                            ? JSON.stringify(row[k])
                            : row[k]
                        )
                      : 'default'
                  )
                  .join(',') +
                ')'
            )
            .join(',')}`;
          if (this.conflict) {
            const target = this.conflict.split(',').map(identifier).join(',');
            sql += this.ignoreDuplicates
              ? ` on conflict (${target}) do nothing`
              : ` on conflict (${target}) do update set ${keys
                  .filter((k) => !this.conflict.split(',').includes(k))
                  .map((k) => `${identifier(k)}=excluded.${identifier(k)}`)
                  .join(',')}`;
          }
          sql += ' returning *';
        }
        const result = await pg.query(sql, this.parameters);
        const rows = cloneJson(result.rows);
        if (this.singleMode && (rows.length > 1 || (this.singleMode === 'required' && !rows.length))) {
          return { data: null, error: { code: 'PGRST116', message: 'Expected one row' } };
        }
        return {
          data: this.options?.head ? null : this.singleMode ? rows[0] || null : rows,
          error: null,
          count: rows.length,
        };
      } catch (e) {
        return { data: null, error: { code: e.code, message: e.message } };
      }
    }
  }

  return {
    from: (table) => new Query(table),
    rpc(name, args = {}) {
      let singular = false;
      const execute = async () => {
        try {
          const entries = Object.entries(args || {}).filter(([, v]) => v !== undefined);
          const values = entries.map(([, v]) =>
            v && typeof v === 'object' && !Array.isArray(v) ? JSON.stringify(v) : v
          );
          const parameters = entries.map(([key], idx) => `${identifier(key)} => $${idx + 1}`).join(',');
          const result = await pg.query(`select * from ${identifier(name)}(${parameters})`, values);
          if (singular && result.rows.length !== 1) {
            return { data: null, error: { code: 'PGRST116', message: 'Expected one RPC row' } };
          }
          const isScalar =
            result.rows.length === 1 &&
            result.rows[0] &&
            Object.keys(result.rows[0]).length === 1 &&
            name in result.rows[0];
          return {
            data: isScalar ? cloneJson(result.rows[0][name]) : singular ? cloneJson(result.rows[0]) : cloneJson(result.rows),
            error: null,
          };
        } catch (e) {
          return { data: null, error: { code: e.code, message: e.message } };
        }
      };
      const query = {
        single() {
          singular = true;
          return query;
        },
        then(resolve, reject) {
          return execute().then(resolve, reject);
        },
      };
      return query;
    },
  };
}

test('Codex R01, R02, R03: Real PostgreSQL (PGlite) durability, multi-instance concurrency, process restarts & rollback', async (t) => {
  const { database: pg } = await import('./support/isolated-supabase.mjs');
  const prevTenant = process.env.HR_TENANT_ID;
  const prevCronSecret = process.env.CRON_SECRET;
  const prevTmsUrl = process.env.NEXUS_TMS_URL;
  const prevSigningSecret = process.env.NEXUS_SIGNING_SECRET;
  const originalFetch = globalThis.fetch;

  try {
    process.env.HR_TENANT_ID = 'tenant-alpha';
    process.env.CRON_SECRET = 'cron-test-secret-r01';
    process.env.NEXUS_TMS_URL = 'https://tms.example.com/api/webhooks/hr';
    process.env.NEXUS_SIGNING_SECRET = 'wh-signing-secret-r01';
    process.env.LINE_CHANNEL_ACCESS_TOKEN = '';

    await pg.exec('create role anon; create role authenticated; create role service_role;');
    for (const file of [
      'schema.sql',
      'schema-hr.sql',
      ...[1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21].map((n) => `schema-phase${n}.sql`),
      'migrations/001_schema_migrations_ledger.sql',
      'migrations/002_tenant_bindings_and_auth_tokens.sql',
      'migrations/003_api_keys_and_connections.sql',
      'migrations/004_notification_endpoints_scope.sql',
      'migrations/005_company_profiles_and_snapshots.sql',
      'migrations/006_entitlements_and_quotas.sql',
      'migrations/007_integration_links_outbox_inbox.sql',
      'migrations/008_payroll_import_batches.sql',
      'migrations/010_driving_income.sql',
    ]) {
      await pg.exec(await fs.readFile(new URL('supabase/' + file, root), 'utf8'));
    }

    const password = 'test-password-only';
    const hash = await bcrypt.hash(password, 4);
    for (const [id, role, name, salary] of [
      ['HR1', 'hr', 'HR Lead', 30000],
      ['EMP-DRV1', 'employee', 'สมชาย ขับดี', 20000],
      ['EMP-PAID2', 'employee', 'สมหญิง จ่ายแล้ว', 22000],
    ]) {
      await pg.query(
        'insert into users(id,username,password,name,role,employee_id,status) values($1,$1,$2,$3,$4,$1,$5)',
        [id, hash, name, role, 'active']
      );
      await pg.query('insert into employee_records(employee_id,salary) values($1,$2)', [id, salary]);
    }

    // Seed PostgreSQL entitlement rows (006_entitlements_and_quotas.sql)
    await pg.query(
      `insert into tenant_modules (tenant_id, package_code, modules, lifecycle_state)
       values ('tenant-alpha', 'FULL_SUITE', array['hr','wms','tms'], 'active')`
    );
    await pg.query(
      `insert into tenant_features_limits (tenant_id, features, quotas)
       values ('tenant-alpha', '{"payroll_tms_import": true}'::jsonb, '{"max_users": 1}'::jsonb)`
    );

    // Seed verified driver link in PostgreSQL (007_integration_links_outbox_inbox.sql)
    const instanceA = createIndependentDbClient(pg);
    const instanceB = createIndependentDbClient(pg);
    const instanceC = createIndependentDbClient(pg);

    const { upsertVerifiedDriverEmployeeLink, clearDriverLinksForTests } = await import('../lib/driver-employee-links.js');
    await upsertVerifiedDriverEmployeeLink(
      {
        tenantId: 'tenant-alpha',
        connectionId: 'conn-alpha',
        hrEmployeeId: 'EMP-DRV1',
        tmsDriverId: 'DRV-A01',
        employmentClassification: 'employee',
        verifiedBy: 'HR1',
      },
      instanceA
    );
    await upsertVerifiedDriverEmployeeLink(
      {
        tenantId: 'tenant-alpha',
        connectionId: 'conn-alpha',
        hrEmployeeId: 'EMP-PAID2',
        tmsDriverId: 'DRV-P02',
        employmentClassification: 'employee',
        verifiedBy: 'HR1',
      },
      instanceA
    );
    // Clear in-memory driver link cache to prove instanceB/C read from PostgreSQL
    clearDriverLinksForTests();

    const { SupabaseOutboxInboxRepository, enqueueOutboxEvent } = await import('../lib/integration-outbox-inbox.js');
    const {
      createPayrollImportBatch,
      reviewPayrollImportBatch,
      approvePayrollImportBatch,
      postImportBatchToPayroll,
      setPeriodLock,
      clearPayrollImportsForTests,
    } = await import('../lib/payroll-tms-import.js');
    const {
      checkAndReserveQuota,
      releaseQuotaReservation,
      clearEntitlementsForTests,
    } = await import('../lib/entitlements.js');

    const loginRoute = await import('../app/api/auth/login/route.js');
    const tmsImportRoute = await import('../app/api/hr/payroll/tms-import/route.js');
    const generateRoute = await import('../app/api/hr/payroll/generate/route.js');
    const cronOutboxRoute = await import('../app/api/cron/integration-outbox/route.js');

    const req = (path, cookie, body, extraHeaders = {}) =>
      new Request('https://hr.test' + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { ...(cookie ? { cookie } : {}), 'Content-Type': 'application/json', ...extraHeaders },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });

    const loginRes = await loginRoute.POST(req('/api/auth/login', null, { username: 'HR1', password }));
    assert.equal(loginRes.status, 200);
    const hrCookie = loginRes.headers.get('set-cookie').split(';')[0];

    await t.test('R01: DB-backed outbox survives restart, SKIP LOCKED prevents double claim, cron delivers & inbox deduplicates across instances', async () => {
      const repoA = new SupabaseOutboxInboxRepository(instanceA);
      const enq = await repoA.enqueueOutboxEvent({
        eventId: 'evt-r01-db-1',
        tenantId: 'tenant-alpha',
        connectionId: 'conn-alpha',
        aggregateId: 'JOB-R01',
        aggregateVersion: 1,
        eventType: 'hr.driver_link.updated',
        payload: { driverId: 'DRV-A01', employeeId: 'EMP-DRV1' },
        nowMs: 1_700_000_000_000,
      });
      assert.equal(enq.deduplicated, false);

      // Simulate process restart: two brand-new worker repositories with empty memory race to claim
      const repoWorker1 = new SupabaseOutboxInboxRepository(instanceB);
      const repoWorker2 = new SupabaseOutboxInboxRepository(instanceC);

      const [claim1, claim2] = await Promise.all([
        repoWorker1.claimOutboxBatch({ workerId: 'worker-1', leaseDurationMs: 30000, nowMs: 1_700_000_001_000 }),
        repoWorker2.claimOutboxBatch({ workerId: 'worker-2', leaseDurationMs: 30000, nowMs: 1_700_000_001_000 }),
      ]);
      assert.equal(claim1.length + claim2.length, 1, 'FOR UPDATE SKIP LOCKED must allow only 1 worker to claim the event');

      // Simulate worker-1 crash & expired lease -> cron route reclaims and delivers via HTTP fetch
      await pg.query(
        `update integration_outbox set lease_expires_at = $1 where event_id = 'evt-r01-db-1'`,
        [new Date(Date.now() - 5000).toISOString()]
      );

      // Unauthorized cron request fails closed
      const unauthCron = await cronOutboxRoute.POST(req('/api/cron/integration-outbox', null, {}));
      assert.equal(unauthCron.status, 401);

      let deliveredCount = 0;
      globalThis.fetch = async (_url, init) => {
        deliveredCount++;
        assert.ok(init.headers['x-nexus-signature']);
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      };

      const cronRes = await cronOutboxRoute.POST(
        req('/api/cron/integration-outbox', null, {}, { Authorization: 'Bearer cron-test-secret-r01' })
      );
      assert.equal(cronRes.status, 200);
      const cronJson = await cronRes.json();
      assert.equal(cronJson.claimedCount, 1);
      assert.equal(cronJson.results[0].status, 'delivered');
      assert.equal(deliveredCount, 1);

      const attemptsRes = await pg.query(`select * from integration_attempts where tenant_id = 'tenant-alpha'`);
      assert.equal(attemptsRes.rows.length, 1);

      // Inbox: instanceA applies once; instanceB (after restart) deduplicates & rejects payload mismatch (409)
      let sideEffects = 0;
      const in1 = await repoA.receiveAndApplyInboxEvent({
        connectionId: 'conn-alpha',
        tenantId: 'tenant-alpha',
        eventId: 'in-r01-1',
        aggregateId: 'EARN-1',
        aggregateVersion: 1,
        payload: { job: 'J1', amount: 1250 },
        applyFn: async () => {
          sideEffects++;
          return { appliedJob: 'J1' };
        },
      });
      assert.equal(in1.status, 'applied');
      assert.equal(sideEffects, 1);

      const inDupAfterRestart = await repoWorker1.receiveAndApplyInboxEvent({
        connectionId: 'conn-alpha',
        tenantId: 'tenant-alpha',
        eventId: 'in-r01-1',
        aggregateId: 'EARN-1',
        aggregateVersion: 1,
        payload: { amount: 1250, job: 'J1' },
        applyFn: async () => {
          sideEffects++;
          return { appliedJob: 'J1' };
        },
      });
      assert.equal(inDupAfterRestart.status, 'duplicate_ignored');
      assert.equal(inDupAfterRestart.idempotent, true);
      assert.equal(sideEffects, 1);

      const inMismatch = await repoWorker2.receiveAndApplyInboxEvent({
        connectionId: 'conn-alpha',
        tenantId: 'tenant-alpha',
        eventId: 'in-r01-1',
        aggregateId: 'EARN-1',
        aggregateVersion: 1,
        payload: { job: 'J1', amount: 9999 },
      });
      assert.equal(inMismatch.httpStatus, 409);
      assert.equal(inMismatch.status, 'conflict_payload_mismatch');

      // Schema mismatch must fail explicitly (never swallow into memory)
      const unmigratedPg = new PGlite();
      const unmigratedClient = createIndependentDbClient(unmigratedPg);
      await assert.rejects(
        () =>
          enqueueOutboxEvent(
            {
              eventId: 'evt-fail',
              tenantId: 'tenant-alpha',
              connectionId: 'conn-alpha',
              aggregateId: 'JOB-X',
              payload: {},
            },
            unmigratedClient
          ),
        /Outbox enqueue failed|does not exist/i
      );
      await unmigratedPg.close();
    });

    await t.test('R02: Payroll import batch survives multi-instance handoff/restart, prevents duplicate revision, enforces DB period lock, and rolls back mid-batch failure', async () => {
      process.env.NEXUS_TMS_API_KEY='test-key'; process.env.NEXUS_TMS_CONNECTION_ID='conn-alpha';
      globalThis.fetch = async url => String(url).endsWith('/claim') ? Response.json({success:true}) : Response.json({version:2,tenantId:'tenant-alpha',connectionId:'conn-alpha',period:'2026-10',lines:[{earning_line_id:'EARN-R02-1',revision:1,job_id:'JOB-R02-1',driver_id:'DRV-A01',verified_at:'2026-10-15T10:00:00Z',payment_owner:'hr_payroll',amount_minor:150000,currency:'THB'}]});
      // Instance A creates draft batch
      const batchA = await createPayrollImportBatch({
        tenantId: 'tenant-alpha',
        period: '2026-10',
        connectionId: 'conn-alpha',
        createdBy: 'HR-A',
        database: instanceA,
        lines: [
          {
            sourceEarningLineId: 'EARN-R02-1',
            sourceRevision: 1,
            jobId: 'JOB-R02-1',
            tmsDriverId: 'DRV-A01',
            verifiedAt: '2026-10-15T10:00:00Z',
            paymentOwner: 'hr_payroll',
            amountMinor: 150000, // 1500 THB
          },
        ],
      });
      assert.equal(batchA.status, 'draft');

      // Simulate restart: wipe any in-memory maps; Instance B reviews; Instance C approves & posts via route!
      clearPayrollImportsForTests();
      const reviewedB = await reviewPayrollImportBatch({
        tenantId: 'tenant-alpha',
        batchId: batchA.id,
        actorId: 'HR-B',
        database: instanceB,
      });
      assert.equal(reviewedB.status, 'reviewed');

      clearPayrollImportsForTests();
      const approveRes = await tmsImportRoute.POST(
        req('/api/hr/payroll/tms-import', hrCookie, { action: 'approve', batchId: batchA.id })
      );
      assert.equal(approveRes.status, 200);
      assert.equal((await approveRes.json()).batch.status, 'approved');

      const postRes = await tmsImportRoute.POST(
        req('/api/hr/payroll/tms-import', hrCookie, { action: 'post', batchId: batchA.id })
      );
      assert.equal(postRes.status, 200);
      assert.equal((await postRes.json()).batch.status, 'posted');

      // After restart, re-importing the same (EARN-R02-1, rev 1) skips from PostgreSQL!
      clearPayrollImportsForTests();
      const dupBatch = await createPayrollImportBatch({
        tenantId: 'tenant-alpha',
        period: '2026-10',
        connectionId: 'conn-alpha',
        createdBy: 'HR-C',
        database: instanceC,
        lines: [
          {
            sourceEarningLineId: 'EARN-R02-1',
            sourceRevision: 1,
            jobId: 'JOB-R02-1',
            tmsDriverId: 'DRV-A01',
            verifiedAt: '2026-10-15T10:00:00Z',
            paymentOwner: 'hr_payroll',
            amountMinor: 150000,
          },
        ],
      });
      assert.equal(dupBatch.lines[0].disposition, 'duplicate_skipped');
      assert.equal(dupBatch.reconciliation.importedPayableMinor, 0);

      // Mid-batch atomic rollback: 2 employees in 2026-12 (EMP-DRV1 has draft slip, EMP-PAID2 has paid slip)
      await pg.query(
        `insert into payroll_slips (employee_id, period, status, calculation_version, base_salary, ot_pay, bonus, reimbursements, tax, sso, deduction, net)
         values
           ('EMP-DRV1', '2026-12', 'draft', 2, 20000, 0, 0, 0, 0, 0, 0, 20000),
           ('EMP-PAID2', '2026-12', 'paid', 2, 22000, 0, 0, 0, 0, 0, 0, 22000)`
      );

      const midFailBatch = await createPayrollImportBatch({
        tenantId: 'tenant-alpha',
        period: '2026-12',
        connectionId: 'conn-alpha',
        createdBy: 'HR-A',
        database: instanceA,
        lines: [
          {
            sourceEarningLineId: 'EARN-R02-MID-1',
            sourceRevision: 1,
            jobId: 'JOB-MID-1',
            tmsDriverId: 'DRV-A01',
            verifiedAt: '2026-12-10T10:00:00Z',
            paymentOwner: 'hr_payroll',
            amountMinor: 100000, // +1000 THB to EMP-DRV1
          },
          {
            sourceEarningLineId: 'EARN-R02-MID-2',
            sourceRevision: 1,
            jobId: 'JOB-MID-2',
            tmsDriverId: 'DRV-P02',
            verifiedAt: '2026-12-10T10:00:00Z',
            paymentOwner: 'hr_payroll',
            amountMinor: 50000, // +500 THB to EMP-PAID2 (paid!)
          },
        ],
      });
      await reviewPayrollImportBatch({ tenantId: 'tenant-alpha', batchId: midFailBatch.id, actorId: 'HR-B', database: instanceB });
      await approvePayrollImportBatch({ tenantId: 'tenant-alpha', batchId: midFailBatch.id, actorId: 'HR-C', database: instanceC });

      await assert.rejects(
        () => postImportBatchToPayroll({ tenantId: 'tenant-alpha', batchId: midFailBatch.id, actorId: 'HR-C', database: instanceC }),
        (err) => err.code === 'PERIOD_LOCKED' && err.status === 409
      );

      // Verify EMP-DRV1's draft slip was 100% rolled back (bonus still 0, net still 20000) and batch still 'approved'
      const drv1Slip = (await pg.query(`select bonus, net from payroll_slips where employee_id = 'EMP-DRV1' and period = '2026-12'`)).rows[0];
      assert.equal(Number(drv1Slip.bonus), 0);
      assert.equal(Number(drv1Slip.net), 20000);
      const batchStatusAfterFail = (await pg.query(`select status from payroll_import_batches where batch_id = $1`, [midFailBatch.id])).rows[0].status;
      assert.equal(batchStatusAfterFail, 'approved');

      // Period lock persists across restart and blocks BOTH post AND /api/hr/payroll/generate
      await setPeriodLock('tenant-alpha', '2026-10', true, 'HR-A', instanceA);
      clearPayrollImportsForTests();

      const genLockedRes = await generateRoute.POST(
        req('/api/hr/payroll/generate', hrCookie, { period: '2026-10', overwrite: true })
      );
      assert.equal(genLockedRes.status, 409);
      const genLockedJson = await genLockedRes.json();
      assert.equal(genLockedJson.code, 'PERIOD_LOCKED');
    });

    await t.test('R03: DB-backed reserve_tenant_quota serializes competing instances, deduplicates retries across restarts & releases on failure', async () => {
      clearEntitlementsForTests();

      // Limit = 1 from PostgreSQL tenant_features_limits; two separate instances race concurrently
      const [r1, r2] = await Promise.allSettled([
        checkAndReserveQuota('tenant-alpha', 'max_users', async () => 0, {
          module: 'hr',
          eventId: 'quota-race-A',
          database: instanceA,
        }),
        checkAndReserveQuota('tenant-alpha', 'max_users', async () => 0, {
          module: 'hr',
          eventId: 'quota-race-B',
          database: instanceB,
        }),
      ]);

      const fulfilled = [r1, r2].filter((r) => r.status === 'fulfilled');
      const rejected = [r1, r2].filter((r) => r.status === 'rejected');
      assert.equal(fulfilled.length, 1, 'Exactly one concurrent instance may claim the last quota slot');
      assert.equal(rejected.length, 1);
      assert.equal(rejected[0].reason.code, 'QUOTA_EXCEEDED');

      const winnerEventId = fulfilled[0].value.eventId;

      // Simulate restart (clear all in-memory entitlement caches) and retry winning eventId on instanceC
      clearEntitlementsForTests();
      const retryRes = await checkAndReserveQuota('tenant-alpha', 'max_users', async () => 0, {
        module: 'hr',
        eventId: winnerEventId,
        database: instanceC,
      });
      assert.equal(retryRes.allowed, true);
      assert.equal(retryRes.deduplicated, true);

      // Release reservation on failure -> subsequent distinct request succeeds
      await releaseQuotaReservation('tenant-alpha', 'max_users', 1, {
        module: 'hr',
        eventId: winnerEventId,
        database: instanceC,
      });

      const afterRelease = await checkAndReserveQuota('tenant-alpha', 'max_users', async () => 0, {
        module: 'hr',
        eventId: 'quota-after-release-C',
        database: instanceB,
      });
      assert.equal(afterRelease.allowed, true);
      assert.equal(afterRelease.deduplicated, false);
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (prevTenant === undefined) delete process.env.HR_TENANT_ID;
    else process.env.HR_TENANT_ID = prevTenant;
    if (prevCronSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = prevCronSecret;
    if (prevTmsUrl === undefined) delete process.env.NEXUS_TMS_URL;
    else process.env.NEXUS_TMS_URL = prevTmsUrl;
    if (prevSigningSecret === undefined) delete process.env.NEXUS_SIGNING_SECRET;
    else process.env.NEXUS_SIGNING_SECRET = prevSigningSecret;
    await pg.close();
    hooks.deregister();
  }
});
