/**
 * LLM provider layer — สลับระหว่าง Gemini (Cloud ความเร็วสูง) กับ Ollama (LLM ในเครื่อง)
 * พร้อมระบบ Health Check, Channel-aware Routing, และ Circuit Breaker
 *
 * กลยุทธ์การจัดสรรทรัพยากร (Smart Hybrid Routing):
 * 1. LINE Bot: ใช้ Gemini เสมอ เพราะต้องการความเร็ว < 2 วินาที (LINE timeout สั้นมาก)
 * 2. Web Chat: ใช้ Gemini หรือ Ollama ตามความพร้อม และ Failover ไปยังตัวสำรองอัตโนมัติ
 * 3. Healthcheck: ตรวจสอบความพร้อมของ Ollama ล่วงหน้า (timeout 800ms) ป้องกันบอทค้าง
 */
import { GoogleGenerativeAI } from '@google/generative-ai';

const OLLAMA_URL = (process.env.OLLAMA_URL || '').replace(/\/$/, '');
const OLLAMA_CHAT_MODEL = process.env.OLLAMA_CHAT_MODEL || 'llama3.1:8b';
const OLLAMA_EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text';

const GEMINI_CHAT_MODEL = 'gemini-2.5-flash';
const GEMINI_EMBED_MODEL = 'gemini-embedding-001';
const EMBED_DIMS = 768;

function getGenAI() {
  const key = process.env.GEMINI_API_KEY;
  if (!key || key.startsWith('กรอก_') || key.length < 20) return null;
  return new GoogleGenerativeAI(key);
}

// แคชสถานะความพร้อมของ Ollama เพื่อไม่ต้อง ping ทุก request (แคช 30 วินาที)
let lastOllamaCheck = 0;
let lastOllamaStatus = false;

export async function isOllamaAlive() {
  if (!OLLAMA_URL) return false;
  const now = Date.now();
  if (now - lastOllamaCheck < 30000) {
    return lastOllamaStatus;
  }
  lastOllamaCheck = now;
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, {
      method: 'GET',
      signal: AbortSignal.timeout(800), // เร็วมาก ไม่เกิน 800ms
    });
    lastOllamaStatus = res.ok;
    return res.ok;
  } catch {
    lastOllamaStatus = false;
    return false;
  }
}

/**
 * ตัดสินใจเลือก Provider ที่เหมาะสมที่สุด
 */
export async function resolveProvider(options = {}) {
  const channel = options.channel || 'PWA';
  const configured = (process.env.LLM_PROVIDER || 'auto').toLowerCase();
  const genAI = getGenAI();

  // 1. ถ้ามาจาก LINE: บังคับใช้ Gemini ถ้ามี เพราะต้องการความเร็วสูงมาก
  if (channel === 'LINE') {
    if (genAI) return 'gemini';
    const ollamaOk = await isOllamaAlive();
    if (ollamaOk) return 'ollama';
    return null;
  }

  // 2. ถ้าผู้ใช้ระบุ provider ชัดเจนใน env
  if (configured === 'gemini') {
    return genAI ? 'gemini' : null;
  }
  if (configured === 'ollama') {
    const ollamaOk = await isOllamaAlive();
    if (ollamaOk) return 'ollama';
    // Failover: ถ้าตั้งใจใช้ ollama แต่เครื่องไม่ได้เปิด ให้ fallback ไป gemini แทนที่จะให้ระบบพัง
    if (genAI) return 'gemini';
    return null;
  }

  // 3. โหมด auto: ใช้ Gemini ก่อน ถ้า Gemini ติดปัญหาจึงสลับไปหา Ollama
  if (genAI) return 'gemini';
  const ollamaOk = await isOllamaAlive();
  if (ollamaOk) return 'ollama';

  return null;
}

export function llmProvider() {
  const genAI = getGenAI();
  const configured = (process.env.LLM_PROVIDER || 'auto').toLowerCase();
  if (configured === 'gemini' && genAI) return 'gemini';
  if (configured === 'ollama' && OLLAMA_URL) return 'ollama';
  if (genAI) return 'gemini';
  if (OLLAMA_URL) return 'ollama';
  return null;
}

export function llmAvailable() {
  return !!getGenAI() || !!OLLAMA_URL;
}

async function ollamaFetch(path, body, timeoutMs = 30000) {
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
 * สร้างคำตอบจาก prompt พร้อม failover อัตโนมัติ
 */
export async function chatComplete(prompt, options = {}) {
  const targetProvider = await resolveProvider(options);
  const genAI = getGenAI();

  // ฟังก์ชันย่อยสำหรับเรียก Gemini
  async function callGemini() {
    if (!genAI) throw new Error('GEMINI_API_KEY ไม่ถูกต้องหรือไม่พร้อมใช้งาน');
    const model = genAI.getGenerativeModel({ model: GEMINI_CHAT_MODEL });
    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text();
  }

  // ฟังก์ชันย่อยสำหรับเรียก Ollama
  async function callOllama() {
    const ollamaOk = await isOllamaAlive();
    if (!ollamaOk) throw new Error('Ollama service ไม่ได้เปิดอยู่บนเครื่อง');
    const data = await ollamaFetch('/api/generate', {
      model: OLLAMA_CHAT_MODEL,
      prompt,
      stream: false,
      options: { temperature: 0.3, num_ctx: 8192, num_predict: 700 },
    }, 25000);
    return String(data.response || '').trim();
  }

  // ลำดับการเรียกตาม Provider ที่ถูกเลือก
  if (targetProvider === 'gemini') {
    try {
      return await callGemini();
    } catch (err) {
      console.warn('[LLM] Gemini เกิดข้อผิดพลาด พยายาม Failover ไปหา Ollama...', err.message);
      try {
        return await callOllama();
      } catch (ollamaErr) {
        throw new Error(`AI ทั้ง Gemini และ Ollama ไม่สามารถให้บริการได้: ${err.message}`);
      }
    }
  }

  if (targetProvider === 'ollama') {
    try {
      return await callOllama();
    } catch (err) {
      console.warn('[LLM] Ollama เกิดข้อผิดพลาด พยายาม Failover ไปหา Gemini...', err.message);
      if (genAI) {
        return await callGemini();
      }
      throw err;
    }
  }

  throw new Error('ไม่ได้ตั้งค่า LLM provider หรือไม่สามารถเชื่อมต่อบริการ AI ได้');
}

/**
 * สร้าง embedding 768 มิติ
 */
export async function embedText(text) {
  const genAI = getGenAI();
  if (genAI) {
    try {
      const model = genAI.getGenerativeModel({ model: GEMINI_EMBED_MODEL });
      const result = await model.embedContent({
        content: { parts: [{ text }] },
        outputDimensionality: EMBED_DIMS,
      });
      return result.embedding.values;
    } catch (err) {
      console.warn('[LLM] Gemini embedding error, trying Ollama...', err.message);
    }
  }

  const ollamaOk = await isOllamaAlive();
  if (ollamaOk) {
    const data = await ollamaFetch('/api/embed', {
      model: OLLAMA_EMBED_MODEL,
      input: text,
    }, 15000);
    const embedding = data.embeddings?.[0];
    if (embedding) return embedding;
  }

  throw new Error('ไม่สามารถสร้าง Embedding ได้ (ทั้ง Gemini และ Ollama ไม่พร้อมใช้งาน)');
}
