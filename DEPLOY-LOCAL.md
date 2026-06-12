# คู่มือรันระบบบนเครื่อง Windows ภายในองค์กร + เปิดให้ใช้งานผ่าน Cloudflare Tunnel

เหมาะสำหรับองค์กรเล็ก (≤50 คน) ที่ไม่อยากพึ่ง cloud VM — รันแอปบนเครื่อง Windows ที่มีอยู่แล้ว
แล้วเปิด HTTPS URL ให้พนักงานเข้าใช้งาน (PWA) และให้ LINE webhook เรียกเข้ามาได้

---

## ภาพรวม

```
พนักงาน/LINE  --HTTPS-->  Cloudflare Tunnel  --localhost:3000-->  Next.js app (PM2)
```

- **PM2**: คุมให้แอป Next.js รันค้างไว้ตลอด + auto-restart ถ้า crash + เริ่มเองตอนเปิดเครื่อง
- **cloudflared**: เปิด tunnel จากเครื่องนี้ออกไปอินเทอร์เน็ต โดยไม่ต้อง config router/port forwarding

---

## สถานะปัจจุบัน (ทำให้แล้ว)

- ✅ Build production แล้ว (`npm run build`)
- ✅ รันด้วย PM2 ชื่อ process `hr-chatbot` (`ecosystem.config.js`)
- ✅ ตั้งค่า `pm2-startup` ให้ PM2 เริ่มเองตอน Windows boot

ตรวจสอบสถานะได้ด้วย:

```powershell
pm2 list          # ดูสถานะแอป
pm2 logs hr-chatbot   # ดู log
pm2 restart hr-chatbot   # รีสตาร์ทหลังแก้โค้ด/build ใหม่
```

หลังแก้โค้ด ต้อง build ใหม่ก่อน restart เสมอ:

```powershell
npm run build
pm2 restart hr-chatbot
```

---

## ขั้นที่ 1: เปิด Tunnel แบบ Quick Tunnel (ทดสอบก่อน — ไม่ต้องมีโดเมน)

```powershell
cloudflared tunnel --url http://localhost:3000
```

จะได้ URL แบบ `https://xxxx-xxxx-xxxx.trycloudflare.com` — ใช้ทดสอบ:
- เปิด URL นี้ใน browser ควรเห็นหน้า login
- ใส่ใน LINE Developers Console เป็น Webhook URL: `https://xxxx.trycloudflare.com/api/line/webhook` → กด Verify

⚠️ **ข้อจำกัด**: URL จะ**เปลี่ยนทุกครั้ง**ที่รัน cloudflared ใหม่ — เหมาะแค่ทดสอบ ไม่เหมาะ production จริง
(ถ้าจะใช้ยาว ต้องเปิด terminal นี้ทิ้งไว้ตลอด)

---

## ขั้นที่ 2: Named Tunnel (URL คงที่ — สำหรับใช้งานจริง)

ต้องมี **โดเมนที่เพิ่มเข้า Cloudflare account แล้ว** (ซื้อผ่าน Cloudflare Registrar หรือที่อื่นแล้วย้าย DNS มาที่ Cloudflare)

```powershell
# 1. Login เพื่อผูกกับ Cloudflare account (เปิด browser ให้ยืนยัน)
cloudflared tunnel login

# 2. สร้าง tunnel
cloudflared tunnel create hr-chatbot

# 3. ตั้งค่า DNS ให้ชี้มาที่ tunnel (เปลี่ยน hr.yourdomain.com เป็นโดเมนจริง)
cloudflared tunnel route dns hr-chatbot hr.yourdomain.com
```

สร้างไฟล์ config `%USERPROFILE%\.cloudflared\config.yml`:

```yaml
tunnel: hr-chatbot
credentials-file: C:\Users\Armdd\.cloudflared\<TUNNEL-ID>.json

ingress:
  - hostname: hr.yourdomain.com
    service: http://localhost:3000
  - service: http_status:404
```

รัน tunnel:

```powershell
cloudflared tunnel run hr-chatbot
```

ติดตั้งให้รันเป็น Windows service (เริ่มเองตอนเปิดเครื่อง):

```powershell
cloudflared service install
```

จากนั้นเข้าใช้งานได้ที่ `https://hr.yourdomain.com` ตลอดเวลา และตั้ง LINE webhook เป็น
`https://hr.yourdomain.com/api/line/webhook`

---

## การตั้งค่า Supabase (storage backend)

ข้อมูลทั้งหมด (users, documents, employee_records, line_mappings, audit_logs) และไฟล์เอกสารที่อัพโหลด
ย้ายมาอยู่บน Supabase (Postgres + Storage) แล้ว — ไม่ใช้ไฟล์ใน `data\` อีกต่อไป

ขั้นตอนตั้งค่า (ทำครั้งเดียว):

1. สมัคร/login ที่ https://supabase.com แล้วสร้างโปรเจกต์ใหม่ (ฟรี)
2. ไปที่ Project Settings → API คัดลอก **Project URL** และ **service_role key**
3. ใส่ใน `.env.local`:
   ```
   NEXT_PUBLIC_SUPABASE_URL=...
   SUPABASE_SERVICE_ROLE_KEY=...
   ```
4. เปิด SQL Editor ในโปรเจกต์ แล้วรันไฟล์ `supabase/schema.sql` ทั้งหมด
5. ไปที่ Storage → New bucket → ชื่อ `documents` → Public: **off**
6. ย้ายข้อมูลเดิมจาก `data\*.json` + `data\files\` เข้า Supabase:
   ```powershell
   node scripts/migrate-to-supabase.mjs
   ```
7. `npm run build` แล้ว `pm2 restart hr-chatbot`

ไฟล์ใน `data\` ยังเก็บไว้เป็น backup แต่แอปจะไม่อ่าน/เขียนไฟล์เหล่านี้อีก

---

## แก้ปัญหาที่พบบ่อย

| อาการ | สาเหตุ/วิธีแก้ |
|---|---|
| `pm2 list` แสดง `errored` | ดู `pm2 logs hr-chatbot --err` หาสาเหตุ มักเป็น build ไม่สำเร็จหรือ port ชนกัน |
| เปิดเครื่องใหม่แล้วแอปไม่ขึ้น | เช็คว่า `pm2-startup install` รันสำเร็จ และ `pm2 save` ไว้แล้ว |
| LINE Verify ไม่ผ่าน | ต้องเป็น HTTPS (Cloudflare Tunnel ให้มาแล้ว) และ `cloudflared` ต้องรันอยู่ |
| Quick Tunnel URL เปลี่ยนทุกครั้ง | ใช้ Named Tunnel (ขั้นที่ 2) แทนสำหรับใช้งานจริง |
| AI ไม่ตอบจากเอกสาร | เช็ค `GEMINI_API_KEY` ใน `.env.local` แล้ว `pm2 restart hr-chatbot` |
