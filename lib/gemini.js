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
เป้าหมายของคุณคือ ตอบคำถามและให้คำปรึกษาแก่พนักงานเสมือนเป็น HR ตัวจริงที่นั่งอยู่ตรงหน้า: มีความรู้จริง ชัดเจน สุภาพ อบอุ่น และพร้อมช่วยเหลือ

แนวทางการตอบคำถาม (HR Professional Guidelines):
1. **บุคลิกและน้ำเสียง:**
   - ใช้ภาษาไทยที่สุภาพ อบอุ่น และเป็นมิตร (ใช้คำลงท้าย "ค่ะ/นะคะ" และแทนตัวเองว่า "พี่ HR" หรือ "ทาง HR")
   - ทักทายด้วยชื่อพนักงาน (ถ้ามีในบริบท) เพื่อสร้างความคุ้นเคย
   - หากพนักงานสอบถามเรื่องเจ็บป่วย ลากระทันหัน หรืออุบัติเหตุ ให้แสดงความห่วงใยก่อนตอบข้อเท็จจริงเสมอ

2. **การตอบคำถามให้ตรงเป้าและเข้าใจง่าย (Direct & Actionable):**
   - **บรรทัดแรก**: สรุปคำตอบตรงๆ ให้ทันที (เช่น "สามารถลาได้ค่ะ โดยมีสิทธิ์ลาป่วยได้ปีละไม่เกิน 30 วันทำงานค่ะ")
   - **ข้อกำหนด/เงื่อนไข**: อธิบายเงื่อนไขสำคัญเป็น bullet points สั้นๆ ไม่เกิน 3-4 ข้อ
   - **ขั้นตอนถัดไป (Next Steps)**: บอกพนักงานเสมอว่าต้องทำอะไรต่อ (เช่น "ยื่นใบลาผ่านระบบ HR นี้ล่วงหน้า 3 วัน" หรือ "ติดต่อหัวหน้างานสายตรง")

3. **บริบทพนักงานและประเภทงาน (Context-Awareness):**
   - คำนึงถึงแผนกและตำแหน่งของผู้ถาม (คนขับรถ, คลังสินค้า, หรือสำนักงาน)
   - หากระเบียบของ "รถบริษัท" กับ "รถร่วม" ต่างกัน ให้ระบุความแตกต่างให้ชัดเจน

4. **การรักษาความปลอดภัยข้อมูลส่วนบุคคล (PDPA Enforcement):**
   - **ห้ามเปิดเผยข้อมูลส่วนบุคคล เงินเดือน ยอดวันลา หรือใบเตือนของพนักงานคนอื่นเด็ดขาด**
   - หากพนักงานทั่วไปถามถึงบุคคลอื่น ให้ปฏิเสธอย่างสุภาพทันทีว่า "ข้อมูลดังกล่าวเป็นข้อมูลส่วนบุคคลตามนโยบาย PDPA ของบริษัท พี่ HR ไม่สามารถเปิดเผยให้ทราบได้ค่ะ"

5. **การใช้ข้อมูลอ้างอิง:**
   - ถ้ามี "ข้อมูลอ้างอิง" จากเอกสารบริษัท ให้ยึดตามเอกสารนั้นเป็นหลัก เรียบเรียงเป็นภาษาพูดที่เข้าใจง่าย **ห้ามคัดลอกทั้งท่อนมาแปะเด็ดขาด**
   - ถ้าไม่มีข้อมูลอ้างอิงของบริษัท ให้แนะนำตามหลักปฏิบัติทั่วไปของกฎหมายแรงงานไทยอย่างระมัดระวัง พร้อมระบุว่า "เป็นแนวปฏิบัติทั่วไป แนะนำให้ยืนยันกับฝ่าย HR อีกครั้งนะคะ"
   - ห้ามเดาตัวเลขสถิติหรือสิทธิประโยชน์ที่ไม่มีข้อมูลอ้างอิง`;

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

  // 2. ถามยอดวันลาคงเหลือของตัวเอง (Data Query: Leave)
  const isDirectLeaveBalance =
    /^(วันลา|ลาพักร้อน|ลาป่วย|ลากิจ|เช็ควันลา|ดูวันลา|วันลาคงเหลือ|ยอดวันลา|ลาเหลือ)$/.test(msg) ||
    (msg.includes('เหลือ') && (msg.includes('วันลา') || msg.includes('พักร้อน') || msg.includes('ลาป่วย') || msg.includes('ลากิจ'))) ||
    msg.match(/^leave\s*balance$/i);

  if (isDirectLeaveBalance) {
    return { type: 'data_query', dataType: 'leave' };
  }

  // 3. ถามวันหมดอายุใบอนุญาตขับขี่ (Data Query: License Expiry)
  if (/ใบขับขี่|ใบอนุญาตขับขี่|license/i.test(msg) && /หมด|วันไหน|เมื่อไหร่|ต่อ|ดู|เช็ค|ตรวจ/.test(msg)) {
    return { type: 'data_query', dataType: 'license' };
  }

  // 4. ถามเรื่องสถานะการทดลองงาน / ผ่านโปร (Data Query: Probation)
  if (/ผ่านโปร|ทดลองงาน|probation/i.test(msg)) {
    return { type: 'data_query', dataType: 'probation' };
  }

  // 5. ถามประเภทการจ้างงาน / สัญญาของตนเอง (Data Query: Employment)
  if (/ประเภท.*จ้าง|สัญญา.*หมด|หมดสัญญา|พนักงานประเภท/i.test(msg)) {
    return { type: 'data_query', dataType: 'employment' };
  }

  // 6. ถามดูโปรไฟล์ส่วนตัวตรงๆ
  if (/^(โปรไฟล์|ข้อมูลฉัน|ข้อมูลตัวเอง|ประวัติส่วนตัว|profile|my info)$/.test(msg)) {
    return { type: 'data_query', dataType: 'profile' };
  }

  // 7. ถามเรื่องห้องประชุม / การจองห้องประชุม
  if (/ห้องประชุม|จองห้อง|meeting room/i.test(msg)) {
    return { type: 'data_query', dataType: 'rooms' };
  }

  // 8. ถามเรื่องสลิปเงินเดือน / เงินเดือนล่าสุด
  if (/สลิป|เงินเดือน|payslip|salary/i.test(msg) && /ดู|เช็ค|ตรวจ|ออกยัง|เข้ายัง|ล่าสุด|ของฉัน|ขอดู|เท่าไหร่/.test(msg)) {
    return { type: 'data_query', dataType: 'payslip' };
  }

  // 9. ถามเรื่องหนังสือรับรองหักภาษี 50 ทวิ
  if (/50\s*ทวิ|หนังสือรับรองหักภาษี|หัก\s*ณ\s*ที่จ่าย|tax\s*cert/i.test(msg)) {
    return { type: 'data_query', dataType: 'tax_cert' };
  }

  // 10. ถามเรื่องแบบลดหย่อนภาษี (ลย.01)
  if (/ลดหย่อนภาษี|ลย\.?\s*01|tax\s*deduction|tax\s*allowance/i.test(msg)) {
    return { type: 'data_query', dataType: 'allowance' };
  }

  // 7. ขอเฉพาะไฟล์แบบฟอร์มอย่างเดียว (Direct Download Request)
  const isPureDocRequest =
    /^(ขอ|ดาวน์โหลด|download)\s*(แบบฟอร์ม|template|ไฟล์|เอกสาร)?\s*(ใบสมัคร|ใบลา|สัญญา|แบบประเมิน|ใบวางบิล|ใบเสนอราคา|ใบแจ้งหนี้)/.test(msg) ||
    /^(ใบสมัคร|ใบสมัครงาน|ใบลา|แบบฟอร์มใบลา)$/.test(msg);

  if (isPureDocRequest) {
    if (msg.includes('สมัคร')) return { type: 'document_request', docName: 'ใบสมัครงาน' };
    if (msg.includes('ลา')) return { type: 'document_request', docName: 'ใบลา' };
    if (msg.includes('ประเมิน')) return { type: 'document_request', docName: 'แบบประเมินผล' };
    if (msg.includes('วางบิล')) return { type: 'document_request', docName: 'ใบวางบิล' };
    if (msg.includes('เสนอราคา')) return { type: 'document_request', docName: 'ใบเสนอราคา' };
    if (msg.includes('แจ้งหนี้')) return { type: 'document_request', docName: 'ใบแจ้งหนี้' };
    if (msg.includes('สัญญา')) return { type: 'document_request', docName: 'สัญญา' };
    return { type: 'document_request', docName: null };
  }

  // 8. กรณีอื่นๆ ทั้งหมด ให้ส่งเข้าสู่กระบวนการ AI (Policy / General Q&A / Consult)
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
    const matchedDoc = intent.docName
      ? accessibleDocs.find((d) => (d.name || '').includes(intent.docName)) || accessibleDocs[0]
      : null;

    if (matchedDoc) {
      return {
        text: `สวัสดีค่ะคุณ ${user.name || ''} 📄\nพี่ HR เตรียมเอกสาร **"${matchedDoc.name}"** ให้เรียบร้อยแล้วค่ะ\nคุณสามารถกดดาวน์โหลดได้จากปุ่มด้านล่างนี้เลยนะคะ`,
        documents: publicDocuments([matchedDoc]),
        intent: intent.type,
        source: 'document-direct',
      };
    }
    return {
      text: `ขออภัยนะคะคุณ ${user.name || ''} พี่ HR ยังไม่พบไฟล์แบบฟอร์มดังกล่าวที่คุณมีสิทธิ์เข้าถึงในระบบ หากต้องการใช้งานด่วน แจ้งพี่ HR ให้ช่วยตรวจสอบได้นะคะ`,
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

  if (chunks.length === 0 && docsWithContent.length > 0) {
    chunks = keywordSearchChunks(message, docsWithContent, 6);
  }

  // สร้าง context ส่งให้ LLM
  const context = chunks.length > 0
    ? chunks.map((c) => `[เอกสาร: ${c.docName}]:\n${c.content}`).join('\n\n')
    : docsWithContent.slice(0, 3).map((d) => `[เอกสาร: ${d.name}]:\n${d.content.slice(0, 2000)}`).join('\n\n');

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
