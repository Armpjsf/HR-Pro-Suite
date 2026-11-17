import { NextResponse } from 'next/server';
import { requireMenu } from '@/lib/hr-access';
import { deleteDocument, addAuditEntry } from '@/lib/db';

/**
 * DELETE /api/documents/[id] — ลบเอกสาร (admin/hr)
 */
export async function DELETE(request, { params }) {
  const { user, error, status } = await requireMenu(request, 'documents');
  if (error) return NextResponse.json({ error }, { status });

  const { id } = await params;
  const deleted = await deleteDocument(id);

  if (!deleted) {
    return NextResponse.json({ error: 'ไม่พบเอกสาร' }, { status: 404 });
  }

  await addAuditEntry({ user: user.name, action: `ลบเอกสาร "${deleted.name}"`, channel: 'PWA' });
  return NextResponse.json({ success: true });
}
