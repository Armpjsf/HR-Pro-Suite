import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { getDocuments, readStoredFile, updateDocumentContent } from '@/lib/db';
import { detectFileType, extractText } from '@/lib/extract';
import { indexDocument } from '@/lib/rag';

/**
 * POST /api/documents/reindex — สร้าง RAG index ใหม่ให้เอกสารทั้งหมด (admin)
 * ใช้ตอนตั้งค่าครั้งแรก หรือหลังแก้วิธีตัดชิ้น
 */
export async function POST(request) {
  const { error, status } = requireRole(request, ['admin']);
  if (error) return NextResponse.json({ error }, { status });

  const docs = await getDocuments();
  const results = [];
  let totalChunks = 0;

  for (const d of docs) {
    let content = d.content || '';

    if (d.storedFileName) {
      const fileBuffer = await readStoredFile(d.storedFileName);
      if (fileBuffer) {
        const fileType = d.type || detectFileType(d.fileName || d.storedFileName);
        const extracted = await extractText(fileBuffer, fileType);
        if (extracted && extracted !== content) {
          content = extracted;
          await updateDocumentContent(d.id, content);
        }
      }
    }

    if (!content) {
      results.push({ name: d.name, chunks: 0, skipped: true, reason: 'no readable content' });
      continue;
    }

    try {
      const n = await indexDocument(d.id, content);
      totalChunks += n;
      results.push({ name: d.name, chunks: n });
    } catch (err) {
      results.push({ name: d.name, error: err.message });
    }
  }

  return NextResponse.json({ success: true, totalChunks, results });
}
