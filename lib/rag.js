/**
 * RAG — ตัดเนื้อหาเอกสารเป็นชิ้น (chunk), สร้าง embedding ด้วย Gemini,
 * เก็บใน Supabase (pgvector) และค้นเฉพาะชิ้นที่ตรงคำถามที่สุด
 */
import { GoogleGenerativeAI } from '@google/generative-ai';
import { supabase } from './supabase';

const genAI = process.env.GEMINI_API_KEY
  ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  : null;

const EMBED_MODEL = 'gemini-embedding-001'; // กำหนด output 768 มิติ, มี free quota แยกจาก chat
const EMBED_DIMS = 768;
const CHUNK_TARGET = 600;   // ความยาวเป้าหมายต่อชิ้น (ตัวอักษร)
const CHUNK_OVERLAP = 100;  // ทับซ้อนระหว่างชิ้น กันข้อความขาดตอน

/**
 * ตัดข้อความเป็นชิ้น — พยายามตัดตามขอบเขตธรรมชาติ (ย่อหน้า/บรรทัด/หัวข้อ)
 * แล้วรวมเป็นชิ้นขนาดราว CHUNK_TARGET พร้อม overlap
 */
export function chunkText(text) {
  const clean = (text || '').replace(/\r\n/g, '\n').trim();
  if (!clean) return [];

  // แยกตามย่อหน้า/บรรทัดว่าง ก่อน แล้วค่อยรวม
  const blocks = clean
    .split(/\n{2,}|\n(?=[•\-\d]+[.)\s])|\n(?=ข้อ\s)/)
    .map((b) => b.trim())
    .filter(Boolean);

  const chunks = [];
  let current = '';

  for (const block of blocks) {
    // ถ้า block เดียวยาวเกินไป ตัดย่อยตามประโยค
    if (block.length > CHUNK_TARGET * 1.5) {
      if (current) { chunks.push(current); current = ''; }
      const sentences = block.split(/(?<=[.!?。])\s+|\n/).filter(Boolean);
      let buf = '';
      for (const s of sentences) {
        if ((buf + ' ' + s).length > CHUNK_TARGET && buf) {
          chunks.push(buf.trim());
          buf = buf.slice(-CHUNK_OVERLAP) + ' ' + s;
        } else {
          buf += (buf ? ' ' : '') + s;
        }
      }
      if (buf.trim()) current = buf.trim();
      continue;
    }

    if ((current + '\n' + block).length > CHUNK_TARGET && current) {
      chunks.push(current.trim());
      // เริ่มชิ้นใหม่โดยมี overlap ท้ายชิ้นเดิม
      current = current.slice(-CHUNK_OVERLAP) + '\n' + block;
    } else {
      current += (current ? '\n' : '') + block;
    }
  }
  if (current.trim()) chunks.push(current.trim());

  return chunks;
}

/**
 * สร้าง embedding ของข้อความเดียว
 */
export async function embed(text) {
  if (!genAI) throw new Error('ไม่ได้ตั้งค่า GEMINI_API_KEY');
  const model = genAI.getGenerativeModel({ model: EMBED_MODEL });
  const result = await model.embedContent({
    content: { parts: [{ text }] },
    outputDimensionality: EMBED_DIMS,
  });
  return result.embedding.values;
}

/**
 * Index เอกสาร 1 ไฟล์ — ลบ chunk เดิม, ตัดใหม่, สร้าง embedding, บันทึก
 * คืนจำนวน chunk ที่ทำได้ (0 = ไม่มีเนื้อหา/ทำไม่ได้)
 */
export async function indexDocument(documentId, content) {
  const chunks = chunkText(content);

  // ลบ chunk เดิมของเอกสารนี้ก่อนเสมอ (idempotent)
  await supabase.from('document_chunks').delete().eq('document_id', documentId);

  if (chunks.length === 0) return 0;

  const rows = [];
  for (let i = 0; i < chunks.length; i++) {
    const embedding = await embed(chunks[i]);
    rows.push({
      document_id: documentId,
      chunk_index: i,
      content: chunks[i],
      embedding,
    });
  }

  const { error } = await supabase.from('document_chunks').insert(rows);
  if (error) throw new Error(`indexDocument: ${error.message}`);
  return rows.length;
}

/**
 * ค้นชิ้นที่ตรงคำถามที่สุด จากเฉพาะเอกสารที่อนุญาต
 * คืน [{ documentId, content, similarity }]
 */
export async function retrieveChunks(question, allowedDocIds, topK = 5) {
  if (!allowedDocIds || allowedDocIds.length === 0) return [];
  const queryEmbedding = await embed(question);

  const { data, error } = await supabase.rpc('match_document_chunks', {
    query_embedding: queryEmbedding,
    match_count: topK,
    allowed_doc_ids: allowedDocIds,
  });
  if (error) throw new Error(`retrieveChunks: ${error.message}`);

  return (data || []).map((r) => ({
    documentId: r.document_id,
    content: r.content,
    similarity: r.similarity,
  }));
}
