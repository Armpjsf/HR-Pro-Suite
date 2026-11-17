# HR Pro Suite

ระบบบริหาร HR และ Employee Self-Service: พนักงาน/องค์กร ลงเวลา GPS กะ การลา เงินเดือน OT เบิกจ่าย เอกสาร/AI ประกาศ และงานพัฒนาองค์กร รองรับเว็บ PWA และ Android ผ่าน Capacitor

## เริ่มต้น

```powershell
npm ci
Copy-Item .env.example .env.local
# ตั้งค่า .env.local และ schema บน staging ตามคู่มือก่อน
npm test
npm run lint
npm run build
npm run dev
```

เปิด http://localhost:3000 ด้วยบัญชีที่ provision สำหรับ environment นั้น ไม่มีรหัสผ่าน admin เริ่มต้นที่ควรใช้ใน production

ข้อมูลอยู่ใน **Supabase Postgres + private Storage bucket documents** ไม่ใช่ JSON ใน data/ เว็บใช้ HttpOnly session cookie และตรวจบัญชี active/role ล่าสุดเมื่อเรียก protected API ส่วน service role key ใช้เฉพาะ server

**รุ่นแก้ Audit ต้องลง schema-phase21.sql ก่อน deploy โค้ดใหม่** ห้ามคำนวณทับประวัติหรือแปลง notified เป็น paid โดยไม่ตรวจหลักฐาน อ่าน [คู่มือติดตั้งและย้ายข้อมูล](docs/OPERATIONS.md) ก่อนดำเนินการ

## เอกสาร

- [คู่มือพนักงาน หัวหน้า HR และ Payroll](docs/USER-GUIDE.md)
- [ติดตั้ง Migration ส่งออกและกู้คืน](docs/OPERATIONS.md)
- [สถานะการแก้และงานที่ยังต้องตรวจ](docs/AUDIT-FIX-RELEASE.md)
- [รายงาน Audit ต้นฉบับ](docs/HR-SYSTEM-AUDIT-2026-11-17.md)

## การทดสอบ

`npm test` ทดสอบ logic และ transaction ด้วย PostgreSQL ใน WASM (PGlite) สร้าง schema จากไฟล์จริง ใช้ข้อมูลจำลอง ไม่อ่าน .env และไม่เชื่อม Supabase จริง การผ่านชุดนี้ไม่แทนการทดสอบหน้าจอ มือถือ อุปกรณ์ GPS LINE หรือการตรวจยอดโดย payroll

`npm run build` สร้าง production build; `npm start` รัน production server ส่วน Android ใช้ remote server URL จาก capacitor.config.json ต้องตรวจปลายทางก่อน `npm run build:apk`

## การเชื่อมต่อ

AI/LINE/push/TMS เป็นส่วนเสริม ให้ตั้งค่าตาม .env.example และตรวจนโยบายข้อมูลก่อนใช้ OCR ภายนอก รหัสผ่าน LINE ต้องตรวจด้วย bcrypt ลิงก์ดาวน์โหลดจาก LINE จำกัดเอกสารและอายุ 5 นาที

CSV ส่งออกเป็นข้อมูลสำหรับจัดเตรียมและตรวจสอบ ต้องยืนยันรูปแบบธนาคาร/หน่วยงานปลายทางก่อนนำส่งจริง ส่วน logical export ในหน้าตั้งค่ารวมข้อมูลและไฟล์แนบ แต่ไม่แทน database backup แบบ point-in-time

คู่มือ DEPLOY.md และ DEPLOY-LOCAL.md เก็บขั้นตอน infrastructure รุ่นก่อน การตั้งค่า backend/schema/backup ให้ยึด OPERATIONS.md เป็นหลัก
