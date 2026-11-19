import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const ISSUED_STATUSES = new Set([
  'issued',
  'approved',
  'Billed',
  'Paid',
  'DELIVERED',
  'COMPLETED',
]);

function sortKeysCanonical(value) {
  if (Array.isArray(value)) return value.map(sortKeysCanonical);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) {
        out[key] = sortKeysCanonical(value[key]);
      }
    }
    return out;
  }
  return value;
}

function getTokenSecret() {
  const secret = process.env.DOCUMENT_TOKEN_SECRET || process.env.JWT_SECRET;
  if (process.env.NODE_ENV === 'production' && !secret) {
    throw new Error('FATAL: DOCUMENT_TOKEN_SECRET or JWT_SECRET must be set in production.');
  }
  return secret || 'hr-document-token-dev-only';
}

export function createDocumentSnapshot({
  tenantId,
  legalEntityId,
  documentType,
  documentNo,
  issuerProfile,
  templateVersion = 1,
  payload = {},
  issuedAt = new Date().toISOString(),
}) {
  const legalName = String(issuerProfile?.legalName || issuerProfile?.company_name || '').trim();
  const taxId = String(issuerProfile?.taxId || issuerProfile?.tax_id || '').trim();
  const address = String(issuerProfile?.address || '').trim();

  if (!legalName || !taxId || !address) {
    const err = new Error('SETUP_REQUIRED: กรุณาตั้งค่าข้อมูลนิติบุคคล (ชื่อบริษัท, เลขผู้เสียภาษี, ที่อยู่) ก่อนออกเอกสารทางการ');
    err.code = 'SETUP_REQUIRED';
    err.status = 400;
    throw err;
  }

  const issuer = {
    legalName,
    nameEn: String(issuerProfile?.nameEn || issuerProfile?.company_name_en || '').trim(),
    taxId,
    taxBranchCode: String(issuerProfile?.taxBranchCode || issuerProfile?.tax_branch_code || '00000').trim(),
    address,
    phone: String(issuerProfile?.phone || '').trim(),
    email: String(issuerProfile?.email || '').trim(),
    bankName: String(issuerProfile?.bankName || issuerProfile?.bank_name || '').trim(),
    bankAccountNo: String(issuerProfile?.bankAccountNo || issuerProfile?.bank_account_no || '').trim(),
    bankAccountName: String(issuerProfile?.bankAccountName || issuerProfile?.bank_account_name || '').trim(),
    logoUrl: String(issuerProfile?.logoDocumentUrl || issuerProfile?.logoUrl || issuerProfile?.logo_url || '').trim(),
    signatoryName: String(issuerProfile?.signatoryName || issuerProfile?.signatory_name || '').trim(),
  };

  const base = {
    snapshotVersion: 1,
    tenantId: String(tenantId || issuerProfile?.tenantId || 'default-tenant'),
    legalEntityId: String(legalEntityId || issuerProfile?.legalEntityId || `le-${tenantId || 'default-tenant'}`),
    documentType: String(documentType || 'document'),
    documentNo: String(documentNo || ''),
    issuedAt,
    templateVersion: Number(templateVersion) || 1,
    issuer,
    payload: sortKeysCanonical(payload || {}),
  };

  const contentHash = createHash('sha256')
    .update(JSON.stringify(sortKeysCanonical(base)))
    .digest('hex');

  return {
    ...base,
    contentHash,
  };
}

export function resolveDocumentIssuer(documentRow, liveCompanyProfile) {
  const snapshot = documentRow?.issued_snapshot || documentRow?.Issued_Snapshot;
  if (documentRow && ISSUED_STATUSES.has(documentRow.status || documentRow.Status) && snapshot) {
    return snapshot.issuer || snapshot.company || liveCompanyProfile;
  }
  return liveCompanyProfile;
}

export function issuePublicDocumentToken({
  tenantId,
  documentType,
  documentId,
  ttlSeconds = 3600,
  now = Date.now(),
}) {
  if (!tenantId || !documentType || !documentId) {
    throw new Error('tenantId, documentType, and documentId are required');
  }
  const iat = Math.floor(now / 1000);
  const exp = iat + Math.max(1, Number(ttlSeconds) || 3600);
  const claims = {
    t: String(tenantId),
    dt: String(documentType),
    id: String(documentId),
    iat,
    exp,
    jti: randomBytes(8).toString('hex'),
  };
  const bodyB64 = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  const sigB64 = createHmac('sha256', getTokenSecret()).update(bodyB64).digest('base64url');
  return `${bodyB64}.${sigB64}`;
}

export function verifyPublicDocumentToken(token, {
  expectedTenantId,
  expectedDocumentType,
  expectedDocumentId,
  now = Date.now(),
} = {}) {
  if (!token || typeof token !== 'string' || !token.includes('.')) {
    return { valid: false, error: 'MALFORMED_TOKEN' };
  }
  const parts = token.split('.');
  if (parts.length !== 2) {
    return { valid: false, error: 'MALFORMED_TOKEN' };
  }
  const [bodyB64, sigB64] = parts;
  const expectedSig = createHmac('sha256', getTokenSecret()).update(bodyB64).digest('base64url');
  const actualBuf = Buffer.from(sigB64, 'utf8');
  const expectedBuf = Buffer.from(expectedSig, 'utf8');
  if (actualBuf.length !== expectedBuf.length || !timingSafeEqual(actualBuf, expectedBuf)) {
    return { valid: false, error: 'INVALID_SIGNATURE' };
  }

  let claims;
  try {
    claims = JSON.parse(Buffer.from(bodyB64, 'base64url').toString('utf8'));
  } catch {
    return { valid: false, error: 'INVALID_PAYLOAD' };
  }

  const nowSec = Math.floor(now / 1000);
  if (!claims.exp || nowSec > Number(claims.exp)) {
    return { valid: false, error: 'TOKEN_EXPIRED' };
  }
  if (expectedTenantId && claims.t !== String(expectedTenantId)) {
    return { valid: false, error: 'TENANT_MISMATCH' };
  }
  if (expectedDocumentType && claims.dt !== String(expectedDocumentType)) {
    return { valid: false, error: 'DOCUMENT_TYPE_MISMATCH' };
  }
  if (expectedDocumentId && claims.id !== String(expectedDocumentId)) {
    return { valid: false, error: 'DOCUMENT_ID_MISMATCH' };
  }

  return {
    valid: true,
    payload: {
      tenantId: claims.t,
      documentType: claims.dt,
      documentId: claims.id,
      iat: claims.iat,
      exp: claims.exp,
      jti: claims.jti,
    },
  };
}
