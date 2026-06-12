import { NextResponse } from 'next/server';
import { requireAuth, requireRole } from '@/lib/auth';
import { filterDocumentsByRole } from '@/lib/permissions';
import { getDocuments, addDocument, writeStoredFile, addAuditEntry } from '@/lib/db';
import { detectFileType, extractText } from '@/lib/extract';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

const VALID_CATEGORIES = ['policies', 'templates', 'contracts', 'announcements', 'employee-data'];

// ค่า default ของสิทธิ์เข้าถึงตามหมวดหมู่
const DEFAULT_ACCESS_ROLES = {
  policies: ['admin', 'hr', 'employee'],
  templates: ['admin', 'hr', 'employee'],
  announcements: ['admin', 'hr', 'employee'],
  contracts: ['admin', 'hr'],
  'employee-data': ['admin', 'hr'],
};

/**
 * GET /api/documents — รายการเอกสาร (กรองตามสิทธิ์)
 */
export async function GET(request) {
  const { user, error, status } = requireAuth(request);
  if (error) return NextResponse.json({ error }, { status });

  const docs = filterDocumentsByRole(await getDocuments(), user.role, user.employeeId);
  // ไม่ส่ง content เต็มกลับไป (ลดขนาด response)
  const list = docs.map(({ content, ...rest }) => ({
    ...rest,
    hasContent: !!content,
  }));

  return NextResponse.json({ documents: list });
}

/**
 * POST /api/documents — อัพโหลดเอกสารจริง (admin/hr)
 */
export async function POST(request) {
  const { user, error, status } = requireRole(request, ['admin', 'hr']);
  if (error) return NextResponse.json({ error }, { status });

  try {
    const formData = await request.formData();
    const file = formData.get('file');
    const category = formData.get('category') || 'policies';
    const customName = formData.get('name');

    if (!file || typeof file === 'string') {
      return NextResponse.json({ error: 'กรุณาเลือกไฟล์' }, { status: 400 });
    }

    if (!VALID_CATEGORIES.includes(category)) {
      return NextResponse.json({ error: 'หมวดหมู่ไม่ถูกต้อง' }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: 'ไฟล์ใหญ่เกิน 10MB' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const fileType = detectFileType(file.name);

    if (fileType === 'other') {
      return NextResponse.json(
        { error: 'รองรับเฉพาะ PDF, Excel, Word, Text' },
        { status: 400 }
      );
    }

    // ดึงข้อความจากไฟล์ (ใช้เป็น knowledge ให้ AI)
    const content = await extractText(buffer, fileType);

    // เก็บไฟล์จริง
    const docId = `doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const ext = file.name.split('.').pop();
    const storedFileName = await writeStoredFile(`${docId}.${ext}`, buffer);

    const doc = {
      id: docId,
      name: (customName || file.name.replace(/\.[^/.]+$/, '')).toString(),
      fileName: file.name,
      storedFileName,
      category,
      type: fileType,
      templateType: category === 'templates' ? 'basic' : undefined,
      size: `${Math.max(1, Math.round(file.size / 1024))} KB`,
      updatedAt: new Date().toISOString().split('T')[0],
      accessRoles: DEFAULT_ACCESS_ROLES[category],
      content,
      uploadedBy: user.name,
    };

    await addDocument(doc);
    await addAuditEntry({ user: user.name, action: `อัพโหลดเอกสาร "${doc.name}"`, channel: 'PWA' });

    const { content: _c, ...docMeta } = doc;
    return NextResponse.json({
      success: true,
      document: { ...docMeta, hasContent: !!content },
      extracted: content.length,
    });
  } catch (err) {
    console.error('Upload error:', err);
    return NextResponse.json({ error: 'อัพโหลดไม่สำเร็จ' }, { status: 500 });
  }
}
