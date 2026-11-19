import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { requireTenantContext, TenantContextError } from '@/lib/tenantContext';
import {
  getTenantCompanyProfile,
  saveTenantCompanyProfile,
  getPublicBrandProfile,
  getDocumentIssuerProfile,
  validateBrandAssetUpload,
} from '@/lib/company';

export const dynamic = 'force-dynamic';

function validateTaxId(taxId) {
  if (taxId === undefined || taxId === null || taxId === '') return true;
  return /^\d{13}$/.test(String(taxId).trim());
}

export async function GET(request) {
  const auth = await requireRole(request, ['admin']);
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status || 401 });
  }

  let tenantCtx;
  try {
    tenantCtx = await requireTenantContext(request, { allowedRoles: ['admin'] });
  } catch (err) {
    if (err instanceof TenantContextError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }

  const profile = await getTenantCompanyProfile(tenantCtx);
  const issuer = getDocumentIssuerProfile(profile);
  return NextResponse.json({
    profile: issuer,
    publicBrand: getPublicBrandProfile(profile),
    setupComplete: issuer.setupComplete,
  });
}

export async function PATCH(request) {
  const auth = await requireRole(request, ['admin']);
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status || 401 });
  }

  let tenantCtx;
  try {
    tenantCtx = await requireTenantContext(request, { allowedRoles: ['admin'] });
  } catch (err) {
    if (err instanceof TenantContextError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  if (body.taxId !== undefined && !validateTaxId(body.taxId)) {
    return NextResponse.json(
      { error: 'เลขประจำตัวผู้เสียภาษีต้องเป็นตัวเลข 13 หลัก' },
      { status: 400 },
    );
  }

  if (body.logoUpload) {
    const check = validateBrandAssetUpload(body.logoUpload);
    if (!check.valid) {
      return NextResponse.json({ error: check.error }, { status: 400 });
    }
  }

  // Strip tenantId/legalEntityId override attempts from body — enforce trusted tenantCtx.tenantId
  const { tenantId: _ignoredTenant, ...safePatch } = body;
  const saved = await saveTenantCompanyProfile(tenantCtx, safePatch);
  const issuer = getDocumentIssuerProfile(saved);

  return NextResponse.json({
    success: true,
    profile: issuer,
    publicBrand: getPublicBrandProfile(saved),
    setupComplete: issuer.setupComplete,
  });
}
