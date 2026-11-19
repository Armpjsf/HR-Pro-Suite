import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getDocuments } from '@/lib/db';
import { getDeploymentTenantId } from '@/lib/tenantContext';
import { requireModule, EntitlementError } from '@/lib/entitlements';
import { issuePublicDocumentToken } from '@/lib/document-snapshot';

function extractIntegrationKey(request) {
  const headerKey = request.headers.get('x-tms-api-key')?.trim();
  if (headerKey) return headerKey;
  const auth = request.headers.get('authorization') || request.headers.get('Authorization') || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  return '';
}

function keysMatch(provided, expected) {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

function filterManualsByAudience(docs, audience, tenantId) {
  const normalizedAudience = String(audience || 'subcontractor').toLowerCase();

  return (docs || []).filter((d) => {
    if (d.category !== 'driver-manuals') return false;
    if (d.tenantId && d.tenantId !== tenantId) return false;

    const roles = Array.isArray(d.accessRoles) ? d.accessRoles.map((r) => String(r).toLowerCase()) : [];

    if (normalizedAudience === 'subcontractor') {
      // Subcontractors may NEVER receive internal company-only manuals
      return roles.includes('partner_driver') || roles.includes('subcontractor') || roles.includes('all') || roles.includes('public');
    }

    if (normalizedAudience === 'company') {
      if (roles.length === 0) return true;
      return (
        roles.includes('employee') ||
        roles.includes('company_driver') ||
        roles.includes('partner_driver') ||
        roles.includes('all') ||
        roles.includes('public')
      );
    }

    if (normalizedAudience === 'all') {
      return roles.includes('all') || roles.includes('public') || roles.includes('partner_driver') || roles.includes('employee') || roles.length === 0;
    }

    return false;
  });
}

export async function GET(request) {
  const expectedKey = process.env.HR_INTEGRATION_KEY?.trim();
  if (!expectedKey) {
    return NextResponse.json({ error: 'HR_INTEGRATION_KEY not configured' }, { status: 503 });
  }

  const providedKey = extractIntegrationKey(request);
  if (!keysMatch(providedKey, expectedKey)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const tenantId = getDeploymentTenantId();
  try {
    await requireModule(tenantId, 'hr', 'integration');
  } catch (err) {
    if (err instanceof EntitlementError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    throw err;
  }

  const url = new URL(request.url);
  const audience = url.searchParams.get('audience') || url.searchParams.get('driver_type') || 'subcontractor';

  try {
    const docs = await getDocuments();
    const filtered = filterManualsByAudience(docs, audience, tenantId);
    const manuals = filtered.map((d) => {
      const isPrivateFile = Boolean(d.storedFileName || d.privateFile || d.visibility === 'private');
      let downloadUrl = null;
      if (isPrivateFile) {
        const token = issuePublicDocumentToken({
          tenantId,
          documentType: 'driver-manual',
          documentId: d.id,
          ttlSeconds: 300,
        });
        downloadUrl = `/api/documents/${encodeURIComponent(d.id)}/download?token=${encodeURIComponent(token)}`;
      }
      return {
        id: d.id,
        name: d.name,
        audience: Array.isArray(d.accessRoles) ? d.accessRoles : [],
        videoUrl: isPrivateFile ? null : (d.fileName || null),
        downloadUrl,
        source: d.size,
        accessRoles: d.accessRoles || [],
        updatedAt: d.updatedAt,
      };
    });

    return NextResponse.json({
      tenantId,
      audience,
      manuals,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message || 'Failed to load driver manuals' }, { status: 500 });
  }
}
