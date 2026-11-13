import { NextResponse } from 'next/server';
import { requireAuth, requireRole } from '@/lib/auth';
import { filterDocumentsByRole } from '@/lib/permissions';
import { getDocuments, addDocument, writeStoredFile, addAuditEntry } from '@/lib/db';
import { detectFileType, extractText } from '@/lib/extract';
import { indexDocument } from '@/lib/rag';
import { supabase } from '@/lib/supabase';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

const VALID_CATEGORIES = ['policies', 'templates', 'contracts', 'announcements', 'employee-data', 'driver-manuals'];

// ค่า default ของสิทธิ์เข้าถึงตามหมวดหมู่
const DEFAULT_ACCESS_ROLES = {
  policies: ['admin', 'hr', 'employee'],
  templates: ['admin', 'hr', 'employee'],
  announcements: ['admin', 'hr', 'employee'],
  contracts: ['admin', 'hr'],
  'employee-data': ['admin', 'hr'],
  'driver-manuals': ['admin', 'hr', 'employee', 'partner_driver'],
};

/**
 * GET /api/documents — รายการเอกสาร (กรองตามสิทธิ์)
 */
export async function GET(request) {
  const { user, error, status } = requireAuth(request);
  if (error) return NextResponse.json({ error }, { status });

  const categoryFilter = request.nextUrl?.searchParams?.get('category');
  let docs = filterDocumentsByRole(await getDocuments(), user.role, user.employeeId);
  if (categoryFilter && categoryFilter !== 'all') {
    docs = docs.filter((d) => d.category === categoryFilter);
  }
  // ไม่ส่ง content เต็มกลับไป (ลดขนาด response)
  const list = docs.map(({ content, ...rest }) => ({
    ...rest,
    hasContent: !!content,
  }));

  return NextResponse.json({ documents: list });
}

/**
 * POST /api/documents — อัพโหลดเอกสารจริง หรือเพิ่มลิงก์คลิปวิดีโอ (admin/hr)
 */
export async function POST(request) {
  const { user, error, status } = requireRole(request, ['admin', 'hr']);
  if (error) return NextResponse.json({ error }, { status });

  try {
    const contentType = request.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      const body = await request.json();
      const name = String(body.name || '').trim();
      const videoUrl = String(body.videoUrl || '').trim();
      const category = body.category || 'driver-manuals';
      const targetGroup = body.targetGroup || 'all';
      const description = String(body.description || '').trim();

      if (!name) {
        return NextResponse.json({ error: 'กรุณาระบุชื่อคลิปคู่มือ' }, { status: 400 });
      }
      if (!/^https?:\/\//i.test(videoUrl)) {
        return NextResponse.json({ error: 'กรุณาระบุลิงก์วิดีโอที่ถูกต้อง (ขึ้นต้นด้วย https://)' }, { status: 400 });
      }
      if (!VALID_CATEGORIES.includes(category)) {
        return NextResponse.json({ error: 'หมวดหมู่ไม่ถูกต้อง' }, { status: 400 });
      }

      const accessRoles =
        targetGroup === 'company'
          ? ['admin', 'hr', 'employee']
          : targetGroup === 'partner'
            ? ['admin', 'hr', 'partner_driver']
            : ['admin', 'hr', 'employee', 'partner_driver'];

      const audienceLabel =
        targetGroup === 'company'
          ? 'พนักงานบริษัทดีดี (Employee)'
          : targetGroup === 'partner'
            ? 'พนักงานขับรถร่วม (Partner Driver)'
            : 'พนักงานบริษัทดีดี และ พนักงานขับรถร่วม (ทั้งหมด)';

      const ragContent = [
        `ชื่อวิดีโอคู่มือ: ${name}`,
        `กลุ่มเป้าหมาย: ${audienceLabel}`,
        `หมวดหมู่: คู่มือพนักงานขับรถ (วิดีโอ)`,
        description ? `รายละเอียดเนื้อหา:\n${description}` : '',
        `ลิงก์ดูวิดีโอ: ${videoUrl}`,
      ]
        .filter(Boolean)
        .join('\n');

      const sourceLabel = /drive\.google\.com/i.test(videoUrl)
        ? 'Google Drive'
        : /youtube\.com|youtu\.be/i.test(videoUrl)
          ? 'YouTube'
          : 'วิดีโอลิงก์';

      const docId = `doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const doc = {
        id: docId,
        name,
        fileName: videoUrl,
        storedFileName: null,
        category,
        type: 'video',
        size: sourceLabel,
        updatedAt: new Date().toISOString().split('T')[0],
        accessRoles,
        content: ragContent,
        uploadedBy: user.name,
      };

      await addDocument(doc);
      try {
        await indexDocument(docId, ragContent);
      } catch (err) {
        console.error('indexDocument failed (video link still ok):', err);
      }
      await addAuditEntry({ user: user.name, action: `เพิ่มคลิปคู่มือ "${doc.name}"`, channel: 'PWA' });

      const { content: _c, ...docMeta } = doc;
      return NextResponse.json({
        success: true,
        document: { ...docMeta, hasContent: true },
        extracted: ragContent.length,
      });
    }

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

    // หากเป็นเอกสารหมวดประกาศบริษัท (announcements) ให้สร้างประกาศใน announcements table อัตโนมัติ
    if (category === 'announcements') {
      try {
        const cleanSnippet = (content || '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 500);
        const bodyText = cleanSnippet
          ? `${cleanSnippet}${content.length > 500 ? '...' : ''}\n\n📎 ไฟล์แนบ: ${doc.fileName} [DOC:${doc.id}]`
          : `ประกาศบริษัทฉบับเต็มแนบอยู่ในไฟล์เอกสาร: ${doc.fileName} [DOC:${doc.id}]`;
        await supabase.from('announcements').insert({
          title: doc.name,
          body: bodyText,
          category: 'ประกาศบริษัท',
          publish_date: doc.updatedAt,
          author: user.name || 'HR',
          pinned: true,
        });
      } catch (annErr) {
        console.warn('Auto-create announcement from document failed:', annErr.message);
      }
    }

    // สร้าง RAG index (ตัดเป็นชิ้น + embedding) เพื่อให้ AI ตอบเฉพาะจุด
    // ถ้าล้มเหลว (เช่น embedding quota หมด) ไม่ให้กระทบการอัปโหลด — chat จะ fallback ใช้เนื้อหาเต็ม
    if (content) {
      try {
        await indexDocument(docId, content);
      } catch (err) {
        console.error('indexDocument failed (upload still ok):', err);
      }
    }

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
