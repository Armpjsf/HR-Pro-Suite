export const PROVISIONING_STEPS = Object.freeze([
  'validate_config',
  'create_tenant_and_binding',
  'apply_migrations',
  'seed_minimum_required',
  'invite_first_admin',
  'verify_readiness',
]);

const provisioningStore = new Map();

export function clearProvisioningStateForTests() {
  provisioningStore.clear();
}

export function getProvisioningState(tenantIdOrKey) {
  return provisioningStore.get(tenantIdOrKey) || null;
}

export async function runTenantProvisioning(spec) {
  const tenantId = String(spec?.tenantId || '').trim();
  const idempotencyKey = String(spec?.idempotencyKey || tenantId).trim();
  const storeKey = `${tenantId}::${idempotencyKey}`;

  if (!tenantId || !spec?.orgName?.trim()) {
    throw new Error('tenantId and orgName are required for provisioning');
  }

  let record = provisioningStore.get(storeKey);
  const resumed = Boolean(record);
  if (!record) {
    record = {
      key: storeKey,
      tenantId,
      idempotencyKey,
      completedSteps: [],
      failedStep: null,
      lastError: null,
      status: 'in_progress',
      createdRecords: {
        tenantCreated: false,
        bindingCreated: false,
        migrationsApplied: false,
        minimumSeeded: false,
        demoSeeded: false,
        adminInvited: false,
        readinessVerified: false,
      },
      updatedAt: new Date().toISOString(),
    };
    provisioningStore.set(storeKey, record);
  }

  if (record.status === 'completed') {
    return {
      ok: true,
      resumed: true,
      status: 'completed',
      completedSteps: [...record.completedSteps],
      failedStep: null,
      state: { ...record, completedSteps: [...record.completedSteps], createdRecords: { ...record.createdRecords } },
    };
  }

  record.status = 'in_progress';
  record.failedStep = null;
  record.lastError = null;

  for (const step of PROVISIONING_STEPS) {
    if (record.completedSteps.includes(step)) {
      continue;
    }

    try {
      const customHandler = spec.handlers?.[step];
      if (customHandler) {
        await customHandler(record);
      }

      if (step === 'validate_config') {
        if (!spec.adminUsername?.trim() && !spec.adminEmail?.trim()) {
          throw new Error('adminUsername or adminEmail is required');
        }
      } else if (step === 'create_tenant_and_binding') {
        record.createdRecords.tenantCreated = true;
        record.createdRecords.bindingCreated = true;
      } else if (step === 'apply_migrations') {
        record.createdRecords.migrationsApplied = true;
      } else if (step === 'seed_minimum_required') {
        record.createdRecords.minimumSeeded = true;
        record.createdRecords.demoSeeded = spec.seedDemo === true;
      } else if (step === 'invite_first_admin') {
        record.createdRecords.adminInvited = true;
      } else if (step === 'verify_readiness') {
        record.createdRecords.readinessVerified = true;
      }

      record.completedSteps.push(step);
      record.updatedAt = new Date().toISOString();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      record.status = 'failed';
      record.failedStep = step;
      record.lastError = msg;
      record.updatedAt = new Date().toISOString();
      return {
        ok: false,
        resumed,
        status: 'failed',
        completedSteps: [...record.completedSteps],
        failedStep: step,
        error: msg,
        state: { ...record, completedSteps: [...record.completedSteps], createdRecords: { ...record.createdRecords } },
      };
    }
  }

  record.status = 'completed';
  record.updatedAt = new Date().toISOString();
  return {
    ok: true,
    resumed,
    status: 'completed',
    completedSteps: [...record.completedSteps],
    failedStep: null,
    state: { ...record, completedSteps: [...record.completedSteps], createdRecords: { ...record.createdRecords } },
  };
}
