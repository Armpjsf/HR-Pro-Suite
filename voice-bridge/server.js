// server.js — Voice Bridge: Twilio Media Streams ⇄ Gemini Live
//
// รันแบบ long-running (PM2/Docker) — Vercel serverless รัน WebSocket ค้างไม่ได้
//   node voice-bridge/server.js   (หรือ pm2 start ecosystem)
//
// endpoints:
//   GET  /health                → ตรวจสถานะ
//   POST /twiml/:sessionId       → TwiML ที่สั่ง Twilio เปิด Media Stream มาที่ /media (ใช้ในเฟส 3)
//   WS   /media                  → Twilio ต่อ WebSocket ส่งเสียงเข้ามา (sessionId มาใน customParameters)

import http from 'http';
import { WebSocketServer } from 'ws';
import 'dotenv/config';

import { twilioToGemini, geminiToTwilio } from './audio.js';
import { openGeminiLive, buildSystemInstruction } from './gemini-live.js';
import { getSession, getApplicant, getQuestionSet, updateSession, insertTurn, markApplicantInterviewed } from './db.js';

const PORT = process.env.BRIDGE_PORT || 8787;
const PUBLIC_WSS_URL = process.env.PUBLIC_WSS_URL || `wss://localhost:${PORT}/media`;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const APP_INTERNAL_URL = process.env.APP_INTERNAL_URL;   // เช่น https://hr.yourdomain.com
const BRIDGE_SECRET = process.env.BRIDGE_SECRET;

// เฟส 4: แจ้ง HR app ให้สรุป+ให้คะแนนหลังวางสาย
async function triggerScoring(sessionId) {
  if (!APP_INTERNAL_URL || !BRIDGE_SECRET) return;
  try {
    await fetch(`${APP_INTERNAL_URL.replace(/\/$/, '')}/api/internal/interview-complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-bridge-secret': BRIDGE_SECRET },
      body: JSON.stringify({ sessionId }),
    });
  } catch (e) {
    console.error('triggerScoring error:', e?.message || e);
  }
}

// ---------- HTTP ----------
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, geminiKey: !!GEMINI_API_KEY }));
  }

  // TwiML สำหรับให้ Twilio เปิด media stream — ใช้ในเฟส 3
  const m = url.pathname.match(/^\/twiml\/(\d+)$/);
  if (req.method === 'POST' && m) {
    const sessionId = m[1];
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${PUBLIC_WSS_URL}">
      <Parameter name="sessionId" value="${sessionId}" />
    </Stream>
  </Connect>
</Response>`;
    res.writeHead(200, { 'Content-Type': 'text/xml' });
    return res.end(twiml);
  }

  res.writeHead(404);
  res.end('not found');
});

// ---------- WebSocket (Twilio Media Streams) ----------
const wss = new WebSocketServer({ server, path: '/media' });

wss.on('connection', (ws) => {
  const call = {
    streamSid: null,
    sessionId: null,
    gemini: null,
    turnIndex: 0,
    aiBuf: '',
    userBuf: '',
    startedAt: Date.now(),
    ready: false,
    queue: [], // เสียงที่มาก่อน Gemini พร้อม
  };

  const log = (...a) => console.log(`[${call.sessionId || '?'}]`, ...a);

  function sendToTwilio(base64Pcm24k) {
    if (!call.streamSid) return;
    const payload = geminiToTwilio(base64Pcm24k);
    ws.send(JSON.stringify({ event: 'media', streamSid: call.streamSid, media: { payload } }));
  }
  function clearTwilio() {
    if (call.streamSid) ws.send(JSON.stringify({ event: 'clear', streamSid: call.streamSid }));
  }

  async function flushUser() {
    if (call.userBuf.trim()) {
      await insertTurn(call.sessionId, call.turnIndex++, 'applicant', call.userBuf);
      call.userBuf = '';
    }
  }
  async function flushAi() {
    if (call.aiBuf.trim()) {
      await insertTurn(call.sessionId, call.turnIndex++, 'ai', call.aiBuf);
      call.aiBuf = '';
    }
  }

  async function startGemini() {
    const session = await getSession(call.sessionId);
    if (!session) { log('ไม่พบ session'); ws.close(); return; }

    const [qset, applicant] = await Promise.all([
      getQuestionSet(session.question_set_id),
      getApplicant(session.applicant_id),
    ]);
    const lang = qset?.lang || 'th';
    const consent = qset?.consent_script;
    const intro = qset?.intro_script;

    let systemInstruction = buildSystemInstruction({
      questions: qset?.questions || [],
      position: applicant?.position_applied || qset?.position,
      intro,
      lang,
    });
    if (consent) {
      systemInstruction =
        `ก่อนเริ่มสัมภาษณ์ ให้พูดข้อความขอความยินยอมนี้ก่อนเป็นอย่างแรก: "${consent}"\n` +
        `ถ้าผู้สมัครไม่ยินยอมหรือปฏิเสธ ให้กล่าวขอบคุณสั้น ๆ แล้วจบสาย ห้ามถามคำถามใด ๆ ต่อ\n\n` +
        systemInstruction;
    }

    await updateSession(call.sessionId, { status: 'in_progress', started_at: new Date().toISOString() });

    call.gemini = await openGeminiLive({
      apiKey: GEMINI_API_KEY,
      systemInstruction,
      lang,
      onAudio: (b64) => sendToTwilio(b64),
      onInputText: (t) => { call.userBuf += t; },
      onOutputText: async (t) => {
        // เริ่มมีเสียง AI = จบคำตอบผู้สมัครรอบก่อน → บันทึกก่อน
        if (call.userBuf.trim() && !call.aiBuf.trim()) await flushUser();
        call.aiBuf += t;
      },
      onInterrupted: () => clearTwilio(),
      onTurnComplete: async () => { await flushAi(); },
      onError: (e) => log('gemini error:', e?.message || e),
      onClose: () => log('gemini closed'),
    });

    call.ready = true;
    // ระบายเสียงที่คิวไว้ตอน Gemini ยังไม่พร้อม
    for (const b64 of call.queue) call.gemini.sendAudio(b64);
    call.queue = [];

    // กระตุ้นให้ AI เริ่มพูด (คำขอยินยอม/คำถามแรก) โดยไม่ต้องรอผู้สมัครพูดก่อน
    try {
      call.gemini.raw.sendClientContent({ turns: 'เริ่มการโทรได้เลย', turnComplete: true });
    } catch { /* บาง SDK เวอร์ชันใช้ชื่อเมธอดต่าง */ }
    log('gemini ready');
  }

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    switch (msg.event) {
      case 'start': {
        call.streamSid = msg.start?.streamSid;
        call.sessionId = msg.start?.customParameters?.sessionId || null;
        log('stream start', call.streamSid);
        if (!call.sessionId) { ws.close(); return; }
        try { await startGemini(); } catch (e) { log('startGemini fail:', e?.message || e); ws.close(); }
        break;
      }
      case 'media': {
        const b64 = twilioToGemini(msg.media.payload);
        if (call.ready && call.gemini) call.gemini.sendAudio(b64);
        else call.queue.push(b64);
        break;
      }
      case 'stop':
        log('stream stop');
        ws.close();
        break;
      default:
        break;
    }
  });

  ws.on('close', async () => {
    try {
      await flushUser();
      await flushAi();
      call.gemini?.close();
      if (call.sessionId) {
        const dur = Math.round((Date.now() - call.startedAt) / 1000);
        await updateSession(call.sessionId, {
          status: 'completed',
          ended_at: new Date().toISOString(),
          duration_sec: dur,
        });
        const s = await getSession(call.sessionId);
        if (s?.applicant_id) await markApplicantInterviewed(s.applicant_id, s.score);
        await triggerScoring(call.sessionId);
      }
    } catch (e) {
      log('close cleanup error:', e?.message || e);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Voice Bridge listening on :${PORT}`);
  console.log(`  health : http://localhost:${PORT}/health`);
  console.log(`  media  : ws://localhost:${PORT}/media  (public: ${PUBLIC_WSS_URL})`);
  if (!GEMINI_API_KEY) console.warn('  ⚠️  ยังไม่ตั้ง GEMINI_API_KEY');
});
