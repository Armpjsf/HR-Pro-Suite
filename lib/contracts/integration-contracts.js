export const CONTRACT_VERSION = '2.0.0';

const VALID_PRODUCTS = new Set(['hr', 'wms', 'tms']);
const VALID_CLASSIFICATIONS = new Set(['employee', 'subcontractor']);

export class ContractValidationError extends Error {
  constructor(message, code = 'CONTRACT_VALIDATION_ERROR', status = 400) {
    super(message);
    this.name = 'ContractValidationError';
    this.code = code;
    this.status = status;
  }
}

export class CrossTenantLinkError extends Error {
  constructor(message = 'Cross-tenant external entity link access forbidden') {
    super(message);
    this.name = 'CrossTenantLinkError';
    this.code = 'CROSS_TENANT_LINK_FORBIDDEN';
    this.status = 403;
  }
}

function isNonEmptyString(val) {
  return typeof val === 'string' && val.trim().length > 0;
}

export function validateEnvelope(envelope) {
  const errors = [];
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    return { valid: false, errors: ['Envelope must be a JSON object'] };
  }

  const requiredStrings = [
    'event_id',
    'connection_id',
    'event_type',
    'aggregate_id',
    'correlation_id',
    'tenant_claim',
  ];

  for (const field of requiredStrings) {
    if (!isNonEmptyString(envelope[field])) {
      errors.push(`Missing or empty string field: ${field}`);
    }
  }

  if (!VALID_PRODUCTS.has(envelope.source_product)) {
    errors.push('Invalid source_product (must be hr | wms | tms)');
  }
  if (!VALID_PRODUCTS.has(envelope.target_product)) {
    errors.push('Invalid target_product (must be hr | wms | tms)');
  }

  if (!isNonEmptyString(envelope.schema_version) || !/^2\.\d+\.\d+$/.test(envelope.schema_version)) {
    errors.push('Invalid schema_version (must match 2.x.y)');
  }

  if (!Number.isInteger(envelope.aggregate_version) || envelope.aggregate_version < 1) {
    errors.push('Invalid aggregate_version (must be integer >= 1)');
  }

  if (!isNonEmptyString(envelope.occurred_at) || Number.isNaN(Date.parse(envelope.occurred_at))) {
    errors.push('Invalid occurred_at (must be ISO-8601 timestamp)');
  }

  if (!envelope.payload || typeof envelope.payload !== 'object' || Array.isArray(envelope.payload)) {
    errors.push('Invalid payload (must be a non-null object)');
  }

  return { valid: errors.length === 0, errors };
}

export function validateDriverEarningLineV2(line) {
  const errors = [];
  if (!line || typeof line !== 'object' || Array.isArray(line)) {
    return { valid: false, errors: ['Earning line must be an object'] };
  }
  if (!isNonEmptyString(line.earning_line_id)) errors.push('Missing earning_line_id');
  if (!Number.isInteger(line.revision) || line.revision < 1) errors.push('Invalid revision');
  if (!isNonEmptyString(line.job_id)) errors.push('Missing job_id');
  if (!isNonEmptyString(line.driver_id)) errors.push('Missing driver_id');
  if (!VALID_CLASSIFICATIONS.has(line.employment_type)) errors.push('Invalid employment_type');
  if (!['hr_payroll', 'tms_paid'].includes(line.payment_owner)) errors.push('Invalid payment_owner');
  if (!Number.isInteger(line.amount_minor) || line.amount_minor < 0) errors.push('Invalid amount_minor');
  if (line.currency !== 'THB') errors.push('Invalid currency (must be THB)');
  if (typeof line.amount_decimal !== 'number' || !Number.isFinite(line.amount_decimal) || line.amount_decimal < 0) {
    errors.push('Invalid amount_decimal');
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Read-only legacy Notes parser kept strictly for historical backfill tooling.
 * Never use as primary runtime link truth in v2 flows.
 * @deprecated
 */
export function parseLegacyWmsNotesForBackfillOnly(notes) {
  const text = String(notes || '');
  const orderMatches = [...text.matchAll(/\[WMS:\s*([^\]]+)\]/gi)]
    .map((m) => String(m[1] || '').trim())
    .filter(Boolean);
  const tripMatch = text.match(/\[Trip:\s*([^\]]+)\]/i);
  const jobMatch = text.match(/\[TMS Job:\s*([^\]]+)\]/i);
  const dropMatch = text.match(/\[Drop:\s*(\d+)\s*\/\s*(\d+)\]/i);

  return {
    backfillOnly: true,
    wmsOrderNos: [...new Set(orderMatches)],
    tripId: tripMatch ? tripMatch[1].trim() : null,
    tmsJobId: jobMatch ? jobMatch[1].trim() : null,
    dropIndex: dropMatch ? Number(dropMatch[1]) : null,
    totalDrops: dropMatch ? Number(dropMatch[2]) : null,
  };
}

export class ExternalEntityLinkStore {
  constructor() {
    this.links = new Map();
    this.connectionTenants = new Map();
  }

  _buildKey(tenantId, connectionId, sourceSystem, sourceType, sourceId) {
    return `${tenantId}::${connectionId}::${sourceSystem}::${sourceType}::${sourceId}`;
  }

  _assertTenantConnectionBinding(tenantId, connectionId) {
    const existingTenant = this.connectionTenants.get(connectionId);
    if (existingTenant && existingTenant !== tenantId) {
      throw new CrossTenantLinkError(
        `Connection '${connectionId}' belongs to another tenant; cross-tenant link access denied`
      );
    }
  }

  linkExternalEntity(input) {
    const tenantId = String(input?.tenantId || '').trim();
    const connectionId = String(input?.connectionId || '').trim();
    const sourceSystem = String(input?.sourceSystem || '').trim().toLowerCase();
    const sourceType = String(input?.sourceType || '').trim();
    const sourceId = String(input?.sourceId || '').trim();
    const targetSystem = String(input?.targetSystem || '').trim().toLowerCase();
    const targetType = String(input?.targetType || '').trim();
    const targetId = String(input?.targetId || '').trim();

    if (!tenantId || !connectionId || !sourceSystem || !sourceType || !sourceId || !targetSystem || !targetType || !targetId) {
      throw new ContractValidationError('All external entity link fields are required');
    }

    this._assertTenantConnectionBinding(tenantId, connectionId);
    this.connectionTenants.set(connectionId, tenantId);

    const key = this._buildKey(tenantId, connectionId, sourceSystem, sourceType, sourceId);
    const existing = this.links.get(key);
    if (existing) {
      if (existing.targetId !== targetId || existing.targetSystem !== targetSystem || existing.targetType !== targetType) {
        throw new ContractValidationError(
          `External entity link conflict for ${key}: already mapped to ${existing.targetSystem}:${existing.targetType}:${existing.targetId}`,
          'EXTERNAL_LINK_CONFLICT',
          409
        );
      }
      return { ...existing };
    }

    const record = {
      tenantId,
      connectionId,
      sourceSystem,
      sourceType,
      sourceId,
      targetSystem,
      targetType,
      targetId,
      metadata: input.metadata ? { ...input.metadata } : {},
      createdAt: new Date().toISOString(),
    };
    this.links.set(key, record);
    return { ...record };
  }

  resolveExternalEntity(query) {
    const tenantId = String(query?.tenantId || '').trim();
    const connectionId = String(query?.connectionId || '').trim();
    const sourceSystem = String(query?.sourceSystem || '').trim().toLowerCase();
    const sourceType = String(query?.sourceType || '').trim();
    const sourceId = String(query?.sourceId || '').trim();

    if (!tenantId || !connectionId || !sourceSystem || !sourceType || !sourceId) {
      throw new ContractValidationError('tenantId, connectionId, sourceSystem, sourceType, and sourceId are required');
    }

    this._assertTenantConnectionBinding(tenantId, connectionId);

    const key = this._buildKey(tenantId, connectionId, sourceSystem, sourceType, sourceId);
    const found = this.links.get(key);
    if (!found) return null;
    if (found.tenantId !== tenantId) {
      throw new CrossTenantLinkError();
    }
    return { ...found };
  }

  listLinksForTenant(tenantId, connectionId) {
    const tid = String(tenantId || '').trim();
    if (!tid) throw new ContractValidationError('tenantId is required');
    if (connectionId) {
      this._assertTenantConnectionBinding(tid, String(connectionId).trim());
    }
    const out = [];
    for (const rec of this.links.values()) {
      if (rec.tenantId !== tid) continue;
      if (connectionId && rec.connectionId !== connectionId) continue;
      out.push({ ...rec });
    }
    return out;
  }

  clear() {
    this.links.clear();
    this.connectionTenants.clear();
  }
}

export class DriverEmployeeLinkStore {
  constructor() {
    this.records = new Map();
    this.connectionTenants = new Map();
  }

  _key(tenantId, connectionId, tmsDriverId) {
    return `${tenantId}::${connectionId || 'default'}::${tmsDriverId}`;
  }

  upsertVerifiedDriverEmployeeLink(input) {
    const tenantId = String(input?.tenantId || '').trim();
    const connectionId = String(input?.connectionId || 'default').trim();
    const hrEmployeeId = String(input?.hrEmployeeId || '').trim();
    const tmsDriverId = String(input?.tmsDriverId || '').trim();
    const employmentClassification = String(input?.employmentClassification || '').trim();
    const verifiedBy = String(input?.verifiedBy || '').trim();

    if (!tenantId || !hrEmployeeId || !tmsDriverId) {
      throw new ContractValidationError('tenantId, hrEmployeeId, and tmsDriverId are required');
    }
    if (!VALID_CLASSIFICATIONS.has(employmentClassification)) {
      throw new ContractValidationError("employmentClassification must be 'employee' or 'subcontractor'");
    }
    if (!verifiedBy) {
      throw new ContractValidationError(
        'UNVERIFIED_LINK_REJECTED: verifiedBy actor is required; fuzzy/unverified auto-linking is prohibited',
        'UNVERIFIED_LINK_REJECTED',
        400
      );
    }

    const boundTenant = this.connectionTenants.get(connectionId);
    if (connectionId !== 'default' && boundTenant && boundTenant !== tenantId) {
      throw new CrossTenantLinkError();
    }
    if (connectionId !== 'default') {
      this.connectionTenants.set(connectionId, tenantId);
    }

    const k = this._key(tenantId, connectionId, tmsDriverId);
    const existing = this.records.get(k);
    if (existing && existing.tenantId !== tenantId) {
      throw new CrossTenantLinkError();
    }

    const record = {
      id: existing?.id || input.id || `drv-link-${tenantId}-${tmsDriverId}`,
      tenantId,
      connectionId,
      hrEmployeeId,
      tmsDriverId,
      employmentClassification,
      effectiveFrom: input.effectiveFrom || null,
      effectiveTo: input.effectiveTo || null,
      active: input.active !== false,
      verifiedBy,
      verifiedAt: input.verifiedAt || new Date().toISOString(),
    };
    this.records.set(k, record);
    return { ...record };
  }

  getVerifiedDriverEmployeeLink({ tenantId, connectionId = 'default', tmsDriverId, asOfDate } = {}) {
    const tid = String(tenantId || '').trim();
    const cid = String(connectionId || 'default').trim();
    const did = String(tmsDriverId || '').trim();
    if (!tid || !did) {
      throw new ContractValidationError('tenantId and tmsDriverId are required');
    }
    if (cid !== 'default') {
      const boundTenant = this.connectionTenants.get(cid);
      if (boundTenant && boundTenant !== tid) {
        throw new CrossTenantLinkError();
      }
    }

    const rec = this.records.get(this._key(tid, cid, did));
    if (!rec) return null;
    if (rec.tenantId !== tid) throw new CrossTenantLinkError();
    if (!rec.active) return null;

    if (asOfDate) {
      const target = String(asOfDate).slice(0, 10);
      if (rec.effectiveFrom && target < String(rec.effectiveFrom).slice(0, 10)) return null;
      if (rec.effectiveTo && target > String(rec.effectiveTo).slice(0, 10)) return null;
    }

    return { ...rec };
  }

  listDriverEmployeeLinks({ tenantId, connectionId, activeOnly = false } = {}) {
    const tid = String(tenantId || '').trim();
    if (!tid) throw new ContractValidationError('tenantId is required');
    if (connectionId && connectionId !== 'default') {
      const boundTenant = this.connectionTenants.get(connectionId);
      if (boundTenant && boundTenant !== tid) {
        throw new CrossTenantLinkError();
      }
    }
    const out = [];
    for (const rec of this.records.values()) {
      if (rec.tenantId !== tid) continue;
      if (connectionId && rec.connectionId !== connectionId) continue;
      if (activeOnly && !rec.active) continue;
      out.push({ ...rec });
    }
    return out;
  }

  clear() {
    this.records.clear();
    this.connectionTenants.clear();
  }
}
