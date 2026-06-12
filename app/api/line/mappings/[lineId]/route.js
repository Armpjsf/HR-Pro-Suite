import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { deleteLineMapping, addAuditEntry } from '@/lib/db';

/**
 * DELETE /api/line/mappings/[lineId] — ยกเลิกการผูกบัญชี LINE (admin)
 */
export async function DELETE(request, { params }) {
  const { user, error, status } = requireRole(request, ['admin']);
  if (error) return NextResponse.json({ error }, { status });

  const { lineId } = await params;
  const deleted = await deleteLineMapping(decodeURIComponent(lineId));

  if (!deleted) {
    return NextResponse.json({ error: 'ไม่พบการผูกบัญชีนี้' }, { status: 404 });
  }

  await addAuditEntry({ user: user.name, action: 'ยกเลิกการผูกบัญชี LINE', channel: 'PWA' });
  return NextResponse.json({ success: true });
}
