import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { getDocuments } from '@/lib/db';
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
    if (!d.content) {
      results.push({ name: d.name, chunks: 0, skipped: true });
      continue;
    }
    try {
      const n = await indexDocument(d.id, d.content);
      totalChunks += n;
      results.push({ name: d.name, chunks: n });
    } catch (err) {
      results.push({ name: d.name, error: err.message });
    }
  }

  return NextResponse.json({ success: true, totalChunks, results });
}
