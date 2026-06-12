# HR AI Chatbot

ระบบผู้ช่วย HR อัจฉริยะ — ตอบคำถามระเบียบบริษัท แจกเอกสาร/Template ตรวจสอบวันลา ผ่านเว็บ (PWA) และ LINE Bot โดยควบคุมสิทธิ์ตาม role (admin / hr / employee)

## เริ่มใช้งาน

```bash
# 1. ติดตั้ง dependencies
npm install

# 2. ตั้งค่า environment (คัดลอกแล้วใส่ค่าจริง)
cp .env.example .env.local

# 3. รัน
npm run dev
```

เปิด [http://localhost:3000](http://localhost:3000)

**บัญชีเริ่มต้น:** username `admin` / password `admin123` — ⚠️ เปลี่ยนรหัสผ่านทันทีหลัง login ครั้งแรก (จัดการผู้ใช้ → แก้ไข)

## การตั้งค่า (.env.local)

| ตัวแปร | จำเป็น | คำอธิบาย |
|---|---|---|
| `GEMINI_API_KEY` | แนะนำ | ขอฟรีที่ [aistudio.google.com](https://aistudio.google.com/apikey) — ถ้าไม่ใส่ ระบบตอบจากเนื้อหาเอกสารโดยตรง |
| `JWT_SECRET` | จำเป็น (production) | ค่าสุ่มยาว ๆ สำหรับเซ็น token |
| `LINE_CHANNEL_SECRET` | ถ้าใช้ LINE | จาก [LINE Developers Console](https://developers.line.biz/console/) |
| `LINE_CHANNEL_ACCESS_TOKEN` | ถ้าใช้ LINE | จาก LINE Developers Console |

## ขั้นตอนใช้งานครั้งแรก

1. Login ด้วยบัญชี admin
2. **จัดการผู้ใช้** — เพิ่มพนักงาน/HR พร้อมกำหนดรหัสพนักงาน (เช่น EMP001)
3. **จัดการเอกสาร** — อัพโหลดระเบียบบริษัท, Template, ประกาศ (PDF/Excel/Word/Text) ระบบจะดึงข้อความจาก PDF/Excel/Text ให้ AI ใช้ตอบอัตโนมัติ
4. ทดสอบถามในหน้าแชท

## LINE Bot

1. สร้าง Messaging API channel ใน LINE Developers Console
2. ตั้ง Webhook URL: `https://<โดเมนของคุณ>/api/line/webhook`
3. ใส่ secret/token ใน `.env.local`
4. พนักงานแอดเพื่อน แล้วพิมพ์ `ลงทะเบียน EMP001` (รหัสพนักงานต้องมีในระบบ)

## โครงสร้างข้อมูล

ข้อมูลทั้งหมดเก็บเป็นไฟล์ JSON ในโฟลเดอร์ `data/`:

- `users.json` — ผู้ใช้ (รหัสผ่าน hash ด้วย bcrypt)
- `knowledge-base.json` — เอกสาร + ข้อมูลพนักงาน (วันลา ฯลฯ)
- `line-mappings.json` — การผูกบัญชี LINE
- `audit-log.json` — บันทึกกิจกรรม
- `files/` — ไฟล์เอกสารจริงที่อัพโหลด

💡 สำรองข้อมูลด้วยการ copy โฟลเดอร์ `data/` ทั้งหมด

## ข้อมูลวันลาพนักงาน

แก้ `knowledge-base.json` ส่วน `employeeData` ตามรูปแบบ:

```json
{
  "employeeData": {
    "EMP001": {
      "name": "สมชาย ใจดี",
      "department": "Engineering",
      "position": "Developer",
      "startDate": "2023-01-15",
      "leave": {
        "annual": { "total": 10, "used": 3, "remaining": 7 },
        "sick": { "total": 30, "used": 1, "remaining": 29 },
        "personal": { "total": 5, "used": 0, "remaining": 5 }
      }
    }
  }
}
```

## Deploy

ระบบเขียนไฟล์ลงดิสก์ (`data/`) จึงต้อง deploy บนเซิร์ฟเวอร์ที่มี persistent storage เช่น VPS/Docker (`npm run build && npm start`) — **ไม่เหมาะกับ Vercel/serverless** เว้นแต่เปลี่ยนชั้นจัดเก็บข้อมูลเป็นฐานข้อมูลภายนอก
