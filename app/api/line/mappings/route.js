import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { getLineMappings } from '@/lib/db';

/**
 * GET /api/line/mappings — รายการผูกบัญชี LINE (admin/hr)
 */
export async function GET(request) {
  const { error, status } = requireRole(request, ['admin', 'hr']);
  if (error) return NextResponse.json({ error }, { status });

  return NextResponse.json({ mappings: getLineMappings() });
}
