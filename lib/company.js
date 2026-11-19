import { supabase } from './supabase.js';
import { getDeploymentTenantId } from './deployment-tenant.js';

const testProfiles = new Map();
const runtimeProfiles = new Map();

const MAX_LOGO_BYTES = 2 * 1024 * 1024; // 2 MB
const ALLOWED_BRAND_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/svg+xml',
]);

function resolveTenantId(contextOrTenantId) {
  if (typeof contextOrTenantId === 'string' && contextOrTenantId.trim()) {
    return contextOrTenantId.trim();
  }
  if (contextOrTenantId && typeof contextOrTenantId === 'object' && typeof contextOrTenantId.tenantId === 'string' && contextOrTenantId.tenantId.trim()) {
    return contextOrTenantId.tenantId.trim();
  }
  return getDeploymentTenantId();
}

function defaultNeutralProfile(tenantId) {
  return {
    tenantId,
    legalEntityId: `le-${tenantId}`,
    displayName: 'HR Pro Suite',
    shortName: 'HR',
    name: 'HR Pro Suite',
    legalName: '',
    nameEn: '',
    taxId: '',
    taxBranchCode: '00000',
    address: '',
    phone: '',
    email: '',
    website: '',
    logoLightUrl: '/brand/hr-pro-logo.svg',
    logoDarkUrl: '/brand/hr-pro-logo.svg',
    logoDocumentUrl: '',
    primaryColor: '#0284C7',
    supportEmail: '',
    supportPhone: '',
    productLabel: 'HR Pro Suite',
    bankName: '',
    bankAccountNo: '',
    bankAccountName: '',
    signatoryName: '',
    signatoryTitle: '',
    signatureAssetId: null,
    stampAssetId: null,
    version: 1,
    setupComplete: false,
  };
}

function normalizeCompanyProfile(tenantId, raw = {}) {
  const base = defaultNeutralProfile(tenantId);
  const legalName = String(raw.legalName ?? raw.legal_name ?? raw.company_name_th ?? raw.company_name ?? '').trim();
  const displayName = String(raw.displayName ?? raw.display_name ?? raw.name ?? (legalName || base.displayName)).trim();
  const name = String(raw.name ?? raw.shortName ?? (displayName || legalName || base.name)).trim();
  const shortName = String(raw.shortName ?? raw.short_name ?? name).trim();
  const nameEn = String(raw.nameEn ?? raw.name_en ?? raw.company_name_en ?? '').trim();
  const taxId = String(raw.taxId ?? raw.tax_id ?? '').trim();
  const taxBranchCode = String(raw.taxBranchCode ?? raw.tax_branch_code ?? base.taxBranchCode).trim();
  const address = String(raw.address ?? '').trim();
  const phone = String(raw.phone ?? raw.supportPhone ?? '').trim();
  const email = String(raw.email ?? raw.supportEmail ?? '').trim();
  const website = String(raw.website ?? '').trim();
  const logoLightUrl = String(raw.logoLightUrl ?? raw.logo_light_url ?? raw.logoUrl ?? raw.logo_url ?? base.logoLightUrl).trim();
  const logoDarkUrl = String(raw.logoDarkUrl ?? raw.logo_dark_url ?? logoLightUrl).trim();
  const logoDocumentUrl = String(raw.logoDocumentUrl ?? raw.logo_document_url ?? raw.logoUrl ?? raw.logo_url ?? '').trim();
  const primaryColor = String(raw.primaryColor ?? raw.primary_color ?? base.primaryColor).trim();
  const supportEmail = String(raw.supportEmail ?? raw.support_email ?? email).trim();
  const supportPhone = String(raw.supportPhone ?? raw.support_phone ?? phone).trim();
  const productLabel = String(raw.productLabel ?? raw.product_label ?? base.productLabel).trim();
  const bankName = String(raw.bankName ?? raw.bank_name ?? '').trim();
  const bankAccountNo = String(raw.bankAccountNo ?? raw.bank_account_no ?? '').trim();
  const bankAccountName = String(raw.bankAccountName ?? raw.bank_account_name ?? '').trim();
  const signatoryName = String(raw.signatoryName ?? raw.signatory_name ?? '').trim();
  const signatoryTitle = String(raw.signatoryTitle ?? raw.signatory_title ?? '').trim();
  const signatureAssetId = raw.signatureAssetId ?? raw.signature_asset_id ?? null;
  const stampAssetId = raw.stampAssetId ?? raw.stamp_asset_id ?? null;
  const legalEntityId = String(raw.legalEntityId ?? raw.legal_entity_id ?? base.legalEntityId).trim();
  const version = Number(raw.version) > 0 ? Number(raw.version) : 1;
  const setupComplete = Boolean(legalName && taxId && address);

  return {
    tenantId,
    legalEntityId,
    displayName,
    shortName,
    name,
    legalName,
    nameEn,
    taxId,
    taxBranchCode,
    address,
    phone,
    email,
    website,
    logoLightUrl,
    logoDarkUrl,
    logoDocumentUrl,
    primaryColor,
    supportEmail,
    supportPhone,
    productLabel,
    bankName,
    bankAccountNo,
    bankAccountName,
    signatoryName,
    signatoryTitle,
    signatureAssetId,
    stampAssetId,
    version,
    setupComplete,
  };
}

function readEnvProfile(tenantId) {
  const rawJson = process.env.HR_COMPANY_PROFILE_JSON;
  if (!rawJson) return null;
  try {
    const parsed = JSON.parse(rawJson);
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed[tenantId] && typeof parsed[tenantId] === 'object') {
      return parsed[tenantId];
    }
    if (parsed.tenantId && parsed.tenantId !== tenantId) {
      return null;
    }
    if (!parsed.tenantId && tenantId !== getDeploymentTenantId()) {
      return null;
    }
    // Distinguish a tenant map { "tenant-alpha": { ... } } from a flat profile object
    const looksLikeProfile =
      'legalName' in parsed || 'legal_name' in parsed || 'name' in parsed || 'displayName' in parsed || 'taxId' in parsed || 'tax_id' in parsed;
    return looksLikeProfile ? parsed : null;
  } catch {
    return null;
  }
}

export function setTenantCompanyProfileForTests(tenantId, profile) {
  const key = resolveTenantId(tenantId);
  if (!profile) {
    testProfiles.delete(key);
    return null;
  }
  const normalized = normalizeCompanyProfile(key, profile);
  testProfiles.set(key, normalized);
  return normalized;
}

export function clearTenantCompanyProfilesForTests() {
  testProfiles.clear();
  runtimeProfiles.clear();
}

export async function getTenantCompanyProfile(contextOrTenantId, database = supabase) {
  const tenantId = resolveTenantId(contextOrTenantId);

  if (testProfiles.has(tenantId)) {
    return { ...testProfiles.get(tenantId) };
  }

  if (runtimeProfiles.has(tenantId)) {
    return { ...runtimeProfiles.get(tenantId) };
  }

  const envProfile = readEnvProfile(tenantId);
  if (envProfile) {
    return normalizeCompanyProfile(tenantId, envProfile);
  }

  if (database && typeof database.from === 'function') {
    try {
      const { data, error } = await database
        .from('company_profiles')
        .select('*')
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (!error && data) {
        return normalizeCompanyProfile(tenantId, data);
      }

      if (error && tenantId === 'default-tenant') {
        const fallback = await database.from('company_profiles').select('*').limit(1).maybeSingle();
        if (!fallback.error && fallback.data) {
          return normalizeCompanyProfile(tenantId, fallback.data);
        }
      }
    } catch {
      // company_profiles table may not exist yet in baseline schema
    }

    try {
      const { data: wsData, error: wsError } = await database
        .from('work_settings')
        .select('*')
        .eq('id', 1)
        .maybeSingle();

      if (!wsError && wsData) {
        const embedded = wsData.company_profile
          ? (typeof wsData.company_profile === 'string' ? JSON.parse(wsData.company_profile) : wsData.company_profile)
          : (wsData.legal_name || wsData.company_name ? wsData : null);
        if (embedded && (!embedded.tenant_id || embedded.tenant_id === tenantId)) {
          return normalizeCompanyProfile(tenantId, embedded);
        }
      }
    } catch {
      // Ignore if work_settings has no company columns
    }
  }

  return defaultNeutralProfile(tenantId);
}

export async function saveTenantCompanyProfile(contextOrTenantId, patch = {}, database = supabase) {
  const tenantId = resolveTenantId(contextOrTenantId);
  const current = await getTenantCompanyProfile(tenantId, database);
  const nextVersion = (Number(current.version) || 1) + 1;
  const merged = normalizeCompanyProfile(tenantId, {
    ...current,
    ...patch,
    tenantId,
    version: nextVersion,
  });

  if (database && typeof database.from === 'function') {
    try {
      const row = {
        tenant_id: tenantId,
        legal_entity_id: merged.legalEntityId,
        display_name: merged.displayName,
        short_name: merged.shortName,
        legal_name: merged.legalName,
        name_en: merged.nameEn,
        tax_id: merged.taxId,
        tax_branch_code: merged.taxBranchCode,
        address: merged.address,
        phone: merged.phone,
        email: merged.email,
        website: merged.website,
        logo_light_url: merged.logoLightUrl,
        logo_dark_url: merged.logoDarkUrl,
        logo_document_url: merged.logoDocumentUrl,
        primary_color: merged.primaryColor,
        support_email: merged.supportEmail,
        support_phone: merged.supportPhone,
        product_label: merged.productLabel,
        bank_name: merged.bankName,
        bank_account_no: merged.bankAccountNo,
        bank_account_name: merged.bankAccountName,
        signatory_name: merged.signatoryName,
        signatory_title: merged.signatoryTitle,
        version: merged.version,
        updated_at: new Date().toISOString(),
      };
      const { data, error } = await database
        .from('company_profiles')
        .upsert(row, { onConflict: 'tenant_id' })
        .select()
        .maybeSingle();

      if (!error) {
        const saved = normalizeCompanyProfile(tenantId, data || merged);
        runtimeProfiles.set(tenantId, saved);
        return saved;
      }

      // If table doesn't exist yet (e.g. isolated PGlite before MIG-06), persist in runtime store
      if (!/does not exist|relation/i.test(error.message || '')) {
        throw new Error(error.message || 'Failed to save company profile');
      }
    } catch (err) {
      if (!/does not exist|relation/i.test(err?.message || '')) {
        throw err;
      }
    }
  }

  runtimeProfiles.set(tenantId, merged);
  if (testProfiles.has(tenantId)) {
    testProfiles.set(tenantId, merged);
  }
  return merged;
}

/**
 * Public branding projection — NEVER exposes taxId, bankAccountNo, bankAccountName,
 * signatoryName, signatureAssetId, or stampAssetId.
 */
export function getPublicBrandProfile(profile) {
  const tenantId = profile?.tenantId || getDeploymentTenantId();
  const base = defaultNeutralProfile(tenantId);
  const src = profile || base;
  return {
    tenantId,
    displayName: src.displayName || src.name || base.displayName,
    shortName: src.shortName || src.name || base.shortName,
    logoLightUrl: src.logoLightUrl || base.logoLightUrl,
    logoDarkUrl: src.logoDarkUrl || src.logoLightUrl || base.logoDarkUrl,
    primaryColor: src.primaryColor || base.primaryColor,
    supportEmail: src.supportEmail || src.email || '',
    supportPhone: src.supportPhone || src.phone || '',
    productLabel: src.productLabel || base.productLabel,
  };
}

/**
 * Full legal issuer projection for authenticated HR operations and document snapshots.
 */
export function getDocumentIssuerProfile(profile) {
  const tenantId = profile?.tenantId || getDeploymentTenantId();
  const normalized = normalizeCompanyProfile(tenantId, profile || {});
  return {
    tenantId: normalized.tenantId,
    legalEntityId: normalized.legalEntityId,
    legalName: normalized.legalName,
    nameEn: normalized.nameEn,
    name: normalized.name,
    taxId: normalized.taxId,
    taxBranchCode: normalized.taxBranchCode,
    address: normalized.address,
    phone: normalized.phone,
    email: normalized.email,
    website: normalized.website,
    logoDocumentUrl: normalized.logoDocumentUrl,
    bankName: normalized.bankName,
    bankAccountNo: normalized.bankAccountNo,
    bankAccountName: normalized.bankAccountName,
    signatoryName: normalized.signatoryName,
    signatoryTitle: normalized.signatoryTitle,
    version: normalized.version,
    setupComplete: Boolean(normalized.legalName && normalized.taxId && normalized.address),
  };
}

export function validateBrandAssetUpload({ mimeType, sizeBytes, svgText } = {}) {
  const normalizedMime = String(mimeType || '').trim().toLowerCase();
  if (!ALLOWED_BRAND_MIMES.has(normalizedMime)) {
    return {
      valid: false,
      error: 'รองรับเฉพาะไฟล์ PNG, JPEG, WebP หรือ SVG เท่านั้น',
    };
  }

  const size = Number(sizeBytes);
  if (!Number.isFinite(size) || size <= 0) {
    return { valid: false, error: 'ขนาดไฟล์ไม่ถูกต้อง' };
  }
  if (size > MAX_LOGO_BYTES) {
    return { valid: false, error: 'ขนาดไฟล์โลโก้ต้องไม่เกิน 2 MB' };
  }

  if (normalizedMime === 'image/svg+xml') {
    const rawSvg = String(svgText || '');
    if (!/<svg[\s>]/i.test(rawSvg)) {
      return { valid: false, error: 'ไฟล์ SVG ไม่ถูกต้อง' };
    }
    const unsafePatterns = [
      /<script\b/i,
      /\bonload\s*=/i,
      /\bonerror\s*=/i,
      /\bon[a-z]+\s*=/i,
      /javascript\s*:/i,
      /<foreignobject\b/i,
    ];
    if (unsafePatterns.some((re) => re.test(rawSvg))) {
      return {
        valid: false,
        error: 'SVG มีสคริปต์หรือแท็กที่ไม่ปลอดภัย (<script>, event handler, javascript:, foreignObject)',
      };
    }
    return { valid: true, mimeType: normalizedMime, sanitizedSvg: rawSvg.trim() };
  }

  return { valid: true, mimeType: normalizedMime };
}

function getSyncCompanyProfile() {
  const tenantId = getDeploymentTenantId();
  if (testProfiles.has(tenantId)) return testProfiles.get(tenantId);
  if (runtimeProfiles.has(tenantId)) return runtimeProfiles.get(tenantId);
  const envProfile = readEnvProfile(tenantId);
  if (envProfile) return normalizeCompanyProfile(tenantId, envProfile);
  return defaultNeutralProfile(tenantId);
}

// Backward-compatible dynamic proxy for legacy callers importing { COMPANY }
export const COMPANY = new Proxy({}, {
  get(_target, prop) {
    return getSyncCompanyProfile()[prop];
  },
  ownKeys() {
    return Reflect.ownKeys(getSyncCompanyProfile());
  },
  getOwnPropertyDescriptor(_target, prop) {
    const profile = getSyncCompanyProfile();
    if (prop in profile) {
      return { enumerable: true, configurable: true, value: profile[prop] };
    }
    return undefined;
  },
});
