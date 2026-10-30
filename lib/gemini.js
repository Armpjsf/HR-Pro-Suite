import { filterDocumentsByRole, getRoleContext, canAccessEmployeeData } from './permissions.js';
import { getDocuments, getEmployeeRecord } from './db.js';
import { chunkText, retrieveChunks } from './rag.js';
import { llmProvider, llmAvailable, chatComplete } from './llm.js';

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

4. **การใช้ข้อมูลอ้างอิง:**
   - ถ้ามี "ข้อมูลอ้างอิง" จากเอกสารบริษัท ให้ยึดตามเอกสารนั้นเป็นหลัก เรียบเรียงเป็นภาษาพูดที่เข้าใจง่าย **ห้ามคัดลอกทั้งท่อนมาแปะเด็ดขาด**
   - ถ้าไม่มีข้อมูลอ้างอิงของบริษัท ให้แนะนำตามหลักปฏิบัติทั่วไปของกฎหมายแรงงานไทยอย่างระมัดระวัง พร้อมระบุว่า "เป็นแนวปฏิบัติทั่วไป แนะนำให้ยืนยันกับฝ่าย HR อีกครั้งนะคะ"
   - ห้ามเดาตัวเลขสถิติหรือสิทธิประโยชน์ที่ไม่มีข้อมูลอ้างอิง

5. **ความกระชับสำหรับการอ่านบนมือถือ (Mobile-Friendly):**
   - ตอบกระชับ ความยาวเหมาะสมกับการอ่านบนหน้าจอมือถือ (LINE และ PWA)
   - หากมีเอกสารหรือแบบฟอร์มที่เกี่ยวข้อง ให้แจ้งชื่อเอกสารและแนะนำให้ดาวน์โหลด`;

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

function compactText(text) {
  return String(text || '').toLowerCase().replace(/\s+/g, '');
}

function normalizeThaiDigits(text) {
  const thaiDigits = '๐๑๒๓๔๕๖๗๘๙';
  return String(text || '').replace(/[๐-๙]/g, (d) => String(thaiDigits.indexOf(d)));
}

function parseRequestedClauseNumber(message) {
  const normalized = normalizeThaiDigits(message);
  const match =
    normalized.match(/(?:ข้อ|ข้อที่|หัวข้อ)\s*(\d+(?:\.\d+)?)/i) ||
    normalized.match(/(?:section|clause)\s*(\d+(?:\.\d+)?)/i);
  return match ? match[1] : null;
}

function cleanSectionText(text) {
  return String(text || '')
    .replace(/\n--\s*\d+\s+of\s+\d+\s*--/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractNumberedSection(content, clauseNumber) {
  if (!content || !clauseNumber) return '';
  const lines = String(content).replace(/\r/g, '').split('\n');
  const startRe = new RegExp(`^\\s*(?:ข้อ\\s*)?${clauseNumber}\\s*[.)]?\\s*`);
  const startIndex = lines.findIndex((line) => startRe.test(line));
  if (startIndex < 0) return '';

  let endIndex = lines.length;
  const nextTop = Number(clauseNumber) + 1;
  const endRe = new RegExp(`^\\s*(?:ข้อ\\s*)?${nextTop}\\s*[.)]\\s*`);
  for (let i = startIndex + 1; i < lines.length; i++) {
    if (endRe.test(lines[i])) {
      endIndex = i;
      break;
    }
  }

  return cleanSectionText(lines.slice(startIndex, endIndex).join('\n'));
}

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
    `บทบาทในระบบ: ${user?.role || 'employee'}`,
  ].join('\n');
}

/**
 * วิเคราะห์ intent อย่างชาญฉลาด
 * แยกคำถามเชิงข้อมูลระบบ (Data Query) ออกจากคำถามสนทนาที่ต้องการ AI
 */
export function analyzeIntent(message) {
  const msg = message.toLowerCase().trim();

  // 1. ถามยอดวันลาคงเหลือของตัวเองโดยตรง (Data Query: Leave)
  const isDirectLeaveBalance =
    /^(วันลา|ลาพักร้อน|ลาป่วย|ลากิจ|เช็ควันลา|ดูวันลา|วันลาคงเหลือ|ยอดวันลา|ลาเหลือ)$/.test(msg) ||
    (msg.includes('เหลือ') && (msg.includes('วันลา') || msg.includes('พักร้อน') || msg.includes('ลาป่วย') || msg.includes('ลากิจ'))) ||
    msg.match(/^leave\s*balance$/i);

  if (isDirectLeaveBalance) {
    return { type: 'data_query', dataType: 'leave' };
  }

  // 2. ถามดูโปรไฟล์ส่วนตัวตรงๆ
  if (/^(โปรไฟล์|ข้อมูลฉัน|ข้อมูลตัวเอง|ประวัติส่วนตัว|profile|my info)$/.test(msg)) {
    return { type: 'data_query', dataType: 'profile' };
  }

  // 3. ขอเฉพาะไฟล์แบบฟอร์มอย่างเดียว (Direct Download Request)
  // ต้องเป็นคำสั่งขอไฟล์ตรงๆ เช่น "ขอใบสมัคร", "ขอไฟล์ใบลา" ไม่ใช่คำถามเชิงอธิบาย เช่น "ขั้นตอนการลา"
  const isPureDocRequest =
    /^(ขอ|ดาวน์โหลด|download)\s*(แบบฟอร์ม|template|ไฟล์|เอกสาร)?\s*(ใบสมัคร|ใบลา|สัญญา|แบบประเมิน)/.test(msg) ||
    /^(ใบสมัคร|ใบสมัครงาน|ใบลา|แบบฟอร์มใบลา)$/.test(msg);

  if (isPureDocRequest) {
    if (msg.includes('สมัคร')) return { type: 'document_request', docName: 'ใบสมัครงาน' };
    if (msg.includes('ลา')) return { type: 'document_request', docName: 'ใบลา' };
    if (msg.includes('ประเมิน')) return { type: 'document_request', docName: 'แบบประเมินผล' };
    if (msg.includes('สัญญา')) return { type: 'document_request', docName: 'สัญญา' };
    return { type: 'document_request', docName: null };
  }

  // 4. กรณีอื่นๆ ทั้งหมด ให้ส่งเข้าสู่กระบวนการ AI (Policy / General Q&A / Consult)
  return { type: 'consult_or_policy' };
}

/**
 * ค้นหาเอกสารที่ผู้ใช้มีสิทธิ์เข้าถึง
 */
async function findRelevantDocuments(intent, userRole, employeeId) {
  const allDocs = await getDocuments();
  return filterDocumentsByRole(allDocs, userRole, employeeId);
}

/**
 * ดึงข้อมูลพนักงาน
 */
async function getEmployeeData(employeeId, dataType) {
  const data = await getEmployeeRecord(employeeId);
  if (!data) return null;

  if (dataType === 'leave') {
    return {
      name: data.name,
      leave: data.leave,
    };
  }
  return data;
}

/**
 * ฟังก์ชันหลักในการสร้างคำตอบ — สถาปัตยกรรม Hybrid ตอบได้เหมือน HR ตัวจริง
 */
export async function generateResponse(message, user, options = {}) {
  const intent = analyzeIntent(message);
  const channel = options.channel || 'PWA';
  const historyText = normalizeHistory(options.history);
  const userContext = await buildUserContext(user, channel);

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
      text: `ขออภัยนะคะคุณ ${user.name || ''} พี่ HR ยังไม่พบไฟล์แบบฟอร์มดังกล่าวในระบบ หากต้องการใช้งานด่วน แจ้งพี่ HR ให้ช่วยประสานงานให้ได้นะคะ`,
      documents: [],
      intent: intent.type,
      source: 'document-direct',
    };
  }

  // ===== 2. TIER 0: จัดการคำถามยอดวันลาและโปรไฟล์ตรงๆ (Direct System Data) =====
  if (intent.type === 'data_query') {
    if (intent.dataType === 'leave') {
      const targetEmployeeId = user.employeeId;
      if (!canAccessEmployeeData(user.role, targetEmployeeId, user.employeeId)) {
        return {
          text: '🔒 ขออภัยนะคะ คุณไม่มีสิทธิ์เข้าถึงข้อมูลวันลาของพนักงานท่านอื่นค่ะ',
          documents: [],
          intent: intent.type,
          source: 'system-data',
        };
      }

      const leaveData = await getEmployeeData(targetEmployeeId, 'leave');
      if (leaveData && leaveData.leave) {
        const lines = Object.values(leaveData.leave).map(
          (item) => `• **${item.label || item.code}**: ใช้ไป ${item.used} วัน | คงเหลือ **${item.remaining} วัน** (จากโควต้า ${item.total} วัน)`
        );
        return {
          text: `📅 **สรุปยอดวันลาคงเหลือของคุณ ${leaveData.name}**\n\n${lines.join('\n')}\n\n💡 *หากต้องการยื่นลา สามารถแจ้งพี่ HR หรือทำรายการผ่านเมนู "ขอลางาน" ในระบบได้เลยนะคะ*`,
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

    if (intent.dataType === 'profile') {
      const profileData = await getEmployeeData(user.employeeId);
      if (profileData) {
        return {
          text: `👤 **ข้อมูลพนักงาน: คุณ ${profileData.name}**\n\n• 🏢 แผนก: ${profileData.department || '-'}\n• 💼 ตำแหน่ง: ${profileData.position || '-'}\n• 📅 วันเริ่มงาน: ${profileData.startDate || '-'}\n\nหากต้องการแก้ไขข้อมูลส่วนตัว แจ้งฝ่ายบุคคลได้ตลอดนะคะ`,
          documents: [],
          intent: intent.type,
          source: 'system-data',
        };
      }
    }
  }

  // ===== 3. TIER 1 & 2: RAG + LLM ตอบคำถามเชิงนโยบาย ปรึกษา ระเบียบบริษัท =====
  const relevantDocs = await findRelevantDocuments(intent, user.role, user.employeeId);
  const docsWithContent = relevantDocs.filter((d) => d.content);
  const templateDocs = publicDocuments(relevantDocs.filter((d) => d.category === 'templates').slice(0, 3));

  // ค้นหาชิ้นส่วนเอกสารที่ตรงคำถาม (Hybrid RAG: Vector + Lexical Search)
  let chunks = [];
  try {
    const docIdToName = new Map(docsWithContent.map((d) => [d.id, d.name]));
    const found = await retrieveChunks(message, [...docIdToName.keys()], 6);
    chunks = found.map((c) => ({ ...c, docName: docIdToName.get(c.documentId) || 'เอกสาร' }));
  } catch (err) {
    console.warn('[RAG] Vector search error, fallback to keyword:', err.message);
  }

  if (chunks.length === 0) {
    chunks = keywordSearchChunks(message, docsWithContent, 6);
  }

  // สร้าง context ส่งให้ LLM
  const context = chunks.length > 0
    ? chunks.map((c) => `[เอกสาร: ${c.docName}]:\n${c.content}`).join('\n\n')
    : docsWithContent.slice(0, 3).map((d) => `[เอกสาร: ${d.name}]:\n${d.content.slice(0, 2000)}`).join('\n\n');

  // ตรวจสอบความพร้อมของ LLM
  if (llmAvailable()) {
    const prompt = `${SYSTEM_PROMPT}

${COMPANY_PROFILE}

ข้อมูลบริบทของผู้ถาม:
${userContext}

ประวัติการสนทนาก่อนหน้านี้:
${historyText || '(นี่คือการเริ่มต้นบทสนทนาใหม่)'}

ข้อมูลอ้างอิงจากเอกสารระเบียบของบริษัท:
${context || '(ไม่มีเอกสารระเบียบบริษัทที่ตรงกับคำถามนี้โดยตรง ให้ใช้แนวปฏิบัติทั่วไปของธุรกิจขนส่งและกฎหมายแรงงานตอบอย่างระมัดระวัง)'}

คำถามของพนักงาน:
"${message}"

คำแนะนำในการสร้างคำตอบของพี่ HR:
1. ตอบให้ตรงประเด็น ทักทายสุภาพด้วยชื่อพนักงาน (หากเหมาะสม)
2. อธิบายเข้าใจง่าย ภาษาคน ไม่ใช้ศัพท์เทคนิคกฎหมายจนเกินไป
3. หากมีเอกสารที่เกี่ยวข้อง พี่ HR ได้แนบปุ่มดาวน์โหลดไว้ให้ท้ายข้อความแล้ว`;

    try {
      // ส่ง channel เข้าไปเพื่อให้ Smart Routing เลือกโมเดลที่เร็วที่สุด (เช่น Gemini สำหรับ LINE)
      const text = await chatComplete(prompt, { channel });
      if (text) {
        return {
          text,
          documents: templateDocs,
          intent: 'consult_or_policy',
          source: llmProvider(),
        };
      }
    } catch (error) {
      console.error('[GenerateResponse] LLM Error:', error.message);
    }
  }

  // Fallback กรณี LLM ออฟไลน์ทั้งหมด: ดึงเนื้อหาเอกสารที่ใกล้เคียงที่สุดมาแสดง
  if (chunks.length > 0) {
    const top = chunks[0];
    return {
      text: `สวัสดีค่ะคุณ ${user.name || ''}\n\nจากการตรวจสอบเอกสาร **"${top.docName}"** มีข้อกำหนดที่เกี่ยวข้องดังนี้ค่ะ:\n\n${top.content}\n\n💬 *หากต้องการความชัดเจนเพิ่มเติม สอบถามพี่ HR เพิ่มเติมได้เลยนะคะ*`,
      documents: templateDocs,
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
