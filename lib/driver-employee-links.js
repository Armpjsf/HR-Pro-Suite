import { supabase } from './supabase.js';
import {
  DriverEmployeeLinkStore,
  ContractValidationError,
  CrossTenantLinkError,
} from './contracts/integration-contracts.js';

export const defaultDriverLinkStore = new DriverEmployeeLinkStore();

export { ContractValidationError, CrossTenantLinkError };

export async function upsertVerifiedDriverEmployeeLink(input, database = supabase) {
  const record = (database ? new DriverEmployeeLinkStore() : defaultDriverLinkStore).upsertVerifiedDriverEmployeeLink(input);

  if (database && typeof database.from === 'function') {
    const row = {
      id: record.id,
      tenant_id: record.tenantId,
      connection_id: record.connectionId,
      hr_employee_id: record.hrEmployeeId,
      tms_driver_id: record.tmsDriverId,
      employment_type: record.employmentClassification === 'subcontractor' ? 'subcontractor' : 'internal',
      employment_classification: record.employmentClassification,
      effective_from: record.effectiveFrom,
      effective_to: record.effectiveTo,
      active: record.active,
      verified_by: record.verifiedBy,
      verified_at: record.verifiedAt,
      status: record.active ? 'active' : 'disabled',
    };
    const { error } = await database.from('driver_employee_links').upsert(row, {
      onConflict: 'tenant_id,connection_id,tms_driver_id',
    });
    if (error) {
      throw new Error(`Failed to persist driver_employee_link: ${error.message}`);
    }
  }

  return record;
}

export async function getVerifiedDriverEmployeeLink(query, database = supabase) {
  if (database && typeof database.from === 'function') {
    const { data, error } = await database
      .from('driver_employee_links')
      .select('*')
      .eq('tenant_id', query.tenantId)
      .eq('connection_id', query.connectionId || 'default')
      .eq('tms_driver_id', query.tmsDriverId)
      .eq('active', true)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to query driver_employee_links: ${error.message}`);
    }

    if (!error && data) {
      if (data.tenant_id && data.tenant_id !== query.tenantId) {
        throw new CrossTenantLinkError();
      }
      if (query.asOfDate) {
        const asOf = String(query.asOfDate).slice(0, 10);
        if (data.effective_from && asOf < String(data.effective_from).slice(0, 10)) return null;
        if (data.effective_to && asOf > String(data.effective_to).slice(0, 10)) return null;
      }
      return {
        id: data.id,
        tenantId: data.tenant_id || query.tenantId,
        connectionId: data.connection_id || 'default',
        hrEmployeeId: data.hr_employee_id,
        tmsDriverId: data.tms_driver_id,
        employmentClassification: data.employment_classification || data.employment_type || 'employee',
        effectiveFrom: data.effective_from || null,
        effectiveTo: data.effective_to || null,
        active: data.active !== false,
        verifiedBy: data.verified_by || null,
        verifiedAt: data.verified_at || new Date().toISOString(),
      };
    }
  }

  if (database) return null;
  return defaultDriverLinkStore.getVerifiedDriverEmployeeLink(query);
}

export async function listDriverEmployeeLinks(query, database = supabase) {
  const storeRows = database ? [] : defaultDriverLinkStore.listDriverEmployeeLinks(query);
  if (database && typeof database.from === 'function') {
    let q = database
      .from('driver_employee_links')
      .select('*')
      .eq('tenant_id', query.tenantId);
    if (query.connectionId) q = q.eq('connection_id', query.connectionId);
    if (query.activeOnly) q = q.eq('active', true);
    const { data, error } = await q;
    if (error) {
      throw new Error(`Failed to list driver_employee_links: ${error.message}`);
    }
    if (!error && Array.isArray(data) && data.length > 0) {
      const merged = new Map(storeRows.map((r) => [r.tmsDriverId, r]));
      for (const d of data) {
        if (!merged.has(d.tms_driver_id)) {
          merged.set(d.tms_driver_id, {
            id: d.id,
            tenantId: d.tenant_id || query.tenantId,
            connectionId: d.connection_id || 'default',
            hrEmployeeId: d.hr_employee_id,
            tmsDriverId: d.tms_driver_id,
            employmentClassification: d.employment_classification || d.employment_type || 'employee',
            effectiveFrom: d.effective_from || null,
            effectiveTo: d.effective_to || null,
            active: d.active !== false,
            verifiedBy: d.verified_by || 'db_verified',
            verifiedAt: d.verified_at || null,
          });
        }
      }
      return [...merged.values()];
    }
  }
  return storeRows;
}

export function clearDriverLinksForTests() {
  defaultDriverLinkStore.clear();
}
