import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { filterDocumentsByRole } from '@/lib/permissions';
import { getDocuments, readStoredFile, addAuditEntry } from '@/lib/db';

const MIME_TYPES = {
  pdf: 'application/pdf',
  excel: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  text: 'text/plain; charset=utf-8',
};

/**
 * GET /api/documents/[id]/download — ดาวน์โหลดไฟล์จริง (ตรวจสิทธิ์ก่อน)
 */
export async function GET(request, { params }) {
  const { user, error, status } = requireAuth(request);
  if (error) return NextResponse.json({ error }, { status });

  const { id } = await params;
  const doc = getDocuments().find((d) => d.id === id);

  if (!doc) {
    return NextResponse.json({ error: 'ไม่พบเอกสาร' }, { status: 404 });
  }

  // ตรวจสิทธิ์เข้าถึงเอกสารนี้ตาม role
  const accessible = filterDocumentsByRole([doc], user.role, user.employeeId);
  if (accessible.length === 0) {
    return NextResponse.json({ error: 'คุณไม่มีสิทธิ์เข้าถึงเอกสารนี้' }, { status: 403 });
  }

  if (!doc.storedFileName) {
    return NextResponse.json({ error: 'เอกสารนี้ไม่มีไฟล์แนบ' }, { status: 404 });
  }

  const buffer = readStoredFile(doc.storedFileName);
  if (!buffer) {
    return NextResponse.json({ error: 'ไฟล์หายไปจากระบบ' }, { status: 404 });
  }

  addAuditEntry({ user: user.name, action: `ดาวน์โหลด "${doc.name}"`, channel: 'PWA' });

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': MIME_TYPES[doc.type] || 'application/octet-stream',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(doc.fileName)}`,
      'Content-Length': String(buffer.length),
    },
  });
}
