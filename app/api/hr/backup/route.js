import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { supabase, DOCUMENTS_BUCKET } from '@/lib/supabase';
import { createLogicalBackup } from '@/lib/backup';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request) {
  const { error, status } = await requireRole(request, ['admin']);
  if (error) return NextResponse.json({ error }, { status });
  try {
    const payload = await createLogicalBackup(supabase, supabase.storage.from(DOCUMENTS_BUCKET));
    return new NextResponse(JSON.stringify(payload), { headers: {
      'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store',
      'Content-Disposition': `attachment; filename="hr-logical-export-${new Date().toISOString().slice(0,10)}.json"`,
    } });
  } catch (e) { return NextResponse.json({ error: e.message }, { status: 503 }); }
}
