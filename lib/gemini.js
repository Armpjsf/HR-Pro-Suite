import { filterDocumentsByRole, getRoleContext, canAccessEmployeeData } from './permissions.js';
import { getDocuments, getEmployeeRecord } from './db.js';
import { chunkText, retrieveChunks } from './rag.js';
import { llmProvider, llmAvailable, chatComplete } from './llm.js';
import { supabase } from './supabase.js';
import { getWorkSettingsForEmployee } from './work-calendar.js';

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
เป้าหมายของคุณคือ ตอบคำถาม ให้คำปรึกษา และดูแลพนักงานเสมือน HR ตัวจริง: ถูกต้อง แม่นยำ อบอุ่น เป็นมิตร กระชับ และนำไปปฏิบัติได้ทันที

แนวทางการตอบตามประเภทคำถาม (Adaptive Guidelines):
1. **คำถามด้านระเบียบบริษัท นโยบาย วันลา สวัสดิการ วินัย หรือขั้นตอนการทำงาน (HR Policies & Workflows):**
   - **บรรทัดแรก**: สรุปคำตอบตรงๆ ให้ทันทีอย่างชัดเจน
   - **เงื่อนไขสำคัญ**: อธิบายเป็น Bullet points สั้นๆ 2-4 ข้อ (ไม่เยิ่นเย้อ)
   - **ขั้นตอนถัดไป (Next Steps)**: บอกชัดเจนว่าต้องทำอย่างไรต่อ เช่น ทำรายการที่เมนูใดในระบบ หรือติดต่อใคร
   - **การอ้างอิงข้อมูล**: หากมีข้อมูลอ้างอิงจากเอกสารบริษัท ให้ยึดตามเอกสารนั้นและระบุชื่อเอกสารอ้างอิง หากไม่มีเอกสารบริษัทระบุ ให้ตอบตามหลักกฎหมายแรงงานไทยหรือแนวปฏิบัติธุรกิจขนส่ง พร้อมระบุว่าเป็นแนวปฏิบัติตามกฎหมายแรงงานทั่วไป แนะนำยืนยันกับฝ่ายบุคคลอีกครั้ง

2. **คำถามความรู้ทั่วไป การทำงานทั่วไป หรือขอคำแนะนำทั่วไป (General Work & Knowledge Q&A):**
   - ตอบอย่างชาญฉลาด ตรงประเด็น ช่วยเหลือได้อย่างเป็นมืออาชีพในโทนพี่ HR
   - ไม่ต้องฝืนใส่ข้อความอ้างอิงกฎหมายแรงงานหรือขั้นตอนระบบ HR หากไม่เกี่ยวข้องกับคำถาม

3. **การทักทาย ชวนคุยเล่น ขอบคุณ หรือระบายความรู้สึก (Small Talk & Casual Chat):**
   - ตอบอย่างเป็นกันเอง อบอุ่น เป็นมิตร สั้นกระชับ 1-3 ประโยค เหมือนรุ่นพี่ HR ที่คอยรับฟังและให้กำลังใจ
   - ไม่ต้องใช้ Bullet points และไม่ต้องใส่ข้อความอ้างอิงกฎหมายแรงงานใดๆ ทั้งสิ้น

4. **ความปลอดภัย PDPA (Strict PDPA):**
   - ห้ามเปิดเผยข้อมูลส่วนบุคคล เงินเดือน ยอดวันลา หรือบทลงโทษของพนักงานท่านอื่นเด็ดขาด`;

const SMALL_TALK_PROMPT = `คุณคือ "พี่ HR" รุ่นพี่ฝ่ายบุคคลที่ใจดี อบอุ่น และเป็นกันเอง ของบริษัท ดีดี เซอร์วิส แอนด์ ทรานสปอร์ต จำกัด
ตอบข้อความทักทาย ชวนคุยเล่น ขอบคุณ หรือระบายความรู้สึกของพนักงานอย่างเป็นมิตร อบอุ่น ให้กำลังใจ สั้นกระชับใน 1-3 ประโยค
ห้ามใช้ Bullet points ห้ามอ้างอิงกฎหมายแรงงาน และตอบด้วยภาษาพูดที่เป็นธรรมชาติ`;

const STOPWORDS = new Set([
  'ขอ', 'ถาม', 'อยาก', 'ทราบ', 'หน่อย', 'ครับ', 'ค่ะ', 'คะ', 'มี', 'คือ', 'อะไร',
  'ยังไง', 'อย่างไร', 'ได้ไหม', 'ได้มั้ย', 'บริษัท', 'เอกสาร', 'ระเบียบ',
  'วันนี้', 'วัน', 'วันที่', 'เวลา', 'เดือน', 'เดือนหน้า', 'ปี', 'ปีนี้',
  'เท่าไร', 'เท่าไหร่', 'วันไหน', 'กี่โมง', 'งาน', 'ไม่มี', 'เลย', 'มั้ย', 'ไหม',
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
      // ข้าม chunks ที่เป็นจุดไข่ปลา หรือช่องว่างสำหรับกรอกเอกสาร (fill-in blanks) เกิน 25%
      const dotsAndBlanks = (content.match(/[.…_\-]/g) || []).length;
      if (content.length > 0 && dotsAndBlanks / content.length > 0.25) {
        return;
      }

      const haystack = `${name}\n${content}`.toLowerCase();
      let matchedTerms = 0;
      let score = 0;
      for (const term of terms) {
        if (haystack.includes(term)) {
          matchedTerms++;
          score += name.includes(term) ? 2 : 1;
        }
      }

      // ต้องตรงอย่างน้อย 2 คำสำคัญขึ้นไป หรือถ้าคำถามมีคำเดียวต้องยาว >= 4 ตัวอักษร
      const isQualified =
        matchedTerms >= 2 ||
        (terms.length === 1 && terms[0].length >= 4 && matchedTerms >= 1);

      if (isQualified && score > 0) {
        scored.push({
          documentId: doc.id,
          docName: doc.name,
          content,
          similarity: Math.min(0.58, 0.34 + (score / Math.max(terms.length, 3)) * 0.24),
          lexicalScore: score,
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

  const leaveSummary = profile?.leave
    ? Object.values(profile.leave)
        .map((item) => `${item.label || item.code}: เหลือ ${item.remaining}/${item.total} วัน (ใช้ไป ${item.used})`)
        .join(', ')
    : 'ไม่มีข้อมูล';

  let ws = null;
  if (user?.employeeId) {
    try {
      ws = await getWorkSettingsForEmployee(user.employeeId);
    } catch (e) {
      console.warn('[buildUserContext] work settings error:', e.message);
    }
  }
  const workHoursText = `${ws?.standard_in ? ws.standard_in.slice(0, 5) : '08:00'} - ${ws?.standard_out ? ws.standard_out.slice(0, 5) : '17:00'} น.`;

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
    `ยอดวันลาคงเหลือปัจจุบัน: ${leaveSummary}`,
    `เวลาทำงานปกติของสาขา/พนักงาน: ${workHoursText}`,
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

  // 1.0 ตรวจสอบเคสขอติดต่อคนจริง / Human Escalation / สายด่วน HR
  if (/^(ติดต่อ\s*hr|ขอเบอร์\s*hr|คุยกับคน|คุยกับ\s*hr|แจ้งอุบัติเหตุ|ร้องเรียน|ติดต่อเจ้าหน้าที่|สายด่วน|เบอร์ฝ่ายบุคคล|ติดต่อฝ่ายบุคคล)/i.test(msg)) {
    return { type: 'human_escalation' };
  }

  // 1.0.1 ตรวจสอบการทักทาย / คุยเล่น / ระบายความรู้สึก (Small Talk & Casual Chat)
  const isSmallTalk =
    /^(สวัสดี|หวัดดี|ดีจ้า|ดีครับ|ดีค่ะ|ทักทาย|ฮัลโหล|hello|hi|hey|ขอบคุณ|ขอบใจ|แต้งกิ้ว|thank|เหนื่อย|ง่วง|หิว|ท้อ|เบื่อ|สู้ๆ|ฝันดี|กินข้าวยัง|กินไรยัง|ทำไรอยู่|ชื่ออะไร|เป็นใคร|คุยเล่น|เหงา|อากาศร้อน|ฝนตก|วันนี้งานยุ่ง)/i.test(msg) &&
    !/(ลา|เงินเดือน|สลิป|โอที|ot|เบิก|สวัสดิการ|ระเบียบ|แบบฟอร์ม|ฟอร์ม|เอกสาร|สัญญา|ใบขับขี่|ผ่านโปร|ทดลองงาน|ภาษี|50\s*ทวิ|ห้องประชุม|ทรัพย์สิน|กะทำงาน|ประกาศ)/i.test(msg);
  if (isSmallTalk) {
    return { type: 'small_talk' };
  }

  // 1.0.2 ขอเฉพาะไฟล์แบบฟอร์มอย่างเดียว หรือพิมพ์ชื่อเอกสารเพื่อดาวน์โหลด (Direct Download Request)
  // เช็ค all_templates ก่อน
  if (/(มี.*(ฟอร์ม|แบบฟอร์ม|เอกสาร).*(โหลด|ดาวน์โหลด|อะไรบ้าง|ไหม|มั้ย)|ขอ.*(รายการ|รายชื่อ).*(ฟอร์ม|แบบฟอร์ม)|ขอ.*(ฟอร์ม|แบบฟอร์ม)$|โหลดฟอร์ม|ขอเอกสารดาวน์โหลด|แบบฟอร์มทั้งหมด|รายการแบบฟอร์ม|มีแบบฟอร์มอะไรบ้าง|มีฟอร์มอะไรบ้าง)/i.test(msg)) {
    return { type: 'document_request', docName: 'all_templates' };
  }

  // เช็คคำถามนโยบาย/ขั้นตอน (Policy Consult) เพื่อแยกออกจากคำขอโหลดไฟล์สุภาพ
  const isPolicyConsultQuestion = /(กี่วัน|กี่ชม|กี่ชั่วโมง|เท่าใด|เท่าไหร่|ยังไง|อย่างไร|ทำไม|เมื่อไหร่|วันไหน|ขั้นตอน|ระเบียบ|ข้อกำหนด|เงื่อนไข|มีผล|ขอล่วงหน้า|ส่งที่ไหน|ใครอนุมัติ|บทลงโทษ|กี่ครั้ง|กี่เปอร์เซ็นต์|ช่วยอธิบาย|วิธีกรอก)/.test(msg);
  const explicitDownloadPrefix = /^(ขอ|ขอดูไฟล์|ขอโหลด|ดาวน์โหลด|download|โหลด|ขอไฟล์|ขอเอกสาร|ขอแบบฟอร์ม|ขอฟอร์ม|ขอเทมเพลต|ขอ\s*template|ส่งไฟล์|ส่งฟอร์ม|อยากได้ไฟล์|อยากได้ฟอร์ม|อยากได้แบบฟอร์ม|เอาไฟล์|มีไฟล์|มีแบบฟอร์ม|มีฟอร์ม)\s*/i.test(msg);
  const hasDownloadIntent =
    explicitDownloadPrefix ||
    /(ใบสมัคร|ใบสมัครงาน|แบบฟอร์มใบสมัคร|ใบลา|แบบฟอร์มใบลา|ฟอร์มใบลา|หนังสือเตือน|แบบฟอร์มหนังสือเตือน|รายงานการสอบสวน|รายงานการสอบสวนอุบัติเหตุ|หัวกระดาษ|หัวกระดาษกลางบริษัท|ใบวางบิล|ใบเสนอราคา|ใบแจ้งหนี้|สัญญาจ้างรถร่วม|สัญญาเช่าซื้อรถยนต์|ผลการตรวจปัสวะ|ผลการตรวจปัสสาวะ|template_employees)/i.test(msg);
  const isQuestion = /(กี่วัน|กี่ชม|กี่ชั่วโมง|เท่าใด|เท่าไหร่|ยังไง|อย่างไร|ทำไม|เมื่อไหร่|วันไหน|ขั้นตอน|ระเบียบ|ข้อกำหนด|เงื่อนไข|มีผล|ได้ไหม|ได้มั้ย|หรือไม่|หรือเปล่า|มีสิทธิ์|ขอล่วงหน้า|ส่งที่ไหน|ใครอนุมัติ|บทลงโทษ|กี่ครั้ง|กี่เปอร์เซ็นต์|ช่วยอธิบาย|สอบถาม|ถามเรื่อง|มีอะไรบ้าง)/.test(msg);

  if ((explicitDownloadPrefix && !isPolicyConsultQuestion) || (!isQuestion && hasDownloadIntent)) {
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
      .replace(/^(ขอ|ขอดูไฟล์|ขอโหลด|ดาวน์โหลด|download|โหลด|ขอไฟล์|ขอเอกสาร|ขอแบบฟอร์ม|ขอฟอร์ม|ขอเทมเพลต|ขอ\s*template|ส่งไฟล์|ส่งฟอร์ม|อยากได้ไฟล์|อยากได้ฟอร์ม|อยากได้แบบฟอร์ม|อยากได้|เอาไฟล์|มีไฟล์|มีแบบฟอร์ม|มีฟอร์ม)\s*/i, '')
      .replace(/ให้หน่อย|หน่อย|ได้ไหม|ได้มั้ย|ไหม|มั้ย|หรือเปล่า|ครับ|ค่ะ|คะ|นะ|นะคะ|หน่อยครับ|หน่อยค่ะ|\?/g, '')
      .trim();
    if (docKeyword) return { type: 'document_request', docName: docKeyword };
  }

  // 1.0.3 ประกาศบริษัทและข่าวสาร (Data Query: Announcements)
  if (/ประกาศ|ข่าวสาร|แจ้งเตือนบริษัท|announcement/i.test(msg) && !/ขอไฟล์|โหลด/.test(msg)) {
    return { type: 'data_query', dataType: 'announcements' };
  }

  // 1.0.4 ทรัพย์สินและอุปกรณ์ที่ถือครอง (Data Query: Assets)
  if (/ทรัพย์สิน|อุปกรณ์ที่เบิก|ของที่เบิก|ถือครอง|asset/i.test(msg)) {
    return { type: 'data_query', dataType: 'assets' };
  }

  // 1.0.5 ตารางกะ / เวลาทำงานปกติ (Data Query: Shifts)
  if (/ตารางกะ|กะทำงาน|เข้ากะ|เวลาทำงานปกติ|เวลาเข้าออกงานปกติ|ทำงานกี่โมงถึงกี่โมง/i.test(msg)) {
    return { type: 'data_query', dataType: 'shifts' };
  }

  // 1.0.6 สรุปภาพรวมฝ่ายบุคคล/ผู้บริหาร (Data Query: HR Summary)
  if (/(วันนี้ใครลา|ใครลาบ้าง|คนลาวันนี้|สรุปคนลา|พนักงานทั้งหมดกี่คน|มีพนักงานกี่คน|จำนวนพนักงานทั้งหมด|วันนี้ใครมาสาย|ใครสายบ้าง)/i.test(msg)) {
    return { type: 'data_query', dataType: 'hr_summary' };
  }

  // 1.1 ถามวันที่ / เวลา ปัจจุบัน หรือ วันนี้หยุดไหม (Direct Intent: Date/Time)
  const isDateTimeQuery =
    !/(เข้างาน|ออกงาน|เช็คอิน|เวลาทำงาน|สถิติเข้างาน|ลา|พักร้อน|เงินเดือน|สลิป|ใบขับขี่|หมดอายุ)/.test(msg) &&
    (
      /^(วันนี้|พรุ่งนี้|ตอนนี้)?\s*(วันที่เท่าไหร่|วันที่เท่าไร|วันอะไร|วันที่|กี่โมง|เวลาเท่าไหร่|เวลาเท่าไร|วันหยุดไหม|หยุดไหม)/i.test(msg) ||
      (/(วันนี้|พรุ่งนี้|ตอนนี้)/.test(msg) && /(วันที่เท่าไหร่|วันที่เท่าไร|วันอะไร|กี่โมง|เวลาเท่าไหร่|เวลาเท่าไร|วันหยุดไหม|หยุดไหม)/.test(msg)) ||
      /^(วันที่เท่าไหร่|วันที่เท่าไร|วันนี้วันอะไร|กี่โมงแล้ว|เวลาเท่าไหร่|เวลาเท่าไร)$/.test(msg)
    );

  if (isDateTimeQuery) {
    return { type: 'data_query', dataType: 'datetime' };
  }

  // 1.2 ถามวันหยุดบริษัท / วันหยุดนักขัตฤกษ์ / ปฏิทินวันหยุด (Direct Intent: Holidays)
  const isHolidayQuery =
    !/(ลาพักร้อน|ขอลางาน|ยื่นใบลา|วันลา|สิทธิ์ลา|ขอลา|ลาป่วย|ลากิจ|ลาคลอด)/.test(msg) &&
    /วันหยุด|หยุดนักขัตฤกษ์|หยุดชดเชย|ปฏิทินวันหยุด|เดือนหน้า.*หยุด|หยุด.*เดือนหน้า|เดือนนี้.*หยุด|หยุด.*ปีนี้/i.test(msg);

  if (isHolidayQuery) {
    return { type: 'data_query', dataType: 'holidays' };
  }

  // 2. ถามยอดวันลาคงเหลือของตัวเอง (Data Query: Leave)
  const isDirectLeaveBalance =
    /^(วันลา|ลาพักร้อน|ลาป่วย|ลากิจ|เช็ควันลา|ดูวันลา|วันลาคงเหลือ|ยอดวันลา|ลาเหลือ)$/.test(msg) ||
    (msg.includes('เหลือ') && (msg.includes('วันลา') || msg.includes('พักร้อน') || msg.includes('ลาป่วย') || msg.includes('ลากิจ'))) ||
    (/วันลา|ลาพักร้อน|ลาป่วย|ลากิจ|สิทธิ์ลา|โควต้าลา/i.test(msg) && /เหลือ|คงเหลือ|กี่วันแล้ว|ใช้ไปกี่วัน|ของฉัน|เช็ค|ดู|ยอด/i.test(msg)) ||
    msg.match(/^leave\s*balance$/i);

  if (isDirectLeaveBalance) {
    return { type: 'data_query', dataType: 'leave' };
  }

  // 3. ถามเวลาเข้างาน / เช็คอิน / สถิติเข้างานวันนี้
  if (
    (/เช็คอิน|เข้างาน|ออกงาน|เวลาเข้า|ลงเวลา|สถิติเข้างาน|เวลาทำงาน/i.test(msg) && /ดู|เช็ค|ตรวจ|วันนี้|ของฉัน|เท่าไหร่|ประวัติ|กี่โมง/.test(msg)) ||
    /สายกี่ครั้ง|มาสายกี่วัน|ขาดงานกี่วัน|สถิติมาทำงาน/i.test(msg)
  ) {
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

  // 14. กรณีอื่นๆ ทั้งหมด ให้ส่งเข้าสู่กระบวนการ AI (Policy / General Q&A / Consult)
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

  // ===== 0.0 จัดการคำสั่งติดต่อ HR / Human Escalation =====
  if (intent.type === 'human_escalation') {
    return {
      text: `👩‍💼 **ช่องทางการติดต่อฝ่ายทรัพยากรบุคคล (HR)**\nบริษัท ดีดี เซอร์วิส แอนด์ ทรานสปอร์ต จำกัด\n\nสวัสดีค่ะคุณ ${user?.name || 'พนักงาน'} หากต้องการติดต่อเจ้าหน้าที่ HR เพื่อปรึกษาเรื่องส่วนตัว ร้องเรียน หรือสอบถามข้อมูลเพิ่มเติม สามารถติดต่อได้ตามช่องทางนี้ค่ะ:\n\n• 📞 **โทรศัพท์:** 02-123-4567 ต่อ 101-104\n• ⏰ **เวลาทำการ:** จันทร์ - ศุกร์ (ตามเวลาทำการสาขา)\n• ✉️ **อีเมล:** hr@ddtransport.co.th\n• 🚨 **เหตุฉุกเฉิน/อุบัติเหตุ 24 ชม.:** โทร 1669 หรือสายด่วนศูนย์ควบคุมการขนส่ง`,
      documents: [],
      intent: 'human_escalation',
      source: 'system-guide',
    };
  }

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

    // กรณีเป็น Admin หรือ HR: ค้นหาข้อมูลพนักงานที่ถูกถามถึง
    try {
      const { data: userRows } = await supabase
        .from('users')
        .select('employee_id, name, department, role, status');

      const cleanMsg = message.toLowerCase();
      const matchedUser = (userRows || []).find((u) => {
        const empIdMatch = u.employee_id && cleanMsg.includes(u.employee_id.toLowerCase());
        const nameMatch = u.name && cleanMsg.includes(u.name.toLowerCase());
        return empIdMatch || nameMatch;
      });

      if (matchedUser) {
        const targetData = await getEmployeeData(matchedUser.employee_id);
        const leaveLines = targetData?.leave
          ? Object.values(targetData.leave).map((l) => `• **${l.label || l.code}**: คงเหลือ **${l.remaining}/${l.total} วัน** (ใช้ไป ${l.used} วัน)`).join('\n')
          : 'ไม่มีข้อมูลวันลา';
        return {
          text: `📋 **ข้อมูลพนักงาน: คุณ ${targetData?.name || matchedUser.name} (รหัส: ${matchedUser.employee_id})**\n\n• แผนก: ${targetData?.department || matchedUser.department || '-'}\n• ตำแหน่ง: ${targetData?.position || '-'}\n• สถานะ: ${matchedUser.status || 'active'}\n\n**ยอดวันลาคงเหลือ:**\n${leaveLines}`,
          documents: [],
          intent: 'admin_employee_query',
          source: 'system-data',
        };
      }
    } catch (err) {
      console.error('[cross_employee_query] HR query error:', err);
    }

    return {
      text: `ℹ️ **ค้นหาข้อมูลพนักงาน (สำหรับผู้ดูแลระบบ/HR)**\n\nกรุณาระบุชื่อ นามสกุล หรือรหัสพนักงานที่ต้องการตรวจสอบอย่างชัดเจนค่ะ เช่น "ขอข้อมูลวันลาของ สมชาย" หรือ "ตรวจสอบวันลาของ EMP002"`,
      documents: [],
      intent: 'admin_employee_query',
      source: 'system-guide',
    };
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

  // ===== 2. TIER 0: จัดการคำถามข้อมูลระบบและข้อมูลส่วนตัว (Direct Data Queries) =====
  if (intent.type === 'data_query') {
    // 2.0.1 ถามวันที่และเวลาปัจจุบัน (Data Query: Datetime)
    if (intent.dataType === 'datetime') {
      const thaiDays = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
      const thaiMonths = [
        'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
        'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
      ];

      // คำนวณวันและเวลาตาม Timezone ประเทศไทย (Asia/Bangkok)
      const now = new Date();
      const isTomorrow = /พรุ่งนี้/.test(message);
      const targetInstant = isTomorrow ? new Date(now.getTime() + 24 * 60 * 60 * 1000) : now;
      const bkkParts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Bangkok',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).formatToParts(targetInstant);

      const partMap = {};
      bkkParts.forEach((p) => { partMap[p.type] = p.value; });

      const dayNum = Number(partMap.day);
      const monthNum = Number(partMap.month);
      const yearCE = Number(partMap.year);
      const yearBE = yearCE + 543;
      const hourStr = partMap.hour || '00';
      const minStr = partMap.minute || '00';

      const bkkDateObj = new Date(targetInstant.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
      const dayOfWeekIdx = bkkDateObj.getDay();
      const dayName = thaiDays[dayOfWeekIdx] || '';
      const monthName = thaiMonths[monthNum - 1] || '';

      const todayBkkStr = `${yearCE}-${String(monthNum).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
      const dayPrefix = isTomorrow ? 'พรุ่งนี้' : 'วันนี้';
      const formattedDateTime = isTomorrow
        ? `วัน${dayName}ที่ ${dayNum} ${monthName} พ.ศ. ${yearBE} (${yearCE})`
        : `วัน${dayName}ที่ ${dayNum} ${monthName} พ.ศ. ${yearBE} (${yearCE}) เวลา ${hourStr}:${minStr} น.`;

      // ตรวจสอบวันหยุดบริษัทและสถานะการทำงาน
      let userBranchId = user?.branchId ?? null;
      if (!userBranchId && user?.employeeId) {
        try {
          const { data: uRow } = await supabase
            .from('users')
            .select('branch_id')
            .eq('employee_id', user.employeeId)
            .maybeSingle();
          if (uRow?.branch_id) userBranchId = uRow.branch_id;
        } catch (err) {
          console.warn('[datetime] fetch user branch error:', err.message);
        }
      }

      let holidayText = '';
      try {
        let holidayQ = supabase
          .from('holidays')
          .select('name, note')
          .eq('holiday_date', todayBkkStr);
        holidayQ = userBranchId
          ? holidayQ.or(`branch_id.is.null,branch_id.eq.${userBranchId}`)
          : holidayQ.is('branch_id', null);
        const { data: todayHolidays } = await holidayQ;

        if (todayHolidays && todayHolidays.length > 0) {
          const names = todayHolidays.map((h) => h.name).join(', ');
          holidayText = `🎉 **${dayPrefix}เป็นวันหยุดตามปฏิทินบริษัท:** ${names}`;
        }
      } catch (err) {
        console.warn('[datetime] holiday query error:', err.message);
      }

      let workStatusText = '';
      if (!holidayText) {
        try {
          let ws = null;
          if (user?.employeeId) {
            ws = await getWorkSettingsForEmployee(user.employeeId);
          }
          const workDays = new Set((ws?.work_days || '1,2,3,4,5').split(',').map((s) => Number(s.trim())));
          if (workDays.has(dayOfWeekIdx)) {
            const inHm = String(ws?.standard_in || '08:00').slice(0, 5);
            const outHm = String(ws?.standard_out || '17:00').slice(0, 5);
            workStatusText = `🏢 **สถานะวันทำงาน:** ${dayPrefix}เป็นวันทำงานปกติ (${inHm} - ${outHm} น.)`;
          } else {
            workStatusText = `☕ **สถานะวันทำงาน:** ${dayPrefix}เป็นวันหยุดประจำสัปดาห์ / วันหยุดพักผ่อน`;
          }
        } catch (err) {
          console.warn('[datetime] work settings error:', err.message);
        }
      }

      const statusDetail = holidayText || workStatusText;

      return {
        text: `🕒 **ข้อมูลวันที่และเวลา${isTomorrow ? 'วันพรุ่งนี้' : 'ปัจจุบัน'} (ประเทศไทย)**\n\n📅 **${formattedDateTime}**${statusDetail ? `\n\n${statusDetail}` : ''}`,
        documents: [],
        intent: intent.type,
        source: 'system-data',
      };
    }

    // 2.0.2 ถามวันหยุดบริษัท / วันหยุดนักขัตฤกษ์ (Data Query: Holidays)
    if (intent.dataType === 'holidays') {
      const thaiMonths = [
        'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
        'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
      ];
      const thaiDays = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];

      const now = new Date();
      const bkkParts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Bangkok',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
      }).formatToParts(now);

      const partMap = {};
      bkkParts.forEach((p) => { partMap[p.type] = p.value; });
      const currYear = Number(partMap.year);
      const currMonth = Number(partMap.month);
      const currDay = Number(partMap.day);
      const todayBkkStr = `${currYear}-${String(currMonth).padStart(2, '0')}-${String(currDay).padStart(2, '0')}`;

      // ตรวจสอบสาขาของผู้ใช้
      let userBranchId = user?.branchId ?? null;
      if (!userBranchId && user?.employeeId) {
        try {
          const { data: uRow } = await supabase
            .from('users')
            .select('branch_id')
            .eq('employee_id', user.employeeId)
            .maybeSingle();
          if (uRow?.branch_id) userBranchId = uRow.branch_id;
        } catch (err) {
          console.warn('[holidays] fetch user branch error:', err.message);
        }
      }

      let holidayQ = supabase
        .from('holidays')
        .select('id, holiday_date, name, note, branch_id')
        .order('holiday_date', { ascending: true });
      holidayQ = userBranchId
        ? holidayQ.or(`branch_id.is.null,branch_id.eq.${userBranchId}`)
        : holidayQ.is('branch_id', null);

      const { data: allHolidays, error: hErr } = await holidayQ;
      if (hErr) {
        console.error('[holidays] query error:', hErr.message);
      }
      const holidaysList = allHolidays || [];

      function formatHolidayItem(h) {
        const [y, m, d] = (h.holiday_date || '').split('-').map(Number);
        if (!y || !m || !d) return `• ${h.holiday_date}: **${h.name}**`;
        const dObj = new Date(Date.UTC(y, m - 1, d));
        const dName = thaiDays[dObj.getUTCDay()] || '';
        const mName = thaiMonths[m - 1] || '';
        const beYear = y + 543;
        return `• วัน${dName}ที่ ${d} ${mName} ${beYear}: **${h.name}**${h.note ? ` *(${h.note})*` : ''}`;
      }

      const msg = message.toLowerCase();
      const isNextMonth = /เดือนหน้า|ถัดไป/i.test(msg);
      const isThisMonth = /เดือนนี้|ปัจจุบัน/i.test(msg);

      if (isNextMonth) {
        const targetMonth = currMonth === 12 ? 1 : currMonth + 1;
        const targetYear = currMonth === 12 ? currYear + 1 : currYear;
        const prefix = `${targetYear}-${String(targetMonth).padStart(2, '0')}`;
        const targetMonthName = thaiMonths[targetMonth - 1];
        const targetBeYear = targetYear + 543;

        const filtered = holidaysList.filter((h) => h.holiday_date && h.holiday_date.startsWith(prefix));
        if (filtered.length > 0) {
          const lines = filtered.map(formatHolidayItem).join('\n');
          return {
            text: `📅 **วันหยุดตามปฏิทินบริษัท ประจำเดือน${targetMonthName} ${targetBeYear}**\n\n${lines}\n\n💡 *อ้างอิงตามปฏิทินวันหยุดบริษัท ดีดี เซอร์วิส แอนด์ ทรานสปอร์ต จำกัด*`,
            documents: [],
            intent: intent.type,
            source: 'system-data',
          };
        }

        const upcomingAfter = holidaysList.filter((h) => h.holiday_date && h.holiday_date > `${prefix}-31`);
        let nextTip = '';
        if (upcomingAfter.length > 0) {
          nextTip = `\n\n💡 **วันหยุดครั้งถัดไปหลังจากนั้น:**\n${formatHolidayItem(upcomingAfter[0])}`;
        }
        return {
          text: `📅 **วันหยุดบริษัท ประจำเดือน${targetMonthName} ${targetBeYear}**\n\nในเดือน${targetMonthName} ${targetBeYear} ยังไม่มีวันหยุดตามปฏิทินบริษัทสำหรับสาขาของคุณค่ะ${nextTip}`,
          documents: [],
          intent: intent.type,
          source: 'system-data',
        };
      }

      if (isThisMonth) {
        const prefix = `${currYear}-${String(currMonth).padStart(2, '0')}`;
        const thisMonthName = thaiMonths[currMonth - 1];
        const thisBeYear = currYear + 543;

        const filtered = holidaysList.filter((h) => h.holiday_date && h.holiday_date.startsWith(prefix));
        if (filtered.length > 0) {
          const lines = filtered.map(formatHolidayItem).join('\n');
          return {
            text: `📅 **วันหยุดตามปฏิทินบริษัท ประจำเดือน${thisMonthName} ${thisBeYear}**\n\n${lines}\n\n💡 *อ้างอิงตามปฏิทินวันหยุดบริษัท ดีดี เซอร์วิส แอนด์ ทรานสปอร์ต จำกัด*`,
            documents: [],
            intent: intent.type,
            source: 'system-data',
          };
        }

        const upcomingAfter = holidaysList.filter((h) => h.holiday_date && h.holiday_date >= todayBkkStr);
        let nextTip = '';
        if (upcomingAfter.length > 0) {
          nextTip = `\n\n💡 **วันหยุดที่กำลังจะถึงเร็วๆ นี้:**\n${formatHolidayItem(upcomingAfter[0])}`;
        }
        return {
          text: `📅 **วันหยุดบริษัท ประจำเดือน${thisMonthName} ${thisBeYear}**\n\nในเดือนนี้ (${thisMonthName} ${thisBeYear}) ไม่มีวันหยุดนักขัตฤกษ์ตามปฏิทินบริษัทค่ะ${nextTip}`,
          documents: [],
          intent: intent.type,
          source: 'system-data',
        };
      }

      // กรณีถามวันหยุดทั่วไป: แสดงวันหยุดที่กำลังจะมาถึงตั้งแต่ วันนี้ เป็นต้นไป (ไม่เกิน 8 วัน)
      const upcoming = holidaysList.filter((h) => h.holiday_date && h.holiday_date >= todayBkkStr);
      const remainingThisYear = upcoming.filter((h) => h.holiday_date.startsWith(String(currYear))).length;

      if (upcoming.length > 0) {
        const displayList = upcoming.slice(0, 8);
        const lines = displayList.map(formatHolidayItem).join('\n');
        return {
          text: `📅 **ปฏิทินวันหยุดบริษัทที่กำลังจะมาถึง (ตั้งแต่ ${todayBkkStr} เป็นต้นไป)**\n\n${lines}\n\n*(รวมวันหยุดที่เหลือในปีนี้ทั้งหมด ${remainingThisYear} วัน)*\n💡 *อ้างอิงตามประกาศวันหยุดบริษัท ดีดี เซอร์วิส แอนด์ ทรานสปอร์ต จำกัด*`,
          documents: [],
          intent: intent.type,
          source: 'system-data',
        };
      }

      return {
        text: `📅 **ข้อมูลวันหยุดตามปฏิทินบริษัท**\n\nขณะนี้ยังไม่มีรายการวันหยุดที่กำลังจะมาถึงบันทึกไว้ในระบบค่ะ คุณ ${user.name || ''} สามารถสอบถามฝ่ายบุคคลเพิ่มเติมได้นะคะ`,
        documents: [],
        intent: intent.type,
        source: 'system-data',
      };
    }

    // 2.0.3 ประกาศบริษัทและข่าวสาร (Data Query: Announcements)
    if (intent.dataType === 'announcements') {
      const [{ data: annList }, accessibleDocs] = await Promise.all([
        supabase
          .from('announcements')
          .select('*')
          .order('pinned', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(5),
        findRelevantDocuments(intent, user.role, user.employeeId),
      ]);

      const annDocs = (accessibleDocs || []).filter((d) => d.category === 'announcements');
      const hasAnnouncements = annList && annList.length > 0;
      const hasAnnDocs = annDocs.length > 0;

      if (!hasAnnouncements && !hasAnnDocs) {
        return {
          text: `📢 **ประกาศและข่าวสารจากบริษัท**\n\nขณะนี้ยังไม่มีประกาศใหม่จากทางบริษัทค่ะ คุณ ${user.name || ''} สามารถติดตามข่าวสารเพิ่มเติมผ่านบอร์ดประชาสัมพันธ์หรือหน้าระบบพนักงานได้นะคะ`,
          documents: [],
          intent: intent.type,
          source: 'system-data',
        };
      }

      const existingTitles = new Set((annList || []).map((a) => (a.title || '').trim().toLowerCase()));

      const annLines = (annList || []).map((a) => {
        const pin = a.pinned ? '📌 ' : '• ';
        const date = a.publish_date || (a.created_at ? a.created_at.slice(0, 10) : '');
        const cleanBody = (a.body || a.content || '')
          .replace(/\s*\[DOC:[^\]]+\]/g, '')
          .replace(/\s+/g, ' ')
          .trim();
        const snippet = cleanBody.slice(0, 120);
        return `${pin}**${a.title}** (${date})\n  ${snippet}${cleanBody.length > 120 ? '...' : ''}`;
      });

      const unlistedDocs = annDocs.filter(
        (d) => !existingTitles.has((d.name || '').trim().toLowerCase())
      );

      let docSection = '';
      if (unlistedDocs.length > 0) {
        const docLines = unlistedDocs.slice(0, 3).map((d) => `• 📄 **${d.name}** (${d.fileName || d.name})`);
        docSection = `\n\n📄 **ไฟล์ประกาศบริษัทในคลังเอกสาร:**\n${docLines.join('\n')}`;
      }

      return {
        text: `📢 **ประกาศและข่าวสารล่าสุดของบริษัท ดีดี เซอร์วิส แอนด์ ทรานสปอร์ต**\n\n${annLines.join('\n\n')}${docSection}\n\n💡 *คุณสามารถแตะปุ่มด้านล่างเพื่อเปิดอ่านหรือดาวน์โหลดไฟล์ประกาศฉบับเต็มได้ทันทีค่ะ*`,
        documents: publicDocuments(annDocs.slice(0, 3)),
        intent: intent.type,
        source: 'system-data',
      };
    }

    // 2.0.4 สรุปภาพรวมฝ่ายบุคคล/ผู้บริหาร (Data Query: HR Summary)
    if (intent.dataType === 'hr_summary') {
      if (user.role !== 'admin' && user.role !== 'hr' && user.role !== 'manager') {
        return {
          text: `🔒 **ขออภัยนะคะคุณ ${user.name || ''}**\n\nข้อมูลสรุปการปฏิบัติงาน ภาพรวมการลา และสถิติพนักงานทั้งองค์กร สงวนสิทธิ์เฉพาะผู้บริหาร ผู้จัดการ และฝ่ายบุคคล (HR) ตามนโยบาย PDPA และการรักษาความปลอดภัยข้อมูลของบริษัทค่ะ`,
          documents: [],
          intent: 'pdpa_restriction',
          source: 'pdpa-guard',
        };
      }

      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });

      const [
        { count: totalEmployees },
        { data: todayLeaves },
        { data: todayClockIns }
      ] = await Promise.all([
        supabase.from('users').select('*', { count: 'exact', head: true }).eq('status', 'active'),
        supabase.from('leave_requests').select('employee_id, leave_type, status').lte('start_date', today).gte('end_date', today).in('status', ['approved', 'pending']),
        supabase.from('time_records').select('employee_id, status, clock_in').eq('work_date', today),
      ]);

      const leavesCount = todayLeaves ? todayLeaves.length : 0;
      const clockInCount = todayClockIns ? todayClockIns.length : 0;
      const lateCount = (todayClockIns || []).filter((r) => r.status === 'late').length;

      return {
        text: `📊 **ภาพรวมสถิติพนักงานและกำลังพลประจำวันนี้ (${today})**\n\n• 👥 **พนักงานทั้งหมด (Active):** ${totalEmployees ?? '-'} คน\n• 🏖️ **พนักงานที่ลาวันนี้:** ${leavesCount} คน\n• ⏰ **ลงเวลาเข้างานแล้ว:** ${clockInCount} คน (เข้างานสาย: ${lateCount} คน)\n\n💡 *ดูรายละเอียดรายบุคคลและรายงานการทำงานแบบเต็มได้ที่เมนู "สรุปภาพรวม" และ "ลงเวลา" ในระบบ HR นะคะ*`,
        documents: [],
        intent: intent.type,
        source: 'system-data',
      };
    }

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

    // 2.13 ถามเรื่องทรัพย์สินและอุปกรณ์ที่ถือครอง (Data Query: Assets)
    if (intent.dataType === 'assets') {
      const { data: userAssets } = await supabase
        .from('assets')
        .select('*')
        .eq('assigned_to', user.employeeId)
        .order('code');

      let adminCountText = '';
      if (user.role === 'admin' || user.role === 'hr') {
        try {
          const { count } = await supabase.from('assets').select('*', { count: 'exact', head: true });
          adminCountText = `\n\n🏢 *(สิทธิ์ Admin/HR: ในระบบมีทรัพย์สินบริษัททั้งหมด ${count ?? 0} รายการ สามารถจัดการได้ที่เมนูทรัพย์สิน /hr/assets)*`;
        } catch {}
      }

      if (!userAssets || userAssets.length === 0) {
        return {
          text: `💼 **ข้อมูลทรัพย์สินและอุปกรณ์ของบริษัท**\n\nขณะนี้ไม่พบรายการทรัพย์สินหรืออุปกรณ์ที่ลงทะเบียนถือครองภายใต้รหัสพนักงานของคุณ (${user.employeeId || '-'}) ค่ะ\n\n💡 หากคุณมีอุปกรณ์ที่ต้องใช้งานหรือต้องการเบิก/คืนทรัพย์สิน สามารถติดต่อฝ่ายพัสดุ/HR หรือตรวจสอบได้ที่เมนูทรัพย์สิน (/hr/assets) ค่ะ${adminCountText}`,
          documents: [],
          intent: intent.type,
          source: 'system-data',
        };
      }

      const lines = userAssets.map((a) => `• 📦 **${a.name}** (รหัส: \`${a.code || '-'}\`) | หมวดหมู่: ${a.category || '-'} | สถานะ: ${a.status || 'ใช้งานอยู่'}`);

      return {
        text: `💼 **รายการทรัพย์สินและอุปกรณ์ที่คุณ ${user.name || ''} ถือครอง (${userAssets.length} รายการ)**\n\n${lines.join('\n')}\n\n💡 *หากต้องการส่งคืน ชำรุด หรือเปลี่ยนอุปกรณ์ สามารถติดต่อฝ่ายพัสดุหรือแจ้งทางฝ่ายบุคคลได้เลยนะคะ*${adminCountText}`,
        documents: [],
        intent: intent.type,
        source: 'system-data',
      };
    }

    // 2.14 ถามเรื่องตารางกะ / เวลาทำงานปกติ (Data Query: Shifts)
    if (intent.dataType === 'shifts') {
      let ws = null;
      if (user?.employeeId) {
        try {
          ws = await getWorkSettingsForEmployee(user.employeeId);
        } catch (e) {
          console.warn('[shifts] work settings error:', e.message);
        }
      }
      const stdIn = ws?.standard_in ? ws.standard_in.slice(0, 5) : '08:00';
      const stdOut = ws?.standard_out ? ws.standard_out.slice(0, 5) : '17:00';

      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
      const { data: upcomingShifts } = await supabase
        .from('shifts')
        .select('*')
        .eq('employee_id', user.employeeId)
        .gte('shift_date', today)
        .order('shift_date')
        .limit(7);

      const shiftTypeLabels = { morning: 'กะเช้า', afternoon: 'กะบ่าย', night: 'กะดึก', off: 'วันหยุด' };
      let shiftLines = 'ไม่มีตารางเข้ากะพิเศษล่วงหน้า (ปฏิบัติงานตามเวลามาตรฐานสาขา)';
      if (upcomingShifts && upcomingShifts.length > 0) {
        shiftLines = upcomingShifts
          .map((s) => {
            const label = shiftTypeLabels[s.shift_type] || s.shift_name || 'กะทำงาน';
            const timeRange = s.shift_type === 'off' ? 'หยุดพักผ่อน' : `${(s.start_time || stdIn).slice(0, 5)} - ${(s.end_time || stdOut).slice(0, 5)} น.`;
            return `• วันที่ ${s.shift_date}: **${label}** (${timeRange})`;
          })
          .join('\n');
      }

      return {
        text: `⏱️ **เวลาทำงานและตารางกะของคุณ ${user.name || ''}**\n\n🏢 **เวลาทำงานปกติ:** ${stdIn} - ${stdOut} น.\n\n📅 **ตารางกะที่กำหนดล่วงหน้า (7 วันข้างหน้า):**\n${shiftLines}\n\n💡 *หากต้องการสลับกะหรือสอบถามตารางเวลา สามารถแจ้งหัวหน้างานสายตรงหรือผู้จัดการสาขาได้นะคะ*`,
        documents: [],
        intent: intent.type,
        source: 'system-data',
      };
    }
  }

  // ===== 2.99 TIER 1: จัดการคำถามทักทาย / คุยเล่น (Small Talk) ข้าม RAG ทั้งหมด =====
  if (intent.type === 'small_talk') {
    if (llmAvailable()) {
      const smallTalkPrompt = `${SMALL_TALK_PROMPT}

ชื่อพนักงานที่ทักทาย: คุณ ${user?.name || 'พนักงาน'}
ข้อความจากพนักงาน: "${message}"

ตอบกลับอย่างอบอุ่น เป็นกันเอง สั้นๆ ใน 1-3 ประโยค:`;
      try {
        const text = await chatComplete(smallTalkPrompt, { channel });
        if (text) {
          return {
            text,
            documents: [],
            intent: 'small_talk',
            source: llmProvider(),
          };
        }
      } catch (error) {
        console.error('[GenerateResponse] Small Talk LLM Error:', error.message);
      }
    }

    return {
      text: `สวัสดีค่ะคุณ ${user?.name || ''} 😊 มีเรื่องงาน วันลา สวัสดิการ หรืออยากคุยปรึกษาอะไร ทักหาพี่ HR ได้ตลอดเลยนะคะ!`,
      documents: [],
      intent: 'small_talk',
      source: 'small-talk-fallback',
    };
  }

  // ===== 3. TIER 1 & 2: RAG + LLM ตอบคำถามเชิงนโยบาย ปรึกษา ระเบียบบริษัท =====
  // คัดกรองเอกสารเฉพาะที่ Role นี้มีสิทธิ์เห็นเท่านั้น
  const relevantDocs = await findRelevantDocuments(intent, user.role, user.employeeId);

  // แยกเอกสารระเบียบ/นโยบาย ออกจากแบบฟอร์มเปล่าสำหรับกรอก (Templates)
  // ให้ค้นใน templates ก็ต่อเมื่อผู้ใช้ถามเรื่องแบบฟอร์ม หรือวิธีกรอกเอกสารโดยตรงเท่านั้น
  const isFormRelatedQuery = /แบบฟอร์ม|ฟอร์ม|เอกสาร|กรอก|รายงาน|ส่งยังไง|วิธีใช้/i.test(message);
  const targetDocs = relevantDocs.filter((d) => d.content && (isFormRelatedQuery || d.category !== 'templates'));

  // ค้นหาชิ้นส่วนเอกสารที่ตรงคำถาม (เฉพาะจาก allowedDocIds ที่ผ่านการตรวจ Role แล้วเท่านั้น)
  let chunks = [];
  try {
    const docIdToName = new Map(targetDocs.map((d) => [d.id, d.name]));
    const allowedIds = [...docIdToName.keys()];
    if (allowedIds.length > 0) {
      const found = await retrieveChunks(message, allowedIds, 6);
      chunks = found.map((c) => ({ ...c, docName: docIdToName.get(c.documentId) || 'เอกสาร' }));
    }
  } catch (err) {
    console.warn('[RAG] Vector search error, fallback to keyword:', err.message);
  }

  // คัดกรองเฉพาะ chunks ที่มีความตรงประเด็น (ยกระดับ Similarity Threshold จาก 0.45 เป็น 0.62 ป้องกัน Over-matching)
  chunks = chunks.filter((c) => (c.similarity || 0) >= 0.62);

  if (chunks.length === 0 && targetDocs.length > 0) {
    chunks = keywordSearchChunks(message, targetDocs, 4);
  }

  // สร้าง context ส่งให้ LLM (ไม่ยัดเยียดเอกสารขยะที่ไม่เกี่ยวกับคำถามเด็ดขาด)
  const context = chunks.length > 0
    ? chunks.map((c) => `[เอกสาร: ${c.docName}]:\n${c.content}`).join('\n\n')
    : '';

  // คำนวณวันที่และเวลาปัจจุบัน (ประเทศไทย) เพื่อส่งเป็นบริบท Real-time ป้องกันโมเดลหลอนวันย้อนหลัง
  const now = new Date();
  const thaiDays = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
  const thaiMonths = [
    'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
  ];
  const bkkDateObj = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
  const currDayNum = bkkDateObj.getDate();
  const currMonthNum = bkkDateObj.getMonth();
  const currYearCE = bkkDateObj.getFullYear();
  const currYearBE = currYearCE + 543;
  const currHour = String(bkkDateObj.getHours()).padStart(2, '0');
  const currMin = String(bkkDateObj.getMinutes()).padStart(2, '0');
  const bkkCurrentTimeStr = `วัน${thaiDays[bkkDateObj.getDay()]}ที่ ${currDayNum} ${thaiMonths[currMonthNum]} พ.ศ. ${currYearBE} (ค.ศ. ${currYearCE}) เวลา ${currHour}:${currMin} น.`;

  // ตรวจสอบความพร้อมของ LLM
  if (llmAvailable()) {
    const userContext = await buildUserContext(user, channel);
    const rolePrompt = getRoleContext(user.role);
    const prompt = `${SYSTEM_PROMPT}

${COMPANY_PROFILE}

วันที่และเวลาปัจจุบัน (ประเทศไทย - Real-time Context):
${bkkCurrentTimeStr}

บริบทความปลอดภัยและสิทธิ์ของผู้ถาม (PDPA Context):
${rolePrompt}

ข้อมูลประวัติและสายงานของผู้ถาม:
${userContext}

ประวัติการสนทนาก่อนหน้านี้:
${historyText || '(นี่คือการเริ่มต้นบทสนทนาใหม่)'}

ข้อมูลอ้างอิงจากเอกสารระเบียบของบริษัท (ที่ผ่านการกรองสิทธิ์ตาม Role แล้ว):
${context || '(ไม่มีเอกสารระเบียบบริษัทที่ตรงกับคำถามนี้โดยตรง — หากเป็นคำถามด้าน HR/สิทธิแรงงาน ให้ตอบตามหลักกฎหมายแรงงานไทยหรือแนวปฏิบัติธุรกิจขนส่ง แต่หากเป็นคำถามความรู้ทั่วไปหรือการทำงานทั่วไป ให้ตอบช่วยเหลือตามข้อเท็จจริงอย่างเป็นธรรมชาติโดยไม่ต้องอ้างอิงกฎหมายแรงงาน)'}

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

  // Fallback กรณี LLM ออฟไลน์ทั้งหมด หรือเรียกไม่สำเร็จ
  if (chunks.length > 0) {
    const top = chunks[0];
    const isCleanPolicy = (top.similarity || 0) >= 0.72 && !top.content.includes('.....') && !top.content.includes('----');
    if (isCleanPolicy) {
      return {
        text: `สวัสดีค่ะคุณ ${user.name || ''}\n\nจากการตรวจสอบเอกสาร **"${top.docName}"** มีข้อกำหนดที่เกี่ยวข้องดังนี้ค่ะ:\n\n${top.content}\n\n💬 *หากต้องการความชัดเจนเพิ่มเติม สอบถามพี่ HR เพิ่มเติมได้เลยนะคะ*`,
        documents: [],
        intent: 'fallback',
        source: 'rag-fallback',
      };
    }
  }

  return {
    text: `ขออภัยค่ะคุณ ${user.name || ''} ระบบผู้ช่วย AI ขัดข้องชั่วคราว ไม่สามารถประมวลผลคำถามนี้ได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง หรือติดต่อฝ่ายบุคคลโดยตรงนะคะ`,
    documents: [],
    intent: 'fallback_offline',
    source: 'none',
  };
}
