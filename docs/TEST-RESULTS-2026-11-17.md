# ผลทดสอบ HR Pro Suite — 17 พฤศจิกายน 2569

## สรุป

ทดสอบ commit เดิม 2c92132 แล้วเพิ่มการทดสอบการเชื่อมต่อ API handlers กับ PostgreSQL แยก พบจุดที่ต้องแก้ 3 กลุ่มและแก้แล้ว ผลรวมล่าสุด `npm test` ผ่าน **31/31 รายการ**, production build ผ่าน, lint ไม่มี error และมี 15 warnings เรื่อง img

ยังไม่รับรองว่าทุกหน้าจอ/อุปกรณ์ทำงานครบ เพราะเครื่องมือ browser หมดเวลา และไม่ได้ทำธุรกรรมบนฐานข้อมูลจริง

## ข้อผิดพลาดที่พบและแก้

| ประเด็น | หลักฐานก่อนแก้ | การแก้ | ผลหลังแก้ |
|---|---|---|---|
| HR เข้าถึง API สิทธิ์ Admin | GET /api/hr/permissions ด้วย cookie HR คืน 200 ทั้งที่เมนู adminOnly | requireMenu ตรวจ adminOnly ฝั่ง server รวม GET/PUT | HR ได้ 403 และตารางสิทธิ์ไม่เปลี่ยน; Admin ได้ 200 |
| รับผล RPC ใบลาไม่กำหนดแถวเดียว | submit/review คืน composite row แต่โค้ดอ่านเหมือน object โดยตรง; adapter เดิมในชุดทดสอบไม่จำลอง plural response | เพิ่ม .single() ที่การยื่นลาและอนุมัติทั้ง employee/generic HR; adapter จำลอง array เป็นค่าเริ่มต้น | item.id/days/session และสถานะหลังอนุมัติถูกต้องในการทดสอบ API |
| CSV ภาษีรวมสลิป draft | มีจ่ายจริง 1 คน ร่างอีก 4 คน แต่ CSV ออก 5 คน | pnd1/sso รวมเฉพาะ paid; ตรวจงวด/format และหยุดเมื่อ query ต้นทางผิดพลาด | CSV มี 1 คนและ header; ฐานรายได้ไม่รวมเงินคืนค่าใช้จ่าย |

การใช้ singular response อ้างอิง [PostgREST: Resource Representation](https://docs.postgrest.org/en/stable/references/api/resource_representation.html) ซึ่งอธิบายค่าเริ่มต้นแบบ array และการขอผลแบบ object

แพตช์รอบนี้ไม่แก้ schema และไม่ต้องรัน SQL เพิ่ม

## ขอบเขตการทดสอบ

### Logic และ SQL

- คำนวณสลิปซ้ำแล้ว bonus/reimbursements/net เท่าเดิม
- ใช้เพดาน SSO ตามงวดและตรวจช่วงเปลี่ยนปี
- ยอดติดลบ/ค่าที่ไม่ใช่ตัวเลขและงวดไม่ถูกต้องถูกปฏิเสธ
- แบ่งวันลาและหักตามวันทำงาน/วันหยุด ไม่รวมขาดงานกับลาไม่รับค่าจ้างวันเดียวกันซ้ำ
- ลาครึ่งเช้า/บ่ายแยกกัน กรณีซ้อนถูกปฏิเสธ
- อนุมัติซ้ำไม่ตัดโควตาซ้ำ ความล้มเหลว rollback ทั้งสถานะและยอด
- paid ไม่ถูกเขียนทับ ส่งแจ้งเตือนไม่เปลี่ยนสถานะ paid
- ยอด OT/expense เปลี่ยนหลังสร้างสลิปทำให้ confirm-pay ถูกปฏิเสธ
- เอกสาร snapshot ไม่เปลี่ยนเมื่อข้อมูลพนักงาน/บริษัท/ลายเซ็นปัจจุบันเปลี่ยน
- JWT ของบัญชี suspended/resigned/deleted และ DB failure ไม่ผ่านการตรวจตัวตน
- token ดาวน์โหลดจำกัดเอกสาร/วิธีเรียก/อายุ ไม่ใช้เรียก API อื่น
- ส่งออกมี pagination/ไฟล์/hash และไม่ส่งไฟล์ที่ข้อมูลขาดหาย

### API handlers จริง + PostgreSQL แยก

โหลด Route Handler จริงของ Next.js โดยเปลี่ยนเฉพาะ Supabase client เป็น query adapter ที่ส่ง SQL เข้า PGlite สร้างฐานข้อมูลด้วย schema จริงทั้งหมด ไม่มีการใช้ .env หรือข้อมูลพนักงานจริงในชุดนี้

1. Login ด้วย bcrypt แล้วได้ HttpOnly cookie; JSON ไม่คืน JWT
2. ใช้ cookie เรียก API ได้ และถูกปฏิเสธทันทีหลังระงับบัญชี
3. ส่งใบลาครึ่งวันแม้ client ส่ง days=99 แต่ server คำนวณเป็น 0.5 วัน
4. บุคคลนอกทีมอนุมัติไม่ได้ หัวหน้าตรงทีมและ HR อนุมัติได้
5. Generate → regenerate → confirm payment → confirm ซ้ำ → LINE ยังไม่ได้ตั้งค่า ยอดและสถานะยังถูกต้อง
6. ขอ/อนุมัติหนังสือรับรองแล้วแก้ salary ในข้อมูลหลัก เอกสารยังคงยอด ณ วันอนุมัติ
7. เจ้าของเข้าถึงรูปเอกสารได้ บุคคลอื่นได้ 403
8. 50 ทวิและ CSV ภาษีใช้เฉพาะยอดจ่ายและรายได้ที่ไม่รวม reimbursement
9. HR ดู/แก้ permissions ไม่ได้; Admin ยังใช้ได้

ชุดนี้ไม่ได้จำลอง PostgREST ทุกฟีเจอร์และไม่ใช่ browser E2E โดยเฉพาะ resource embedding, projection และการเชื่อม Storage ผ่านเครือข่ายจริง ยังต้องตรวจใน staging

### ระบบจริงแบบอ่านอย่างเดียว

- Supabase: payroll_slips มี reimbursements/calculation_version/paid_at/notification_status
- Supabase: leave_requests มี session/work_dates
- Supabase: document_requests มี issued_snapshot; documents มี indexing_status
- OpenAPI metadata พบ save_payroll_draft, confirm_payroll_payment, submit_leave_request และ review_leave_request ครบ
- เว็บที่เผยแพร่: หน้าแรกได้ 200; auth/me, hr/permissions, me/onboarding และ asset image ที่ไม่มี session ได้ 401

การตรวจนี้ไม่ได้เรียก RPC ที่เปลี่ยนข้อมูลจริง และไม่ได้สร้างใบลา จ่ายเงินเดือน ส่ง LINE หรือแก้พนักงานจริง

## ผลคำสั่ง

| คำสั่ง | ผล |
|---|---|
| npm test | 31 pass, 0 fail |
| npm run lint | 0 errors, 15 warnings ที่ img |
| npm run build | ผ่าน สร้าง production routes/static pages สำเร็จ |
| git diff --check | ผ่าน |

## สิ่งที่ยังไม่ได้ยืนยัน

- หน้าจอหลัง login, keyboard/focus จริง, responsive และ contrast: พยายามเปิด Chrome แล้วเครื่องมือหมดเวลา
- Android GPS, notification, ปุ่มย้อนกลับ, download/print บนอุปกรณ์จริง
- การส่ง LINE/Push สำเร็จจริง, bank import และนำส่งภาษี
- ไฟล์ PDF ตัวอย่างที่มีรหัสผ่าน และการพิมพ์/ตัดหน้าจริง
- ประวัติ legacy notified/bonus/leave ที่ต้อง reconcile ตาม OPERATIONS.md
- การทำงานพร้อมกันหลาย connection ของ PostgreSQL จริง; PGlite ทดสอบ transaction/rollback แต่ไม่ได้พิสูจน์ทุก race บน production

ผลชุดนี้ยืนยันเส้นทางที่ระบุและป้องกัน regression ไม่ใช่การรับรองว่าทุกกรณีของระบบถูกต้องทั้งหมด
