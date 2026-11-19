import fs from 'node:fs/promises';
import net from 'node:net';
import { registerHooks } from 'node:module';
import { PGlite } from '@electric-sql/pglite';
import bcrypt from 'bcryptjs';

const root = new URL('../../', import.meta.url);
const fixtureURL = new URL('./isolated-supabase.mjs', import.meta.url).href;

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

const identifier = (s) => {
  if (!/^[a-z_][a-z0-9_]*$/i.test(s)) throw Error(`Invalid identifier: ${s}`);
  return `"${s}"`;
};
const cloneJson = (v) => JSON.parse(JSON.stringify(v));

function createDbClientFromExecutor(execFn) {
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
        values.length ? `${identifier(k)} in (${values.map((v) => this.value(v)).join(',')})` : 'false',
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
            .map(
              ([k, v]) =>
                `${identifier(k)}=${this.value(typeof v === 'object' && v !== null && !Array.isArray(v) ? JSON.stringify(v) : v)}`,
            )
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
                            : row[k],
                        )
                      : 'default',
                  )
                  .join(',') +
                ')',
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
        const result = await execFn(sql, this.parameters);
        const rows = cloneJson(result.rows || []);
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
            v && typeof v === 'object' ? JSON.stringify(v) : v,
          );
          const parameters = entries.map(([key], idx) => `${identifier(key)} => $${idx + 1}`).join(',');
          const result = await execFn(`select * from ${identifier(name)}(${parameters})`, values);
          const rows = result.rows || [];
          if (singular && rows.length !== 1) {
            return { data: null, error: { code: 'PGRST116', message: 'Expected one RPC row' } };
          }
          const isScalar =
            rows.length === 1 &&
            rows[0] &&
            Object.keys(rows[0]).length === 1 &&
            name in rows[0];
          return {
            data: isScalar ? cloneJson(rows[0][name]) : singular ? cloneJson(rows[0]) : cloneJson(rows),
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

async function runDiskPhase1(tempDataDir) {
  const pg = new PGlite(tempDataDir);
  await pg.waitReady;

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
    'migrations/009_inbox_leases_and_quota_accounting_fix.sql',
  ]) {
    await pg.exec(await fs.readFile(new URL('supabase/' + file, root), 'utf8'));
  }

  const hash = await bcrypt.hash('disk-pw-only', 4);
  for (const [id, role, name, salary] of [
    ['HR1', 'hr', 'HR Lead', 30000],
    ['EMP-DRV1', 'employee', 'สมชาย ขับดี', 20000],
  ]) {
    await pg.query(
      'insert into users(id,username,password,name,role,employee_id,status) values($1,$1,$2,$3,$4,$1,$5)',
      [id, hash, name, role, 'active'],
    );
    await pg.query('insert into employee_records(employee_id,salary) values($1,$2)', [id, salary]);
  }

  await pg.query(
    `insert into tenant_modules (tenant_id, package_code, modules, lifecycle_state)
     values ('tenant-alpha', 'FULL_SUITE', array['hr','wms','tms'], 'active')`,
  );
  await pg.query(
    `insert into tenant_features_limits (tenant_id, features, quotas)
     values ('tenant-alpha', '{"payroll_tms_import": true}'::jsonb, '{"max_users": 2}'::jsonb)`,
  );

  const db = createDbClientFromExecutor((sql, params) => pg.query(sql, params));
  const { upsertVerifiedDriverEmployeeLink } = await import('../../lib/driver-employee-links.js');
  await upsertVerifiedDriverEmployeeLink(
    {
      tenantId: 'tenant-alpha',
      connectionId: 'conn-alpha',
      hrEmployeeId: 'EMP-DRV1',
      tmsDriverId: 'DRV-A01',
      employmentClassification: 'employee',
      verifiedBy: 'HR1',
    },
    db,
  );

  const { SupabaseOutboxInboxRepository, computePayloadHash } = await import('../../lib/integration-outbox-inbox.js');
  const repo = new SupabaseOutboxInboxRepository(db);
  await repo.enqueueOutboxEvent({
    eventId: 'evt-disk-1',
    tenantId: 'tenant-alpha',
    connectionId: 'conn-alpha',
    aggregateId: 'JOB-DISK-1',
    payload: { driverId: 'DRV-A01', status: 'verified' },
    nowMs: 1_700_000_000_000,
  });

  // Seed a crashed 'processing' inbox row with year-2020 expired lease
  const crashPayload = { jobId: 'JOB-CRASH-1', amount: 500 };
  await pg.query(
    `insert into integration_inbox (
       tenant_id, connection_id, event_id, aggregate_id, aggregate_version,
       event_type, schema_version, payload, payload_hash, status, lease_owner, lease_expires_at, received_at
     ) values (
       'tenant-alpha', 'conn-alpha', 'in-disk-crashed', 'EARN-DISK-CRASH', 1,
       'tms.earning.verified', '2.0.0', $1::jsonb, $2, 'processing', 'dead-worker-pid-999',
       '2020-01-01T00:00:30Z'::timestamptz, '2020-01-01T00:00:00Z'::timestamptz
     )`,
    [JSON.stringify(crashPayload), computePayloadHash(crashPayload)],
  );

  const { createPayrollImportBatch } = await import('../../lib/payroll-tms-import.js');
  const batch = await createPayrollImportBatch({
    tenantId: 'tenant-alpha',
    period: '2026-11',
    connectionId: 'conn-alpha',
    createdBy: 'HR1',
    database: db,
    lines: [
      {
        sourceEarningLineId: 'EARN-DISK-1',
        sourceRevision: 1,
        jobId: 'JOB-DISK-1',
        tmsDriverId: 'DRV-A01',
        verifiedAt: '2026-11-10T10:00:00Z',
        paymentOwner: 'hr_payroll',
        amountMinor: 150000,
      },
    ],
  });

  const { checkAndReserveQuota, commitQuotaReservation } = await import('../../lib/entitlements.js');
  const q1 = await checkAndReserveQuota('tenant-alpha', 'max_users', async () => 0, {
    module: 'hr',
    eventId: 'evt-quota-disk-1',
    database: db,
  });
  await commitQuotaReservation('tenant-alpha', 'max_users', {
    module: 'hr',
    eventId: q1.eventId,
    database: db,
  });

  await pg.exec('CHECKPOINT');
  await pg.close();

  process.send?.({
    ok: true,
    pid: process.pid,
    batchId: batch.id,
    q1,
  });
}

async function runDiskPhase2(tempDataDir, batchId) {
  const pg = new PGlite(tempDataDir);
  await pg.waitReady;
  const db = createDbClientFromExecutor((sql, params) => pg.query(sql, params));

  const { SupabaseOutboxInboxRepository } = await import('../../lib/integration-outbox-inbox.js');
  const repo = new SupabaseOutboxInboxRepository(db);

  const outboxEvents = await repo.getOutboxEventsForTenant('tenant-alpha');

  // Reclaim and apply the crashed 'processing' inbox row left by dead process 1
  let sideEffects = 0;
  const reclaimedRes = await repo.receiveAndApplyInboxEvent({
    connectionId: 'conn-alpha',
    tenantId: 'tenant-alpha',
    eventId: 'in-disk-crashed',
    aggregateId: 'EARN-DISK-CRASH',
    aggregateVersion: 1,
    payload: { jobId: 'JOB-CRASH-1', amount: 500 },
    workerId: `worker-proc-${process.pid}`,
    applyFn: async () => {
      sideEffects++;
      return { recoveredByPid: process.pid };
    },
  });

  const {
    reviewPayrollImportBatch,
    approvePayrollImportBatch,
    postImportBatchToPayroll,
  } = await import('../../lib/payroll-tms-import.js');
  await reviewPayrollImportBatch({ tenantId: 'tenant-alpha', batchId, actorId: 'HR2', database: db });
  await approvePayrollImportBatch({ tenantId: 'tenant-alpha', batchId, actorId: 'HR2', database: db });
  const posted = await postImportBatchToPayroll({ tenantId: 'tenant-alpha', batchId, actorId: 'HR2', database: db });

  const { checkAndReserveQuota, commitQuotaReservation } = await import('../../lib/entitlements.js');
  // Limit=2, event1 committed (resource=1), so event2 with base=1 MUST succeed!
  const q2 = await checkAndReserveQuota('tenant-alpha', 'max_users', async () => 1, {
    module: 'hr',
    eventId: 'evt-quota-disk-2',
    database: db,
  });
  await commitQuotaReservation('tenant-alpha', 'max_users', {
    module: 'hr',
    eventId: q2.eventId,
    database: db,
  });

  let q3ErrorCode = null;
  try {
    await checkAndReserveQuota('tenant-alpha', 'max_users', async () => 2, {
      module: 'hr',
      eventId: 'evt-quota-disk-3',
      database: db,
    });
  } catch (err) {
    q3ErrorCode = err.code || err.message;
  }

  await pg.exec('CHECKPOINT');
  await pg.close();

  process.send?.({
    ok: true,
    pid: process.pid,
    outboxEventIds: outboxEvents.map((e) => e.eventId),
    reclaimedRes,
    sideEffects,
    postedStatus: posted.status,
    q2,
    q3ErrorCode,
  });
}

function createTcpQueryClient(port) {
  const socket = net.createConnection({ host: '127.0.0.1', port: Number(port) });
  socket.on('error', () => {});
  let buffer = '';
  let reqCounter = 0;
  const pending = new Map();

  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let nlIdx;
    while ((nlIdx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nlIdx).trim();
      buffer = buffer.slice(nlIdx + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      const entry = pending.get(msg.id);
      if (entry) {
        pending.delete(msg.id);
        if (msg.error) {
          const err = new Error(msg.error.message);
          err.code = msg.error.code;
          entry.reject(err);
        } else {
          entry.resolve({ rows: msg.rows });
        }
      }
    }
  });

  const execFn = (sql, params) =>
    new Promise((resolve, reject) => {
      const id = ++reqCounter;
      pending.set(id, { resolve, reject });
      socket.write(JSON.stringify({ id, sql, params }) + '\n');
    });

  return {
    db: createDbClientFromExecutor(execFn),
    close: () =>
      new Promise((resolve) => {
        if (socket.destroyed) return resolve();
        socket.end(() => resolve());
      }),
  };
}

async function runTcpWorker(port, workerName) {
  const { db, close } = createTcpQueryClient(port);
  const { SupabaseOutboxInboxRepository } = await import('../../lib/integration-outbox-inbox.js');
  const { checkAndReserveQuota } = await import('../../lib/entitlements.js');
  const repo = new SupabaseOutboxInboxRepository(db);

  const waitForMsg = (expectedType) =>
    new Promise((resolve) => {
      const onMsg = (msg) => {
        if (msg && msg.type === expectedType) {
          process.off('message', onMsg);
          resolve(msg);
        }
      };
      process.on('message', onMsg);
    });

  process.on('message', async (msg) => {
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'RUN_OUTBOX_CLAIM') {
      process.send?.({ type: 'BARRIER_READY', step: 'outbox', workerName, pid: process.pid });
      await waitForMsg('BARRIER_GO');
      const claimed = await repo.claimOutboxBatch({
        workerId: `${workerName}-${process.pid}`,
        leaseDurationMs: 30000,
        nowMs: msg.nowMs,
        limit: 10,
      });
      process.send?.({
        type: 'STEP_RESULT',
        step: 'outbox',
        workerName,
        pid: process.pid,
        claimedIds: claimed.map((c) => c.eventId),
      });
    }

    if (msg.type === 'RUN_QUOTA_RACE') {
      process.send?.({ type: 'BARRIER_READY', step: 'quota', workerName, pid: process.pid });
      await waitForMsg('BARRIER_GO');
      try {
        const res = await checkAndReserveQuota('tenant-alpha', 'max_users', async () => msg.baseCount, {
          module: 'hr',
          eventId: msg.eventId,
          database: db,
          nowIso: new Date(msg.nowMs).toISOString(),
        });
        process.send?.({ type: 'STEP_RESULT', step: 'quota', workerName, pid: process.pid, ok: true, res });
      } catch (err) {
        process.send?.({
          type: 'STEP_RESULT',
          step: 'quota',
          workerName,
          pid: process.pid,
          ok: false,
          code: err.code || 'ERR',
          message: err.message,
        });
      }
    }

    if (msg.type === 'RUN_INBOX_VERSION_RACE') {
      process.send?.({ type: 'BARRIER_READY', step: msg.step, workerName, pid: process.pid });
      await waitForMsg('BARRIER_GO');
      const res = await repo.receiveAndApplyInboxEvent({
        connectionId: 'conn-alpha',
        tenantId: 'tenant-alpha',
        eventId: msg.eventId,
        aggregateId: msg.aggregateId,
        aggregateVersion: msg.aggregateVersion,
        payload: msg.payload,
        workerId: `${workerName}-${process.pid}`,
        nowMs: msg.nowMs,
        applyFn: async ({ aggregateVersion }) => {
          if (msg.holdInApply) {
            process.send?.({ type: 'IN_APPLY_ENTERED', step: msg.step, workerName, pid: process.pid });
            await waitForMsg('RELEASE_APPLY');
          }
          // Write version into audit_logs to verify no regression across OS processes
          await db.from('audit_logs').insert({
            action: 'INBOX_AGG_STATE',
            user_name: msg.aggregateId,
            channel: JSON.stringify({ aggregateVersion, workerName, pid: process.pid }),
            type: 'rv2',
          });
          return { appliedVersion: aggregateVersion, pid: process.pid };
        },
      });
      process.send?.({
        type: 'STEP_RESULT',
        step: msg.step,
        workerName,
        pid: process.pid,
        res,
      });
    }

    if (msg.type === 'RUN_RV3_FENCE_STAGE') {
      process.send?.({ type: 'BARRIER_READY', step: msg.step, workerName, pid: process.pid });
      await waitForMsg('BARRIER_GO');

      if (msg.action === 'claim_and_hold') {
        const res = await repo.receiveAndApplyInboxEvent({
          connectionId: 'conn-alpha',
          tenantId: 'tenant-alpha',
          eventId: msg.eventId,
          aggregateId: msg.aggregateId,
          aggregateVersion: 1,
          payload: msg.payload,
          workerId: `${workerName}-${process.pid}`,
          leaseDurationMs: msg.leaseDurationMs || 1000,
          nowMs: msg.nowMs,
          applyFn: async ({ recordTargetReceipt }) => {
            process.send?.({ type: 'FENCE_CLAIMED', step: msg.step, workerName, pid: process.pid });
            await waitForMsg('RESUME_STALE_WRITE');
            await recordTargetReceipt(
              'target:fence',
              { hijackedBy: workerName },
              { effectType: 'fence_test', markInboxComplete: true },
            );
            return { hijackedBy: workerName };
          },
        });
        process.send?.({ type: 'STEP_RESULT', step: msg.step, workerName, pid: process.pid, res });
      } else if (msg.action === 'reclaim_and_hold') {
        const res = await repo.receiveAndApplyInboxEvent({
          connectionId: 'conn-alpha',
          tenantId: 'tenant-alpha',
          eventId: msg.eventId,
          aggregateId: msg.aggregateId,
          aggregateVersion: 1,
          payload: msg.payload,
          workerId: `${workerName}-${process.pid}`,
          leaseDurationMs: msg.leaseDurationMs || 30000,
          nowMs: msg.nowMs,
          applyFn: async ({ fencingToken, recordTargetReceipt }) => {
            process.send?.({
              type: 'FENCE_RECLAIMED',
              step: msg.step,
              workerName,
              pid: process.pid,
              fencingToken,
            });
            await waitForMsg('COMPLETE_ACTIVE');
            await recordTargetReceipt(
              'target:fence',
              { winner: workerName, fencingToken },
              { effectType: 'fence_test', markInboxComplete: true },
            );
            return { winner: workerName, fencingToken };
          },
        });
        process.send?.({ type: 'STEP_RESULT', step: msg.step, workerName, pid: process.pid, res });
      }
    }

    if (msg.type === 'RUN_STALE_COMPLETE_PROBE') {
      const { data, error } = await db.rpc('complete_integration_inbox_event', {
        p_inbox_id: msg.inboxId,
        p_worker_id: `${workerName}-${process.pid}`,
        p_status: 'applied',
        p_result_json: { hijackedComplete: true },
        p_error: null,
        p_effect_applied: true,
        p_now: new Date(msg.nowMs).toISOString(),
        p_fencing_token: msg.staleFencingToken,
      });
      process.send?.({
        type: 'STALE_COMPLETE_RESULT',
        workerName,
        pid: process.pid,
        data,
        error,
      });
    }

    if (msg.type === 'SHUTDOWN') {
      await close();
      process.exit(0);
    }
  });

  process.send?.({ type: 'WORKER_ONLINE', workerName, pid: process.pid });
}

async function runRv3HrCrash1(tempDataDir) {
  const pg = new PGlite(tempDataDir);
  await pg.waitReady;

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
    'migrations/009_inbox_leases_and_quota_accounting_fix.sql',
    'migrations/010_driving_income.sql',
    'migrations/011_atomic_effect_receipts_and_fencing.sql',
  ]) {
    await pg.exec(await fs.readFile(new URL('supabase/' + file, root), 'utf8'));
  }

  const hash = await bcrypt.hash('rv3-pw', 4);
  for (const [id, role, name, salary] of [
    ['HR1', 'hr', 'HR Lead', 30000],
    ['EMP-DRV1', 'employee', 'สมชาย ขับดี', 20000],
  ]) {
    await pg.query(
      'insert into users(id,username,password,name,role,employee_id,status) values($1,$1,$2,$3,$4,$1,$5)',
      [id, hash, name, role, 'active'],
    );
    await pg.query('insert into employee_records(employee_id,salary) values($1,$2)', [id, salary]);
  }

  const db = createDbClientFromExecutor((sql, params) => pg.query(sql, params));
  const { upsertVerifiedDriverEmployeeLink } = await import('../../lib/driver-employee-links.js');
  await upsertVerifiedDriverEmployeeLink(
    {
      tenantId: 'tenant-alpha',
      connectionId: 'conn-alpha',
      hrEmployeeId: 'EMP-DRV1',
      tmsDriverId: 'DRV-A01',
      employmentClassification: 'employee',
      verifiedBy: 'HR1',
    },
    db,
  );

  const {
    createPayrollImportBatch,
    reviewPayrollImportBatch,
    approvePayrollImportBatch,
    postImportBatchToPayroll,
  } = await import('../../lib/payroll-tms-import.js');
  const batch = await createPayrollImportBatch({
    tenantId: 'tenant-alpha',
    period: '2026-11',
    connectionId: 'conn-alpha',
    createdBy: 'HR1',
    database: db,
    lines: [
      {
        sourceEarningLineId: 'EARN-RV3-1',
        sourceRevision: 1,
        jobId: 'JOB-RV3-1',
        tmsDriverId: 'DRV-A01',
        verifiedAt: '2026-11-10T10:00:00Z',
        paymentOwner: 'hr_payroll',
        amountMinor: 150000,
      },
    ],
  });
  await reviewPayrollImportBatch({ tenantId: 'tenant-alpha', batchId: batch.id, actorId: 'HR1', database: db });
  await approvePayrollImportBatch({ tenantId: 'tenant-alpha', batchId: batch.id, actorId: 'HR1', database: db });

  const { SupabaseOutboxInboxRepository } = await import('../../lib/integration-outbox-inbox.js');
  const repo = new SupabaseOutboxInboxRepository(db);

  process.send?.({ type: 'HR_CRASH_META', pid: process.pid, batchId: batch.id });

  await repo.receiveAndApplyInboxEvent({
    connectionId: 'conn-alpha',
    tenantId: 'tenant-alpha',
    eventId: 'evt-hr-post-crash-1',
    aggregateId: batch.id,
    aggregateVersion: 1,
    eventType: 'hr.payroll.post',
    payload: { action: 'post', batchId: batch.id },
    workerId: `hr-crash-worker-${process.pid}`,
    leaseDurationMs: 1000,
    nowMs: 1_700_000_000_000,
    applyFn: async (inboxCtx) =>
      postImportBatchToPayroll({
        tenantId: 'tenant-alpha',
        batchId: batch.id,
        actorId: 'HR1',
        database: db,
        eventId: inboxCtx.eventId,
        connectionId: inboxCtx.connectionId,
        inboxId: inboxCtx.inboxId,
        workerId: inboxCtx.workerId,
        fencingToken: inboxCtx.fencingToken,
        onAfterCommit: async () => {
          // Simulate sudden OS crash right after PG commit, BEFORE complete_integration_inbox_event runs
          await pg.exec('CHECKPOINT');
          await pg.close();
          process.exit(91);
        },
      }),
  });
}

async function runRv3HrCrash2(tempDataDir, batchId) {
  const pg = new PGlite(tempDataDir);
  await pg.waitReady;
  const db = createDbClientFromExecutor((sql, params) => pg.query(sql, params));

  const inboxBefore = (
    await pg.query(
      `select status, effect_applied_at, lease_owner from integration_inbox where event_id = 'evt-hr-post-crash-1'`,
    )
  ).rows[0];
  const receiptsBefore = (
    await pg.query(`select effect_type, target_key from integration_effect_receipts where event_id = 'evt-hr-post-crash-1'`)
  ).rows;

  const { SupabaseOutboxInboxRepository } = await import('../../lib/integration-outbox-inbox.js');
  const { postImportBatchToPayroll } = await import('../../lib/payroll-tms-import.js');
  const repo = new SupabaseOutboxInboxRepository(db);

  let postCallCount = 0;
  const retryRes = await repo.receiveAndApplyInboxEvent({
    connectionId: 'conn-alpha',
    tenantId: 'tenant-alpha',
    eventId: 'evt-hr-post-crash-1',
    aggregateId: batchId,
    aggregateVersion: 1,
    eventType: 'hr.payroll.post',
    payload: { action: 'post', batchId },
    workerId: `hr-recovery-worker-${process.pid}`,
    leaseDurationMs: 30000,
    nowMs: 1_700_000_010_000,
    applyFn: async (inboxCtx) => {
      postCallCount++;
      return postImportBatchToPayroll({
        tenantId: 'tenant-alpha',
        batchId,
        actorId: 'HR2',
        database: db,
        eventId: inboxCtx.eventId,
        connectionId: inboxCtx.connectionId,
        inboxId: inboxCtx.inboxId,
        workerId: inboxCtx.workerId,
        fencingToken: inboxCtx.fencingToken,
      });
    },
  });

  const slip = (await pg.query(`select driving_pay, bonus, net, status from payroll_slips where employee_id = 'EMP-DRV1' and period = '2026-11'`)).rows[0];
  const inboxAfter = (await pg.query(`select status, effect_applied_at, lease_owner from integration_inbox where event_id = 'evt-hr-post-crash-1'`)).rows[0];
  const receiptsAfter = (await pg.query(`select id, effect_type from integration_effect_receipts where event_id = 'evt-hr-post-crash-1'`)).rows;

  await pg.exec('CHECKPOINT');
  await pg.close();

  process.send?.({
    ok: true,
    pid: process.pid,
    inboxBefore,
    receiptsBefore,
    retryRes,
    postCallCount,
    slip,
    inboxAfter,
    receiptCountAfter: receiptsAfter.length,
  });
}

async function runRv3WmsPartialCrash1(tempDataDir) {
  const pg = new PGlite(tempDataDir);
  await pg.waitReady;

  await pg.exec(`
    CREATE TABLE IF NOT EXISTS outbound_orders (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID NOT NULL,
      order_no TEXT NOT NULL,
      customer_name TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'SHIPPED',
      items_json JSONB NOT NULL DEFAULT '[]'::JSONB,
      delivered_at TIMESTAMPTZ,
      pod_signature TEXT DEFAULT '',
      pod_photo TEXT DEFAULT '',
      pod_note TEXT DEFAULT '',
      tms_status TEXT,
      tms_synced_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ,
      driver_name TEXT,
      vehicle_plate TEXT,
      tms_job_id TEXT,
      tracking_no TEXT
    );
    CREATE TABLE IF NOT EXISTS return_orders (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID NOT NULL,
      rma_no TEXT NOT NULL,
      order_no TEXT NOT NULL,
      customer_name TEXT DEFAULT '',
      reason TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'REQUESTED',
      disposition TEXT NOT NULL DEFAULT 'QUARANTINE',
      items_json JSONB NOT NULL DEFAULT '[]'::JSONB,
      created_by TEXT,
      notes TEXT
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id BIGSERIAL PRIMARY KEY,
      ts TIMESTAMPTZ DEFAULT NOW(),
      org_id UUID,
      user_name TEXT,
      action TEXT,
      module TEXT,
      record_id TEXT,
      description TEXT,
      new_values JSONB
    );
  `);
  for (const file of [
    'migrations/006_entitlements_and_quotas.sql',
    'migrations/007_integration_links_outbox_inbox.sql',
    'migrations/009_inbox_leases_and_quota_accounting_fix.sql',
    'migrations/011_atomic_effect_receipts_and_fencing.sql',
  ]) {
    await pg.exec(await fs.readFile(new URL('supabase/' + file, root), 'utf8'));
  }

  const orgId = '11111111-1111-4111-8111-111111111111';
  await pg.query(
    `INSERT INTO outbound_orders (org_id, order_no, customer_name, status, items_json, tms_job_id)
     VALUES ($1::uuid, 'ORD-RV3-DROP1', 'Cust A', 'SHIPPED', '[{"sku":"SKU-1","name":"Item 1","qty":1}]'::jsonb, 'JOB-RV3-MULTI'),
            ($1::uuid, 'ORD-RV3-DROP2', 'Cust B', 'SHIPPED', '[{"sku":"SKU-2","name":"Item 2","qty":2}]'::jsonb, 'JOB-RV3-MULTI')`,
    [orgId],
  );

  const db = createDbClientFromExecutor((sql, params) => pg.query(sql, params));
  const { SupabaseOutboxInboxRepository } = await import('../../lib/integration-outbox-inbox.js');
  const repo = new SupabaseOutboxInboxRepository(db);

  const dropsPayload = {
    job_id: 'JOB-RV3-MULTI',
    drops: [
      { drop_index: 1, wms_order_no: 'ORD-RV3-DROP1', status: 'Completed', has_incidents: true, incidents: [{ category: 'DAMAGED', description: 'Drop 1 box crushed' }] },
      { drop_index: 2, wms_order_no: 'ORD-RV3-DROP2', status: 'Completed', has_incidents: true, incidents: [{ category: 'WET', description: 'Drop 2 wet carton' }] },
    ],
  };

  process.send?.({ type: 'WMS_CRASH_META', pid: process.pid, orgId });

  await repo.receiveAndApplyInboxEvent({
    connectionId: 'conn-tms-wms-alpha',
    tenantId: orgId,
    eventId: 'evt-wms-multidrop-crash-1',
    aggregateId: 'JOB-RV3-MULTI',
    aggregateVersion: 1,
    eventType: 'tms.pod.updated',
    payload: dropsPayload,
    workerId: `wms-crash-worker-${process.pid}`,
    leaseDurationMs: 1000,
    nowMs: 1_700_000_000_000,
    applyFn: async (inboxCtx) => {
      for (let i = 0; i < dropsPayload.drops.length; i++) {
        const d = dropsPayload.drops[i];
        const { error: dropErr } = await db.rpc('apply_wms_tms_pod_target_atomic', {
          p_tenant_id: orgId,
          p_connection_id: inboxCtx.connectionId,
          p_event_id: inboxCtx.eventId,
          p_target_key: `drop:${d.drop_index}:${d.wms_order_no}`,
          p_inbox_id: inboxCtx.inboxId,
          p_worker_id: inboxCtx.workerId,
          p_fencing_token: inboxCtx.fencingToken,
          p_order_no: d.wms_order_no,
          p_tms_job_id: 'JOB-RV3-MULTI',
          p_status: d.status,
          p_is_completed: true,
          p_has_incidents: d.has_incidents,
          p_incidents: d.incidents,
          p_mark_inbox_complete: i === dropsPayload.drops.length - 1,
          p_now: new Date(1_700_000_000_100).toISOString(),
        });
        if (dropErr) throw new Error(dropErr.message);
        if (i === 0) {
          // Simulate hard OS crash right after Drop 1 commits and before Drop 2 starts!
          await pg.exec('CHECKPOINT');
          await pg.close();
          process.exit(91);
        }
      }
      return {};
    },
  });
}

async function runRv3WmsPartialCrash2(tempDataDir) {
  const pg = new PGlite(tempDataDir);
  await pg.waitReady;
  const db = createDbClientFromExecutor((sql, params) => pg.query(sql, params));
  const orgId = '11111111-1111-4111-8111-111111111111';

  const inboxBefore = (
    await pg.query(
      `select status, effect_applied_at, attempt_count from integration_inbox where event_id = 'evt-wms-multidrop-crash-1'`,
    )
  ).rows[0];
  const drop2Before = (
    await pg.query(`select status from outbound_orders where order_no = 'ORD-RV3-DROP2'`)
  ).rows[0];

  const { SupabaseOutboxInboxRepository } = await import('../../lib/integration-outbox-inbox.js');
  const repo = new SupabaseOutboxInboxRepository(db);

  const dropsPayload = {
    job_id: 'JOB-RV3-MULTI',
    drops: [
      { drop_index: 1, wms_order_no: 'ORD-RV3-DROP1', status: 'Completed', has_incidents: true, incidents: [{ category: 'DAMAGED', description: 'Drop 1 box crushed' }] },
      { drop_index: 2, wms_order_no: 'ORD-RV3-DROP2', status: 'Completed', has_incidents: true, incidents: [{ category: 'WET', description: 'Drop 2 wet carton' }] },
    ],
  };

  let committedKeysSeenOnReclaim = [];
  const dropOutcomes = [];
  const recoverRes = await repo.receiveAndApplyInboxEvent({
    connectionId: 'conn-tms-wms-alpha',
    tenantId: orgId,
    eventId: 'evt-wms-multidrop-crash-1',
    aggregateId: 'JOB-RV3-MULTI',
    aggregateVersion: 1,
    eventType: 'tms.pod.updated',
    payload: dropsPayload,
    workerId: `wms-recovery-worker-${process.pid}`,
    leaseDurationMs: 30000,
    nowMs: 1_700_000_010_000,
    applyFn: async (inboxCtx) => {
      committedKeysSeenOnReclaim = Object.keys(inboxCtx.committedReceipts || {});
      const applied = [];
      const skippedIdempotent = [];
      for (let i = 0; i < dropsPayload.drops.length; i++) {
        const d = dropsPayload.drops[i];
        const { data: rpcOut, error: rpcErr } = await db.rpc('apply_wms_tms_pod_target_atomic', {
          p_tenant_id: orgId,
          p_connection_id: inboxCtx.connectionId,
          p_event_id: inboxCtx.eventId,
          p_target_key: `drop:${d.drop_index}:${d.wms_order_no}`,
          p_inbox_id: inboxCtx.inboxId,
          p_worker_id: inboxCtx.workerId,
          p_fencing_token: inboxCtx.fencingToken,
          p_order_no: d.wms_order_no,
          p_tms_job_id: 'JOB-RV3-MULTI',
          p_status: d.status,
          p_is_completed: true,
          p_has_incidents: d.has_incidents,
          p_incidents: d.incidents,
          p_mark_inbox_complete: i === dropsPayload.drops.length - 1,
          p_now: new Date(1_700_000_010_100).toISOString(),
        });
        if (rpcErr) throw new Error(rpcErr.message);
        dropOutcomes.push(rpcOut);
        if (rpcOut.outcome === 'skipped_idempotent' || rpcOut.idempotent) skippedIdempotent.push(d.wms_order_no);
        else applied.push(d.wms_order_no);
      }
      return { applied, skippedIdempotent, failed: [], unmappedReviewQueue: [] };
    },
  });

  const ordersAfter = (
    await pg.query(`select order_no, status from outbound_orders order by order_no`)
  ).rows;
  const rmaCounts = (
    await pg.query(`select order_no, count(*)::int as cnt from return_orders group by order_no order by order_no`)
  ).rows;
  const auditCounts = (
    await pg.query(`select description, count(*)::int as cnt from audit_log group by description order by description`)
  ).rows;
  const receiptCount = (
    await pg.query(`select count(*)::int as cnt from integration_effect_receipts where event_id = 'evt-wms-multidrop-crash-1'`)
  ).rows[0].cnt;
  const inboxAfter = (
    await pg.query(`select status, effect_applied_at, attempt_count from integration_inbox where event_id = 'evt-wms-multidrop-crash-1'`)
  ).rows[0];

  await pg.exec('CHECKPOINT');
  await pg.close();

  process.send?.({
    ok: true,
    pid: process.pid,
    inboxBefore,
    drop2Before,
    committedKeysSeenOnReclaim,
    dropOutcomes,
    recoverRes,
    ordersAfter,
    rmaCounts,
    auditCounts,
    receiptCount,
    inboxAfter,
  });
}

const mode = process.argv[2];
if (mode === 'disk-phase-1') {
  await runDiskPhase1(process.argv[3]);
} else if (mode === 'disk-phase-2') {
  await runDiskPhase2(process.argv[3], process.argv[4]);
} else if (mode === 'tcp-worker') {
  await runTcpWorker(process.argv[3], process.argv[4]);
} else if (mode === 'rv3-hr-crash-1') {
  await runRv3HrCrash1(process.argv[3]);
} else if (mode === 'rv3-hr-crash-2') {
  await runRv3HrCrash2(process.argv[3], process.argv[4]);
} else if (mode === 'rv3-wms-crash-1') {
  await runRv3WmsPartialCrash1(process.argv[3]);
} else if (mode === 'rv3-wms-crash-2') {
  await runRv3WmsPartialCrash2(process.argv[3]);
} else {
  throw new Error(`Unknown worker mode: ${mode}`);
}
