# Voice Bridge — AI โทรสัมภาษณ์ (เฟส 2)

เซิร์ฟเวอร์เชื่อม **Twilio Media Streams ⇄ Gemini Live** สำหรับให้ AI โทรสัมภาษณ์ผู้สมัครด้วยเสียงแบบโต้ตอบสด

> ต้องรันแบบ long-running (PM2/Docker) — **ลง Vercel serverless ไม่ได้** เพราะเป็น WebSocket ค้างสาย

## ท่อข้อมูล

```
Twilio (μ-law 8k) ──ws──▶ server.js ──PCM16 16k──▶ Gemini Live
                          server.js ◀─PCM16 24k──  Gemini Live
Twilio (μ-law 8k) ◀──ws── server.js
                          └─ ถอดข้อความ 2 ทาง → interview_turns (Supabase)
```

## ไฟล์
| ไฟล์ | หน้าที่ |
|---|---|
| `server.js` | HTTP (/health, /twiml/:id) + WebSocket /media รับสายจาก Twilio |
| `gemini-live.js` | เปิด session Gemini Live + สร้าง prompt ผู้สัมภาษณ์จากชุดคำถาม |
| `audio.js` | แปลง μ-law↔PCM + resample 8k/16k/24k |
| `db.js` | เขียนสถานะสาย + transcript ลง Supabase |
| `simulate.js` | จำลอง Twilio เพื่อทดสอบโดยไม่ต้องมี Twilio |

## ติดตั้ง & รัน

```bash
cd voice-bridge
npm install
cp .env.example .env      # เติม GEMINI_API_KEY + Supabase (ค่าเดียวกับ HR app)
npm start                 # ฟังที่ :8787
```

ตรวจสอบ: เปิด http://localhost:8787/health ควรได้ `{"ok":true,"geminiKey":true}`

## ทดสอบเฟส 2 (ยังไม่ต้องมี Twilio)

1. ในหน้าเว็บ HR: สร้าง **ชุดคำถาม** (เมนู AI สัมภาษณ์) และกด 🎙️ ที่ผู้สมัคร 1 คน → ได้ `interview_sessions.id`
2. อัดไฟล์เสียงคำตอบผู้สมัคร (พูดตอบคำถามไว้ล่วงหน้า) เป็น **WAV PCM16 mono** เช่น `answers.wav`
3. รัน bridge (`npm start`) ค้างไว้ แล้วอีกเทอร์มินัล:
   ```bash
   node simulate.js <sessionId> answers.wav ai-reply.wav
   ```
4. ฟัง `ai-reply.wav` = เสียง AI พูดภาษาไทย และเปิด `/hr/interviews/<sessionId>` ดู transcript ที่ถูกบันทึก

ถ้าได้ยินเสียงไทย + มี transcript = ท่อ STT+LLM+TTS ทำงานครบ **ก่อนจ่ายเงินค่า Twilio**

## ตั้งค่า (.env)
| ตัวแปร | ค่าเริ่มต้น | หมายเหตุ |
|---|---|---|
| `BRIDGE_PORT` | 8787 | พอร์ตเซิร์ฟเวอร์ |
| `PUBLIC_WSS_URL` | wss://localhost:8787/media | URL สาธารณะที่ Twilio ต่อเข้ามา (เฟส 3) |
| `GEMINI_API_KEY` | — | ต้องเปิดสิทธิ์ Live API |
| `GEMINI_LIVE_MODEL` | gemini-2.0-flash-live-001 | โมเดล Live |
| `GEMINI_LIVE_VOICE` | Aoede | เสียง AI (Puck/Charon/Kore/Aoede/Fenrir) |
| `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | — | ใช้ค่าเดียวกับ HR app |

## รันด้วย PM2 (เฟส 3 ตอน deploy จริง)
```bash
pm2 start server.js --name hr-voice-bridge --cwd ./voice-bridge
```

## เฟส 3-4 (เสร็จแล้ว)
- **เฟส 3**: กด 🎙️ ในหน้าผู้สมัคร → HR app สั่ง Twilio โทรออก → TwiML ชี้เข้า `/twiml/:id` ของ bridge → เปิด Media Stream
  ต้องตั้ง `TWILIO_*` + `BRIDGE_PUBLIC_URL` ใน `.env.local` ของ HR app และเปิด public https/wss ให้ bridge (Cloudflare Tunnel)
- **เฟส 4**: วางสาย → bridge เรียก `POST {APP_INTERNAL_URL}/api/internal/interview-complete` (ยืนยันด้วย `BRIDGE_SECRET`)
  → HR app ใช้ LLM สรุป+ให้คะแนน เขียนกลับ `interview_sessions` + `applicants.interview_score` + แจ้ง HR (web push)
  ต้องตั้ง `APP_INTERNAL_URL` + `BRIDGE_SECRET` ให้ตรงกันทั้งสองฝั่ง
