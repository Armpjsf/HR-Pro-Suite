# การติดตั้งและอัปเดต HR Pro Suite

เอกสารนี้เป็นคู่มือปัจจุบันแทนคำอธิบาย JSON storage ใน README/DEPLOY รุ่นเดิม ข้อมูลธุรกิจอยู่ใน Supabase Postgres และ private Storage bucket `documents` ไม่ได้อ่านเขียน data/*.json แล้ว

## ติดตั้งบนเครื่องพัฒนา

1. `npm ci`
2. คัดลอก `.env.example` เป็น `.env.local` ใส่ Supabase URL, service role key และ JWT secret แบบสุ่ม ไม่ใส่ key จริงใน Git
3. ใช้ Supabase project สำหรับ staging แยกจาก production
4. สร้าง bucket `documents` แบบ private
5. ลง schema ตามลำดับด้านล่าง ก่อนรัน application รุ่นใหม่นี้
6. `npm test`, `npm run lint`, `npm run build` แล้ว `npm run dev`

ไม่มีบัญชี admin เริ่มต้นที่รับประกันในโค้ดปัจจุบัน ห้ามพึ่งรหัสผ่านตัวอย่างในคู่มือเก่า ให้ใช้ผู้ดูแลที่ provision ไว้ใน environment นั้นด้วย bcrypt password hash

## ลำดับ schema

ฐานข้อมูลใหม่: `schema.sql` → `schema-hr.sql` → `schema-phase1.sql` → `schema-phase3.sql` ถึง `schema-phase21.sql` ตามเลข (ไม่มี phase2) และ `schema-rag.sql` สำหรับ RAG/pgvector โดยใช้ SQL Editor ของ Supabase ตามสภาพ environment

ฐานข้อมูลเดิมที่ครบ phase20: ตรวจและใช้ `schema-phase21.sql` ก่อน deploy โค้ดใหม่ การทดสอบอัตโนมัติสร้างฐานข้อมูลแยกจาก schema จริงทั้งหมดและรัน phase21 ซ้ำเพื่อตรวจ idempotency แต่ไม่ได้รัน migration บน Supabase จริงให้

ก่อน phase21 ตรวจข้อมูลซ้ำด้วยคำสั่งอ่านอย่างเดียว:

```sql
select employee_id,period,count(*) from payroll_slips group by employee_id,period having count(*)>1;
select employee_id,work_date,count(*) from time_records group by employee_id,work_date having count(*)>1;
```

หากพบซ้ำ ให้ผู้รับผิดชอบตรวจประวัติและเลือกการแก้ข้อมูลตามหลักฐาน Migration จะหยุดและ rollback แทนการลบหรือรวมข้อมูลให้อัตโนมัติ

## การเปลี่ยนแปลง phase21

- เพิ่ม reimbursements แยกโบนัส, calculation_version และสถานะแจ้งเตือนแยกจาก paid
- RPC สำหรับ save draft/confirm payment และ submit/review leave ใช้ transaction/locks
- ตรวจยอด OT/เบิกจ่ายอีกครั้งก่อนยืนยันจ่าย หากเปลี่ยนหลังคำนวณจะหยุดให้คำนวณใหม่
- unique index ป้องกันสลิปซ้ำรายคน/งวด และเวลาซ้ำรายคน/วัน
- ลาครึ่งเช้า/บ่ายบันทึก session และ work_dates; การข้ามปีให้แยกใบลา
- เอกสารรับรองใหม่เก็บ issued_snapshot และห้ามแก้ฉบับที่ออกแล้ว
- สลิป paid และรายการ OT/เบิกจ่ายในงวดปิดมีการป้องกันแก้โดยตรง
- เก็บสิทธิ์ HR เดิมที่ยังไม่มี row เป็นค่า explicit; permission query ที่อ่านไม่ได้ไม่ให้สิทธิ์ทั้งหมด

## ข้อมูลเก่าที่ต้องตรวจเอง

1. `notified` เดิมไม่ได้แปลว่าจ่ายเงินจริง ต้องเทียบหลักฐานธนาคาร/บัญชีก่อนจัดสถานะ ห้ามแปลงทุกแถวเป็น paid อัตโนมัติ
2. สลิป calculation_version=1 ที่มีโบนัสหรือเงินเบิกแยกยอดเดิมไม่ได้จากข้อมูลในช่องเดียว ต้องตรวจแยก bonus/reimbursements ก่อนตั้งเป็น version2 การคำนวณทับจะถูกปิดไว้ในกรณีที่เสี่ยง
3. ใบลาเก่าไม่มี work_dates ต้องจัดสรรตามตารางงานและหลักฐานจริงก่อนอนุมัติหรือใช้ลาไม่รับค่าจ้างคำนวณเงินเดือน ห้ามเติมจากช่วงวันที่แบบเดา
4. หนังสือรับรองที่อนุมัติก่อนมี snapshot จะไม่พิมพ์เป็นฉบับทางการจากข้อมูลปัจจุบัน ให้ยื่นคำขอใหม่และอนุมัติใหม่
5. ตรวจ social_security.monthly_contribution ที่ตั้งเองไว้ ค่า override ยังได้รับการรักษาไว้ ต้องให้ payroll ตรวจว่าเป็นข้อยกเว้นจริงหรือเป็นเพดานเดิมที่ยังไม่ได้แก้
6. ค่า base rate รายวันและงวดผ่อนเงินกู้เดิมมี heuristic ควรตรวจนโยบาย/สัญญาก่อนจ่ายจริง

## Session และ client

เว็บใช้ HttpOnly cookie โดย fetch/download/image ภายใน origin เดียวกัน ไม่ส่ง full JWT ใน localStorage/URL หรือ JSON login response อีก Client ภายนอกและสคริปต์ E2E เก่าที่คาดว่า login จะคืน token ต้องปรับมาใช้ cookie jar ก่อนใช้งาน

หลัง deploy ให้ผู้ใช้ logout/login ใหม่ หน้า logout เรียก API เพื่อล้าง HttpOnly cookie และล้าง draft/แชทใน sessionStorage การระงับ/ลบ/เปลี่ยนบทบาทใน users มีผลเมื่อเรียก API ถัดไป

LINE เดิมใช้ bcrypt.compare พร้อมจำกัดครั้งและตรวจ active account ลิงก์ดาวน์โหลดใช้ token อายุ 5 นาทีที่ผูกกับเอกสารเดียว ระยะถัดไปควรเปลี่ยนการผูกบัญชีเป็น one-time code จากเว็บเพื่อไม่ต้องส่งรหัสผ่านในแชท

## การส่งออกและกู้คืน

หน้าตั้งค่าส่งออกข้อมูลทุกตารางธุรกิจที่กำหนดไว้และไฟล์ใน Storage พร้อม SHA-256 ของแต่ละไฟล์ มี pagination ไม่ตัดประวัติที่ 1,000 รายการ และยกเลิกหากอ่านส่วนใดไม่ครบ จำกัดประมาณ 50 MiB สำหรับการส่งออกผ่านเว็บ

นี่คือ logical export ไม่ใช่ point-in-time backup ควรหยุดการเขียนชั่วคราวเพื่อให้ข้อมูลสัมพันธ์กัน และใช้การสำรองฐานข้อมูลของผู้ให้บริการควบคู่กัน ไฟล์มีข้อมูลเงินเดือน เอกสาร และ password hashes ต้องเข้ารหัส/จำกัดสิทธิ์การจัดเก็บตามนโยบายองค์กร

การซ้อม restore ต้องใช้ project ใหม่: ลง schema รุ่นเดียวกัน → ตรวจ manifest/hash/จำนวนแถว → นำข้อมูลเข้าตาม FK → ตั้ง sequences ให้สูงกว่า ID ที่มี → นำไฟล์คืนตาม path เดิม → ตรวจสิทธิ์ bucket → ทดสอบบัญชี/เอกสาร/ยอดเงิน/โควตา → ตรวจ RAG ใหม่ การส่งออกไม่รวม secrets, schema/functions/sequences หรือ embeddings ที่สร้างใหม่ได้ ห้าม import ทับ production โดยไม่เทียบและมีแผนย้อนกลับ

## ก่อนปล่อยใช้งานจริง

- ทดสอบ migration กับสำเนาข้อมูลจริงและ reconcile ยอดเก่าก่อน
- ตรวจงวดตัวอย่างโดย payroll รวมโบนัส เงินเบิก รายวัน/รายเดือน SSO ภาษี และลาไม่รับค่าจ้าง
- ตรวจ keyboard/screen reader/มือถือจริงและ Android GPS/download/print/push
- CSV เป็นข้อมูลสำหรับตรวจสอบและจัดเตรียม ต้องยืนยันรูปแบบนำเข้าของธนาคาร/หน่วยงานปลายทาง ไม่ถือว่าผ่านการนำส่งจริงแล้ว
- ทดสอบ LINE/push ด้วยบัญชีทดสอบ และทดสอบกรณี provider ไม่พร้อม
- `npm test` ใช้ข้อมูลจำลองและ PostgreSQL ใน WASM ไม่อ่าน .env ไม่เชื่อมฐานข้อมูลจริง
- `npm run lint` และ `npm run build` ต้องผ่านก่อน deploy

การ build ไม่ได้ deploy ให้โดยอัตโนมัติ Android APK ใช้ remote server URL ใน capacitor.config.json จึงต้องตรวจปลายทางและรุ่นก่อน build แจกใหม่
