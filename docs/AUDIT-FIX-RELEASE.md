# สถานะการแก้จาก Audit 17 พฤศจิกายน 2569

## สิ่งที่ลงมือแก้ในโค้ด

- Payroll แยก reimbursement/bonus, ใช้อัตรา SSO ตามงวด, คำนวณซ้ำไม่สะสมเงินคืน, ไม่หัก absence/unpaid leave วันเดียวกันซ้ำ และรายวันไม่หักวันไม่ทำงานซ้ำ
- ตรวจ error ของต้นทางก่อนคำนวณ; แสดง failed รายพนักงาน; ตรวจยอด OT/expense ตอนยืนยันจ่ายอีกครั้ง
- RPC transaction สำหรับ draft/payment/leave; paid locks, unique constraints และปิด generic CRUD ที่ข้าม workflow
- ลาครึ่งวันมี session/work_dates, server คำนวณตามปฏิทิน, ตรวจชน/โควตา pending; มี preview และ draft ชั่วคราว
- GPS input validation และทีม approval ตรวจเจ้าของทีมจริง
- LINE bcrypt/rate limit/active account; full JWT ไม่ใช้ใน query; scoped download token
- HttpOnly cookie และ logout API; ทุก protected request ตรวจ active user/role ใหม่
- หนังสือรับรอง snapshot/immutability; ใช้ข้อมูลบริษัทกลาง; รูปเอกสาร/ลายเซ็น/พนักงาน/ใบเสร็จตรวจสิทธิ์ต่อไฟล์
- Onboarding อ่านข้อมูลจริง; สวัสดิการและสลับกะอธิบายข้อจำกัดจริง
- เมนู More เป็นปุ่มและค้นหาได้; shortcut หัวหน้า; initial deep link; navigation ตามสิทธิ์
- Modal focus/keyboard/dirty guard/labels; ขยายปุ่มไอคอน; bulk failures คงรายการให้ลองใหม่; dashboard/doc request มี error/retry
- Service worker ตัด route ที่ไม่มีออก, offline API ตอบ 503; ปรับ reduced motion รายส่วน
- สถานะดัชนี AI แยกจากไฟล์; สร้าง embeddings ก่อนลบดัชนีเดิม
- Logical export ครบตารางธุรกิจ/ไฟล์พร้อม hash, pagination และหยุดเมื่ออ่านไม่ครบ; แก้คำอธิบายไม่ให้เข้าใจว่าเป็น PITR backup
- อัปเดต environment template, คู่มือผู้ใช้ และคู่มือติดตั้ง

## ขอบเขตที่ยังต้องตรวจ/พัฒนาต่อ

- ผู้ดูแลรัน phase21 แล้ว และตรวจคอลัมน์ใหม่/RPC บน Supabase แบบอ่านอย่างเดียวพบครบ ไม่ได้เปลี่ยนยอด/สถานะข้อมูลเก่าให้อัตโนมัติ
- ยังไม่ได้ยืนยันภาพหน้าจอหลัง login, responsive, contrast, screen reader, Android และการพิมพ์ PDF จริง เครื่องมือ browser หมดเวลาในการตรวจครั้งก่อน
- PDF ตัวอย่างยังเข้ารหัส จึงยังไม่ตรวจจัดหน้าและเนื้อหาจริง
- ยังไม่มี one-time-code LINE linking, self-service shift swap, สิทธิ์สวัสดิการเฉพาะราย, revision/reversal workflow ครบชุด และ payroll tax engine แบบสะสมจริงทั้งปี สูตรภาษียังเป็นประมาณการที่ต้องให้ payroll ตรวจ
- การแปลงข้อมูลเก่าและซ้อม restore ต้องใช้สำเนาข้อมูลจริง/ผู้รับผิดชอบ พร้อมเทียบยอดตาม OPERATIONS.md
- ยังมี inline colors และ img warnings; ไม่ได้อ้างว่าปรับ design tokens/performance จบทั้งระบบ
- Logical export ต้องหยุดการเขียนชั่วคราวถ้าต้องการชุดสัมพันธ์กัน ไม่แทน transaction-consistent database backup
- ยังไม่ได้ปรับ dependencies แบบอัตโนมัติด้วย audit fix --force เพื่อหลีกเลี่ยง breaking changes ต้องตรวจ dependency vulnerabilities แยกตามผล npm audit

## ผลตรวจ

- `npm test`: ผ่าน 31 รายการ ครอบคลุม logic, PostgreSQL transactions และ API handlers จริงกับฐานข้อมูลแยก รวมรัน migration21 ซ้ำ
- `npm run lint`: ผ่าน ไม่มี error มี 15 warnings เรื่อง img ที่มีอยู่ในหลายหน้า
- `npm run build`: ผ่าน
- Impeccable detector: [] ไม่พบรายการจาก scanner แต่ไม่ได้แปลว่าผ่านการตรวจภาพจริง
- HTTP smoke: หน้า login 200, protected API/ไฟล์ที่ไม่มี session 401, login ข้อมูลว่าง 400, logout ล้าง HttpOnly cookie ได้
- พยายามเปิด Chrome เพื่อตรวจภาพรอบนี้แล้ว แต่เครื่องมือหมดเวลา จึงยังไม่รับรองหน้าจอหลัง login หรือมือถือจริง

ไม่มีการอ้างว่าผ่าน live payroll, bank import หรือการนำส่งภาษีแล้ว

ดู [ผลทดสอบรอบขยายและข้อผิดพลาด 3 กลุ่มที่แก้เพิ่มเติม](TEST-RESULTS-2026-11-17.md) แพตช์รอบนี้ไม่ต้องลง SQL เพิ่ม
