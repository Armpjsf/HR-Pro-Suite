// gemini-live.js — เชื่อม Gemini Live API (เสียงเข้า-ออก + ถอดข้อความ)
//
// ใช้ SDK ใหม่ @google/genai (รองรับ Live API แบบ bidirectional)
// เอกสาร: https://ai.google.dev/gemini-api/docs/live
//
// input : PCM16 16kHz (base64)  → session.sendRealtimeInput({ audio })
// output: PCM16 24kHz (base64)  ← message.data
// ถอดข้อความ: เปิด inputAudioTranscription / outputAudioTranscription

import { GoogleGenAI, Modality } from '@google/genai';

const MODEL = process.env.GEMINI_LIVE_MODEL || 'gemini-2.0-flash-live-001';
// เสียงพูดของ AI — Gemini prebuilt voices เช่น Puck, Charon, Kore, Aoede, Fenrir
const VOICE = process.env.GEMINI_LIVE_VOICE || 'Aoede';

/**
 * สร้าง prompt สำหรับผู้สัมภาษณ์ AI จากชุดคำถาม
 */
export function buildSystemInstruction({ questions, position, intro, lang }) {
  const qList = (questions || []).map((q, i) => `${i + 1}. ${q.q}`).join('\n');
  const langLabel = lang === 'en' ? 'English' : 'ภาษาไทย';
  return `คุณคือผู้ช่วย HR ที่โทรสัมภาษณ์งานเบื้องต้นทางโทรศัพท์ พูดด้วย${langLabel} น้ำเสียงสุภาพ เป็นมิตร กระชับ

ตำแหน่งที่สัมภาษณ์: ${position || 'ไม่ระบุ'}

หน้าที่ของคุณ:
- ถามคำถามต่อไปนี้ทีละข้อ ตามลำดับ รอผู้สมัครตอบให้จบก่อนถามข้อถัดไป
- หากคำตอบไม่ชัดเจน ถามย้ำสั้น ๆ ได้ 1 ครั้ง แล้วไปต่อ
- อย่าให้คำมั่นเรื่องการรับเข้าทำงาน อย่าต่อรองเงินเดือน แค่เก็บข้อมูล
- เมื่อถามครบทุกข้อแล้ว กล่าวขอบคุณและบอกว่าทีม HR จะติดต่อกลับ แล้วจบการสนทนา
- พูดสั้น กระชับ เหมือนคุยโทรศัพท์จริง ไม่อ่านยาว

${intro ? `ประโยคเปิด: "${intro}"` : ''}

คำถามที่ต้องถาม:
${qList || '(ใช้คำถามคัดกรองมาตรฐาน: เริ่มงานได้เมื่อไหร่, เงินเดือนที่คาดหวัง, ประสบการณ์ที่เกี่ยวข้อง, เหตุผลที่สนใจงานนี้)'}`;
}

/**
 * เปิด session Gemini Live
 * @param {object} opts
 *   apiKey, systemInstruction, lang
 *   onAudio(base64Pcm24k)      — เสียงตอบจาก AI
 *   onInputText(text)          — ข้อความที่ถอดจากเสียงผู้สมัคร (สะสมทีละชิ้น)
 *   onOutputText(text)         — ข้อความที่ AI พูด (สะสมทีละชิ้น)
 *   onTurnComplete()           — จบ 1 turn ของ AI
 *   onInterrupted()            — ผู้สมัครพูดแทรก (ต้องล้าง buffer เสียงที่ค้าง)
 *   onClose(), onError(err)
 * @returns { sendAudio(base64Pcm16k), close() }
 */
export async function openGeminiLive(opts) {
  const {
    apiKey, systemInstruction, lang,
    onAudio, onInputText, onOutputText, onTurnComplete, onInterrupted, onClose, onError,
  } = opts;

  const ai = new GoogleGenAI({ apiKey });

  const session = await ai.live.connect({
    model: MODEL,
    config: {
      responseModalities: [Modality.AUDIO],
      systemInstruction,
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } },
        languageCode: lang === 'en' ? 'en-US' : 'th-TH',
      },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
    },
    callbacks: {
      onopen: () => {},
      onmessage: (message) => {
        try {
          const sc = message.serverContent;
          // เสียงตอบ (base64 PCM16 24k) อาจมากับ message.data หรือใน modelTurn parts
          if (message.data && onAudio) onAudio(message.data);
          if (sc?.modelTurn?.parts) {
            for (const p of sc.modelTurn.parts) {
              if (p.inlineData?.data && onAudio) onAudio(p.inlineData.data);
            }
          }
          if (sc?.inputTranscription?.text && onInputText) onInputText(sc.inputTranscription.text);
          if (sc?.outputTranscription?.text && onOutputText) onOutputText(sc.outputTranscription.text);
          if (sc?.interrupted && onInterrupted) onInterrupted();
          if (sc?.turnComplete && onTurnComplete) onTurnComplete();
        } catch (e) {
          onError?.(e);
        }
      },
      onerror: (e) => onError?.(e),
      onclose: () => onClose?.(),
    },
  });

  return {
    sendAudio(base64Pcm16k) {
      session.sendRealtimeInput({
        audio: { data: base64Pcm16k, mimeType: 'audio/pcm;rate=16000' },
      });
    },
    // แจ้ง Gemini ว่าสายจบ ให้ปิด session
    close() {
      try { session.close(); } catch { /* noop */ }
    },
    raw: session,
  };
}
