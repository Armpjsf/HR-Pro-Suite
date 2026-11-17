# วิเคราะห์ HR Pro Suite — 17 พฤศจิกายน 2569

Method: dual-agent (A: /root/design_review · B: /root/detector_review) ร่วมกับการตรวจ logic/API/เอกสารโดย agent หลัก

## ข้อสรุป

ระบบมีขอบเขตครอบคลุม HR suite มากกว่า chatbot ตามชื่อ README และมีโครงสร้างใช้งานต่อได้ แต่ยังไม่ควรถือว่าการลา เงินเดือน เอกสารรับรอง และการผูก LINE พร้อมใช้งานจริงทุกเส้นทาง ปัญหาสำคัญที่สุดคือข้อมูลและสถานะไม่สอดคล้องกันระหว่างขั้นตอน มากกว่าความสวยงามของหน้าจอ

คะแนน Nielsen จากการตรวจซอร์สเบื้องต้น **21/40** ไม่ใช่คะแนนจาก usability test หรือผลตรวจภาพหน้าจอจริง คะแนนนี้ใช้จัดลำดับการปรับปรุงเท่านั้น

## ขอบเขตและความน่าเชื่อถือของผล

- ตรวจโครงสร้าง app/hr, app/me, components, lib, API ที่เกี่ยวข้อง, SQL migration และ README/คู่มือ deploy
- Agent A ตรวจ UX อย่างอิสระจากซอร์สก่อนเห็นผล detector; Agent B รัน detector และตรวจข้อสังเกตทางเทคนิค
- `npm test`: ผ่าน 6/6 รายการ; `npm run lint`: 0 errors, 15 warnings เรื่อง img
- Impeccable detector สแกน app/components และไฟล์ตัวอย่าง: ผล [] ไม่ได้แปลว่าไม่มีปัญหา accessibility
- ทดสอบซ้ำ logic เงินเบิกจ่ายและ bcrypt ด้วยข้อมูลจำลองในหน่วยความจำ ไม่เขียนข้อมูลธุรกิจ
- เริ่ม local Next dev ที่ 127.0.0.1:3100 และหยุดแล้ว พบ HTTP GET / สำเร็จ และ GET /chat เป็น 404 ใน log
- เครื่องมือเปิด browser ทั้ง IAB และ Chrome หมดเวลา จึงไม่ได้ตรวจ layout/contrast บนภาพจริง, keyboard flow จริง, responsive จริง หรือทำ live overlay
- PDF ตัวอย่างทั้งสองไฟล์เข้ารหัสและเปิดด้วยรหัสว่างไม่ได้ จึงยังไม่ได้ตรวจเนื้อหา/รูปแบบของไฟล์เหล่านั้น ไม่ได้คาดเดาหรือข้ามรหัสผ่าน
- ไม่ได้ทดสอบ APK บน Android, GPS จริง, push จริง, LINE จริง, bank import หรือการนำส่งภาษีจริง
- ไม่รัน e2e-suite เนื่องจากสคริปต์ใช้บัญชีตายตัวและมีการเปลี่ยนข้อมูล; local .env อาจชี้ฐานข้อมูลจริง
- ข้อเสนอด้านกระบวนการและ UI เป็นข้อเสนอ ส่วนข้อบกพร่อง logic อ้างตำแหน่งโค้ดและเงื่อนไขที่ทำให้เกิดได้ ข้อมูล live DB อาจมี trigger/constraint ต่างจาก SQL ที่อยู่ใน repository จึงต้องยืนยันใน staging

ความรุนแรง: P0 = งานหลักถูกปิดกั้นและยืนยันในสภาพใช้งานจริง, P1 = กระทบความถูกต้อง/ข้อมูล/การเข้าถึงอย่างสำคัญ ควรแก้ก่อนปล่อย, P2 = มีทางเลี่ยงแต่เพิ่มภาระหรือความสับสน, P3 = เก็บรายละเอียด ครั้งนี้ไม่มี P0 ที่ยืนยันบน production

## 1. แผนที่ระบบ

| ส่วน | สิ่งที่พบ | สิ่งที่ควรพิสูจน์ต่อ |
|---|---|---|
| ระบบหลัก | Next.js 16.2.9 / React 19.2.4, API ใน app/api | build/deploy และ migration ตามรุ่น |
| การจัดเก็บ | Supabase Postgres + Storage ผ่าน service role ฝั่ง server | RLS/สิทธิ์ bucket/backup restore ของ environment จริง |
| การเข้าใช้ | JWT 8 ชั่วโมง, role, role_permissions และสิทธิ์เมนู | revocation และ permission scope ให้สม่ำเสมอทุก API |
| HR back office | ภาพรวม รายงาน แชท พนักงาน ผังองค์กร สาขา แผนก ตำแหน่ง | สิทธิ์รายสาขา/รายทีมและข้อมูลอ่อนไหว |
| เวลาและการลา | GPS, time records, กะ, วันหยุด, โควตา, approval หัวหน้า/HR | ข้ามคืน ครึ่งวัน ข้ามปี concurrent approval |
| เงิน | payroll, OT, ค่าใช้จ่าย, เงินกู้, ประกันสังคม, CSV export | reconciliation ปิดงวดและอัตราตามวันที่มีผล |
| เอกสาร | คลังเอกสาร/RAG, หนังสือรับรอง, สลิป, 50 ทวิ, ลายเซ็น/ตรา | immutable issuance, access control และแบบทางการ |
| สนับสนุน | ทรัพย์สิน ห้องประชุม ประกาศ | การจองซ้อนและการอนุมัติครบวงจร |
| พัฒนาองค์กร | สรรหา ผู้สมัคร AI interview อบรม ทริป onboarding ประเมิน/OKR | เนื้อหาจริงกับ placeholder, ผู้อนุมัติและผู้รับผิดชอบ |
| แอพพนักงาน | /me, bottom navigation, เมนูเพิ่มเติม, dynamic sections | งานหน้างาน เครือข่ายช้า draft และ deep link |
| Android | Capacitor ชี้ remote HTTPS URL, MainActivity extends BridgeActivity | GPS permission, notification, back, download/print บนเครื่องจริง |
| LINE/AI/TMS | webhook, LLM/RAG, earnings/manual integrations | identity, retry, observability, data minimization |

หมายเหตุ: การมี route/component หมายถึงมี implementation อยู่ ไม่ใช่การรับรองว่าทุกฟังก์ชันผ่านการทดสอบ end-to-end

## 2. ข้อบกพร่องด้านข้อมูลและกระบวนการที่ควรแก้ก่อน

### F01 [P1] คำนวณสลิปซ้ำแล้วเงินเบิกจ่ายสะสมซ้ำ

หลักฐาน: `app/api/hr/payroll/generate/route.js:159` นำ bonus ของสลิปเดิมมาเป็น prevBonus แล้วส่ง reimbursements รอบเดิมให้ `computeSlip` อีกครั้ง; `lib/payroll.js` เก็บโบนัสและเงินเบิกจ่ายรวมในช่อง bonus

เงื่อนไข: สลิปยังแก้ได้ มี approved expense และ HR เลือก overwrite ก่อน confirm-pay

ผลทดลองจำลอง: ฐานเงินเดือน 20,000 + เงินเบิก 1,000 ครั้งแรก bonus=1,000/net=20,250; คำนวณซ้ำ bonus=2,000/net=21,250 ต่างกัน 1,000 ตัวเลขนี้ใช้สูตรปัจจุบันเพื่อพิสูจน์การบวกซ้ำ ไม่ใช่ตัวอย่างคำนวณตามกฎหมายปัจจุบัน

แก้: แยกรายได้/โบนัส/เงินคืนค่าใช้จ่ายเป็นคนละรายการ ผูก source transaction ID และให้ generate เป็น idempotent: input ชุดเดิมต้องได้ยอดเท่าเดิม

### F02 [P1] สถานะการส่งแจ้งเตือนทับสถานะการจ่ายเงิน

หลักฐาน: `app/api/hr/payroll/[id]/notify/route.js:71` เปลี่ยน status เป็น notified โดยไม่ตรวจ paid; `app/api/me/tax-cert/route.js:22` รวมเฉพาะ paid; generate ป้องกัน overwrite เฉพาะ paid; ปุ่ม LINE ใน `app/hr/payroll/page.js:335` ใช้ได้ทุกสถานะ

ผล: เมื่อส่ง LINE หลังจ่ายแล้ว รายการอาจหายจากยอด 50 ทวิ ถูกแสดงปุ่มยืนยันจ่ายอีกครั้ง และกลับไปอยู่ในกลุ่มที่ overwrite ได้ หากไม่ได้ตั้ง LINE token ยังเข้าทาง mock แล้วบันทึก notified/ตอบสำเร็จได้

แก้: แยก payment_status, notification_status, sent_at; paid ต้องไม่ย้อนกลับเพราะส่งแจ้งเตือน มี failed/retry จริง และห้ามโหมด mock ตอบว่าได้ส่งแล้วใน production

### F03 [P1] สูตรประกันสังคมไม่มีช่วงวันที่มีผล และใช้เพดานเดิม

หลักฐาน: `lib/payroll.js:7` hardcode ฐาน 15,000 สูงสุด 750; tests/core.test.mjs ทดสอบยืนยันเพดานเดียวกัน และลดหย่อน SSO รายปีกำหนด 9,000

ข้อมูลปัจจุบันปี 2569: สำนักงานประกันสังคมระบุการปรับเพดานฐานค่าจ้างเป็น 17,500 และเงินสมทบสูงสุด 875 ตั้งแต่ 1 มกราคม 2569 การตั้ง ssoCustom ช่วย override บางรายได้ แต่ default ยังคลาดเคลื่อน

แหล่งอ้างอิง: https://www.sso.go.th/wpr/assets/upload/files_storage/sso_th/30e306da0526862ae528230bc19aa5a6.pdf และ https://www.hrm.chula.ac.th/th/home/social-security-fund

แก้: ตารางอัตราที่มี effective_from/effective_to ตามงวด สร้างกรณีทดสอบข้ามปีและให้ฝ่าย payroll ยืนยันสูตร/ข้อยกเว้น/ค่าลดหย่อนก่อนใช้จ่ายจริง

### F04 [P1] เบิกจ่ายที่ไม่ได้คำนวณภาษีถูกนับเป็นรายได้ในรายงานภาษี

หลักฐาน: computeSlip รวม reimbursements ลง bonus แต่ calcMonthlyTax รับเฉพาะ bonusMonthly; `app/api/me/tax-cert/route.js:29` และ `app/api/hr/payroll/export/route.js` รวม bonus ทั้งช่องเป็นรายได้

ผล: ฐานที่ใช้คำนวณ withholding กับฐานที่ออกรายงานอาจไม่เท่ากัน แม้ใช้ข้อมูลสลิปชุดเดียวกัน ทั้งนี้การจัดประเภทภาษีของค่าใช้จ่ายแต่ละชนิดต้องให้ผู้รับผิดชอบยืนยัน

แก้: แยก taxable/non-taxable earning และ reimbursement line items พร้อมกฎภาษี/บัญชีที่ใช้อ้างอิงร่วมกัน

### F05 [P1] ลาไม่รับค่าจ้างข้ามเดือนจัดสรรผิดงวดได้

หลักฐาน: generate query ใบลาโดย start_date อยู่ในเดือน แล้วบวก req.days ทั้งใบ ไม่มีตัดจำนวนวันที่คาบเกี่ยวเดือน

ตัวอย่าง: ลาวันที่ปลายเดือนถึงต้นเดือนถัดไป อาจถูกหักทั้งหมดในเดือนแรกและไม่ปรากฏเดือนหลัง

แก้: คำนวณวันทำงาน/ช่วงเวลาที่ตัดกับแต่ละงวดจริง แยกวันหยุดและวันลาครึ่งวัน

### F06 [P1] พนักงานรายวันเสี่ยงถูกหักวันไม่ทำงานซ้ำ

หลักฐาน: generate คิด baseSalary = dailyRate × วันที่เข้างานแล้ว แต่ยังคำนวณ unpaidDeduction จากวัน absent/unpaid leave หักเพิ่มอีก ไม่มีแยกเงื่อนไขรายวันในส่วนนี้

แก้: กำหนดสูตรรายวันแยกจากรายเดือน ทดสอบตามนโยบายบริษัท เช่น เข้างาน 20 วัน ขาด 1 วัน ต้องไม่หักวันเดียวกันสองครั้ง

### F07 [P1] ข้อมูลต้นทางล้มเหลวแต่ยังสร้างสลิปต่อได้

หลักฐาน: generate รับเฉพาะ data จาก Promise.all หลายตาราง ไม่ตรวจ error แต่ละผล; update/insert นับเฉพาะรายการที่ไม่มี error แล้วตอบ success ไม่มี failed details

ผล: ถ้า OT/เบิกจ่าย/โควตาหรือข้อมูลต้นทางดึงไม่ได้ อาจตีเป็นศูนย์และได้สลิปที่ดูเหมือนคำนวณสำเร็จ

แก้: fail closed เมื่อข้อมูลจำเป็นขาด แสดงแหล่งข้อมูล/จำนวนรายการ/ยอดก่อนสร้าง และผลสำเร็จ/ล้มเหลวรายพนักงาน

### F08 [P1] ลาครึ่งเช้าและครึ่งบ่ายไม่ต่างกันหลังบันทึก

หลักฐาน: `app/me/page.js:1004` มี durationMode แต่ส่งเพียง form ที่ :894; `app/api/me/leave/route.js:16` ไม่รับ session และไม่บันทึกช่วงเวลา

เพิ่ม: กดเต็มวันตั้ง days=1 แม้วันที่ยังครอบหลายวัน; ผู้ใช้กรอกจำนวนวันเองได้; server ไม่คำนวณตามปฏิทิน ไม่ตรวจ start<=end หรือช่วงเวลาซ้อนกัน

แก้: server รับ duration/session แล้วคำนวณวันเอง ส่ง preview กลับให้ตรวจ และตรวจ overlap/pending balance/ข้ามปี

### F09 [P1] อนุมัติลาหลายตารางไม่เป็น transaction

หลักฐาน: `app/api/hr/leave/[id]/approve/route.js:117` เปลี่ยน status ก่อน upsert balance/employee_records; time_records เป็น best-effort; conditional update ไม่ตรวจว่ามี row ถูกเปลี่ยนจริงกี่รายการ

ผล: อนุมัติแล้วแต่ยอดไม่ถูกตัด หรือ retry ไม่ได้เพราะ status เปลี่ยนแล้ว; concurrent approval อาจทำ side effects ซ้ำ/เสียยอด

แก้: database transaction/RPC, row locking, atomic balance increments, ตรวจ affected rows และ audit ที่มี request/action ID

### F10 [P1] generic CRUD สามารถเปลี่ยนรายการที่ควรผ่าน workflow

หลักฐาน: lib/hr-resources.js เปิด status ของ leave/payroll และยอดการเงินให้เขียน; `app/api/hr/[resource]/[id]/route.js:49` รับ whitelist แล้ว update ตรง ไม่บังคับ state transition/paid lock หรือธุรกรรมตัดวันลา

เพิ่ม: ลบใบลาอนุมัติแล้วคืนยอดบางตารางและลบ time_records ตามช่วงวัน แต่ไม่คืน legacy counter ใน employee_records และไม่ผูก record กับใบลาต้นทางโดยตรง

แก้: route รายธุรกรรมสำหรับ approve/reject/cancel/pay; generic CRUD ต้องแก้ได้เฉพาะ draft ที่อนุญาต แยก permission view/create/approve/pay/export และห้ามแก้ paid โดยตรง

### F11 [P1] GPS mode ไม่ตรวจค่าจาก client อย่างครบถ้วน

หลักฐาน: `app/api/me/clock/route.js:68` ตรวจ action แต่ไม่มี enum validation check_type; geofence ทำเฉพาะ office ส่วนโหมดอื่นไม่เข้าเงื่อนไข office และ offsite ได้

ผล: API client ส่ง check_type ที่ไม่รู้จักเพื่อหลบเส้นทางตรวจ geofence ได้ แม้ UI ไม่มีตัวเลือกนั้น; WFH ยังต้องผูกสิทธิ์นโยบายบริษัท ไม่ควรเชื่อ mode จาก client เพียงอย่างเดียว

แก้: enum allowlist + authorization ตาม employee/work assignment, latitude/longitude แบบ finite ในช่วงที่ถูกต้อง และ accuracy/เหตุผล/ผู้รับรองสำหรับกรณียกเว้น

### F12 [P1] ผูก LINE เปรียบเทียบรหัสผ่านกับ bcrypt hash โดยตรง

หลักฐาน: `app/api/line/webhook/route.js:324` ใช้ employee.password !== password แต่เว็บ login ใช้ bcrypt.compare

ทดลองข้อมูลจำลอง: bcrypt.compare(รหัสผ่าน, hash)=true ขณะที่ direct equality=false

ผล: ผู้ใช้ที่รหัสผ่านถูก hash ตามระบบปกติผูก LINE ด้วยรหัสผ่านจริงไม่ผ่าน; คู่มือยังบอกให้ส่งรหัสพนักงานอย่างเดียวด้วย

แก้: แนะนำ flow ผูกบัญชีจากเว็บด้วย one-time code อายุสั้น; หากยังรับ password ต้องใช้ bcrypt.compare, rate limit และตรวจ active status อย่างสม่ำเสมอ หลีกเลี่ยงให้พนักงานส่งรหัสผ่านในประวัติแชท

## 3. เอกสารและการรักษาสิทธิ์

### F13 [P1] หนังสือรับรองเลขเดิมเปลี่ยนข้อมูลย้อนหลังได้

หลักฐาน: `lib/document-requests.js:18` enrich จาก users/employee_records/latestSlip ปัจจุบัน; `components/me/SecondaryTabs.js:2426` ใช้ข้อมูลนั้นทำเอกสาร; approval บันทึกสถานะและ asset ID ไม่มี issued content snapshot

ผล: เปลี่ยนเงินเดือน ชื่อ ตำแหน่ง หรือลายเซ็น แล้วเปิดคำขอเลขเดิม อาจได้ข้อมูลใหม่ภายใต้วันที่อนุมัติเดิม

แก้: snapshot ข้อมูลผู้รับรอง/บริษัท/พนักงาน/ยอดเงิน/asset version ณ วันที่อนุมัติ เก็บ issued PDF หรือ canonical data+hash และใช้ revision/revoke/reissue แทนการแก้ย้อนหลัง

### F14 [P1] ข้อมูลบริษัทบนสลิป HR กับแอพพนักงานไม่ตรงกัน

หลักฐาน: `app/hr/payroll/page.js:11` ประกาศ COMPANY เอง มีที่อยู่และ taxId ต่างจาก `lib/company.js` ที่แอพและเอกสารอื่นใช้

ผล: สลิปงวดเดียวกันจากคนละหน้าสามารถแสดงผู้ออกเอกสารต่างกัน ไม่ได้ตัดสินจากโค้ดว่าชุดใดถูก ต้องยืนยันทะเบียนบริษัท

แก้: ใช้ company/branch/legal entity ที่เป็นแหล่งข้อมูลเดียว และ snapshot ตามรุ่นเอกสาร

### F15 [P1] ไฟล์ลายเซ็น/ตราและภาพพนักงานกั้นเพียง login

หลักฐาน: `app/api/assets/image/route.js:12` ตรวจผู้ใช้และ prefix assets/document-assets/employee-photos แต่ไม่ตรวจสิทธิ์เมนู ความเป็นเจ้าของ หรือการอ้างอิงเอกสารอนุมัติ

ผล: ผู้ที่ login และทราบ path ขอไฟล์ในกลุ่มดังกล่าวได้โดยไม่มี object-level authorization เพิ่ม ไม่ได้ยืนยันว่ามีการเดา path หรือข้อมูลรั่วจริง

แก้: resolve asset ผ่าน ID และตรวจสิทธิ์ต่อ object/approved request; แสดงลายเซ็นบนเอกสารที่อนุมัติแล้วเท่าที่จำเป็น ลดการเปิด raw asset

### F16 [P1] ระงับบัญชีและเปลี่ยนสิทธิ์ยังไม่ใช้กฎเดียวกันทุก API

หลักฐาน: requireAuth/requireRole ตรวจเพียง JWT; requireMenu ตรวจ users ซ้ำแต่หากไม่พบ row/อ่าน error จะ fallback role เดิม; getAllowedMenus เมื่อไม่มี data ให้ hr='__all__' โดยไม่แยก DB failure; documents upload ยังใช้ requireRole(admin,hr) ต่างจากเมนู

ผล: token อายุ 8 ชั่วโมงอาจยังใช้บาง API หลังระงับบัญชี/เปลี่ยน role; สิทธิ์ที่เห็นใน UI อาจไม่ตรงกับ server และ DB failure อาจกลายเป็นอนุญาต HR ทั้งหมด

แก้: authentication guard กลางตรวจ active user/token version; database error ต้อง deny; permission กลางต่อ action/resource/branch/team พร้อม explicit migration สำหรับ legacy defaults

### F17 [P1] token อ่านได้จาก JavaScript และถูกใช้ใน URL

หลักฐาน: login ตั้ง cookie httpOnly:false และ app/page.js เก็บ JWT ใน localStorage; `lib/auth.js:58` รับ token query และหน้าดาวน์โหลด/รูปใช้ token ใน URL

ผล: เพิ่มความเสียหายหากมี XSS และเพิ่มโอกาส token ถูกบันทึกใน history/access logs/ลิงก์ที่แชร์ ทั้งนี้ไม่ได้พบหรือพิสูจน์ XSS exploit ในการตรวจครั้งนี้

แก้: HttpOnly secure session cookie สำหรับเว็บ, scoped short-lived download token หรือ authenticated fetch/blob, referrer/cache policy ให้เหมาะกับข้อมูลพนักงาน

### F18 [P1] ปุ่มสำรองข้อมูลยังไม่ให้ชุดที่กู้คืนระบบได้ครบ

หลักฐาน: `app/api/hr/backup/route.js:20` export เฉพาะบางตาราง ไม่ตรวจ error ของผล query; documents ไม่มีไฟล์จริงและเนื้อหาครบ; ไม่มี role_permissions/time/shifts/balances/document_requests/assets/ฯลฯ หลายรายการ; audit จำกัด 1000

เพิ่ม: fallback users.select('*') อาจรวม password hash ในไฟล์ export และ fallback แบบ `data || ...` ไม่ทำงานเมื่อ table เดิมคืน []

แก้: แยกคำว่า data export ออกจาก disaster recovery backup, snapshot database+storage+schema+version, encryption/access log และซ้อม restore ใน environment ใหม่

### F19 [P2] อัปโหลดสำเร็จไม่ได้แปลว่า AI อ่านเอกสารได้

หลักฐาน: `app/api/documents/route.js:209` catch index failure แล้ว upload สำเร็จ; extractText อาจคืนข้อความว่าง/ถูกตัด 100,000 ตัวอักษร; PDF OCR fallback ใช้ Gemini เมื่อมี key

แก้: แสดงสถานะไฟล์และสถานะ AI แยกกัน: กำลังอ่าน/พร้อมใช้/อ่านไม่ได้/ต้องใส่รหัสผ่าน/ต้องตรวจ OCR; มี retry และประวัติ version/effective date; ระบุว่าการ OCR ผ่านผู้ให้บริการภายนอกเป็น flow ที่ต้องกำหนดนโยบายข้อมูล

ไฟล์ตัวอย่าง PDF ที่เข้ารหัสยังไม่ถูกตรวจรูปแบบ จึงยังสรุปความถูกต้องของสลิปหรือ 50 ทวิฉบับตัวอย่างไม่ได้ การพิมพ์ `window.print()` ยังต้องทดสอบ A4, ชื่อยาว, หลายหน้า, ฟอนต์ไทย และ Android WebView จริง

## 4. UX/UI เมนูและปุ่ม

แนวภาพรวมในซอร์สเป็นระบบทำงาน (Operate): มี token พื้นหลัง grouped/card, typography ไทย, sidebar เป็นหมวด และ bottom navigation เหมาะกับงาน HR/พนักงาน ควรรักษาความกระชับและลำดับงาน ยังไม่มีหลักฐานภาพจริงพอที่จะตัดสินสีสวย/คอนทราสต์ผ่าน/พื้นที่ไม่ล้น

### F20 [P1] Onboarding แสดงว่าทำสำเร็จจากค่าคงที่

`components/me/SecondaryTabs.js:2721` มี checklist 5 รายการ โดย 3 รายการ done:true โดยไม่อ่านสถานะรายบุคคล ทำให้ผู้ใช้เข้าใจว่าส่งเอกสาร/รับอุปกรณ์แล้ว

แก้: ผูก onboarding_checklists จริง พร้อม completed_at/completed_by/evidence และผู้รับผิดชอบ

### F21 [P2] สลับกะและสวัสดิการสัญญามากกว่าที่ทำได้

More menu ระบุว่ายื่นเปลี่ยนกะได้ แต่ `SecondaryTabs.js:2779` เป็นข้อความรอเปิด; BenefitsTab :2679 เป็นรายการคงที่ ไม่มีสิทธิ์เฉพาะราย/วงเงิน/การยื่นคำขอ

แก้: ทำ flow ให้ครบ หรือระบุว่าเป็นข้อมูลทั่วไป/ยังไม่เปิดและมีทางติดต่อที่ใช้งานได้จริง

### F22 [P1] More menu ใช้ div คลิกอย่างเดียว

`app/me/page.js:1164` ไม่มี button/link semantics และ keyboard handler ทำให้เข้าถึงเมนูส่วนสำคัญด้วย keyboard ไม่ได้

แก้: ใช้ button หรือ link เต็มแถว คง label และ focus-visible; bottom navigation ใช้ aria-current สำหรับ navigation หรือทำ tab pattern ให้ครบ

### F23 [P1] ฟอร์มกลางและ confirm dialog ยังจัดการ focus ไม่ครบ

`ResourceTable.js:837` modal ไม่มี role=dialog/aria-modal/focus trap/Escape/restore focus และปิดจาก backdrop ได้ขณะบันทึก; labels ที่ :846 และฟอร์มลาไม่ผูก htmlFor/id

ConfirmDialog มี role/initial focus/Escape แล้ว แต่ยังไม่มี Tab trap/restore focus

แก้: accessible modal กลาง ป้องกัน dirty form loss, ปิด backdrop ระหว่าง save, ชื่อฟอร์ม/error summary/field error และ focus กลับปุ่มเดิม

### F24 [P1] Error state บางหน้าเงียบหรือชี้วิธีแก้ผิด

Dashboard `app/hr/page.js:31` กลืน catch แล้ว skeleton ค้าง; คำขอเอกสารใน SecondaryTabs กลืน error คล้ายไม่มีข้อมูล; employee รวม network failure กับ session expired; clock catch บางกรณีรายงานเป็น GPS แม้ fetch/JSON ล้มเหลว

แก้: แยก loading/empty/error/unauthorized/offline, ปุ่มลองใหม่, คงข้อมูลเดิมเมื่อ refresh พลาด และ error message บอกงานที่ล้มเหลวจริง

### F25 [P1] Bulk action บอกสำเร็จไม่ครบความจริง

`ResourceTable.js:465` และ :494 นับ success อย่างเดียวแล้วล้างรายการเลือกแม้มีบางรายการไม่สำเร็จ

แก้: สรุป สำเร็จ X/ไม่สำเร็จ Y พร้อมแถวที่ผิด เหตุผล และ retry เฉพาะ failed; ห้ามผู้ใช้ต้องเทียบยอดเอง

### F26 [P2] เมนูย่อยและสิทธิ์ยังมีเส้นทางไม่ตรงกัน

`app/hr/layout.js:209` ตัด hiddenInSidebar ออกจาก sidebar แต่ subnav ที่ :392 ไม่กรอง allowedMenus ร่วมกัน ผู้มีสิทธิ์เฉพาะ child อาจไม่มีทางคลิกเข้า หรือเห็นแท็บที่ API ไม่อนุญาต

แก้: navigation tree กลาง parent/child/action รวม allowed state และเลือก landing route แรกที่มีสิทธิ์

### F27 [P2] เมนูเพิ่มเติม 18–19 รายการทำให้งานหัวหน้าถูกฝัง

มีแบ่งกลุ่มแล้วแต่ไม่มีค้นหา/โปรด/ล่าสุด งานรออนุมัติควรเห็นตั้งแต่หน้าแรกของหัวหน้า

แก้: แสดง pending approvals พร้อม badge และ 3–4 quick actions ตาม role, เพิ่มค้นหาเมนูและรายการโปรด ไม่เพิ่มแท็บหลักตามจำนวนโมดูล

### F28 [P2] draft และ deep link ยังไม่มั่นคง

form state อยู่ใน tab ที่ unmount เมื่อเปลี่ยนหน้า; app/me เริ่ม home และอ่าน hash ใน popstate handler โดยไม่ restore ตอน mount

แก้: restore initial route/hash, URL ที่สื่อถึงหน้าปลายทาง, draft ตามผู้ใช้ที่มีอายุ/ล้างเมื่อ logout, เตือนก่อนทิ้งข้อมูลสำคัญ

### F29 [P2] ปุ่มไอคอนและภาษาบางจุดต้องปรับ

`hr.css:491` icon button 32×32; documents delete emoji ไม่มีชื่อที่อธิบายรายการ; collapsed sidebar พึ่ง title; คำว่า RAG/Re-index เป็นศัพท์ implementation

แก้: เป้าสัมผัสบนมือถือประมาณ 44–48px, aria-label ที่บอก action+ชื่อรายการ, tooltip สำหรับ desktop และใช้ “คลังเอกสารและความรู้”/“อัปเดตข้อมูลให้ AI” ทั้งนี้ 32px อย่างเดียวไม่พอจะตัดสินว่าไม่ผ่าน WCAG เพราะต้องตรวจ spacing และ exception จริง

### F30 [P2] token/theme ใช้ไม่สม่ำเสมอและ reduced motion หยาบ

มี tokens อยู่แล้ว แต่หลายหน้าใช้ inline hex และ globals.css:152 บังคับทุก animation/transition เป็น 0.01ms

แก้: ใช้ semantic tokens ร่วมกันและกำหนด reduced-motion ราย component ให้ feedback สำคัญยังชัด ไม่ให้คะแนน contrast หรือ performance จนกว่าจะวัด runtime

### F31 [P1] Service worker precache รวม route ที่ไม่มีอยู่

`public/sw.js:6` ใส่ /chat ใน cache.addAll แต่ repo ไม่มี app/chat และ local server ตอบ GET /chat 404; promise install จึงเสี่ยง reject ทั้งชุด

แก้: precache เฉพาะ asset/route ที่รับรองว่ามีและ cache ได้อย่างปลอดภัย, version manifest, test install/upgrade/offline และตั้ง offline API response เป็น status 503 แทนค่า default 200

## 5. โครงเมนูและพฤติกรรมปุ่มที่เสนอ

### HR

| กลุ่ม | เมนูหลัก | สิ่งที่แสดงอันดับแรก |
|---|---|---|
| งานวันนี้ | ภาพรวม, กล่องงานรออนุมัติ | จำนวน pending, งานผิดปกติ, ใกล้ครบกำหนด |
| บุคลากร | พนักงาน, องค์กร, สรรหา, ปฐมนิเทศ | ผู้รับผิดชอบ สถานะ และงานค้าง |
| เวลาและการลา | ลงเวลา, ตารางกะ, การลา, ปฏิทินวันหยุด | ข้อยกเว้นและรายการต้องตรวจ |
| เงินและสวัสดิการ | เงินเดือน, OT, เบิกจ่าย, สวัสดิการ, ประกันสังคม | งวดปัจจุบันและยอด reconcile |
| เอกสารและข่าวสาร | เอกสาร, คำขอรับรอง, ประกาศ | สถานะเอกสาร/การอ่าน/วันมีผล |
| งานสนับสนุนและพัฒนา | ทรัพย์สิน, ห้องประชุม, อบรม, ประเมินผล/OKR | งานที่ยังต้องทำและสถานะคำขอ |
| ตั้งค่าและรายงาน | รายงาน, master data, สิทธิ์, integrations | เฉพาะหน้าที่ role นั้นใช้ได้ |

ไม่จำเป็นต้องเปลี่ยนชื่อ/ย้ายทุกหน้าในครั้งเดียว ควรเริ่มจากกล่องงานรออนุมัติและ permission-aware navigation ซึ่งให้ผลต่อประสิทธิภาพมากกว่าแต่ง dashboard

### แอพพนักงาน

- รักษา bottom navigation จำนวนจำกัด: หน้าหลัก, เวลา/กะ, การลา, ผู้ช่วย, เพิ่มเติม ตามผลทดสอบผู้ใช้จริง
- หน้าหลักควรตอบทันทีว่า วันนี้ทำงานที่ไหน เข้างานหรือยัง มีคำขอใดรอผล และต้องทำอะไรต่อ
- หัวหน้าเห็น “รอคุณอนุมัติ” พร้อมจำนวนและปลายทางตรงรายการ; พนักงานทั่วไปไม่เห็นงานที่ใช้ไม่ได้
- งานเงิน/เอกสารอยู่ใน More ที่ค้นหาได้ และปักทางลัดได้; notification เปิดถึงคำขอ/สลิปนั้นโดยตรง
- GPS แสดง สำนักงาน/นอกสถานที่ ตามสิทธิ์ พร้อมจุดที่อนุญาต ความแม่นยำ ระยะห่าง และวิธีแจ้งปัญหา โดยแยกปัญหาเครือข่ายออกจาก permission

### มาตรฐานปุ่ม

| ประเภท | พฤติกรรมที่ควรมี |
|---|---|
| ปุ่มหลัก | หนึ่งการกระทำหลักต่อบริบท เช่น ส่งใบลา/บันทึก ไม่ใช้สีเด่นทุกปุ่ม |
| ส่งคำขอ | แสดงข้อมูลสรุป ปิดซ้ำขณะส่ง success มีเลขอ้างอิงและขั้นตอนถัดไป |
| อนุมัติ/ปฏิเสธ | เห็นผู้ยื่น ช่วงเวลา ยอดคงเหลือ/ผลกระทบ เหตุผลปฏิเสธ และยืนยันเฉพาะผลสำคัญ |
| ยืนยันจ่าย | สรุปงวด จำนวนคน ยอดรวม สิ่งที่ไม่พร้อม ก่อน action และตรวจสถานะ server อีกครั้ง |
| ลบ | ระบุผลกระทบ หลีกเลี่ยงลบธุรกรรมที่ออกเอกสารแล้ว ใช้ยกเลิก/กลับรายการตามนโยบาย |
| ดาวน์โหลด | ระบุชนิดไฟล์/สถานะพร้อมใช้ error ที่ retry ได้ รองรับ WebView download/print |
| แก้ไข | draft เท่านั้นสำหรับธุรกรรมสำคัญ; แสดง revision/history เมื่ออนุญาต |
| Bulk | จำนวนที่เลือก ผลต่อรายการ อนุญาตเฉพาะ transition ที่ทำได้ แสดง partial failure ชัดเจน |

## 6. คะแนน UX เบื้องต้น

| Nielsen heuristic | /4 | เหตุผล |
|---|---:|---|
| เห็นสถานะระบบ | 2 | toast/loading มี แต่ static done/silent failure |
| ภาษาตรงงานจริง | 3 | ภาษาไทยตามงานชัดหลายจุด มี RAG/re-index |
| ควบคุมและย้อนกลับ | 2 | back/history มี แต่ draft และ initial route ยังขาด |
| ความสม่ำเสมอ | 2 | components กลางดี แต่ modal/nav semantics ไม่ครบ |
| ป้องกันข้อผิดพลาด | 2 | disable/confirm มี แต่ข้อมูลลาและ workflow ยังไม่รัดกุม |
| เห็นแล้วเข้าใจได้ | 2 | แบ่งหมวด แต่ More ยาวและงานหัวหน้าถูกฝัง |
| ประสิทธิภาพผู้ใช้ชำนาญ | 3 | bulk/search/export มี |
| ความกระชับและลำดับ | 2 | โครงสร้างพอประเมินได้ ยังไม่ยืนยันภาพจริง |
| การกู้คืน error | 1 | บางจุดค้าง/เงียบ/ชี้ให้ login ใหม่ |
| ความช่วยเหลือและเอกสาร | 2 | มีคู่มือ แต่ล้าสมัยและไม่ครอบคลุม flow |
| รวม | **21/40** | ประเมินจากซอร์ส ไม่ใช่ visual/usability certification |

Technical audit: accessibility มีข้อบกพร่องยืนยันจาก semantics; theming มี tokens แต่ drift; responsive มี breakpoint/safe-area/touch size บางส่วน แต่ยังไม่ได้ทดสอบ runtime; performance ยังไม่มีตัวเลขวัด จึงไม่ให้คะแนนรวม /20 ที่อาจทำให้เข้าใจว่าได้ทดสอบครบ

จุดแข็งที่ควรรักษา: เมนูกลางและ permission key, ResourceTable ที่ reuse ได้, search/export/bulk, employee dynamic imports, ปุ่ม clock มี loading และปิดระหว่างส่ง, focus-visible styles, mobile navigation บางส่วนสูง 48px, audit/notification ใน workflow หลัก

## 7. คู่มือและเอกสารประกอบระบบ

### F32 [P1] คู่มือ deploy/backup ไม่สอดคล้องกับระบบปัจจุบัน

- README บอกข้อมูลอยู่ JSON ใน data/ และสำรองด้วย copy folder ทั้งที่ db.js ใช้ Supabase
- README บอกไม่เหมาะ Vercel แต่ Capacitor ชี้ URL Vercel และ DEPLOY-LOCAL มีหัวข้อย้าย Supabase แล้ว
- README/DEPLOY อ้าง .env.example แต่ไม่พบไฟล์นี้ใน root ที่ตรวจ
- DEPLOY-LOCAL ให้รัน schema.sql ครั้งเดียว แต่ repository มี schema-hr, RAG, phase1–20 โดยไม่มี migration runner/รายการลำดับที่ชัดในคู่มือ
- LINE onboarding ในคู่มือใช้แค่รหัสพนักงาน ต่างจาก webhook ที่ต้อง password และยังมีข้อบกพร่อง bcrypt
- ยังไม่มี PRODUCT.md/DESIGN.md คู่มือผู้ใช้แยก role หรือ runbook ที่สอดคล้องกับ HR suite ทั้งชุด

แก้: สร้าง source of truth เรื่อง environment/deploy/backend; env template ไม่มี secret; migration manifest/version; คู่มือ HR/พนักงาน/หัวหน้า/Admin; release checklist และ disaster recovery runbook ที่ทดสอบจริง

ชุดคู่มือที่ควรมี: (1) HR รายวัน/ปิดงวด (2) พนักงานลา/ลงเวลา/เอกสาร (3) หัวหน้าอนุมัติทีม (4) Admin role/integration/backup (5) Payroll และ reconciliation (6) Troubleshooting GPS/บัญชี/ไฟล์/LINE (7) Document lifecycle/เวอร์ชัน/เพิกถอน (8) Data retention และผู้รับผิดชอบ

## 8. ลำดับการปรับปรุง

| ระยะ | งาน | เกณฑ์รับมอบ |
|---|---|---|
| 1 ความถูกต้อง | F01–F12 โดยเน้น payroll state/idempotency, leave transaction, LINE, GPS validation | input เดิมยอดเดิม, จ่ายแล้วไม่แก้, approve ซ้ำไม่ตัดซ้ำ, ลาครึ่งวันไม่สูญช่วงเวลา |
| 2 เอกสารและสิทธิ์ | F13–F18 และ F32 | เอกสารเลขเดิมคงข้อมูล, role/active guard สม่ำเสมอ, restore ข้อมูลครบใน environment ใหม่ |
| 3 งานใช้งานประจำ | F20–F28 และ F31 | ไม่มี static completion, retry ทำงาน, ไม่สูญ draft, keyboard ใช้เมนูและ modal ได้, SW install สำเร็จ |
| 4 เก็บรายละเอียด | F19/F29/F30, responsive, typography, performance, help | ตรวจภาพจริง desktop/mobile, 200% zoom, screen reader, metrics และเอกสารผู้ใช้ครบ |

ไม่กำหนดจำนวนวันก่อนทราบ staging/ผู้รับผิดชอบ payroll/ข้อมูล migration เพราะงานแก้ยอดและประวัติเดิมต้องมี reconciliation เพิ่ม ไม่ใช่แก้โค้ดอย่างเดียว

คำสั่ง skill ที่เหมาะ: `/impeccable harden` สำหรับ errors/forms, `/impeccable clarify` สำหรับข้อความ, `/impeccable adapt` สำหรับมือถือ/target size, `/impeccable document` สำหรับ design system, `/impeccable audit` ตรวจซ้ำหลังแก้ และ `/impeccable polish` เป็นขั้นสุดท้าย งานธุรกรรม/backend ต้องแก้และทดสอบ logic โดยตรง ไม่ใช่ใช้คำสั่งดีไซน์แทน

## 9. กรณีทดสอบรับมอบที่ยังต้องทำ

1. Payroll generate ซ้ำโดยมี expense/bonus แล้วได้ยอดคงเดิม รวมกรณี overwrite และ partial DB failure
2. paid → ส่งแจ้งเตือน → 50 ทวิ/CSV ต้องยังรวมยอดเดิม; ส่งล้มเหลวต้องไม่แสดงส่งสำเร็จ
3. ฐาน/เพดาน SSO ตามงวดก่อนและหลังวันที่มีผล และค่าปรับเฉพาะราย
4. รายวัน/รายเดือน/เริ่มงานกลางงวด/ลาไม่รับค่าจ้างข้ามเดือน และแยกเงินคืนค่าใช้จ่าย
5. ยื่นลาครึ่งเช้า/บ่าย, หลายวัน, ข้ามปี, วันหยุด, ชนกะ/ใบลาเดิม, โควตา pending
6. อนุมัติซ้ำพร้อมกัน, update กลางทางล้มเหลว, ยกเลิกและคืนโควตา ทำให้ยอดทุกตารางสอดคล้องกัน
7. JWT ของผู้ถูกระงับ/ลบ/ลดสิทธิ์ต้องถูกปฏิเสธทุก API ที่เกี่ยวข้อง
8. Employee/manager/HR/custom role ตรวจทั้งเมนู ปุ่ม API เอกสาร รูป และข้อมูลข้ามทีม/สาขา
9. ผูก LINE จากผู้ใช้ bcrypt จริงด้วย flow ปลอดภัยและทดสอบบัญชี inactive/rate limiting
10. ออกหนังสือรับรองแล้วแก้ salary/position/company/asset เอกสารเก่าต้องคงเนื้อหาเดิม
11. Restore backup ใน environment ใหม่พร้อมไฟล์ เอกสาร สิทธิ์ โควตา และประวัติ
12. PWA install/update/offline และ Android GPS permission denied/slow network/back/download/print/push
13. Keyboard-only, NVDA/VoiceOver, modal focus, labels, zoom 200%, มือถือ 360/390/430px และ desktop
14. PDF A4 ฟอนต์ไทย ชื่อ/ตำแหน่งยาว หน่วยงานยาว หลายหน้า และตัวอย่างจริงที่ได้รับรหัสเปิดไฟล์

Questions skipped: คำขอนี้เป็นการวิเคราะห์ จึงส่งข้อค้นพบและแผนรับมอบได้โดยไม่ต้องรออนุมัติการแก้ไข ไม่มีการแก้ application code หรือเปลี่ยนข้อมูลธุรกิจ
