import { supabase } from '../lib/supabase.js';

async function seed() {
  console.log('🚀 เริ่มต้นการสร้าง Mockup Data สำหรับทุกโมดูลในระบบ HR Pro Suite...\n');

  // 1. Positions
  console.log('📌 1. Positions (ตำแหน่งงาน)');
  const positions = [
    { title: 'ผู้จัดการฝ่ายขนส่ง', department_code: 'TR-001', level: 'บริหาร', description: 'บริหารจัดการงานขนส่งและทีมคนขับรถ' },
    { title: 'หัวหน้าแผนกคลังสินค้า', department_code: 'WH-001', level: 'หัวหน้างาน', description: 'บริหารคลังสินค้า ตรวจนับสต็อก และกระจายสินค้า' },
    { title: 'ธุรการขนส่ง', department_code: 'TR-001', level: 'ปฏิบัติการ', description: 'ประสานงานเที่ยววิ่งและเอกสารจัดส่ง' },
    { title: 'พนักงานขับรถขนส่ง (4 ล้อ)', department_code: 'TR-001', level: 'ปฏิบัติการ', description: 'ส่งสินค้าตามรอบวิ่งในเขตกรุงเทพและปริมณฑล' },
    { title: 'พนักงานขับรถขนส่ง (6 ล้อ)', department_code: 'TR-001', level: 'ปฏิบัติการ', description: 'ส่งสินค้าสายใต้และกระจายสินค้าศูนย์สุราษฎร์ฯ' },
    { title: 'พนักงานคลังสินค้า', department_code: 'WH-001', level: 'ปฏิบัติการ', description: 'จัดเก็บ เบิกจ่าย และยกแพ็คสินค้า' },
    { title: 'เจ้าหน้าที่ฝ่ายบุคคล', department_code: 'DDHR-001', level: 'ปฏิบัติการ', description: 'สรรหา ดูแลสวัสดิการ และการลงเวลาพนักงาน' },
    { title: 'เจ้าหน้าที่การเงินและบัญชี', department_code: 'ACC-001', level: 'ปฏิบัติการ', description: 'ทำรอบจ่ายเงินเดือน ภาษี และเบิกจ่ายค่าใช้จ่าย' },
  ];
  for (const p of positions) {
    await supabase.from('positions').upsert(p, { onConflict: 'title' });
  }
  console.log('   ✅ บันทึกตำแหน่งงานเรียบร้อย');

  // 2. Holidays 2026
  console.log('📌 2. Holidays (วันหยุดประจำปี 2569)');
  const holidays = [
    { holiday_date: '2026-01-01', name: 'วันขึ้นปีใหม่', note: 'หยุดทุกสาขา' },
    { holiday_date: '2026-04-13', name: 'วันสงกรานต์', note: 'หยุดทุกสาขา' },
    { holiday_date: '2026-04-14', name: 'วันสงกรานต์', note: 'หยุดทุกสาขา' },
    { holiday_date: '2026-04-15', name: 'วันสงกรานต์', note: 'หยุดทุกสาขา' },
    { holiday_date: '2026-05-01', name: 'วันแรงงานแห่งชาติ', note: 'หยุดทุกสาขา' },
    { holiday_date: '2026-07-28', name: 'วันเฉลิมพระชนมพรรษา ร.10', note: 'หยุดทุกสาขา' },
    { holiday_date: '2026-12-05', name: 'วันคล้ายวันพระบรมราชสมภพ ร.9 / วันพ่อแห่งชาติ', note: 'หยุดทุกสาขา' },
    { holiday_date: '2026-12-31', name: 'วันสิ้นปี', note: 'หยุดทุกสาขา' },
  ];
  for (const h of holidays) {
    const { data: exist } = await supabase.from('holidays').select('id').eq('holiday_date', h.holiday_date).maybeSingle();
    if (!exist) await supabase.from('holidays').insert(h);
  }
  console.log('   ✅ บันทึกวันหยุดประจำปีเรียบร้อย');

  // 3. Shift Patterns & Shifts
  console.log('📌 3. Shift Patterns & Shifts (รูปแบบกะและการจัดกะ)');
  const patterns = [
    { name: 'กะปกติ (ออฟฟิศ/ธุรการ)', shift_type: 'normal', start_time: '08:30', end_time: '17:30' },
    { name: 'กะเช้า (งานวิ่งรถ/คลัง)', shift_type: 'morning', start_time: '06:00', end_time: '15:00' },
    { name: 'กะบ่าย (งานวิ่งรถ/คลัง)', shift_type: 'afternoon', start_time: '14:00', end_time: '23:00' },
  ];
  for (const sp of patterns) {
    const { data: exist } = await supabase.from('shift_patterns').select('id').eq('name', sp.name).maybeSingle();
    if (!exist) await supabase.from('shift_patterns').insert(sp);
  }

  const shifts = [
    { employee_id: 'DD-001', shift_date: '2026-11-02', shift_type: 'normal', start_time: '08:30', end_time: '17:30', note: 'กะประจำวันจันทร์' },
    { employee_id: 'DD-001', shift_date: '2026-11-03', shift_type: 'normal', start_time: '08:30', end_time: '17:30', note: 'กะประจำวันอังคาร' },
    { employee_id: 'DD-DRV01', shift_date: '2026-11-02', shift_type: 'morning', start_time: '06:00', end_time: '15:00', note: 'วิ่งสายสมุทรสาคร-สุราษฎร์' },
    { employee_id: 'DD-DRV01', shift_date: '2026-11-03', shift_type: 'morning', start_time: '06:00', end_time: '15:00', note: 'วิ่งสายสมุทรสาคร-สุราษฎร์' },
  ];
  for (const s of shifts) {
    const { data: exist } = await supabase.from('shifts').select('id').eq('employee_id', s.employee_id).eq('shift_date', s.shift_date).maybeSingle();
    if (!exist) await supabase.from('shifts').insert(s);
  }
  console.log('   ✅ บันทึกรูปแบบกะและการจัดกะเรียบร้อย');

  // 4. Time Records (การลงเวลาทำงาน)
  console.log('📌 4. Time Records (ประวัติการลงเวลาทำงาน)');
  const timeRecords = [
    { employee_id: 'DD-001', work_date: '2026-10-27', clock_in: '08:25:00', clock_out: '17:32:00', status: 'present', note: 'ตรงเวลา' },
    { employee_id: 'DD-001', work_date: '2026-10-28', clock_in: '08:42:00', clock_out: '17:40:00', status: 'late', note: 'สาย 12 นาที การจราจรติดขัด' },
    { employee_id: 'DD-001', work_date: '2026-10-29', clock_in: '08:20:00', clock_out: '18:30:00', status: 'present', note: 'ตรงเวลา + ทำ OT' },
    { employee_id: 'DD-DRV01', work_date: '2026-10-28', clock_in: '05:55:00', clock_out: '15:10:00', status: 'present', note: 'วิ่งรถตรวจเช็คสภาพพร้อม' },
    { employee_id: 'DD-DRV01', work_date: '2026-10-29', clock_in: '06:00:00', clock_out: '15:05:00', status: 'present', note: 'วิ่งรถส่งสินค้าครบถ้วน' },
  ];
  for (const tr of timeRecords) {
    const { data: exist } = await supabase.from('time_records').select('id').eq('employee_id', tr.employee_id).eq('work_date', tr.work_date).maybeSingle();
    if (!exist) await supabase.from('time_records').insert(tr);
  }
  console.log('   ✅ บันทึกประวัติเวลาเข้า-ออกงานเรียบร้อย');

  // 5. Expense Claims (การเบิกค่าใช้จ่าย)
  console.log('📌 5. Expense Claims (คำขอเบิกค่าใช้จ่าย)');
  const expenses = [
    { employee_id: 'DD-001', claim_date: '2026-10-25', category: 'travel', amount: 350, description: 'ค่าเดินทางพบลูกค้าติดต่องานขนส่งพิเศษ', status: 'approved', approved_by: 'วิชัย หัวหน้างาน' },
    { employee_id: 'DD-001', claim_date: '2026-10-28', category: 'meal', amount: 200, description: 'ค่าอาหารปฏิบัติงานล่วงเวลางวดปิดบัญชี', status: 'pending', approved_by: null },
    { employee_id: 'DD-DRV01', claim_date: '2026-10-26', category: 'travel', amount: 1200, description: 'ค่าน้ำมันสำรองจ่ายเส้นทางสุราษฎร์ฯ', status: 'paid', approved_by: 'สมศรี ฝ่ายบุคคล' },
  ];
  for (const ex of expenses) {
    const { data: exist } = await supabase.from('expense_claims').select('id').eq('employee_id', ex.employee_id).eq('claim_date', ex.claim_date).eq('amount', ex.amount).maybeSingle();
    if (!exist) await supabase.from('expense_claims').insert(ex);
  }
  console.log('   ✅ บันทึกรายการเบิกค่าใช้จ่ายเรียบร้อย');

  // 6. Benefits & Loans (สวัสดิการและเงินกู้ยืม)
  console.log('📌 6. Benefits & Loans (สวัสดิการและเงินกู้ยืม)');
  const benefits = [
    { employee_id: 'DD-001', type: 'loan', name: 'เงินกู้สวัสดิการพนักงานฉุกเฉิน', amount: 15000, start_date: '2026-01-01', end_date: '2026-12-31', status: 'active', note: 'ผ่อนเดือนละ 1,250 บาท (12 งวด)' },
    { employee_id: 'DD-DRV01', type: 'benefit', name: 'ประกันอุบัติเหตุกลุ่มคุ้มครองพิเศษคนขับรถ', amount: 200000, start_date: '2026-01-01', end_date: '2026-12-31', status: 'active', note: 'บริษัทออกค่าเบี้ยให้ 100%' },
  ];
  for (const b of benefits) {
    const { data: exist } = await supabase.from('benefits_loans').select('id').eq('employee_id', b.employee_id).eq('name', b.name).maybeSingle();
    if (!exist) await supabase.from('benefits_loans').insert(b);
  }
  console.log('   ✅ บันทึกสวัสดิการและเงินกู้ยืมเรียบร้อย');

  // 7. Social Security (ประกันสังคม)
  console.log('📌 7. Social Security (สิทธิ์ประกันสังคม)');
  const ssos = [
    { employee_id: 'DD-001', sso_number: '1234567890123', hospital: 'โรงพยาบาลสมุทรสาคร', registered_date: '2024-01-22', monthly_contribution: 750, status: 'active' },
    { employee_id: 'DD-DRV01', sso_number: '9876543210987', hospital: 'โรงพยาบาลสุราษฎร์ธานี', registered_date: '2024-03-01', monthly_contribution: 750, status: 'active' },
    { employee_id: 'DD-HR01', sso_number: '1122334455667', hospital: 'โรงพยาบาลสมุทรสาคร', registered_date: '2023-05-01', monthly_contribution: 750, status: 'active' },
    { employee_id: 'DD-MGR01', sso_number: '5544332211009', hospital: 'โรงพยาบาลสมุทรสาคร', registered_date: '2022-01-15', monthly_contribution: 750, status: 'active' },
  ];
  for (const s of ssos) {
    const { data: exist } = await supabase.from('social_security').select('id').eq('employee_id', s.employee_id).maybeSingle();
    if (!exist) await supabase.from('social_security').insert(s);
  }
  console.log('   ✅ บันทึกข้อมูลประกันสังคมเรียบร้อย');

  // 8. Meeting Rooms & Bookings (ห้องประชุมและการจอง)
  console.log('📌 8. Meeting Rooms & Bookings (ห้องประชุม)');
  const rooms = [
    { name: 'ห้องประชุมใหญ่ (สำนักงานใหญ่ ชั้น 2)', capacity: 20, equipment: 'Smart TV 75", ไมค์ประชุมไร้สาย, Whiteboard, Zoom Room', status: 'available' },
    { name: 'ห้องประชุมย่อย A (ศูนย์กระจายสินค้า สุราษฎร์ฯ)', capacity: 8, equipment: 'Smart TV 55", กระดานไวท์บอร์ด', status: 'available' },
  ];
  const roomIds = {};
  for (const r of rooms) {
    const { data: exist } = await supabase.from('meeting_rooms').select('id, name').eq('name', r.name).maybeSingle();
    if (exist) {
      roomIds[r.name] = exist.id;
    } else {
      const { data: ins } = await supabase.from('meeting_rooms').insert(r).select('id, name').single();
      roomIds[r.name] = ins.id;
    }
  }

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
  const bookings = [
    { room_id: roomIds['ห้องประชุมใหญ่ (สำนักงานใหญ่ ชั้น 2)'], employee_id: 'DD-MGR01', title: 'ประชุมสรุปแผนงานขนส่งประจำสัปดาห์', book_date: today, start_time: '10:00', end_time: '11:30', status: 'confirmed' },
    { room_id: roomIds['ห้องประชุมย่อย A (ศูนย์กระจายสินค้า สุราษฎร์ฯ)'], employee_id: 'DD-001', title: 'ประชุมตรวจนับสินค้าคงคลังประจำเดือน', book_date: today, start_time: '14:00', end_time: '15:00', status: 'confirmed' },
  ];
  for (const bk of bookings) {
    if (!bk.room_id) continue;
    const { data: exist } = await supabase.from('room_bookings').select('id').eq('room_id', bk.room_id).eq('book_date', bk.book_date).maybeSingle();
    if (!exist) await supabase.from('room_bookings').insert(bk);
  }
  console.log('   ✅ บันทึกห้องประชุมและการจองเรียบร้อย');

  // 9. Assets (ทรัพย์สินบริษัท)
  console.log('📌 9. Assets (ทรัพย์สินบริษัท)');
  const assets = [
    { code: 'VH-001', name: 'รถกระบะขนส่งตู้ทึบ Isuzu D-Max (ทะเบียน 3ฒข-8899 กทม.)', category: 'ยานพาหนะ', assigned_to: 'DD-DRV01', assigned_date: '2024-03-01', status: 'assigned', note: 'รถตรวจเช็คระยะ 50,000 กม. แล้ว' },
    { code: 'VH-002', name: 'รถบรรทุก 6 ล้อ Hino 500 (ทะเบียน 71-4567 สุราษฎร์ธานี)', category: 'ยานพาหนะ', assigned_to: 'DD-DRV01', assigned_date: '2024-04-15', status: 'assigned', note: 'ติดตั้งระบบ GPS Tracking เรียบร้อย' },
    { code: 'IT-001', name: 'โน้ตบุ๊ก Dell Latitude 5420 (SN: DL5420-9988)', category: 'ไอที/คอมพิวเตอร์', assigned_to: 'DD-001', assigned_date: '2024-01-22', status: 'assigned', note: 'สำหรับงานระบบจัดการขนส่ง TMS' },
    { code: 'EQ-001', name: 'เครื่องสแกนบาร์โค้ด Zebra TC21 (ประจำคลังสุราษฎร์ฯ)', category: 'อุปกรณ์คลัง', assigned_to: 'DD-001', assigned_date: '2024-02-10', status: 'assigned', note: 'เครื่องสภาพสมบูรณ์ แบตเตอรี่ 100%' },
    { code: 'IT-002', name: 'แท็บเล็ต Samsung Galaxy Tab A9 ประจำรถ', category: 'ไอที/คอมพิวเตอร์', assigned_to: null, assigned_date: null, status: 'available', note: 'อุปกรณ์สำรองพร้อมจ่ายงาน' },
  ];
  for (const a of assets) {
    const { data: exist } = await supabase.from('assets').select('id').eq('code', a.code).maybeSingle();
    if (!exist) await supabase.from('assets').insert(a);
  }
  console.log('   ✅ บันทึกทรัพย์สินบริษัทเรียบร้อย');

  // 10. Announcements (ข่าวประชาสัมพันธ์)
  console.log('📌 10. Announcements (ข่าวประชาสัมพันธ์)');
  const announcements = [
    {
      title: '🚨 ข้อควรปฏิบัติเพื่อความปลอดภัยในการขับขี่ช่วงมรสุมและฝนตกหนัก',
      body: 'แจ้งเตือนพนักงานขับรถขนส่งทุกท่าน โปรดลดความเร็วในการขับขี่ ตรวจเช็คสภาพยางปัดน้ำฝนและระบบเบรกก่อนออกเดินทางทุกครั้ง หากพบว่าทัศนวิสัยต่ำกว่า 20 เมตร ให้เปิดไฟฉุกเฉินและจอดพักในจุดปลอดภัยทันที',
      category: 'ความปลอดภัย',
      publish_date: '2026-10-25',
      pinned: true,
      author: 'ฝ่ายบริหารงานขนส่งและความปลอดภัย'
    },
    {
      title: '📢 กำหนดการตรวจสุขภาพประจำปี 2569 สำหรับพนักงานทุกสาขา',
      body: 'บริษัทฯ กำหนดจัดตรวจสุขภาพประจำปีในวันที่ 20 พ.ย. 2569 ณ สำนักงานใหญ่ สมุทรสาคร และวันที่ 25 พ.ย. 2569 ณ ศูนย์กระจายสินค้าสุราษฎร์ธานี พนักงานกรุณางดน้ำและอาหารหลังเวลา 20.00 น. ของวันก่อนตรวจ',
      category: 'สวัสดิการ',
      publish_date: '2026-10-28',
      pinned: false,
      author: 'ฝ่ายทรัพยากรบุคคล'
    }
  ];
  for (const ann of announcements) {
    const { data: exist } = await supabase.from('announcements').select('id').eq('title', ann.title).maybeSingle();
    if (!exist) await supabase.from('announcements').insert(ann);
  }
  console.log('   ✅ บันทึกข่าวประกาศเรียบร้อย');

  // 11. Document Assets (ตราประทับและลายเซ็น)
  console.log('📌 11. Document Assets (ตราประทับบริษัทและลายเซ็นผู้มีอำนาจ)');
  const docAssets = [
    {
      asset_type: 'company_stamp',
      name: 'ตราประทับ บริษัท ดีดี เซอร์วิส แอนด์ ทรานสปอร์ต จำกัด',
      signer_name: 'บริษัท ดีดี เซอร์วิส แอนด์ ทรานสปอร์ต จำกัด',
      signer_title: 'ตราประทับนิติบุคคล',
      image_url: '/brand/company-stamp.png',
      active: true,
      note: 'ตราประทับอย่างเป็นทางการสำหรับหนังสือรับรอง'
    },
    {
      asset_type: 'signature',
      name: 'ลายเซ็น กรรมการผู้จัดการ (คุณประเสริฐ ยิ่งเจริญ)',
      signer_name: 'นายประเสริฐ ยิ่งเจริญ',
      signer_title: 'กรรมการผู้จัดการ',
      image_url: '/brand/md-signature.png',
      active: true,
      note: 'ผู้มีอำนาจลงนามรับรองเอกสารพนักงาน'
    }
  ];
  for (const da of docAssets) {
    const { data: exist } = await supabase.from('document_assets').select('id').eq('name', da.name).maybeSingle();
    if (!exist) await supabase.from('document_assets').insert(da);
  }
  console.log('   ✅ บันทึกตราประทับและลายเซ็นเรียบร้อย');

  // 12. Recruitment & Applicants (การสรรหาและผู้สมัคร)
  console.log('📌 12. Recruitment & Applicants (การสรรหาบุคลากร)');
  const openings = [
    { title: 'พนักงานขับรถบรรทุก 6 ล้อ (ขนส่งสายใต้)', department_code: 'TR-001', headcount: 2, status: 'open', description: 'มีใบขับขี่ประเภท ท.2 หรือ ท.3 มีประสบการณ์ขับรถส่งสินค้าสายใต้', posted_date: '2026-10-20' },
    { title: 'เจ้าหน้าที่คลังสินค้าและตรวจนับสต็อก', department_code: 'WH-001', headcount: 1, status: 'open', description: 'ดูแลรับเข้า-จ่ายออก ตรวจสอบยอดสต็อก และจัดเรียงสินค้าตามหมวดหมู่', posted_date: '2026-10-22' },
  ];
  const openingIds = {};
  for (const op of openings) {
    const { data: exist } = await supabase.from('job_openings').select('id, title').eq('title', op.title).maybeSingle();
    if (exist) {
      openingIds[op.title] = exist.id;
    } else {
      const { data: ins } = await supabase.from('job_openings').insert(op).select('id, title').single();
      openingIds[op.title] = ins.id;
    }
  }

  const applicants = [
    { name: 'นายมานะ ขยันขับ', email: 'mana.driver@email.com', phone: '081-9988776', position_applied: 'พนักงานขับรถบรรทุก 6 ล้อ (ขนส่งสายใต้)', opening_id: openingIds['พนักงานขับรถบรรทุก 6 ล้อ (ขนส่งสายใต้)'], status: 'interview', applied_date: '2026-10-24', note: 'มีใบขับขี่ ท.2 ประสบการณ์ 5 ปี นัดสัมภาษณ์ 2 พ.ย.' },
    { name: 'นายประสิทธิ์ คลังมั่น', email: 'prasit.wh@email.com', phone: '089-1122334', position_applied: 'เจ้าหน้าที่คลังสินค้าและตรวจนับสต็อก', opening_id: openingIds['เจ้าหน้าที่คลังสินค้าและตรวจนับสต็อก'], status: 'applied', applied_date: '2026-10-27', note: 'ใช้โปรแกรม WMS และขับรถโฟล์คลิฟท์ได้' },
  ];
  for (const app of applicants) {
    const { data: exist } = await supabase.from('applicants').select('id').eq('email', app.email).maybeSingle();
    if (!exist) await supabase.from('applicants').insert(app);
  }
  console.log('   ✅ บันทึกตำแหน่งงานเปิดรับและผู้สมัครเรียบร้อย');

  // 13. Trainings (หลักสูตรอบรม)
  console.log('📌 13. Trainings (การพัฒนาและฝึกอบรม)');
  const trainings = [
    { title: 'หลักสูตรเทคนิคการขับขี่เชิงป้องกันอุบัติเหตุ (Defensive Driving)', trainer: 'สถาบันความปลอดภัยการขนส่งทางบก', train_date: '2026-11-15', hours: 6, location: 'ห้องประชุมใหญ่ HQ สมุทรสาคร', participants: 'พนักงานขับรถทุกคน', status: 'scheduled' },
    { title: 'การควบคุมมาตรฐานสุขอนามัยและความปลอดภัยในคลังสินค้า (5ส & Safety)', trainer: 'วิทยากรภายใน (ฝ่ายปฏิบัติการ)', train_date: '2026-10-10', hours: 4, location: 'ศูนย์กระจายสินค้า สุราษฎร์ฯ', participants: 'พนักงานคลังสินค้าทุกคน', status: 'completed' },
  ];
  for (const t of trainings) {
    const { data: exist } = await supabase.from('trainings').select('id').eq('title', t.title).maybeSingle();
    if (!exist) await supabase.from('trainings').insert(t);
  }
  console.log('   ✅ บันทึกคอร์สอบรมเรียบร้อย');

  // 14. Company Trips (ทริปท่องเที่ยวบริษัท)
  console.log('📌 14. Company Trips (ทริปบริษัท)');
  const trips = [
    { title: 'ทริปสัมมนาและท่องเที่ยวประจำปี 2569 (หัวหิน ชะอำ)', destination: 'หัวหิน จ.ประจวบคีรีขันธ์ (3 วัน 2 คืน)', start_date: '2026-12-18', end_date: '2026-12-20', budget: 150000, participants: 'พนักงานประจำทุกท่าน', status: 'planned' }
  ];
  for (const tr of trips) {
    const { data: exist } = await supabase.from('company_trips').select('id').eq('title', tr.title).maybeSingle();
    if (!exist) await supabase.from('company_trips').insert(tr);
  }
  console.log('   ✅ บันทึกทริปบริษัทเรียบร้อย');

  // 15. Evaluations & OKRs (การประเมินและ OKR)
  console.log('📌 15. Evaluations & OKRs');
  const evaluations = [
    { employee_id: 'DD-001', period: '2026-H1', score: 88, grade: 'A', evaluator: 'วิชัย หัวหน้างาน', comments: 'ทำงานละเอียดรอบคอบ ประสานงานเที่ยววิ่งได้ดีเยี่ยม ไม่มีข้อผิดพลาด', status: 'completed' },
    { employee_id: 'DD-DRV01', period: '2026-H1', score: 92, grade: 'A', evaluator: 'วิชัย หัวหน้างาน', comments: 'ตรงต่อเวลา รักษาความปลอดภัยดีเยี่ยม สินค้าไม่เคยเสียหาย', status: 'completed' },
  ];
  for (const ev of evaluations) {
    const { data: exist } = await supabase.from('evaluations').select('id').eq('employee_id', ev.employee_id).eq('period', ev.period).maybeSingle();
    if (!exist) await supabase.from('evaluations').insert(ev);
  }

  const okrs = [
    { employee_id: 'DD-001', objective: 'เพิ่มประสิทธิภาพความแม่นยำในการจัดเที่ยววิ่งและส่งมอบตรงเวลา', key_results: 'อัตราการส่งมอบตรงเวลา (On-Time Delivery) >= 98%', period: '2026-Q4', progress: 95, status: 'on_track' },
    { employee_id: 'DD-DRV01', objective: 'ขับขี่ปลอดภัย 0 อุบัติเหตุและสินค้าสมบูรณ์ 100%', key_results: 'สถิติอุบัติเหตุเป็น 0 ตลอดทั้งไตรมาส', period: '2026-Q4', progress: 100, status: 'achieved' },
  ];
  for (const okr of okrs) {
    const { data: exist } = await supabase.from('okrs').select('id').eq('employee_id', okr.employee_id).eq('objective', okr.objective).maybeSingle();
    if (!exist) await supabase.from('okrs').insert(okr);
  }
  console.log('   ✅ บันทึกผลการประเมินและ OKRs เรียบร้อย');

  console.log('\n🎉 สร้าง Mockup Data ครบถ้วนทุกโมดูล 100% เรียบร้อยแล้ว!');
}

seed().catch((err) => {
  console.error('❌ เกิดข้อผิดพลาดในการสร้าง Mockup Data:', err);
  process.exit(1);
});
