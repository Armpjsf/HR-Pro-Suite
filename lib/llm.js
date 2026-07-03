/**
 * LLM provider layer — สลับระหว่าง Ollama (LLM ในเครื่อง) กับ Gemini ผ่าน env
 *
 * ตัวแปร env:
 * - LLM_PROVIDER=ollama|gemini (ถ้าไม่ตั้ง: ใช้ ollama เมื่อมี OLLAMA_URL, ไม่งั้นใช้ gemini เมื่อมี GEMINI_API_KEY)
 * - OLLAMA_URL=http://localhost:11434
 * - OLLAMA_CHAT_MODEL=llama3.1:8b
 * - OLLAMA_EMBED_MODEL=nomic-embed-text  (768 มิติ — ตรงกับ pgvector vector(768) ที่ใช้อยู่)
 *
 * สำคัญ: embedding ของคนละ provider เทียบกันไม่ได้ — เปลี่ยน provider แล้วต้อง reindex เอกสารใหม่
 */
import { GoogleGenerativeAI } from '@google/generative-ai';

const OLLAMA_URL = (process.env.OLLAMA_URL || '').replace(/\/$/, '');
const OLLAMA_CHAT_MODEL = process.env.OLLAMA_CHAT_MODEL || 'llama3.1:8b';
const OLLAMA_EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text';

const GEMINI_CHAT_MODEL = 'gemini-2.5-flash';
const GEMINI_EMBED_MODEL = 'gemini-embedding-001';
const EMBED_DIMS = 768;

const genAI = process.env.GEMINI_API_KEY
  ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  : null;

export function llmProvider() {
  const configured = (process.env.LLM_PROVIDER || '').toLowerCase();
  if (configured === 'ollama' || configured === 'gemini') return configured;
  if (OLLAMA_URL) return 'ollama';
  if (genAI) return 'gemini';
  return null;
}

export function llmAvailable() {
  const p = llmProvider();
  return (p === 'ollama' && !!OLLAMA_URL) || (p === 'gemini' && !!genAI);
}

async function ollamaFetch(path, body, timeoutMs) {
  const res = await fetch(`${OLLAMA_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Ollama ${path} ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

/**
 * สร้างคำตอบจาก prompt เดียว (system + context รวมใน prompt แล้ว)
 */
export async function chatComplete(prompt) {
  const provider = llmProvider();

  if (provider === 'ollama') {
    const data = await ollamaFetch('/api/generate', {
      model: OLLAMA_CHAT_MODEL,
      prompt,
      stream: false,
      // temperature ต่ำ + จำกัดความยาวคำตอบ กันโมเดลเล็กลอกเอกสารมาแปะยาวๆ
      options: { temperature: 0.3, num_ctx: 8192, num_predict: 700 },
    }, 120000); // โมเดลในเครื่องอาจช้า โดยเฉพาะครั้งแรกที่โหลดเข้า RAM
    return String(data.response || '').trim();
  }

  if (provider === 'gemini' && genAI) {
    const model = genAI.getGenerativeModel({ model: GEMINI_CHAT_MODEL });
    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text();
  }

  throw new Error('ไม่ได้ตั้งค่า LLM provider (OLLAMA_URL หรือ GEMINI_API_KEY)');
}

/**
 * สร้าง embedding 768 มิติของข้อความเดียว
 */
export async function embedText(text) {
  const provider = llmProvider();

  if (provider === 'ollama') {
    const data = await ollamaFetch('/api/embed', {
      model: OLLAMA_EMBED_MODEL,
      input: text,
    }, 30000);
    const embedding = data.embeddings?.[0];
    if (!embedding) throw new Error('Ollama embed: ไม่ได้ embedding กลับมา');
    return embedding;
  }

  if (provider === 'gemini' && genAI) {
    const model = genAI.getGenerativeModel({ model: GEMINI_EMBED_MODEL });
    const result = await model.embedContent({
      content: { parts: [{ text }] },
      outputDimensionality: EMBED_DIMS,
    });
    return result.embedding.values;
  }

  throw new Error('ไม่ได้ตั้งค่า LLM provider (OLLAMA_URL หรือ GEMINI_API_KEY)');
}
