// simulate.js — จำลอง Twilio Media Stream เพื่อทดสอบ bridge โดยไม่ต้องมี Twilio
//
// ใช้ทดสอบว่าท่อ เสียง→Gemini→เสียง และการถอดข้อความ ทำงานจริง ก่อนจ่ายเงินค่า Twilio
//
//   node simulate.js <sessionId> <answers.wav> [out.wav]
//
//   sessionId   = id ของ interview_sessions ที่สร้างจากหน้าเว็บ (สถานะ queued)
//   answers.wav = ไฟล์เสียงตอบของ "ผู้สมัคร" (WAV PCM16 mono) — พูดตอบคำถามไว้ล่วงหน้า
//   out.wav     = เสียงที่ AI พูดกลับ (ค่าเริ่มต้น: ai-reply.wav) เอาไว้ฟังผล
//
// จากนั้นเปิดหน้า /hr/interviews/<sessionId> ดู transcript ที่ถูกบันทึก

import fs from 'fs';
import WebSocket from 'ws';
import {
  wavToPcm16, resamplePcm, pcmToMuLawBuffer, muLawBufferToPcm,
  int16ToBuffer, pcm16ToWav,
} from './audio.js';
import 'dotenv/config';

const [, , sessionId, inWav, outWav = 'ai-reply.wav'] = process.argv;
if (!sessionId || !inWav) {
  console.error('ใช้: node simulate.js <sessionId> <answers.wav> [out.wav]');
  process.exit(1);
}

const PORT = process.env.BRIDGE_PORT || 8787;
const ws = new WebSocket(`ws://localhost:${PORT}/media`);

// เตรียมเสียง input → μ-law 8k เป็นเฟรม 20ms (160 ไบต์)
const { pcm, sampleRate } = wavToPcm16(fs.readFileSync(inWav));
const pcm8k = resamplePcm(pcm, sampleRate, 8000);
const mulaw = pcmToMuLawBuffer(pcm8k);
const FRAME = 160;

const replyPcm8k = []; // สะสมเสียงตอบจาก AI (Int16 8k)

ws.on('open', () => {
  console.log('เชื่อมต่อ bridge แล้ว, ส่ง start...');
  ws.send(JSON.stringify({
    event: 'start',
    start: { streamSid: 'SIM', customParameters: { sessionId } },
  }));

  // รอ 4 วิให้ AI พูดคำถาม/คำขอยินยอมก่อน แล้วค่อยเริ่มป้อนคำตอบ
  setTimeout(streamInput, 4000);
});

function streamInput() {
  console.log(`ป้อนเสียงผู้สมัคร ${mulaw.length} ไบต์ (${(mulaw.length / 8000).toFixed(1)} วิ)...`);
  let i = 0;
  const timer = setInterval(() => {
    if (i >= mulaw.length) {
      clearInterval(timer);
      console.log('ป้อนเสียงครบ, รอ AI ตอบ 8 วิ แล้วปิดสาย...');
      setTimeout(() => ws.send(JSON.stringify({ event: 'stop' })), 8000);
      return;
    }
    const payload = mulaw.subarray(i, i + FRAME).toString('base64');
    ws.send(JSON.stringify({ event: 'media', streamSid: 'SIM', media: { payload } }));
    i += FRAME;
  }, 20);
}

ws.on('message', (raw) => {
  let msg;
  try { msg = JSON.parse(raw.toString()); } catch { return; }
  if (msg.event === 'media' && msg.media?.payload) {
    const pcm = muLawBufferToPcm(Buffer.from(msg.media.payload, 'base64'));
    replyPcm8k.push(...pcm);
  } else if (msg.event === 'clear') {
    // AI ถูกพูดแทรก → ตัดเสียงที่ค้าง
    replyPcm8k.length = 0;
  }
});

ws.on('close', () => {
  if (replyPcm8k.length) {
    const buf = int16ToBuffer(Int16Array.from(replyPcm8k));
    fs.writeFileSync(outWav, pcm16ToWav(buf, 8000));
    console.log(`✅ บันทึกเสียง AI ตอบ → ${outWav} (${(replyPcm8k.length / 8000).toFixed(1)} วิ)`);
  } else {
    console.log('⚠️ ไม่ได้รับเสียงตอบจาก AI — ตรวจ GEMINI_API_KEY / สิทธิ์ Live API / โมเดล');
  }
  console.log(`เปิด /hr/interviews/${sessionId} เพื่อดู transcript`);
  process.exit(0);
});

ws.on('error', (e) => { console.error('ws error:', e.message); process.exit(1); });
