import { filterDocumentsByRole, getRoleContext, canAccessEmployeeData } from './permissions.js';
import { getDocuments, getEmployeeRecord } from './db.js';
import { chunkText, retrieveChunks } from './rag.js';
import { llmProvider, llmAvailable, chatComplete } from './llm.js';
import { supabase } from './supabase.js';

const COMPANY_PROFILE = `ข้อมูลบริบทของบริษัท ดีดี เซอร์วิส แอนด์ ทรานสปอร์ต จำกัด (DD Service and Transport Co., Ltd.):
- บริษัทดำเนินธุรกิจด้านการให้บริการโลจิสติกส์ การขนส่งสินค้า และการบริหารจัดการคลังสินค้า (Warehouse Management)
- สายงานหลักของบริษัทประกอบด้วย:
  1. **งานขนส่งหลัก (TT - Trunk Transportation)**: งานขนส่งสายหลักระยะไกล/ปริมาณมาก ขนถ่ายระหว่างคลังสินค้าหรือศูนย์กระจายสินค้า
  2. **งานกระจายสินค้า (MT - Milk-run / Multiple Transportation)**: งานขนส่งกระจายสินค้าไปยังจุดส่งมอบปลายทาง เช่น ร้านค้า สาขา หรือลูกค้าปลายทาง
  3. **งานบริหารจัดการคลังสินค้า (Warehouse)**: การรับเข้า ตรวจนับ จัดเก็บ บรรจุหีบห่อ และเบิกจ่ายสินค้า
  4. **งานสำนักงานและสนับสนุน**: ธุรการขนส่ง, การเงิน/บัญชี, จัดซื้อ, ซ่อมบำรุง, และงานทรัพยากรบุคคล (HR)
- ประเภทของรถและผู้ขับขี่:
  - **รถบริษัท (Company Fleet)**: รถของบริษัท พนักงานขับรถเป็นพนักงานประจำ มีสวัสดิการและเงินเดือน/เบี้ยเลี้ยงตามเกณฑ์พนักงาน
  - **รถร่วม (Sub-contract / Partner Fleet)**: รถของผู้ประกอบการภายนอกที่ร่วมวิ่งงาน มีสัญญาจ้างขนส่งและการคำนวณรายได้ตามเที่ยว/สัญญา ซึ่งมีระเบียบวินัยด้านความปลอดภัยร่วมกัน`;

const SYSTEM_PROMPT = `คุณคือ "พี่ HR" (เจ้าหน้าที่ฝ่ายทรัพยากรบุคคลมืออาชีพ) ของบริษัท ดีดี เซอร์วิส แอนด์ ทรานสปอร์ต จำกัด
เป้าหมายของคุณคือ ตอบคำถามและให้คำปรึกษาแก่พนักงานเสมือน HR ตัวจริง: ถูกต้อง แม่นยำ กระชับ ตรงประเด็น และนำไปปฏิบัติได้ทันที

แนวทางการตอบคำถาม (HR Professional Guidelines):
1. **กระชับ ตรงประเด็น (Concise & Direct):**
   - **บรรทัดแรก**: สรุปคำตอบตรงๆ ให้ทันทีอย่างชัดเจน
   - **เงื่อนไขสำคัญ**: อธิบายเป็น Bullet points สั้นๆ 2-4 ข้อ (ไม่เยิ่นเย้อ)
   - **ขั้นตอนถัดไป (Next Steps)**: บอกชัดเจนว่าต้องทำอย่างไรต่อ เช่น ทำรายการที่เมนูใดในระบบ หรือติดต่อใคร
   - ความยาวคำตอบให้อยู่ในระดับกระชับ 4-7 บรรทัด อ่านเข้าใจง่าย

2. **การอ้างอิงข้อมูล (Fact-based Citing):**
   - หากมี "ข้อมูลอ้างอิงจากเอกสารบริษัท": ยึดตามเอกสารนั้นเป็นหลัก และระบุชื่อเอกสารอ้างอิงให้ชัดเจน
   - หากไม่มีเอกสารบริษัทระบุ: ให้ตอบตามหลักกฎหมายแรงงานไทยและแนวปฏิบัติของธุรกิจขนส่งอย่างระมัดระวัง พร้อมระบุชัดเจนว่าเป็น "แนวปฏิบัติตามกฎหมายแรงงานทั่วไป แนะนำยืนยันกับฝ่ายบุคคลอีกครั้ง"
   - ห้ามเดาตัวเลขที่ไม่มีข้อมูลอ้างอิงเด็ดขาด

3. **ความปลอดภัย PDPA (Strict PDPA):**
   - ห้ามเปิดเผยข้อมูลส่วนบุคคล เงินเดือน ยอดวันลา หรือบทลงโทษของพนักงานท่านอื่นเด็ดขาด`;

const STOPWORDS = new Set([
  'ขอ', 'ถาม', 'อยาก', 'ทราบ', 'หน่อย', 'ครับ', 'ค่ะ', 'คะ', 'มี', 'คือ', 'อะไร',
  'ยังไง', 'อย่างไร', 'ได้ไหม', 'ได้มั้ย', 'บริษัท', 'เอกสาร', 'ระเบียบ',
]);

function publicDocument(doc) {
  if (!doc) return null;
  const { content, accessRoles, uploadedBy, storedFileName, ...safe } = doc;
  return safe;
}

function publicDocuments(docs = []) {
  return docs.map(publicDocument).filter(Boolean);
}

function normalizeHistory(history = []) {
  if (!Array.isArray(history)) return '';
  return history
    .slice(-6)
    .map((m) => {
      const role = m.role === 'ai' || m.role === 'assistant' ? 'พี่ HR' : 'พนักงาน';
      return `${role}: ${String(m.content || '').replace(/\s+/g, ' ').slice(0, 500)}`;
    })
    .filter((line) => line.length > 5)
    .join('\n');
}

function tokenize(text) {
  if (!text) return [];
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    try {
      const segmenter = new Intl.Segmenter('th', { granularity: 'word' });
      const words = [];
      for (const seg of segmenter.segment(text)) {
        if (seg.isWordLike) {
          const w = seg.segment.trim().toLowerCase();
          if (w.length >= 2 && !STOPWORDS.has(w)) {
            words.push(w);
          }
        }
      }
      if (words.length > 0) return words;
    } catch {}
  }
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

function keywordSearchChunks(question, docs, topK = 5) {
  const terms = tokenize(question);
  if (terms.length === 0) return [];

  const scored = [];
  for (const doc of docs) {
    const name = `${doc.name || ''} ${doc.fileName || ''}`.toLowerCase();
    const chunks = chunkText(doc.content || '').slice(0, 80);
    chunks.forEach((content, index) => {
      const haystack = `${name}\n${content}`.toLowerCase();
      let hits = 0;
      for (const term of terms) {
        if (haystack.includes(term)) hits += name.includes(term) ? 2 : 1;
      }
      if (hits > 0) {
        scored.push({
          documentId: doc.id,
          docName: doc.name,
          content,
          similarity: Math.min(0.58, 0.34 + (hits / Math.max(terms.length, 3)) * 0.24),
          lexicalScore: hits,
          chunkIndex: index,
        });
      }
    });
  }

  return scored
    .sort((a, b) => b.lexicalScore - a.lexicalScore || a.chunkIndex - b.chunkIndex)
    .slice(0, topK);
}

function cleanSectionText(text) {
  return String(text || '')
    .replace(/\n--\s*\d+\s+of\s+\d+\s*--/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * ประกอบข้อมูลบริบทของผู้ถามอย่างครบถ้วน (Enriched Employee Context)
 */
async function buildUserContext(user, channel) {
  let profile = null;
  if (user?.employeeId) {
    try {
      profile = await getEmployeeRecord(user.employeeId);
    } catch (err) {
      console.error('getEmployeeRecord context error:', err);
    }
  }

  const dept = profile?.department || user?.department || '';
  const pos = profile?.position || '';
  const empType = profile?.employmentType === 'monthly' ? 'พนักงานประจำรายเดือน' : profile?.employmentType === 'daily' ? 'พนักงานรายวัน' : 'สัญญาจ้าง/รถร่วม';

  // จำแนกกลุ่มงานเพื่อส่งบริบทให้ AI
  let workGroup = 'พนักงานทั่วไป';
  if (/ขับรถ|คนขับ|ขนส่ง|สายส่ง|tt|mt/i.test(dept + pos)) {
    workGroup = 'สายงานปฏิบัติการขนส่ง/พนักงานขับรถ';
  } else if (/คลัง|warehouse|สต็อก/i.test(dept + pos)) {
    workGroup = 'สายงานคลังสินค้า';
  } else if (/ธุรการ|บัญชี|การเงิน|it|admin|hr/i.test(dept + pos)) {
    workGroup = 'สายงานสำนักงาน/ธุรการ';
  }

  return [
    `ช่องทางสนทนา: ${channel === 'LINE' ? 'LINE Official Account' : 'เว็บ HR Pro Suite'}`,
    `ชื่อพนักงาน: คุณ ${user?.name || 'พนักงาน'} (รหัส: ${user?.employeeId || '-'})`,
    `แผนก: ${dept || '-'}`,
    `ตำแหน่ง: ${pos || '-'}`,
    `กลุ่มสายงาน: ${workGroup}`,
    `รูปแบบการจ้าง: ${empType}`,
    `วันเริ่มงาน: ${profile?.startDate || '-'}`,
    `สถานะทดลองงาน/ผ่านโปร: ${profile?.probationEnd ? `สิ้นสุดวันที่ ${profile.probationEnd}` : 'ผ่านการทดลองงานแล้ว'}`,
    `วันหมดอายุใบอนุญาตขับขี่: ${profile?.licenseExpiry || '(ไม่มีระบุในระบบ/ไม่ใช่ตำแหน่งคนขับ)'}`,
    `บทบาท/Role ในระบบ: ${user?.role || 'employee'}`,
  ].join('\n');
}

/**
 * วิเคราะห์ intent อย่างชาญฉลาด แยกคำถามข้อมูลส่วนบุคคลและการตรวจจับ PDPA
 */
export function analyzeIntent(message) {
  const msg = message.toLowerCase().trim();

  // 1. ตรวจจับการละเมิด PDPA: ถามข้อมูลของพนักงานท่านอื่น
  const isCrossEmployeeQuery =
    /(ดู|เช็ค|ถาม|ขอ).*(ข้อมูล|วันลา|เงินเดือน|ประวัติ|ใบเตือน|เบอร์โทร).*(ของ|นาย|นาง|นางสาว|พนักงานอื่น|คนอื่น)/.test(msg) ||
    /วันลาของ\s*([a-zA-Z0-9_\u0E00-\u0E7F]+)/.test(msg);

  if (isCrossEmployeeQuery) {
    return { type: 'cross_employee_query' };
  }

  // เช็คว่าประโยคนี้เป็นคำถามหรือการปรึกษาหรือไม่
  const isQuestion = /(กี่วัน|กี่ชม|กี่ชั่วโมง|เท่าใด|เท่าไหร่|ยังไง|อย่างไร|ทำไม|เมื่อไหร่|วันไหน|ขั้นตอน|ระเบียบ|ข้อกำหนด|เงื่อนไข|มีผล|ได้ไหม|ได้มั้ย|หรือไม่|หรือเปล่า|มีสิทธิ์|ขอล่วงหน้า|ส่งที่ไหน|ใครอนุมัติ|บทลงโทษ|กี่ครั้ง|กี่เปอร์เซ็นต์|ช่วยอธิบาย|สอบถาม|ถามเรื่อง|มีอะไรบ้าง)/.test(msg);

  // 2. ถามยอดวันลาคงเหลือของตัวเอง (Data Query: Leave)
  const isDirectLeaveBalance =
    /^(วันลา|ลาพักร้อน|ลาป่วย|ลากิจ|เช็ควันลา|ดูวันลา|วันลาคงเหลือ|ยอดวันลา|ลาเหลือ)$/.test(msg) ||
    (msg.includes('เหลือ') && (msg.includes('วันลา') || msg.includes('พักร้อน') || msg.includes('ลาป่วย') || msg.includes('ลากิจ'))) ||
    msg.match(/^leave\s*balance$/i);

  if (isDirectLeaveBalance) {
    return { type: 'data_query', dataType: 'leave' };
  }

  // 3. ถามเวลาเข้างาน / เช็คอิน / สถิติเข้างานวันนี้
  if (/เช็คอิน|เข้างาน|ออกงาน|เวลาเข้า|ลงเวลา|สถิติเข้างาน|เวลาทำงาน/i.test(msg) && /ดู|เช็ค|ตรวจ|วันนี้|ของฉัน|เท่าไหร่|ประวัติ|กี่โมง/.test(msg)) {
    return { type: 'data_query', dataType: 'attendance' };
  }

  // 4. ถามวันหมดอายุใบอนุญาตขับขี่ (Data Query: License Expiry)
  if (/ใบขับขี่|ใบอนุญาตขับขี่|license/i.test(msg) && /หมด|วันไหน|เมื่อไหร่|ต่อ|ดู|เช็ค|ตรวจ/.test(msg)) {
    return { type: 'data_query', dataType: 'license' };
  }

  // 5. ถามเรื่องสถานะการทดลองงาน / ผ่านโปร (Data Query: Probation)
  if (/ผ่านโปร|ทดลองงาน|probation/i.test(msg)) {
    return { type: 'data_query', dataType: 'probation' };
  }

  // 6. ถามประเภทการจ้างงาน / สัญญาของตนเอง (Data Query: Employment)
  if (/ประเภท.*จ้าง|สัญญา.*หมด|หมดสัญญา|พนักงานประเภท/i.test(msg)) {
    return { type: 'data_query', dataType: 'employment' };
  }

  // 7. ถามดูโปรไฟล์ส่วนตัวตรงๆ
  if (/^(โปรไฟล์|ข้อมูลฉัน|ข้อมูลตัวเอง|ประวัติส่วนตัว|profile|my info)$/.test(msg)) {
    return { type: 'data_query', dataType: 'profile' };
  }

  // 8. ถามเรื่องห้องประชุม / การจองห้องประชุม
  if (/ห้องประชุม|จองห้อง|meeting room/i.test(msg)) {
    return { type: 'data_query', dataType: 'rooms' };
  }

  // 9. ถามเรื่องสลิปเงินเดือน / เงินเดือนล่าสุด
  if (/สลิป|เงินเดือน|payslip|salary/i.test(msg) && /ดู|เช็ค|ตรวจ|ออกยัง|เข้ายัง|ล่าสุด|ของฉัน|ขอดู|เท่าไหร่/.test(msg)) {
    return { type: 'data_query', dataType: 'payslip' };
  }

  // 10. ถามสถานะ OT ล่าสุด
  if (/ot|ค่าล่วงเวลา/i.test(msg) && /สถานะ|อนุมัติยัง|ผ่านยัง|ผลการขอ|คำขอ/.test(msg)) {
    return { type: 'data_query', dataType: 'ot' };
  }

  // 11. ถามสถานะการเบิกจ่าย / ค่าใช้จ่าย
  if (/เบิก|ค่าใช้จ่าย|expense/i.test(msg) && /สถานะ|อนุมัติยัง|จ่ายยัง|ผลการเบิก|คำขอ/.test(msg)) {
    return { type: 'data_query', dataType: 'expenses' };
  }

  // 12. ถามเรื่องหนังสือรับรองหักภาษี 50 ทวิ
  if (/50\s*ทวิ|หนังสือรับรองหักภาษี|หัก\s*ณ\s*ที่จ่าย|tax\s*cert/i.test(msg)) {
    return { type: 'data_query', dataType: 'tax_cert' };
  }

  // 13. ถามเรื่องแบบลดหย่อนภาษี (ลย.01)
  if (/ลดหย่อนภาษี|ลย\.?\s*01|tax\s*deduction|tax\s*allowance/i.test(msg)) {
    return { type: 'data_query', dataType: 'allowance' };
  }

  // 14. ขอเฉพาะไฟล์แบบฟอร์มอย่างเดียว หรือพิมพ์ชื่อเอกสารเพื่อดาวน์โหลด (Direct Download Request)
  // 14.1 ถามหารายการแบบฟอร์มทั้งหมดที่มีให้โหลด
  if (/^(มี.*(ฟอร์ม|แบบฟอร์ม|เอกสาร).*โหลด|ขอ.*(รายการ|รายชื่อ).*(ฟอร์ม|แบบฟอร์ม)|ขอ.*(ฟอร์ม|แบบฟอร์ม)$|โหลดฟอร์ม|ขอเอกสารดาวน์โหลด|แบบฟอร์มทั้งหมด|รายการแบบฟอร์ม)/i.test(msg)) {
    return { type: 'document_request', docName: 'all_templates' };
  }

  // 14.2 ขอเอกสาร/แบบฟอร์มเฉพาะเจาะจง
  const hasDownloadIntent =
    /^(ขอ|ขอดูไฟล์|ขอโหลด|ดาวน์โหลด|download|โหลด|ขอไฟล์|ขอเอกสาร|ขอแบบฟอร์ม|ขอฟอร์ม|ขอเทมเพลต|ขอ template|ส่งไฟล์|ส่งฟอร์ม|อยากได้|เอาไฟล์|มีไฟล์)\s*/i.test(msg) ||
    /(ใบสมัคร|ใบสมัครงาน|แบบฟอร์มใบสมัคร|ใบลา|แบบฟอร์มใบลา|ฟอร์มใบลา|หนังสือเตือน|แบบฟอร์มหนังสือเตือน|รายงานการสอบสวน|รายงานการสอบสวนอุบัติเหตุ|หัวกระดาษ|หัวกระดาษกลางบริษัท|ใบวางบิล|ใบเสนอราคา|ใบแจ้งหนี้|สัญญาจ้างรถร่วม|สัญญาเช่าซื้อรถยนต์|ผลการตรวจปัสวะ|ผลการตรวจปัสสาวะ|template_employees)/i.test(msg);

  if (!isQuestion && hasDownloadIntent) {
    if (msg.includes('สมัคร')) return { type: 'document_request', docName: 'ใบสมัครงาน' };
    if (msg.includes('ลา')) return { type: 'document_request', docName: 'ใบลา' };
    if (msg.includes('ประเมิน')) return { type: 'document_request', docName: 'แบบประเมินผล' };
    if (msg.includes('วางบิล')) return { type: 'document_request', docName: 'ใบวางบิล' };
    if (msg.includes('เสนอราคา')) return { type: 'document_request', docName: 'ใบเสนอราคา' };
    if (msg.includes('แจ้งหนี้')) return { type: 'document_request', docName: 'ใบแจ้งหนี้' };
    if (msg.includes('สัญญา')) return { type: 'document_request', docName: 'สัญญา' };
    if (/ปัสวะ|ปัสสาวะ|สารเสพติด/i.test(msg)) return { type: 'document_request', docName: 'ปัสวะ' };
    if (/เตือน/i.test(msg)) return { type: 'document_request', docName: 'เตือน' };
    if (/สอบสวน|อุบัติเหตุ/i.test(msg)) return { type: 'document_request', docName: 'สอบสวน' };
    if (/หัวกระดาษ/i.test(msg)) return { type: 'document_request', docName: 'หัวกระดาษ' };

    let docKeyword = msg
      .replace(/^(ขอ|ขอดูไฟล์|ขอโหลด|ดาวน์โหลด|download|โหลด|ขอไฟล์|ขอเอกสาร|ขอแบบฟอร์ม|ขอฟอร์ม|ขอเทมเพลต|ขอ template|ส่งไฟล์|ส่งฟอร์ม|อยากได้|เอาไฟล์|มีไฟล์)\s*/i, '')
      .replace(/ให้หน่อย|หน่อย|ครับ|ค่ะ|คะ|นะ|นะคะ|หน่อยครับ|หน่อยค่ะ/g, '')
      .trim();
    if (docKeyword) return { type: 'document_request', docName: docKeyword };
  }

  // 15. กรณีอื่นๆ ทั้งหมด ให้ส่งเข้าสู่กระบวนการ AI (Policy / General Q&A / Consult)
  return { type: 'consult_or_policy' };
}

/**
 * ค้นหาเอกสารที่ผู้ใช้มีสิทธิ์เข้าถึง (ฟิลเตอร์ตาม Role และ ID)
 */
async function findRelevantDocuments(intent, userRole, employeeId) {
  const allDocs = await getDocuments();
  return filterDocumentsByRole(allDocs, userRole, employeeId);
}

/**
 * ดึงข้อมูลพนักงาน
 */
async function getEmployeeData(employeeId) {
  return getEmployeeRecord(employeeId);
}

/**
 * ฟังก์ชันหลักในการสร้างคำตอบ
 */
export async function generateResponse(message, user, options = {}) {
  const intent = analyzeIntent(message);
  const channel = options.channel || 'PWA';
  const historyText = normalizeHistory(options.history);
  const userContext = await buildUserContext(user, channel);

  // ===== 0. ตรวจสอบการละเมิด PDPA (ถามเรื่องคนอื่น) =====
  if (intent.type === 'cross_employee_query') {
    // ถ้าไม่ใช่ Admin หรือ HR ให้บล็อกทันที
    if (user.role !== 'admin' && user.role !== 'hr') {
      return {
        text: `🔒 **ขออภัยนะคะคุณ ${user.name || ''}**\n\nข้อมูลส่วนบุคคล เงินเดือน วันลา และประวัติการทำงานของพนักงานท่านอื่น ถือเป็นข้อมูลส่วนบุคคลที่มีการคุ้มครองตามพระราชบัญญัติคุ้มครองข้อมูลส่วนบุคคล (PDPA) และนโยบายความลับของบริษัท ดีดี เซอร์วิส แอนด์ ทรานสปอร์ต จำกัด\n\nพี่ HR จึงไม่สามารถเปิดเผยข้อมูลของพนักงานท่านอื่นได้ค่ะ หากเป็นเรื่องงานที่จำเป็น กรุณาประสานงานผ่านหัวหน้างานสายตรงนะคะ`,
        documents: [],
        intent: 'pdpa_restriction',
        source: 'pdpa-guard',
      };
    }
  }

  // ===== 1. TIER 0: จัดการคำสั่งขอไฟล์แบบฟอร์มตรงๆ (Pure Document Request) =====
  if (intent.type === 'document_request') {
    const accessibleDocs = await findRelevantDocuments(intent, user.role, user.employeeId);

    // 1.1 กรณีขอแบบฟอร์มใบลา: ชี้แจงระบบยื่นลาออนไลน์ (Paperless)
    if (intent.docName === 'ใบลา') {
      return {
        text: `สวัสดีค่ะคุณ ${user.name || ''} 🏖️\n\nบริษัท ดีดี เซอร์วิส แอนด์ ทรานสปอร์ต จำกัด ใช้ระบบ **"ยื่นใบลาแบบออนไลน์" (Paperless)** โดยไม่ต้องพิมพ์กระดาษใบลาแล้วค่ะ\n\nคุณ ${user.name || ''} สามารถเข้ายื่นใบลาได้ง่ายๆ เพียงทำตามนี้ค่ะ:\n1. เข้าหน้าพนักงานที่ลิงก์: https://hr-ai-chatbot-tawny.vercel.app/me\n2. ไปที่เมนู **"🏖️ ลางาน"** หรือกดปุ่ม **"🌐 ยื่นลาในระบบ"** ด้านล่าง\n3. เลือกประเภทการลา (ลาป่วย/ลากิจ/พักร้อน), ระบุวันที่ และกดยื่นคำขอได้ทันที\n\nระบบจะส่งการแจ้งเตือนไปยังหัวหน้างานเพื่ออนุมัติอัตโนมัติค่ะ`,
        documents: [],
        intent: 'leave_submit_guide',
        source: 'system-guide',
      };
    }

    // 1.2 กรณีถามหารายการแบบฟอร์มทั้งหมดที่มีให้โหลด
    if (intent.docName === 'all_templates') {
      const templateDocs = accessibleDocs.filter((d) => d.category === 'templates');
      const docList = templateDocs.map((d, i) => `${i + 1}. 📄 **${d.name}** (${(d.type || '').toUpperCase()})`).join('\n');
      return {
        text: `สวัสดีค่ะคุณ ${user.name || ''} 📂\nแบบฟอร์มและเอกสารที่คุณสามารถดาวน์โหลดได้ในระบบ มีดังนี้ค่ะ:\n\n${docList || 'ขณะนี้ยังไม่มีแบบฟอร์มที่เปิดให้ดาวน์โหลด'}\n\n💡 *วิธีขอไฟล์: คุณสามารถพิมพ์ชื่อเอกสาร เช่น "ขอใบสมัครงาน", "ขอหนังสือเตือน", "ขอใบวางบิล" หรือ "ขอใบเสนอราคา" เพื่อรับปุ่มดาวน์โหลดไฟล์จริงได้ทันทีนะคะ*`,
        documents: publicDocuments(templateDocs.slice(0, 3)),
        intent: intent.type,
        source: 'document-direct',
      };
    }

    let matchedDoc = null;

    if (intent.docName) {
      const q = intent.docName.toLowerCase().replace(/\s+/g, '');
      matchedDoc = accessibleDocs.find((d) => {
        const name = (d.name || '').toLowerCase().replace(/\s+/g, '');
        return name.includes(q) || q.includes(name);
      });

      if (!matchedDoc && /ปัสวะ|ปัสสาวะ|สารเสพติด/.test(q)) {
        matchedDoc = accessibleDocs.find((d) => /ปัสวะ|ปัสสาวะ|สารเสพติด/i.test(d.name || ''));
      }
    }

    if (!matchedDoc) {
      const cleanMsg = message.trim().toLowerCase().replace(/\s+/g, '');
      matchedDoc = accessibleDocs.find((d) => {
        const dClean = (d.name || '').trim().toLowerCase().replace(/\s+/g, '');
        return dClean === cleanMsg || (dClean.length >= 4 && cleanMsg.includes(dClean));
      });
    }

    if (matchedDoc) {
      return {
        text: `สวัสดีค่ะคุณ ${user.name || ''} 📄\nพี่ HR เตรียมเอกสาร **"${matchedDoc.name}"** ให้เรียบร้อยแล้วค่ะ\nคุณสามารถกดดาวน์โหลดไฟล์จริงได้จากปุ่มด้านล่างนี้เลยนะคะ`,
        documents: publicDocuments([matchedDoc]),
        intent: intent.type,
        source: 'document-direct',
      };
    }

    // ค้นหาแบบฟอร์มใกล้เคียงมาแนะนำ
    const templateDocs = accessibleDocs.filter((d) => d.category === 'templates');
    const sampleDocs = templateDocs.slice(0, 4).map((d) => `• "${d.name}"`).join('\n');

    return {
      text: `ขออภัยนะคะคุณ ${user.name || ''} พี่ HR ยังไม่พบไฟล์เอกสารตามที่คุณพิมพ์ในระบบค่ะ\n\n📌 **ตัวอย่างแบบฟอร์มที่มีให้ดาวน์โหลด:**\n${sampleDocs}\n\n💡 ลองพิมพ์ระบุชื่อ เช่น **"ขอใบสมัครงาน"** หรือ **"ขอหนังสือเตือน"** ได้เลยนะคะ`,
      documents: [],
      intent: intent.type,
      source: 'document-direct',
    };
  }

  // ===== 2. TIER 0: จัดการคำถามข้อมูลส่วนตัว (Direct Employee Data Queries) =====
  if (intent.type === 'data_query') {
    const targetEmployeeId = user.employeeId;
    if (!canAccessEmployeeData(user.role, targetEmployeeId, user.employeeId)) {
      return {
        text: '🔒 ขออภัยนะคะ คุณไม่มีสิทธิ์เข้าถึงข้อมูลของพนักงานท่านอื่นค่ะ',
        documents: [],
        intent: intent.type,
        source: 'system-data',
      };
    }

    const empData = await getEmployeeData(targetEmployeeId);

    // 2.1 ถามวันลาคงเหลือ
    if (intent.dataType === 'leave') {
      if (empData && empData.leave) {
        const lines = Object.values(empData.leave).map(
          (item) => `• **${item.label || item.code}**: ใช้ไป ${item.used} วัน | คงเหลือ **${item.remaining} วัน** (จากโควต้า ${item.total} วัน)`
        );
        return {
          text: `📅 **สรุปยอดวันลาคงเหลือของคุณ ${empData.name}**\n\n${lines.join('\n')}\n\n💡 *หากต้องการยื่นลา สามารถแจ้งพี่ HR หรือทำรายการผ่านเมนู "ขอลางาน" ในระบบได้เลยนะคะ*`,
          documents: [],
          intent: intent.type,
          source: 'system-data',
        };
      }
      return {
        text: `ขออภัยนะคะคุณ ${user.name || ''} ไม่พบข้อมูลสิทธิ์วันลาของคุณในระบบ กรุณาติดต่อฝ่ายบุคคลเพื่อตรวจสอบข้อมูลนะคะ`,
        documents: [],
        intent: intent.type,
        source: 'system-data',
      };
    }

    // 2.2 ถามวันหมดอายุใบอนุญาตขับขี่
    if (intent.dataType === 'license') {
      if (empData?.licenseExpiry) {
        return {
          text: `🪪 **ข้อมูลใบอนุญาตขับขี่ของคุณ ${empData.name}**\n\n• วันหมดอายุ: **${empData.licenseExpiry}**\n\n⚠️ *คำแนะนำ:* กฎความปลอดภัยบริษัทกำหนดให้ต่อใบขับขี่ล่วงหน้าอย่างน้อย 30 วันก่อนหมดอายุ เมื่อต่อเรียบร้อยแล้วอย่านำสำเนามาอัปเดตกับฝ่ายบุคคลด้วยนะคะ`,
          documents: [],
          intent: intent.type,
          source: 'system-data',
        };
      }
      return {
        text: `คุณ ${user.name || ''} คะ ในระบบยังไม่มีข้อมูลวันหมดอายุใบขับขี่ของคุณบันทึกไว้ (หรือตำแหน่งงานของคุณอาจไม่ใช่พนักงานขับรถ) หากเป็นพนักงานขับรถ สามารถส่งรูปถ่ายใบขับขี่ให้ฝ่ายบุคคลอัปเดตเข้าระบบได้เลยนะคะ`,
        documents: [],
        intent: intent.type,
        source: 'system-data',
      };
    }

    // 2.3 ถามสถานะทดลองงาน / ผ่านโปร
    if (intent.dataType === 'probation') {
      if (empData?.probationEnd) {
        const isPassed = new Date(empData.probationEnd) < new Date();
        return {
          text: `🎯 **สถานะการทดลองงานของคุณ ${empData.name}**\n\n• วันสิ้นสุดระยะเวลาทดลองงาน: **${empData.probationEnd}**\n• สถานะปัจจุบัน: **${isPassed ? 'ครบกำหนดระยะเวลาทดลองงานแล้ว (รอการประเมินยืนยันผลเป็นลายลักษณ์อักษร)' : 'อยู่ระหว่างการทดลองงาน'}**\n\nหากมีข้อสงสัยเรื่องการประเมินผลงาน สามารถสอบถามหัวหน้างานสายตรงหรือฝ่าย HR ได้เลยนะคะ`,
          documents: [],
          intent: intent.type,
          source: 'system-data',
        };
      }
      return {
        text: `คุณ ${user.name || ''} คะ ในระบบไม่ได้ระบุวันสิ้นสุดทดลองงานไว้ แสดงว่าคุณได้ผ่านการทดลองงานเป็นพนักงานประจำเรียบร้อยแล้วค่ะ (วันเริ่มงาน: ${empData?.startDate || '-'})`,
        documents: [],
        intent: intent.type,
        source: 'system-data',
      };
    }

    // 2.4 ถามประเภทการจ้างงาน / สัญญา
    if (intent.dataType === 'employment') {
      const typeLabel = empData?.employmentType === 'monthly' ? 'พนักงานประจำรายเดือน' : empData?.employmentType === 'daily' ? 'พนักงานรายวัน' : 'สัญญาจ้าง/รถร่วม';
      return {
        text: `💼 **รูปแบบการจ้างงานของคุณ ${empData?.name || user.name}**\n\n• ตำแหน่ง: **${empData?.position || '-'}**\n• แผนก: **${empData?.department || '-'}**\n• รูปแบบการจ้าง: **${typeLabel}**\n• วันเริ่มงาน: **${empData?.startDate || '-'}**${empData?.contractEnd ? `\n• วันสิ้นสุดสัญญา: **${empData.contractEnd}**` : ''}`,
        documents: [],
        intent: intent.type,
        source: 'system-data',
      };
    }

    // 2.5 ถามโปรไฟล์ส่วนตัว
    if (intent.dataType === 'profile') {
      if (empData) {
        const typeLabel = empData.employmentType === 'monthly' ? 'พนักงานประจำรายเดือน' : empData.employmentType === 'daily' ? 'พนักงานรายวัน' : 'สัญญาจ้าง/รถร่วม';
        return {
          text: `👤 **ข้อมูลพนักงาน: คุณ ${empData.name}**\n\n• รหัสพนักงาน: ${user.employeeId || '-'}\n• 🏢 แผนก: ${empData.department || '-'}\n• 💼 ตำแหน่ง: ${empData.position || '-'}\n• 📋 รูปแบบการจ้าง: ${typeLabel}\n• 📅 วันเริ่มงาน: ${empData.startDate || '-'}\n${empData.licenseExpiry ? `• 🪪 ใบขับขี่หมดอายุ: ${empData.licenseExpiry}\n` : ''}\nหากต้องการแก้ไขข้อมูลส่วนตัว สามารถแจ้งฝ่ายบุคคลได้ตลอดนะคะ`,
          documents: [],
          intent: intent.type,
          source: 'system-data',
        };
      }
    }

    // 2.6 ถามเรื่องห้องประชุม / การจองห้องประชุม
    if (intent.dataType === 'rooms') {
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
      const [{ data: rooms }, { data: bookings }] = await Promise.all([
        supabase.from('meeting_rooms').select('*').order('name'),
        supabase.from('room_bookings').select('*').eq('book_date', today).neq('status', 'cancelled').order('start_time'),
      ]);

      const roomList = (rooms || []).map((r) =>
        `• **${r.name}** (จุ ${r.capacity} คน) — ${r.status === 'available' ? 'พร้อมใช้งาน' : 'ปิดปรับปรุง'}`
      ).join('\n');

      const roomMap = new Map((rooms || []).map((r) => [r.id, r.name]));
      let bookingText = 'วันนี้ยังไม่มีการจองห้องประชุมค่ะ';
      if (bookings && bookings.length > 0) {
        bookingText = bookings.map((b) =>
          `• **${roomMap.get(b.room_id) || `ห้อง #${b.room_id}`}** (${(b.start_time || '').slice(0, 5)} - ${(b.end_time || '').slice(0, 5)} น.): ${b.title || 'ประชุม'}`
        ).join('\n');
      }

      return {
        text: `🎦 **ข้อมูลห้องประชุมและตารางการจองวันนี้ (${today})**\n\n**รายชื่อห้องประชุม:**\n${roomList || 'ยังไม่มีข้อมูลห้องประชุม'}\n\n**ตารางการจองวันนี้:**\n${bookingText}\n\n💡 *หากต้องการจองห้องประชุม สามารถเข้าทำรายการได้ที่เมนู "🎦 จองห้องประชุม" ในระบบพนักงาน (หน้า /me) ได้ทันทีค่ะ*`,
        documents: [],
        intent: intent.type,
        source: 'system-data',
      };
    }

    // 2.7 ถามเรื่องสลิปเงินเดือน / เงินเดือนล่าสุด
    if (intent.dataType === 'payslip') {
      const { data: slips } = await supabase
        .from('payroll_slips')
        .select('*')
        .eq('employee_id', targetEmployeeId)
        .order('period', { ascending: false })
        .limit(3);

      if (!slips || slips.length === 0) {
        return {
          text: `คุณ ${user.name || ''} คะ ในระบบยังไม่มีข้อมูลสลิปเงินเดือนของคุณ หากเพิ่งเริ่มงานในงวดนี้ สลิปจะออกอัตโนมัติเมื่อฝ่ายบุคคลดำเนินการสรุปและยืนยันรอบจ่ายเงินเดือนนะคะ`,
          documents: [],
          intent: intent.type,
          source: 'system-data',
        };
      }

      const latest = slips[0];
      const isPaid = latest.status === 'paid';
      const fmt = (v) => Number(v || 0).toLocaleString('th-TH');

      const text =
        `💰 **สรุปสลิปเงินเดือนล่าสุดของคุณ ${user.name || ''} (งวด ${latest.period})**\n\n` +
        `• 💵 เงินเดือน/ค่าจ้างฐาน: ${fmt(latest.base_salary)} บาท\n` +
        `• ⏱️ ค่าล่วงเวลา (OT): +${fmt(latest.ot_pay)} บาท\n` +
        `• 🎁 โบนัส/ค่าตอบแทนพิเศษ: +${fmt(latest.bonus)} บาท\n` +
        `• 🛡️ หักประกันสังคม: -${fmt(latest.sso)} บาท\n` +
        `• 🧾 หักภาษี ณ ที่จ่าย: -${fmt(latest.tax)} บาท\n` +
        (Number(latest.deduction) > 0 ? `• 📉 หักอื่นๆ: -${fmt(latest.deduction)} บาท\n` : '') +
        `━━━━━━━━━━━━\n` +
        `✨ **รับสุทธิ: ${fmt(latest.net)} บาท**\n` +
        `📊 สถานะ: **${isPaid ? '✅ จ่ายเรียบร้อยแล้ว' : '⏳ รออนุมัติจ่ายเงินเดือน'}**\n\n` +
        `💡 *คุณสามารถเปิดดูสลิปฉบับเต็มและสั่งพิมพ์ PDF ได้ที่เมนู "💰 เงินเดือน" ในระบบพนักงาน (หน้า /me) ได้เลยค่ะ*`;

      return {
        text,
        documents: [],
        intent: intent.type,
        source: 'system-data',
      };
    }

    // 2.8 ถามเรื่องหนังสือรับรองหักภาษี ณ ที่จ่าย 50 ทวิ
    if (intent.dataType === 'tax_cert') {
      const currentYearCE = new Date().getFullYear();
      const currentYearBE = currentYearCE + 543;
      const { data: slips } = await supabase
        .from('payroll_slips')
        .select('*')
        .eq('employee_id', targetEmployeeId)
        .like('period', `${currentYearCE}-%`);

      const rows = slips || [];
      const sum = (k) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
      const totalIncome = sum('base_salary') + sum('ot_pay') + sum('bonus');
      const totalTax = sum('tax');
      const totalSso = sum('sso');
      const fmt = (v) => Number(v || 0).toLocaleString('th-TH');

      const text =
        `🧾 **ข้อมูลหนังสือรับรองการหักภาษี ณ ที่จ่าย (50 ทวิ) ประจำปี ${currentYearBE}**\n` +
        `คุณ ${user.name || ''} (รหัส: ${targetEmployeeId})\n\n` +
        `• จำนวนงวดเงินเดือนที่บันทึกแล้ว: ${rows.length} เดือน\n` +
        `• 💰 รวมเงินได้ทั้งปี: **${fmt(totalIncome)} บาท**\n` +
        `• 🧾 รวมภาษีหัก ณ ที่จ่ายสะสม: **${fmt(totalTax)} บาท**\n` +
        `• 🛡️ รวมเงินสมทบประกันสังคมสะสม: **${fmt(totalSso)} บาท**\n\n` +
        `💡 *คุณสามารถเปิดดูและดาวน์โหลดหนังสือรับรอง 50 ทวิ ฉบับสมบูรณ์ (พร้อมพิมพ์ PDF สำหรับยื่นภาษี ภ.ง.ด.91) ได้ที่เมนู "เพิ่มเติม > หนังสือรับรองหักภาษี (50 ทวิ)" ในระบบพนักงาน (หน้า /me) ได้ตลอด 24 ชม. ค่ะ*`;

      return {
        text,
        documents: [],
        intent: intent.type,
        source: 'system-data',
      };
    }

    // 2.9 ถามเรื่องแบบลดหย่อนภาษี (ลย.01)
    if (intent.dataType === 'allowance') {
      const currentYearBE = new Date().getFullYear() + 543;
      const { data: allowance } = await supabase
        .from('tax_allowances')
        .select('*')
        .eq('employee_id', targetEmployeeId)
        .eq('year', currentYearBE)
        .maybeSingle();

      let statusText = 'ยังไม่ได้ส่งแบบลดหย่อนประจำปีนี้';
      if (allowance) {
        statusText = `ส่งแบบลดหย่อนแล้ว (สถานะ: ${allowance.status === 'submitted' ? 'ยื่นเรียบร้อย' : allowance.status})`;
      }

      const text =
        `📝 **แบบลดหย่อนภาษีประจำปี (ลย.01) ปี ${currentYearBE}**\n` +
        `คุณ ${user.name || ''}\n\n` +
        `• สถานะปัจจุบัน: **${statusText}**\n` +
        `• สิทธิลดหย่อนพื้นฐาน: ค่าลดหย่อนผู้มีเงินได้ 60,000 บาท และประกันสังคมตามจริง\n` +
        `• รายการลดหย่อนเพิ่มเติม: คู่สมรส, บุตร, บิดามารดา, เบี้ยประกันชีวิต, ประกันสุขภาพ, กองทุนสำรองเลี้ยงชีพ, ดอกเบี้ยกู้บ้าน ฯลฯ\n\n` +
        `💡 *คุณสามารถกรอกหรืออัปเดตแบบลดหย่อนภาษี (ลย.01) เพื่อให้ระบบนำไปคำนวณหักภาษีในสลิปเงินเดือนอัตโนมัติ ได้ที่เมนู "เพิ่มเติม > แบบลดหย่อนภาษี (ลย.01)" ในระบบพนักงาน (หน้า /me) ได้เลยค่ะ*`;

      return {
        text,
        documents: [],
        intent: intent.type,
        source: 'system-data',
      };
    }

    // 2.10 ถามเวลาเข้างาน / เช็คอิน / สถิติเข้างานวันนี้
    if (intent.dataType === 'attendance') {
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
      const monthStart = today.slice(0, 7) + '-01';
      const [{ data: todayClock }, { data: monthRecords }] = await Promise.all([
        supabase.from('time_records').select('*').eq('employee_id', targetEmployeeId).eq('work_date', today).maybeSingle(),
        supabase.from('time_records').select('status').eq('employee_id', targetEmployeeId).gte('work_date', monthStart).lte('work_date', today),
      ]);

      const onTime = (monthRecords || []).filter((r) => r.status === 'normal').length;
      const late = (monthRecords || []).filter((r) => r.status === 'late').length;
      const absent = (monthRecords || []).filter((r) => r.status === 'absent').length;

      let statusToday = 'วันนี้ยังไม่มีข้อมูลการบันทึกเวลาเข้างานค่ะ';
      if (todayClock) {
        statusToday = `• เวลาเข้างาน: **${todayClock.clock_in ? todayClock.clock_in.slice(0, 5) + ' น.' : '—'}**\n• เวลาออกงาน: **${todayClock.clock_out ? todayClock.clock_out.slice(0, 5) + ' น.' : 'ยังไม่ออกงาน'}**\n• สถานะวันนี้: **${todayClock.status === 'normal' ? '✅ เข้างานปกติ' : todayClock.status === 'late' ? '⚠️ เข้างานสาย' : todayClock.status}**`;
      }

      return {
        text: `⏰ **ข้อมูลการลงเวลาทำงานของคุณ ${user.name || ''}**\n\n**สถานะวันนี้ (${today}):**\n${statusToday}\n\n**สถิติการมาทำงานเดือนนี้ (${today.slice(0, 7)}):**\n• ปกติ: ${onTime} วัน | สาย: ${late} วัน | ขาด: ${absent} วัน\n\n💡 *สามารถบันทึกเวลาเข้า-ออกงานผ่านระบบได้ที่เมนู "⏰ ลงเวลา" ในระบบพนักงาน (หน้า /me) ค่ะ*`,
        documents: [],
        intent: intent.type,
        source: 'system-data',
      };
    }

    // 2.11 ถามสถานะคำขอ OT
    if (intent.dataType === 'ot') {
      const { data: ots } = await supabase
        .from('ot_records')
        .select('*')
        .eq('employee_id', targetEmployeeId)
        .order('ot_date', { ascending: false })
        .limit(3);

      if (!ots || ots.length === 0) {
        return {
          text: `คุณ ${user.name || ''} คะ ยังไม่มีประวัติคำขอทำล่วงเวลา (OT) ในระบบค่ะ\n\n💡 *หากต้องการยื่นขอ OT สามารถเข้าทำรายการได้ที่เมนู "เพิ่มเติม > ขอค่าล่วงเวลา (OT)" ในระบบพนักงาน (หน้า /me) ได้เลยค่ะ*`,
          documents: [],
          intent: intent.type,
          source: 'system-data',
        };
      }

      const statusMap = { pending: '⏳ รออนุมัติ', approved: '✅ อนุมัติแล้ว', rejected: '❌ ปฏิเสธ' };
      const lines = ots.map(
        (o) => `• วันที่ ${o.ot_date}: **${o.hours} ชม.** (ยอดประมาณการ ${Number(o.amount || 0).toLocaleString()} ฿) — สถานะ: **${statusMap[o.status] || o.status}**`
      );

      return {
        text: `⏱️ **ประวัติคำขอค่าล่วงเวลา (OT) ล่าสุดของคุณ ${user.name || ''}**\n\n${lines.join('\n')}\n\n💡 *ดูรายละเอียดหรือยื่นคำขอใหม่ได้ที่เมนู "ขอค่าล่วงเวลา (OT)" ในหน้า /me ค่ะ*`,
        documents: [],
        intent: intent.type,
        source: 'system-data',
      };
    }

    // 2.12 ถามสถานะเบิกค่าใช้จ่าย
    if (intent.dataType === 'expenses') {
      const { data: exps } = await supabase
        .from('expense_claims')
        .select('*')
        .eq('employee_id', targetEmployeeId)
        .order('claim_date', { ascending: false })
        .limit(3);

      if (!exps || exps.length === 0) {
        return {
          text: `คุณ ${user.name || ''} คะ ยังไม่มีรายการยื่นเบิกค่าใช้จ่ายในระบบค่ะ\n\n💡 *หากมีค่าเดินทาง ค่าน้ำมัน หรือเบี้ยเลี้ยง สามารถยื่นเบิกพร้อมแนบใบเสร็จได้ที่เมนู "เพิ่มเติม > เบิกค่าใช้จ่าย" ในหน้า /me ค่ะ*`,
          documents: [],
          intent: intent.type,
          source: 'system-data',
        };
      }

      const statusMap = { pending: '⏳ รออนุมัติ', approved: '✅ อนุมัติแล้ว', paid: '🟣 จ่ายเงินแล้ว', rejected: '❌ ปฏิเสธ' };
      const lines = exps.map(
        (e) => `• วันที่ ${e.claim_date || '-'}: **${Number(e.amount || 0).toLocaleString()} ฿** (${e.category || '-'}) — สถานะ: **${statusMap[e.status] || e.status}**`
      );

      return {
        text: `🧾 **สถานะรายการเบิกค่าใช้จ่ายล่าสุดของคุณ ${user.name || ''}**\n\n${lines.join('\n')}\n\n💡 *ติดตามสถานะหรือยื่นเบิกรายการใหม่ได้ที่เมนู "เบิกค่าใช้จ่าย" ในหน้า /me ค่ะ*`,
        documents: [],
        intent: intent.type,
        source: 'system-data',
      };
    }
  }

  // ===== 3. TIER 1 & 2: RAG + LLM ตอบคำถามเชิงนโยบาย ปรึกษา ระเบียบบริษัท =====
  // คัดกรองเอกสารเฉพาะที่ Role นี้มีสิทธิ์เห็นเท่านั้น
  const relevantDocs = await findRelevantDocuments(intent, user.role, user.employeeId);
  const docsWithContent = relevantDocs.filter((d) => d.content);

  // ค้นหาชิ้นส่วนเอกสารที่ตรงคำถาม (เฉพาะจาก allowedDocIds ที่ผ่านการตรวจ Role แล้วเท่านั้น)
  let chunks = [];
  try {
    const docIdToName = new Map(docsWithContent.map((d) => [d.id, d.name]));
    const allowedIds = [...docIdToName.keys()];
    if (allowedIds.length > 0) {
      const found = await retrieveChunks(message, allowedIds, 6);
      chunks = found.map((c) => ({ ...c, docName: docIdToName.get(c.documentId) || 'เอกสาร' }));
    }
  } catch (err) {
    console.warn('[RAG] Vector search error, fallback to keyword:', err.message);
  }

  // คัดกรองเฉพาะ chunks ที่มีความตรงประเด็น (Similarity Threshold >= 0.45)
  chunks = chunks.filter((c) => (c.similarity || 0) >= 0.45);

  if (chunks.length === 0 && docsWithContent.length > 0) {
    chunks = keywordSearchChunks(message, docsWithContent, 4);
  }

  // สร้าง context ส่งให้ LLM (ไม่ยัดเยียดเอกสารขยะที่ไม่เกี่ยวกับคำถามเด็ดขาด)
  const context = chunks.length > 0
    ? chunks.map((c) => `[เอกสาร: ${c.docName}]:\n${c.content}`).join('\n\n')
    : '';

  // ตรวจสอบความพร้อมของ LLM
  if (llmAvailable()) {
    const rolePrompt = getRoleContext(user.role);
    const prompt = `${SYSTEM_PROMPT}

${COMPANY_PROFILE}

บริบทความปลอดภัยและสิทธิ์ของผู้ถาม (PDPA Context):
${rolePrompt}

ข้อมูลประวัติและสายงานของผู้ถาม:
${userContext}

ประวัติการสนทนาก่อนหน้านี้:
${historyText || '(นี่คือการเริ่มต้นบทสนทนาใหม่)'}

ข้อมูลอ้างอิงจากเอกสารระเบียบของบริษัท (ที่ผ่านการกรองสิทธิ์ตาม Role แล้ว):
${context || '(ไม่มีเอกสารระเบียบบริษัทที่ตรงกับคำถามนี้โดยตรง ให้ใช้แนวปฏิบัติทั่วไปของธุรกิจขนส่งและกฎหมายแรงงานตอบอย่างระมัดระวัง)'}

คำถามของพนักงาน:
"${message}"

คำแนะนำในการสร้างคำตอบของพี่ HR:
1. ตอบให้ตรงประเด็น ทักทายสุภาพด้วยชื่อพนักงาน (หากเหมาะสม)
2. อธิบายเข้าใจง่าย ภาษาคน ไม่ใช้ศัพท์เทคนิคกฎหมายจนเกินไป
3. ปฏิบัติตามกฎ PDPA อย่างเคร่งครัด ห้ามเปิดเผยข้อมูลส่วนบุคคลหรือบทลงโทษของพนักงานท่านอื่นเด็ดขาด
4. ตอบเฉพาะเนื้อหาที่พนักงานถามให้ชัดเจนและกระชับ ไม่ต้องแนะนำหรือชวนดาวน์โหลดแบบฟอร์ม/เอกสารใดๆ เว้นแต่พนักงานจะพิมพ์ระบุขอไฟล์เอกสารนั้นโดยตรง`;

    try {
      const text = await chatComplete(prompt, { channel });
      if (text) {
        return {
          text,
          documents: [],
          intent: 'consult_or_policy',
          source: llmProvider(),
        };
      }
    } catch (error) {
      console.error('[GenerateResponse] LLM Error:', error.message);
    }
  }

  // Fallback กรณี LLM ออฟไลน์ทั้งหมด
  if (chunks.length > 0) {
    const top = chunks[0];
    return {
      text: `สวัสดีค่ะคุณ ${user.name || ''}\n\nจากการตรวจสอบเอกสาร **"${top.docName}"** มีข้อกำหนดที่เกี่ยวข้องดังนี้ค่ะ:\n\n${top.content}\n\n💬 *หากต้องการความชัดเจนเพิ่มเติม สอบถามพี่ HR เพิ่มเติมได้เลยนะคะ*`,
      documents: [],
      intent: 'fallback',
      source: 'rag-fallback',
    };
  }

  return {
    text: `สวัสดีค่ะคุณ ${user.name || ''} พี่ HR ได้รับคำถามแล้วนะคะ แต่ยังไม่พบระเบียบที่ระบุเรื่องนี้ไว้ในเอกสารของบริษัทอย่างชัดเจน\n\nคุณ ${user.name || ''} สามารถแจ้งฝ่ายบุคคลโดยตรง เพื่อให้เจ้าหน้าที่ตรวจสอบและให้ข้อมูลที่ถูกต้องที่สุดนะคะ`,
    documents: [],
    intent: 'general',
    source: 'none',
  };
}
