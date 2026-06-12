import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { deleteDocument, addAuditEntry } from '@/lib/db';

/**
 * DELETE /api/documents/[id] — ลบเอกสาร (admin/hr)
 */
export async function DELETE(request, { params }) {
  const { user, error, status } = requireRole(request, ['admin', 'hr']);
  if (error) return NextResponse.json({ error }, { status });

  const { id } = await params;
  const deleted = deleteDocument(id);

  if (!deleted) {
    return NextResponse.json({ error: 'ไม่พบเอกสาร' }, { status: 404 });
  }

  addAuditEntry({ user: user.name, action: `ลบเอกสาร "${deleted.name}"`, channel: 'PWA' });
  return NextResponse.json({ success: true });
}
