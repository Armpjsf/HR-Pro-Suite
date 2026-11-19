import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { filterDocumentsByRole } from '@/lib/permissions';
import { getDocuments, readStoredFile, addAuditEntry } from '@/lib/db';
import { getDeploymentTenantId } from '@/lib/tenantContext';
import { verifyPublicDocumentToken } from '@/lib/document-snapshot';

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
  const { id } = await params;
  const queryToken = new URL(request.url).searchParams.get('token');
  const tenantId = getDeploymentTenantId();

  let scopedManualAccess = false;
  let actorName = 'TMS Driver';

  if (queryToken) {
    const tokenRes = verifyPublicDocumentToken(queryToken, {
      expectedTenantId: tenantId,
      expectedDocumentType: 'driver-manual',
      expectedDocumentId: id,
    });
    if (tokenRes.valid) {
      scopedManualAccess = true;
    }
  }

  let user = null;
  if (!scopedManualAccess) {
    const auth = await requireAuth(request);
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
    user = auth.user;
    actorName = user.name;
  }

  const docs = await getDocuments();
  const doc = docs.find((d) => d.id === id);

  if (!doc) {
    return NextResponse.json({ error: 'ไม่พบเอกสาร' }, { status: 404 });
  }

  if (scopedManualAccess) {
    if (doc.category !== 'driver-manuals') {
      return NextResponse.json({ error: 'คุณไม่มีสิทธิ์เข้าถึงเอกสารนี้' }, { status: 403 });
    }
  } else {
    // ตรวจสิทธิ์เข้าถึงเอกสารนี้ตาม role
    const accessible = filterDocumentsByRole([doc], user.role, user.employeeId);
    if (accessible.length === 0) {
      return NextResponse.json({ error: 'คุณไม่มีสิทธิ์เข้าถึงเอกสารนี้' }, { status: 403 });
    }
  }

  if (doc.type === 'video' && doc.fileName && /^https?:\/\//i.test(doc.fileName)) {
    await addAuditEntry({ user: actorName, action: `เปิดดูวิดีโอ "${doc.name}"`, channel: 'PWA' });
    return NextResponse.redirect(doc.fileName);
  }

  if (!doc.storedFileName) {
    return NextResponse.json({ error: 'เอกสารนี้ไม่มีไฟล์แนบ' }, { status: 404 });
  }

  const buffer = await readStoredFile(doc.storedFileName);
  if (!buffer) {
    return NextResponse.json({ error: 'ไฟล์หายไปจากระบบ' }, { status: 404 });
  }

  await addAuditEntry({ user: actorName, action: `ดาวน์โหลด "${doc.name}"`, channel: 'PWA' });

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': MIME_TYPES[doc.type] || 'application/octet-stream',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(doc.fileName)}`,
      'Content-Length': String(buffer.length),
    },
  });
}
