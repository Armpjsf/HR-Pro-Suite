import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fork } from 'node:child_process';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const root = new URL('../', import.meta.url);
const fixtureURL = new URL('./support/isolated-supabase.mjs', import.meta.url).href;
const workerScriptPath = fileURLToPath(new URL('./support/rv2-child-worker.mjs', import.meta.url));

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

function createPgClientAdapter(pg) {
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
            v && typeof v === 'object' && !Array.isArray(v) ? JSON.stringify(v) : v,
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

function runChildOnce(args) {
  return new Promise((resolve, reject) => {
    const child = fork(workerScriptPath, args, { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    let lastMsg = null;
    let stderr = '';
    child.stderr?.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('message', (m) => {
      lastMsg = m;
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`Child exited with code ${code}: ${stderr}`));
      } else {
        resolve(lastMsg);
      }
    });
  });
}

function runChildExpectExit(args, expectedCode) {
  return new Promise((resolve, reject) => {
    const child = fork(workerScriptPath, args, { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    let lastMsg = null;
    let stderr = '';
    child.stderr?.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('message', (m) => {
      lastMsg = m;
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code !== expectedCode) {
        reject(new Error(`Expected child exit ${expectedCode}, got ${code}: ${stderr}`));
      } else {
        resolve({ exitCode: code, lastMsg });
      }
    });
  });
}

function waitForIpcMessage(child, predicate) {
  return new Promise((resolve, reject) => {
    const onMsg = (msg) => {
      if (predicate(msg)) {
        cleanup();
        resolve(msg);
      }
    };
    const onExit = (code) => {
      cleanup();
      reject(new Error(`Worker exited unexpectedly with code ${code}`));
    };
    const cleanup = () => {
      child.off('message', onMsg);
      child.off('exit', onExit);
    };
    child.on('message', onMsg);
    child.on('exit', onExit);
  });
}

test('Codex RV2-01, RV2-02, RV2-03 & Multi-Process Disk/TCP PostgreSQL Verification', async (t) => {
  const {
    SupabaseOutboxInboxRepository,
    computePayloadHash,
  } = await import('../lib/integration-outbox-inbox.js');
  const {
    checkAndReserveQuota,
    releaseQuotaReservation,
    commitQuotaReservation,
    setTenantEntitlementForTests,
    clearEntitlementsForTests,
  } = await import('../lib/entitlements.js');

  t.after(() => {
    hooks.deregister();
  });

  await t.test('Part A.1 (RV2-01): Reproduces & fixes stale year-2020 processing row, active 409 retry, and crash-after-effect without duplicate side effects', async () => {
    const pg = new PGlite();
    await pg.waitReady;
    try {
      await pg.exec(await fs.readFile(new URL('supabase/migrations/006_entitlements_and_quotas.sql', root), 'utf8'));
      await pg.exec(await fs.readFile(new URL('supabase/migrations/007_integration_links_outbox_inbox.sql', root), 'utf8'));
      await pg.exec(await fs.readFile(new URL('supabase/migrations/009_inbox_leases_and_quota_accounting_fix.sql', root), 'utf8'));

      const db = createPgClientAdapter(pg);
      const repo = new SupabaseOutboxInboxRepository(db);

      // 1) Exact reproduction of codex-inbox-recovery-reproduction.json: stale processing row from year 2020
      const payload = { jobId: 'JOB-2020', amount: 1500 };
      const payloadHash = computePayloadHash(payload);
      await pg.query(
        `insert into integration_inbox (
           tenant_id, connection_id, event_id, aggregate_id, aggregate_version,
           event_type, schema_version, payload, payload_hash, status, lease_owner, lease_expires_at, received_at
         ) values (
           'tenant-alpha', 'conn-alpha', 'evt-stale-2020', 'EARN-2020', 1,
           'tms.earning.verified', '2.0.0', $1::jsonb, $2, 'processing', 'crashed-worker',
           '2020-01-01T00:00:30Z'::timestamptz, '2020-01-01T00:00:00Z'::timestamptz
         )`,
        [JSON.stringify(payload), payloadHash],
      );

      let sideEffects = 0;
      const reclaimed = await repo.receiveAndApplyInboxEvent({
        connectionId: 'conn-alpha',
        tenantId: 'tenant-alpha',
        eventId: 'evt-stale-2020',
        aggregateId: 'EARN-2020',
        aggregateVersion: 1,
        payload,
        applyFn: async () => {
          sideEffects++;
          return { recovered: true };
        },
      });
      assert.equal(reclaimed.status, 'applied');
      assert.equal(reclaimed.httpStatus, 200);
      assert.equal(sideEffects, 1, 'Stale processing row MUST reclaim and execute applyFn once');

      const rowAfter = (
        await pg.query(`select status, effect_applied_at, lease_owner from integration_inbox where event_id = 'evt-stale-2020'`)
      ).rows[0];
      assert.equal(rowAfter.status, 'applied');
      assert.ok(rowAfter.effect_applied_at);
      assert.equal(rowAfter.lease_owner, null);

      // 2) Synthetic DB adapter WITHOUT claim_integration_inbox_event RPC (fallback query path) also reclaims year-2020 row
      const syntheticRows = [
        {
          id: 'syn-1',
          tenant_id: 'tenant-alpha',
          connection_id: 'conn-alpha',
          event_id: 'evt-syn-2020',
          aggregate_id: 'EARN-SYN',
          aggregate_version: 1,
          payload_hash: payloadHash,
          status: 'processing',
          lease_expires_at: '2020-01-01T00:00:30Z',
          received_at: '2020-01-01T00:00:00Z',
          attempt_count: 1,
        },
      ];
      const syntheticDb = {
        from(table) {
          assert.equal(table, 'integration_inbox');
          const filters = [];
          let op = 'select';
          let patch = null;
          let isSingle = false;
          const q = {
            select: () => q,
            eq: (k, v) => { filters.push((r) => r[k] === v); return q; },
            order: () => q,
            limit: () => q,
            maybeSingle: () => { isSingle = true; return q; },
            update: (p) => { op = 'update'; patch = p; return q; },
            then(resolve, reject) {
              const matched = syntheticRows.filter((r) => filters.every((fn) => fn(r)));
              if (op === 'update') {
                matched.forEach((r) => Object.assign(r, patch));
                return Promise.resolve({ data: isSingle ? (matched[0] || null) : matched, error: null }).then(resolve, reject);
              }
              return Promise.resolve({ data: isSingle ? (matched[0] || null) : matched, error: null }).then(resolve, reject);
            },
          };
          return q;
        },
      };
      const synRepo = new SupabaseOutboxInboxRepository(syntheticDb);
      let synEffects = 0;
      const synRes = await synRepo.receiveAndApplyInboxEvent({
        connectionId: 'conn-alpha',
        tenantId: 'tenant-alpha',
        eventId: 'evt-syn-2020',
        aggregateId: 'EARN-SYN',
        aggregateVersion: 1,
        payload,
        applyFn: async () => {
          synEffects++;
          return { synRecovered: true };
        },
      });
      assert.equal(synRes.status, 'applied');
      assert.equal(synEffects, 1);

      // 3) Active processing lease -> MUST return 409 in_progress_retry_later (NEVER 200 duplicate_ignored)
      const activeNowMs = 1_750_000_000_000;
      await pg.query(
        `insert into integration_inbox (
           tenant_id, connection_id, event_id, aggregate_id, aggregate_version,
           event_type, schema_version, payload, payload_hash, status, lease_owner, lease_expires_at, received_at
         ) values (
           'tenant-alpha', 'conn-alpha', 'evt-active-lease', 'EARN-ACTIVE', 1,
           'tms.earning.verified', '2.0.0', $1::jsonb, $2, 'processing', 'live-worker-1',
           $3::timestamptz, $4::timestamptz
         )`,
        [
          JSON.stringify(payload),
          payloadHash,
          new Date(activeNowMs + 60_000).toISOString(),
          new Date(activeNowMs).toISOString(),
        ],
      );
      const activeRetry = await repo.receiveAndApplyInboxEvent({
        connectionId: 'conn-alpha',
        tenantId: 'tenant-alpha',
        eventId: 'evt-active-lease',
        aggregateId: 'EARN-ACTIVE',
        aggregateVersion: 1,
        payload,
        nowMs: activeNowMs + 5_000,
      });
      assert.equal(activeRetry.httpStatus, 409);
      assert.equal(activeRetry.status, 'in_progress_retry_later');

      // 4) Crash AFTER business effect applied, BEFORE finalization -> retry MUST NOT execute applyFn a second time
      let crashWindowEffects = 0;
      const crashFirst = await repo.receiveAndApplyInboxEvent({
        connectionId: 'conn-alpha',
        tenantId: 'tenant-alpha',
        eventId: 'evt-crash-after-effect',
        aggregateId: 'EARN-CRASH-FINAL',
        aggregateVersion: 1,
        payload: { jobId: 'JOB-CF', amount: 888 },
        applyFn: async ({ recordEffectApplied }) => {
          crashWindowEffects++;
          await recordEffectApplied({ appliedAmount: 888 });
          return { appliedAmount: 888 };
        },
        persistInboxFn: async () => {
          throw new Error('Simulated transient error during post-apply finalization');
        },
      });
      assert.equal(crashFirst.httpStatus, 500);
      assert.equal(crashWindowEffects, 1);

      const crashRetry = await repo.receiveAndApplyInboxEvent({
        connectionId: 'conn-alpha',
        tenantId: 'tenant-alpha',
        eventId: 'evt-crash-after-effect',
        aggregateId: 'EARN-CRASH-FINAL',
        aggregateVersion: 1,
        payload: { jobId: 'JOB-CF', amount: 888 },
        applyFn: async () => {
          crashWindowEffects++;
          return { appliedAmount: 888 };
        },
      });
      assert.equal(crashRetry.httpStatus, 200);
      assert.equal(crashRetry.status, 'duplicate_ignored');
      assert.equal(crashWindowEffects, 1, 'Side effect must NEVER execute twice after crash-before-finalize');

      // 5) Crash inside applyFn AFTER recordEffectApplied() while leaving row in 'processing' with effect_applied_at set
      let partialCrashEffects = 0;
      const partialFail = await repo.receiveAndApplyInboxEvent({
        connectionId: 'conn-alpha',
        tenantId: 'tenant-alpha',
        eventId: 'evt-partial-crash',
        aggregateId: 'EARN-PARTIAL',
        aggregateVersion: 1,
        payload: { jobId: 'JOB-PC', amount: 444 },
        applyFn: async ({ recordEffectApplied }) => {
          partialCrashEffects++;
          await recordEffectApplied({ ok: true, id: 'JOB-PC' });
          throw new Error('Crash after DB business write before return');
        },
      });
      assert.equal(partialFail.httpStatus, 500);
      assert.equal(partialCrashEffects, 1);

      const partialRecover = await repo.receiveAndApplyInboxEvent({
        connectionId: 'conn-alpha',
        tenantId: 'tenant-alpha',
        eventId: 'evt-partial-crash',
        aggregateId: 'EARN-PARTIAL',
        aggregateVersion: 1,
        payload: { jobId: 'JOB-PC', amount: 444 },
        applyFn: async () => {
          partialCrashEffects++;
          return { ok: true };
        },
      });
      assert.equal(partialRecover.httpStatus, 200);
      assert.equal(partialRecover.status, 'duplicate_ignored');
      assert.equal(partialCrashEffects, 1);
    } finally {
      await pg.close();
    }
  });

  await t.test('Part A.2 (RV2-03 & RV2-02): Reproduces & fixes quota committed double-count on real PostgreSQL + fail-closed missing/malformed RPC', async () => {
    const pg = new PGlite();
    await pg.waitReady;
    try {
      await pg.exec(await fs.readFile(new URL('supabase/migrations/006_entitlements_and_quotas.sql', root), 'utf8'));
      await pg.exec(await fs.readFile(new URL('supabase/migrations/007_integration_links_outbox_inbox.sql', root), 'utf8'));
      await pg.exec(await fs.readFile(new URL('supabase/migrations/009_inbox_leases_and_quota_accounting_fix.sql', root), 'utf8'));

      const db = createPgClientAdapter(pg);
      await pg.query(
        `insert into tenant_modules (tenant_id, package_code, modules, lifecycle_state)
         values ('tenant-alpha', 'FULL_SUITE', array['hr','wms','tms'], 'active')`,
      );
      await pg.query(
        `insert into tenant_features_limits (tenant_id, features, quotas)
         values ('tenant-alpha', '{}'::jsonb, '{"employees": 2}'::jsonb)`,
      );

      clearEntitlementsForTests();

      // Exact reproduction of codex-quota-accounting-reproduction.json:
      // limit=2 -> reserve event1 (base=0) -> commit event1 -> resource exists (base=1) -> reserve event2 (base=1) MUST SUCCEED!
      const first = await checkAndReserveQuota('tenant-alpha', 'employees', async () => 0, {
        module: 'hr',
        eventId: 'quota-repro-1',
        database: db,
      });
      assert.equal(first.allowed, true);
      assert.equal(first.reserved, 1);
      assert.equal(first.limit, 2);

      await commitQuotaReservation('tenant-alpha', 'employees', {
        module: 'hr',
        eventId: 'quota-repro-1',
        database: db,
      });

      const second = await checkAndReserveQuota('tenant-alpha', 'employees', async () => 1, {
        module: 'hr',
        eventId: 'quota-repro-2',
        database: db,
      });
      assert.equal(second.allowed, true, 'Committed reservation must NOT be double-counted against base=1 when limit=2');
      assert.equal(second.reserved, 1);
      assert.equal(second.limit, 2);

      await commitQuotaReservation('tenant-alpha', 'employees', {
        module: 'hr',
        eventId: 'quota-repro-2',
        database: db,
      });

      // Retry of committed event1 with base=2 MUST deduplicate cleanly
      const retryCommitted = await checkAndReserveQuota('tenant-alpha', 'employees', async () => 2, {
        module: 'hr',
        eventId: 'quota-repro-1',
        database: db,
      });
      assert.equal(retryCommitted.allowed, true);
      assert.equal(retryCommitted.deduplicated, true);

      // Distinct event3 with base=2 MUST fail with QUOTA_EXCEEDED
      await assert.rejects(
        () =>
          checkAndReserveQuota('tenant-alpha', 'employees', async () => 2, {
            module: 'hr',
            eventId: 'quota-repro-3',
            database: db,
          }),
        (err) => err.code === 'QUOTA_EXCEEDED' && err.status === 403,
      );

      // RV2-02: Fail closed (503 QUOTA_SCHEMA_MISSING) on 42883, PGRST202, or malformed RPC response
      setTenantEntitlementForTests('tenant-alpha', {
        packageCode: 'HR_ONLY',
        state: 'active',
        quotas: { employees: 5 },
      });

      for (const badDb of [
        { rpc: async () => ({ data: null, error: { code: '42883', message: 'function reserve_tenant_quota does not exist' } }) },
        { rpc: async () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.reserve_tenant_quota' } }) },
        { rpc: async () => ({ data: { unexpected: true }, error: null }) },
        { from: () => ({}) },
      ]) {
        await assert.rejects(
          () =>
            checkAndReserveQuota('tenant-alpha', 'employees', async () => 0, {
              module: 'hr',
              eventId: 'evt-fail-closed',
              database: badDb,
            }),
          (err) => err.code === 'QUOTA_SCHEMA_MISSING' && err.status === 503,
        );
      }

      await assert.rejects(
        () =>
          releaseQuotaReservation('tenant-alpha', 'employees', 1, {
            module: 'hr',
            eventId: 'evt-fail-closed',
            database: { rpc: async () => ({ data: null, error: { code: 'PGRST202', message: 'missing release_tenant_quota' } }) },
          }),
        (err) => err.code === 'QUOTA_SCHEMA_MISSING' && err.status === 503,
      );

      await assert.rejects(
        () =>
          commitQuotaReservation('tenant-alpha', 'employees', {
            module: 'hr',
            eventId: 'evt-fail-closed',
            database: { rpc: async () => ({ data: null, error: { code: '42883', message: 'missing commit_tenant_quota' } }) },
          }),
        (err) => err.code === 'QUOTA_SCHEMA_MISSING' && err.status === 503,
      );

      // In production, explicit in-memory opt-in MUST also be forbidden
      const prevNodeEnv = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = 'production';
        await assert.rejects(
          () =>
            checkAndReserveQuota('tenant-alpha', 'employees', async () => 0, {
              module: 'hr',
              eventId: 'evt-prod-block',
              database: null,
              allowInMemoryQuotaFallback: true,
            }),
          (err) => err.code === 'QUOTA_CONFIG_ERROR' && err.status === 503,
        );
      } finally {
        process.env.NODE_ENV = prevNodeEnv;
      }
    } finally {
      clearEntitlementsForTests();
      await pg.close();
    }
  });

  await t.test('Part B.1 (Real OS Process Restart on Disk-Backed PGlite): Separate Node OS child processes persist & recover outbox, inbox crash, payroll & committed quota', async () => {
    const tempDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-rv2-pg-disk-'));
    try {
      const phase1 = await runChildOnce(['disk-phase-1', tempDataDir]);
      assert.equal(phase1.ok, true);
      assert.ok(phase1.pid && phase1.pid !== process.pid, 'Phase 1 must run in a distinct OS child PID');
      assert.equal(phase1.q1.allowed, true);

      const phase2 = await runChildOnce(['disk-phase-2', tempDataDir, phase1.batchId]);
      assert.equal(phase2.ok, true);
      assert.ok(phase2.pid && phase2.pid !== phase1.pid && phase2.pid !== process.pid, 'Phase 2 must run in a brand-new OS child PID');
      assert.deepEqual(phase2.outboxEventIds, ['evt-disk-1']);
      assert.equal(phase2.reclaimedRes.status, 'applied');
      assert.equal(phase2.sideEffects, 1);
      assert.equal(phase2.postedStatus, 'posted');
      assert.equal(phase2.q2.allowed, true);
      assert.equal(phase2.q2.reserved, 1);
      assert.equal(phase2.q3ErrorCode, 'QUOTA_EXCEEDED');
    } finally {
      await fs.rm(tempDataDir, { recursive: true, force: true });
    }
  });

  await t.test('Part B.2 (Concurrent OS Worker Child Processes Over TCP with Barriers): Outbox SKIP LOCKED, Quota Last-Slot Race & Out-of-Order Inbox Aggregate Version Barrier', async () => {
    const pg = new PGlite();
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

    await pg.query(
      `insert into tenant_modules (tenant_id, package_code, modules, lifecycle_state)
       values ('tenant-alpha', 'FULL_SUITE', array['hr','wms','tms'], 'active')`,
    );
    await pg.query(
      `insert into tenant_features_limits (tenant_id, features, quotas)
       values ('tenant-alpha', '{}'::jsonb, '{"max_users": 2}'::jsonb)`,
    );

    // Seed 1 outbox event for multi-process SKIP LOCKED race
    const coordDb = createPgClientAdapter(pg);
    const coordRepo = new SupabaseOutboxInboxRepository(coordDb);
    await coordRepo.enqueueOutboxEvent({
      eventId: 'evt-tcp-race-1',
      tenantId: 'tenant-alpha',
      connectionId: 'conn-alpha',
      aggregateId: 'JOB-RACE-1',
      payload: { job: 'JOB-RACE-1' },
      nowMs: 1_700_000_000_000,
    });

    // Serialize pg.query calls cleanly across TCP sockets so PGlite executes each query deterministically
    let queryChain = Promise.resolve();
    const runPgQuery = (sql, params) => {
      const next = queryChain.then(() => pg.query(sql, params));
      queryChain = next.catch(() => {});
      return next;
    };

    const sockets = new Set();
    const server = net.createServer((socket) => {
      sockets.add(socket);
      socket.on('error', () => {});
      socket.on('close', () => sockets.delete(socket));
      let buffer = '';
      socket.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        let nlIdx;
        while ((nlIdx = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nlIdx).trim();
          buffer = buffer.slice(nlIdx + 1);
          if (!line) continue;
          const req = JSON.parse(line);
          runPgQuery(req.sql, req.params)
            .then((res) => {
              socket.write(JSON.stringify({ id: req.id, rows: res.rows || [] }) + '\n');
            })
            .catch((err) => {
              socket.write(
                JSON.stringify({ id: req.id, error: { code: err.code || 'ERR', message: err.message } }) + '\n',
              );
            });
        }
      });
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();

    const workerA = fork(workerScriptPath, ['tcp-worker', String(port), 'workerA'], {
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    const workerB = fork(workerScriptPath, ['tcp-worker', String(port), 'workerB'], {
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });

    try {
      const [onlineA, onlineB] = await Promise.all([
        waitForIpcMessage(workerA, (m) => m.type === 'WORKER_ONLINE'),
        waitForIpcMessage(workerB, (m) => m.type === 'WORKER_ONLINE'),
      ]);
      assert.notEqual(onlineA.pid, onlineB.pid);
      assert.notEqual(onlineA.pid, process.pid);

      // 1) Concurrent OS process outbox claim race at barrier
      const outboxReady = Promise.all([
        waitForIpcMessage(workerA, (m) => m.type === 'BARRIER_READY' && m.step === 'outbox'),
        waitForIpcMessage(workerB, (m) => m.type === 'BARRIER_READY' && m.step === 'outbox'),
      ]);
      const outboxResultsP = Promise.all([
        waitForIpcMessage(workerA, (m) => m.type === 'STEP_RESULT' && m.step === 'outbox'),
        waitForIpcMessage(workerB, (m) => m.type === 'STEP_RESULT' && m.step === 'outbox'),
      ]);
      workerA.send({ type: 'RUN_OUTBOX_CLAIM', nowMs: 1_700_000_005_000 });
      workerB.send({ type: 'RUN_OUTBOX_CLAIM', nowMs: 1_700_000_005_000 });
      await outboxReady;
      workerA.send({ type: 'BARRIER_GO' });
      workerB.send({ type: 'BARRIER_GO' });
      const [outA, outB] = await outboxResultsP;
      assert.equal(outA.claimedIds.length + outB.claimedIds.length, 1, 'Exactly one OS worker may claim the outbox event');

      // 2) Concurrent OS process quota race for last remaining slot (limit=2, base=1)
      const quotaReady = Promise.all([
        waitForIpcMessage(workerA, (m) => m.type === 'BARRIER_READY' && m.step === 'quota'),
        waitForIpcMessage(workerB, (m) => m.type === 'BARRIER_READY' && m.step === 'quota'),
      ]);
      const quotaResultsP = Promise.all([
        waitForIpcMessage(workerA, (m) => m.type === 'STEP_RESULT' && m.step === 'quota'),
        waitForIpcMessage(workerB, (m) => m.type === 'STEP_RESULT' && m.step === 'quota'),
      ]);
      workerA.send({ type: 'RUN_QUOTA_RACE', eventId: 'tcp-q-A', baseCount: 1, nowMs: 1_700_000_010_000 });
      workerB.send({ type: 'RUN_QUOTA_RACE', eventId: 'tcp-q-B', baseCount: 1, nowMs: 1_700_000_010_000 });
      await quotaReady;
      workerA.send({ type: 'BARRIER_GO' });
      workerB.send({ type: 'BARRIER_GO' });
      const [qResA, qResB] = await quotaResultsP;
      const qWinners = [qResA, qResB].filter((r) => r.ok);
      const qLosers = [qResA, qResB].filter((r) => !r.ok);
      assert.equal(qWinners.length, 1, 'Exactly one OS worker may win the last quota slot');
      assert.equal(qLosers.length, 1);
      assert.equal(qLosers[0].code, 'QUOTA_EXCEEDED');

      // 3) Out-of-order aggregate versions (v2 held mid-apply at barrier while v1 arrives from workerB)
      const stepName = 'inbox-v-race';
      const readyA = waitForIpcMessage(workerA, (m) => m.type === 'BARRIER_READY' && m.step === stepName);
      const readyB = waitForIpcMessage(workerB, (m) => m.type === 'BARRIER_READY' && m.step === stepName);
      const inApplyA = waitForIpcMessage(workerA, (m) => m.type === 'IN_APPLY_ENTERED' && m.step === stepName);
      const resAP = waitForIpcMessage(workerA, (m) => m.type === 'STEP_RESULT' && m.step === stepName);
      const resBP = waitForIpcMessage(workerB, (m) => m.type === 'STEP_RESULT' && m.step === stepName);

      workerA.send({
        type: 'RUN_INBOX_VERSION_RACE',
        step: stepName,
        eventId: 'evt-agg-v2',
        aggregateId: 'AGG-ORDER-99',
        aggregateVersion: 2,
        payload: { version: 2 },
        nowMs: 1_700_000_020_000,
        holdInApply: true,
      });
      workerB.send({
        type: 'RUN_INBOX_VERSION_RACE',
        step: stepName,
        eventId: 'evt-agg-v1',
        aggregateId: 'AGG-ORDER-99',
        aggregateVersion: 1,
        payload: { version: 1 },
        nowMs: 1_700_000_020_000,
        holdInApply: false,
      });

      await Promise.all([readyA, readyB]);
      // Start workerA (v2) and wait until it is paused mid-applyFn (status='processing' in DB)
      workerA.send({ type: 'BARRIER_GO' });
      await inApplyA;

      // Now release workerB (v1) WHILE v2 is mid-apply -> must be blocked with 409 in_progress_retry_later!
      workerB.send({ type: 'BARRIER_GO' });
      const resB = await resBP;
      assert.equal(resB.res.httpStatus, 409);
      assert.equal(resB.res.status, 'in_progress_retry_later');

      // Release workerA (v2) to complete -> v2 becomes applied
      workerA.send({ type: 'RELEASE_APPLY' });
      const resA = await resAP;
      assert.equal(resA.res.httpStatus, 200);
      assert.equal(resA.res.status, 'applied');

      // Now workerB retries v1 -> must be recorded as rejected_stale_version and state must stay at version 2!
      const retryStep = 'inbox-v1-retry';
      const readyB2 = waitForIpcMessage(workerB, (m) => m.type === 'BARRIER_READY' && m.step === retryStep);
      const resB2P = waitForIpcMessage(workerB, (m) => m.type === 'STEP_RESULT' && m.step === retryStep);
      workerB.send({
        type: 'RUN_INBOX_VERSION_RACE',
        step: retryStep,
        eventId: 'evt-agg-v1',
        aggregateId: 'AGG-ORDER-99',
        aggregateVersion: 1,
        payload: { version: 1 },
        nowMs: 1_700_000_021_000,
        holdInApply: false,
      });
      await readyB2;
      workerB.send({ type: 'BARRIER_GO' });
      const resB2 = await resB2P;
      assert.equal(resB2.res.httpStatus, 200);
      assert.equal(resB2.res.status, 'rejected_stale_version');

      const auditStates = (
        await pg.query(`select channel from audit_logs where action = 'INBOX_AGG_STATE' and user_name = 'AGG-ORDER-99'`)
      ).rows;
      assert.equal(auditStates.length, 1);
      assert.equal(JSON.parse(auditStates[0].channel).aggregateVersion, 2);

      const inboxRows = (
        await pg.query(`select event_id, aggregate_version, status from integration_inbox where aggregate_id = 'AGG-ORDER-99' order by aggregate_version desc`)
      ).rows;
      assert.deepEqual(
        inboxRows.map((r) => ({ event_id: r.event_id, version: Number(r.aggregate_version), status: r.status })),
        [
          { event_id: 'evt-agg-v2', version: 2, status: 'applied' },
          { event_id: 'evt-agg-v1', version: 1, status: 'rejected_stale_version' },
        ],
      );
    } finally {
      workerA.send({ type: 'SHUTDOWN' });
      workerB.send({ type: 'SHUTDOWN' });
      await Promise.all([
        new Promise((r) => workerA.once('exit', r)),
        new Promise((r) => workerB.once('exit', r)),
      ]);
      for (const s of sockets) s.destroy();
      await new Promise((r) => server.close(r));
      await pg.close();
    }
  });

  await t.test('Part C.1 (RV3-01 Real OS process.exit(91) Crash After HR Payroll SQL Commit Before Inbox Marker): Zero double-post on OS restart', async () => {
    const tempDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-rv3-hr-crash-'));
    try {
      const crash1 = await runChildExpectExit(['rv3-hr-crash-1', tempDataDir], 91);
      assert.equal(crash1.exitCode, 91);
      assert.ok(crash1.lastMsg?.batchId);
      assert.notEqual(crash1.lastMsg.pid, process.pid);

      const phase2 = await runChildOnce(['rv3-hr-crash-2', tempDataDir, crash1.lastMsg.batchId]);
      assert.equal(phase2.ok, true);
      assert.notEqual(phase2.pid, crash1.lastMsg.pid);
      assert.equal(phase2.inboxBefore.status, 'processing');
      assert.ok(phase2.inboxBefore.effect_applied_at, 'post_payroll_import_batch must stamp effect_applied_at atomically inside domain tx');
      assert.equal(phase2.receiptsBefore.length, 1);
      assert.equal(phase2.receiptsBefore[0].effect_type, 'hr_payroll_post');
      assert.equal(phase2.retryRes.httpStatus, 200);
      assert.equal(phase2.retryRes.status, 'duplicate_ignored');
      assert.equal(phase2.postCallCount, 0, 'Retry after crash-before-marker MUST NOT re-execute postImportBatchToPayroll');
      assert.equal(Number(phase2.slip.driving_pay), 1500);
      assert.equal(Number(phase2.slip.net), 21500);
      assert.equal(phase2.inboxAfter.status, 'applied');
      assert.equal(phase2.receiptCountAfter, 1);
    } finally {
      await fs.rm(tempDataDir, { recursive: true, force: true });
    }
  });

  await t.test('Part C.2 (RV3-01 Real OS process.exit(91) Crash After WMS Drop 1 Before Drop 2): Reuses Drop 1 receipt cleanly without duplicate RMA/audit and finishes Drop 2', async () => {
    const tempDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-rv3-wms-crash-'));
    try {
      const crash1 = await runChildExpectExit(['rv3-wms-crash-1', tempDataDir], 91);
      assert.equal(crash1.exitCode, 91);
      assert.notEqual(crash1.lastMsg.pid, process.pid);

      const phase2 = await runChildOnce(['rv3-wms-crash-2', tempDataDir]);
      assert.equal(phase2.ok, true);
      assert.notEqual(phase2.pid, crash1.lastMsg.pid);
      assert.equal(phase2.inboxBefore.status, 'processing');
      assert.equal(phase2.inboxBefore.effect_applied_at, null, 'Partial Drop 1 commit must leave effect_applied_at NULL until final target');
      assert.equal(phase2.drop2Before.status, 'SHIPPED', 'Drop 2 must still be SHIPPED before recovery');
      assert.deepEqual(phase2.committedKeysSeenOnReclaim, ['drop:1:ORD-RV3-DROP1']);
      assert.equal(phase2.dropOutcomes[0].receipt_reused, true);
      assert.equal(phase2.dropOutcomes[0].outcome, 'skipped_idempotent');
      assert.equal(phase2.dropOutcomes[1].outcome, 'applied');
      assert.equal(phase2.recoverRes.httpStatus, 200);
      assert.equal(phase2.recoverRes.status, 'applied');
      assert.deepEqual(phase2.ordersAfter, [
        { order_no: 'ORD-RV3-DROP1', status: 'DELIVERED' },
        { order_no: 'ORD-RV3-DROP2', status: 'DELIVERED' },
      ]);
      assert.deepEqual(phase2.rmaCounts, [
        { order_no: 'ORD-RV3-DROP1', cnt: 1 },
        { order_no: 'ORD-RV3-DROP2', cnt: 1 },
      ]);
      assert.equal(phase2.auditCounts.length, 2);
      assert.equal(phase2.auditCounts[0].cnt, 1);
      assert.equal(phase2.auditCounts[1].cnt, 1);
      assert.equal(phase2.receiptCount, 2);
      assert.equal(phase2.inboxAfter.status, 'applied');
      assert.ok(phase2.inboxAfter.effect_applied_at);
      assert.equal(phase2.inboxAfter.attempt_count, 2);
    } finally {
      await fs.rm(tempDataDir, { recursive: true, force: true });
    }
  });

  await t.test('Part C.3 (RV3-01 Stale-Worker Fencing Token Guard): Reclaimed lease fences stale worker from effect receipt and inbox completion across concurrent OS processes', async () => {
    const pg = new PGlite();
    await pg.waitReady;

    for (const file of [
      'migrations/006_entitlements_and_quotas.sql',
      'migrations/007_integration_links_outbox_inbox.sql',
      'migrations/009_inbox_leases_and_quota_accounting_fix.sql',
      'migrations/011_atomic_effect_receipts_and_fencing.sql',
    ]) {
      await pg.exec(await fs.readFile(new URL('supabase/' + file, root), 'utf8'));
    }

    let queryChain = Promise.resolve();
    const runPgQuery = (sql, params) => {
      const next = queryChain.then(() => pg.query(sql, params));
      queryChain = next.catch(() => {});
      return next;
    };

    const sockets = new Set();
    const server = net.createServer((socket) => {
      sockets.add(socket);
      socket.on('error', () => {});
      socket.on('close', () => sockets.delete(socket));
      let buffer = '';
      socket.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        let nlIdx;
        while ((nlIdx = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nlIdx).trim();
          buffer = buffer.slice(nlIdx + 1);
          if (!line) continue;
          const req = JSON.parse(line);
          runPgQuery(req.sql, req.params)
            .then((res) => {
              socket.write(JSON.stringify({ id: req.id, rows: res.rows || [] }) + '\n');
            })
            .catch((err) => {
              socket.write(
                JSON.stringify({ id: req.id, error: { code: err.code || 'ERR', message: err.message } }) + '\n',
              );
            });
        }
      });
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();

    const workerA = fork(workerScriptPath, ['tcp-worker', String(port), 'workerA'], {
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    const workerB = fork(workerScriptPath, ['tcp-worker', String(port), 'workerB'], {
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });

    try {
      await Promise.all([
        waitForIpcMessage(workerA, (m) => m.type === 'WORKER_ONLINE'),
        waitForIpcMessage(workerB, (m) => m.type === 'WORKER_ONLINE'),
      ]);

      const payload = { jobId: 'JOB-FENCE-1', amount: 100 };
      const readyA = waitForIpcMessage(workerA, (m) => m.type === 'BARRIER_READY' && m.step === 'fence-a');
      const claimedA = waitForIpcMessage(workerA, (m) => m.type === 'FENCE_CLAIMED' && m.step === 'fence-a');
      const resAP = waitForIpcMessage(workerA, (m) => m.type === 'STEP_RESULT' && m.step === 'fence-a');

      workerA.send({
        type: 'RUN_RV3_FENCE_STAGE',
        step: 'fence-a',
        action: 'claim_and_hold',
        eventId: 'evt-fence-1',
        aggregateId: 'AGG-FENCE-1',
        payload,
        leaseDurationMs: 1000,
        nowMs: 1_700_000_000_000,
      });
      await readyA;
      workerA.send({ type: 'BARRIER_GO' });
      await claimedA;

      // Worker B reclaims after Worker A's 1000ms lease has expired -> fencingToken = 2
      const readyB = waitForIpcMessage(workerB, (m) => m.type === 'BARRIER_READY' && m.step === 'fence-b');
      const reclaimedB = waitForIpcMessage(workerB, (m) => m.type === 'FENCE_RECLAIMED' && m.step === 'fence-b');
      const resBP = waitForIpcMessage(workerB, (m) => m.type === 'STEP_RESULT' && m.step === 'fence-b');

      workerB.send({
        type: 'RUN_RV3_FENCE_STAGE',
        step: 'fence-b',
        action: 'reclaim_and_hold',
        eventId: 'evt-fence-1',
        aggregateId: 'AGG-FENCE-1',
        payload,
        leaseDurationMs: 30000,
        nowMs: 1_700_000_005_000,
      });
      await readyB;
      workerB.send({ type: 'BARRIER_GO' });
      const bClaimMeta = await reclaimedB;
      assert.equal(bClaimMeta.fencingToken, 2);

      // Probe 1: Stale worker A tries to directly complete inbox with stale fencing token 1 while B owns lease
      const inboxRow = (
        await pg.query(`select id from integration_inbox where event_id = 'evt-fence-1'`)
      ).rows[0];
      const staleProbeP = waitForIpcMessage(workerA, (m) => m.type === 'STALE_COMPLETE_RESULT');
      workerA.send({
        type: 'RUN_STALE_COMPLETE_PROBE',
        inboxId: inboxRow.id,
        staleFencingToken: 1,
        nowMs: 1_700_000_005_500,
      });
      const staleProbe = await staleProbeP;
      assert.equal(staleProbe.error, null);
      assert.equal(staleProbe.data.updated, false);
      assert.equal(staleProbe.data.reason, 'lease_lost');

      // Probe 2: Stale worker A resumes and tries to record_integration_effect_receipt -> blocked with 409 lease_lost
      workerA.send({ type: 'RESUME_STALE_WRITE' });
      const resA = await resAP;
      assert.equal(resA.res.httpStatus, 409);
      assert.equal(resA.res.status, 'lease_lost');

      // Release active worker B to write receipt and finish -> 200 applied with B's result
      workerB.send({ type: 'COMPLETE_ACTIVE' });
      const resB = await resBP;
      assert.equal(resB.res.httpStatus, 200);
      assert.equal(resB.res.status, 'applied');
      assert.equal(resB.res.result.winner, 'workerB');

      const finalInbox = (
        await pg.query(`select status, result_json, attempt_count from integration_inbox where event_id = 'evt-fence-1'`)
      ).rows[0];
      assert.equal(finalInbox.status, 'applied');
      assert.equal(finalInbox.result_json.winner, 'workerB');
      assert.equal(Number(finalInbox.attempt_count), 2);

      const finalReceipt = (
        await pg.query(`select fencing_token, result_json from integration_effect_receipts where event_id = 'evt-fence-1'`)
      ).rows[0];
      assert.equal(Number(finalReceipt.fencing_token), 2);
      assert.equal(finalReceipt.result_json.winner, 'workerB');
    } finally {
      workerA.send({ type: 'SHUTDOWN' });
      workerB.send({ type: 'SHUTDOWN' });
      await Promise.all([
        new Promise((r) => workerA.once('exit', r)),
        new Promise((r) => workerB.once('exit', r)),
      ]);
      for (const s of sockets) s.destroy();
      await new Promise((r) => server.close(r));
      await pg.close();
    }
  });
});
