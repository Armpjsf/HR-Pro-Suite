import { NextResponse } from 'next/server';
import { getTenantCompanyProfile, getPublicBrandProfile } from '@/lib/company';
import { getDeploymentTenantId } from '@/lib/tenantContext';

export const dynamic = 'force-dynamic';

export async function GET() {
  const tenantId = getDeploymentTenantId();
  const profile = await getTenantCompanyProfile(tenantId);
  return NextResponse.json(getPublicBrandProfile(profile));
}
