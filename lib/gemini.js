import { GoogleGenerativeAI } from '@google/generative-ai';
import { filterDocumentsByRole, getRoleContext, canAccessEmployeeData } from './permissions';
import { getDocuments, getEmployeeRecord } from './db';
import { chunkText, retrieveChunks } from './rag';

const genAI = process.env.GEMINI_API_KEY
  ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  : null;

const COMPANY_PROFILE = `ข้อมูลพื้นฐานเกี่ยวกับบริษัท (บริบทที่ HR ของบริษัทนี้ควรรู้เป็นพื้นฐาน):
- บริษัท ดีดี เซอร์วิส แอนด์ ทรานสปอร์ต จำกัด (DD Service and Transport Co., Ltd.) ให้บริการด้านโลจิสติกส์/ขนส่ง และบริหารจัดการคลังสินค้า
- งานขนส่งมี 2 รูปแบบหลัก ได้แก่ **TT** และ **MT** (โดยทั่วไปในธุรกิจขนส่ง TT มักหมายถึงงานขนส่งสายหลัก/ปริมาณมากระหว่างคลังหรือศูนย์กระจายสินค้า ส่วน MT มักหมายถึงงานขนส่งกระจายสินค้าไปยังหลายจุดปลายทาง เช่น ร้านค้า/สาขา — แต่ความหมายที่ใช้จริงในบริษัทอาจแตกต่างกันได้ ถ้าพนักงานถามรายละเอียดเฉพาะเจาะจง ให้แนะนำสอบถามฝ่ายปฏิบัติการ/HR เพื่อความชัดเจน)
- รถที่ใช้ในการขนส่งมี 2 ประเภท:
  - **รถบริษัท**: รถที่บริษัทเป็นเจ้าของเอง คนขับเป็นพนักงานของบริษัท
  - **รถร่วม**: รถของผู้ประกอบการ/บุคคลภายนอกที่เข้าร่วมวิ่งงานกับบริษัท (ไม่ใช่พนักงานประจำ แต่อยู่ในระบบงานขนส่งเดียวกัน) อาจมีระเบียบ/สวัสดิการบางอย่างต่างจากพนักงานประจำ
- งานบริหารจัดการคลังสินค้า (Warehouse Management): รับ-จ่ายสินค้า, จัดเก็บ, ตรวจนับสต็อก, แพ็คสินค้าก่อนส่งต่อให้รถ TT/MT
- กลุ่มพนักงานหลักที่เกี่ยวข้อง ได้แก่ พนักงานขับรถ (รถบริษัท/รถร่วม), พนักงานคลังสินค้า, และพนักงานสำนักงาน/ธุรการ
ใช้ข้อมูลนี้เป็นความรู้พื้นฐานเพื่อเข้าใจบริบทคำถามของพนักงาน (เช่น คำศัพท์ TT/MT/รถร่วม/คลัง) แต่ไม่ใช่ระเบียบบริษัทที่เป็นทางการ — ถ้าพนักงานถามระเบียบ/สิทธิ์ที่เป็นทางการ ให้ยึดตาม "ข้อมูลอ้างอิง" (เอกสารบริษัท) เท่านั้นตามกฎด้านล่าง`;

const SYSTEM_PROMPT = `คุณคือ "HR Assistant" ผู้ช่วย HR อัจฉริยะของบริษัท คุณต้อง:
1. ตอบคำถามเป็นภาษาไทยเสมอ ใช้ภาษาสุภาพ เป็นมิตร
2. ถ้าคำถามเกี่ยวกับระเบียบ/นโยบาย/สวัสดิการ/สิทธิ์ของบริษัทนี้โดยเฉพาะ และมี "ข้อมูลอ้างอิง" ที่ตรงกับคำถาม ให้ตอบจากข้อมูลอ้างอิงนั้นเท่านั้น ห้ามสมมุติตัวเลขหรือรายละเอียดที่ไม่มีในข้อมูลอ้างอิง และอ้างอิงชื่อเอกสารที่ใช้ตอบทุกครั้ง ห้ามอ้างอิงชื่อเอกสารที่ไม่ได้อยู่ใน "ข้อมูลอ้างอิง" จริง
3. ถ้าไม่มี "ข้อมูลอ้างอิง" ที่ตรงกับคำถาม (ไม่ว่าจะเป็นคำถามทั่วไป หรือคำถามเกี่ยวกับระเบียบ/สิทธิ์ของบริษัท) ให้ใช้ความรู้ทั่วไปของคุณตอบแบบเป็นประโยชน์ที่สุด เช่น หลักเกณฑ์ทั่วไปตามกฎหมายแรงงานไทย แนวปฏิบัติทั่วไปของธุรกิจขนส่ง/คลังสินค้า หรือคำแนะนำทั่วไปเรื่องการทำงาน — แต่ต้องระบุให้ชัดเจนว่าเป็น "ข้อมูล/คำแนะนำทั่วไป (ยังไม่ใช่นโยบายที่ยืนยันจากบริษัทนี้)" และแนะนำให้ตรวจสอบกับฝ่าย HR เพื่อความถูกต้องเป็นทางการ ห้ามตอบว่า "ไม่พบข้อมูล" เพียงอย่างเดียวโดยไม่ให้ข้อมูลที่เป็นประโยชน์เลย ยกเว้นเป็นคำถามที่ต้องใช้ข้อมูลเฉพาะตัวพนักงาน (เช่น ยอดวันลาคงเหลือของตนเอง) ซึ่งต้องมาจากระบบเท่านั้น
4. ถ้าเป็นคำขอเอกสาร/Template ให้แจ้งชื่อเอกสารและบอกว่าสามารถดาวน์โหลดได้
5. จัดรูปแบบคำตอบให้อ่านง่าย ใช้ bullet points หรือรายการ
6. ห้ามเปิดเผยข้อมูลที่ผู้ใช้ไม่มีสิทธิ์เห็น
7. ใช้ประวัติสนทนาเพื่อเข้าใจคำถามต่อเนื่อง แต่ถ้าประวัติขัดกับข้อมูลอ้างอิง ให้ยึดข้อมูลอ้างอิง/ข้อมูลระบบเป็นหลัก
8. ถ้าช่องทางคือ LINE ให้ตอบกระชับกว่าหน้าเว็บ และถ้าต้องดาวน์โหลดเอกสาร ให้บอกให้เปิดเมนูเอกสาร HR ในเว็บเพราะ LINE ไม่มี token ดาวน์โหลดไฟล์
9. ถ้าผู้ใช้ถามเฉพาะเลขข้อ เช่น "ข้อ 2" หรือ "ข้อ 2.1" ให้ตอบเฉพาะเนื้อหาของข้อนั้น สรุปให้ครบถ้วนตามข้อความอ้างอิง และอย่าลากข้ออื่นหรือท้ายเอกสารมาตอบ เว้นแต่จำเป็นต่อบริบท

${COMPANY_PROFILE}`;

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
      const role = m.role === 'ai' || m.role === 'assistant' ? 'ผู้ช่วย' : 'ผู้ใช้';
      return `${role}: ${String(m.content || '').replace(/\s+/g, ' ').slice(0, 500)}`;
    })
    .filter((line) => line.length > 8)
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
          similarity: Math.min(0.58, 0.34 + hits / Math.max(terms.length, 3) * 0.24),
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

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

function sectionStartRegex(clauseNumber) {
  const escaped = escapeRegExp(clauseNumber);
  return new RegExp(`^\\s*(?:ข้อ\\s*)?${escaped}\\s*[.)]?\\s*`);
}

function sectionEndRegex(clauseNumber) {
  if (clauseNumber.includes('.')) {
    const parts = clauseNumber.split('.').map(Number);
    const nextSibling = [...parts.slice(0, -1), parts[parts.length - 1] + 1].join('.');
    const nextTop = parts[0] + 1;
    return new RegExp(`^\\s*(?:(?:ข้อ\\s*)?${escapeRegExp(nextSibling)}\\s*[.)]?\\s*|(?:ข้อ\\s*)?${nextTop}\\s*[.)]\\s*)`);
  }

  const nextTop = Number(clauseNumber) + 1;
  return new RegExp(`^\\s*(?:ข้อ\\s*)?${nextTop}\\s*[.)]\\s*`);
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
  const startRe = sectionStartRegex(clauseNumber);
  const endRe = sectionEndRegex(clauseNumber);
  const startIndex = lines.findIndex((line) => startRe.test(line));
  if (startIndex < 0) return '';

  let endIndex = lines.length;
  for (let i = startIndex + 1; i < lines.length; i++) {
    if (endRe.test(lines[i])) {
      endIndex = i;
      break;
    }
  }

  return cleanSectionText(lines.slice(startIndex, endIndex).join('\n'));
}

function scoreDocForQuestion(question, doc) {
  const q = compactText(normalizeThaiDigits(question).replace(/(?:ข้อ|ข้อที่|หัวข้อ)\s*\d+(?:\.\d+)?/g, ''));
  const name = compactText(doc.name || '');
  const body = compactText(doc.content || '');
  const haystack = `${name}\n${body}`;
  let score = 0;

  const phrases = [
    'ความปลอดภัย', 'แนวปฏิบัติ', 'สวัสดิการ', 'สิทธิ์การลา', 'วันลา',
    'รถร่วม', 'สัญญา', 'ยกเลิกสัญญา', 'ใบสมัคร', 'ประกันภัย',
  ];
  for (const phrase of phrases) {
    const p = compactText(phrase);
    if (q.includes(p) && haystack.includes(p)) score += 10;
  }

  for (const term of tokenize(question)) {
    const compactTerm = compactText(term);
    if (compactTerm && haystack.includes(compactTerm)) score += name.includes(compactTerm) ? 3 : 1;
  }

  return score;
}

function extractRequestedNumberedSections(question, docs) {
  const clauseNumber = parseRequestedClauseNumber(question);
  if (!clauseNumber) return [];

  const matches = [];
  for (const doc of docs) {
    const content = extractNumberedSection(doc.content, clauseNumber);
    if (!content) continue;
    matches.push({
      documentId: doc.id,
      docName: doc.name,
      content,
      similarity: 0.92,
      clauseNumber,
      sectionMatch: true,
      lexicalScore: scoreDocForQuestion(question, doc),
    });
  }

  const sorted = matches.sort((a, b) => b.lexicalScore - a.lexicalScore || b.content.length - a.content.length);
  const bestScore = sorted[0]?.lexicalScore || 0;
  return (bestScore > 0 ? sorted.filter((m) => m.lexicalScore === bestScore) : sorted.slice(0, 1)).slice(0, 2);
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

  return [
    `ช่องทาง: ${channel === 'LINE' ? 'LINE Bot' : 'เว็บ HR Pro Suite'}`,
    `ผู้ใช้: ${user?.name || '-'} (${user?.employeeId || '-'})`,
    `สิทธิ์ระบบ: ${user?.role || '-'}`,
    `แผนก: ${profile?.department || user?.department || '-'}`,
    `ตำแหน่ง: ${profile?.position || '-'}`,
  ].join('\n');
}

/**
 * วิเคราะห์ intent จากข้อความ
 */
export function analyzeIntent(message) {
  const msg = message.toLowerCase();

  // ถามยอดวันลาคงเหลือของตัวเอง (ต้องมีคำว่า "เหลือ"/"คงเหลือ" ร่วมกับคำเกี่ยวกับลา ถึงจะถือเป็นข้อมูลส่วนตัว)
  if (msg.match(/ลาเหลือ|ลาคงเหลือ|วันลาคงเหลือ|leave.*balance|((วันลา|ลาพักร้อน|ลาป่วย|ลากิจ|พักร้อน|วันลา).*(เหลือ|คงเหลือ))|((เหลือ|คงเหลือ).*(วันลา|ลาพักร้อน|ลาป่วย|ลากิจ|พักร้อน))/)) {
    return { type: 'data_query', dataType: 'leave' };
  }

  // ถามข้อมูลพนักงาน
  if (msg.match(/ข้อมูล.*พนักงาน|ข้อมูล.*ตัวเอง|profile|ตำแหน่ง/)) {
    return { type: 'data_query', dataType: 'profile' };
  }

  // ขอเอกสาร/Template — ต้องระบุชนิดเอกสาร/แบบฟอร์มชัดเจน ไม่ใช่แค่คำว่า "ขอ"/"ต้องการ" เฉยๆ
  // (เพื่อไม่ให้คำถามทั่วไป เช่น "ขอขั้นตอนการลงทะเบียนรถร่วม" ถูกตีความว่าขอเอกสาร)
  if (msg.match(/ดาวน์โหลด|download|template|แบบฟอร์ม|ใบสมัคร|ใบลา|สัญญาจ้าง|แบบประเมิน|เอกสาร/)) {
    if (msg.match(/ใบสมัคร|สมัครงาน|application/)) return { type: 'document_request', docName: 'ใบสมัครงาน' };
    if (msg.match(/ใบลา|ลาพักร้อน|ลาป่วย|ลากิจ|leave/)) return { type: 'document_request', docName: 'ใบลา' };
    if (msg.match(/ประเมิน|performance|review/)) return { type: 'document_request', docName: 'แบบประเมินผล' };
    if (msg.match(/สัญญา|contract/)) return { type: 'document_request', docName: 'สัญญาจ้าง' };
    return { type: 'document_request', docName: null };
  }

  // ถามระเบียบ/Policy (รวมถึงคำถามทั่วไปเกี่ยวกับประเภท/สิทธิการลา)
  if (msg.match(/ระเบียบ|กฎ|นโยบาย|policy|สวัสดิการ|benefit|แต่งกาย|ความปลอดภัย|ประกันภัย|บทลงโทษ|การลา|ได้กี่วัน|วันลา|ลาพักร้อน|ลาป่วย|ลากิจ/)) {
    return { type: 'policy_question' };
  }

  // ถามประกาศ
  if (msg.match(/ประกาศ|ข่าว|announcement|อัพเดท|ล่าสุด/)) {
    return { type: 'announcement_query' };
  }

  return { type: 'general' };
}

/**
 * ค้นหาเอกสารที่เกี่ยวข้อง
 */
async function findRelevantDocuments(intent, userRole, employeeId) {
  const allDocs = await getDocuments();
  const accessibleDocs = filterDocumentsByRole(allDocs, userRole, employeeId);

  switch (intent.type) {
    case 'document_request':
      if (intent.docName) {
        return accessibleDocs.filter(d =>
          d.name.includes(intent.docName) || d.category === 'templates'
        );
      }
      return accessibleDocs;

    case 'policy_question':
      // เอกสารจริงมักถูกอัปโหลดเป็นประกาศ/สัญญา/ไฟล์ HR อื่น ๆ แม้เนื้อหาเป็นนโยบาย
      return accessibleDocs.filter(d => d.content || ['policies', 'announcements'].includes(d.category));

    case 'announcement_query':
      return accessibleDocs.filter(d => d.category === 'announcements');

    default:
      return accessibleDocs.filter(d => d.content);
  }
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
 * สร้างคำตอบจาก AI (Gemini) หรือ fallback
 */
export async function generateResponse(message, user, options = {}) {
  const intent = analyzeIntent(message);
  const roleContext = getRoleContext(user.role);
  const channel = options.channel || 'PWA';
  const historyText = normalizeHistory(options.history);
  const userContext = await buildUserContext(user, channel);

  // Handle document requests
  if (intent.type === 'document_request') {
    const docs = await findRelevantDocuments(intent, user.role, user.employeeId);
    if (docs.length > 0) {
      const matchedDoc = intent.docName
        ? docs.find(d => d.name.includes(intent.docName)) || docs[0]
        : null;

      return {
        text: matchedDoc
          ? `📄 พบเอกสาร **"${matchedDoc.name}"** ค่ะ\n\nคุณสามารถดาวน์โหลดได้จากด้านล่างนี้เลย`
          : `📄 มีเอกสารที่เกี่ยวข้องดังนี้ค่ะ`,
        documents: publicDocuments(matchedDoc ? [matchedDoc] : docs.slice(0, 5)),
        intent: intent.type,
        source: 'document-list',
      };
    }
    return {
      text: '❌ ไม่พบเอกสารที่ต้องการ หรือคุณไม่มีสิทธิ์เข้าถึงเอกสารนี้ กรุณาติดต่อฝ่าย HR',
      documents: [],
      intent: intent.type,
      source: 'document-list',
    };
  }

  // Handle data queries
  if (intent.type === 'data_query') {
    if (intent.dataType === 'leave') {
      // ตรวจสอบสิทธิ์
      const targetEmployeeId = user.employeeId;
      if (!canAccessEmployeeData(user.role, targetEmployeeId, user.employeeId)) {
        return {
          text: '🔒 คุณไม่มีสิทธิ์ดูข้อมูลวันลาของพนักงานท่านนี้',
          documents: [],
          intent: intent.type,
          source: 'system-data',
        };
      }

      const leaveData = await getEmployeeData(targetEmployeeId, 'leave');
      if (leaveData && leaveData.leave) {
        const { leave } = leaveData;
        const lines = Object.values(leave).map((item) =>
          `• **${item.label || item.code}**: ใช้ไป ${item.used} วัน | คงเหลือ **${item.remaining} วัน** (จาก ${item.total} วัน)`
        );
        return {
          text: `📅 **วันลาคงเหลือของคุณ ${leaveData.name}** ณ ปัจจุบัน:\n\n` +
            `${lines.join('\n')}\n\n` +
            `📎 อ้างอิง: employee-data/leave-balance`,
          documents: [],
          intent: intent.type,
          source: 'system-data',
        };
      }
      return {
        text: '❌ ไม่พบข้อมูลวันลาของคุณในระบบ กรุณาติดต่อฝ่าย HR',
        documents: [],
        intent: intent.type,
        source: 'system-data',
      };
    }

    if (intent.dataType === 'profile') {
      const profileData = await getEmployeeData(user.employeeId);
      if (profileData) {
        return {
          text: `👤 **ข้อมูลพนักงาน: ${profileData.name}**\n\n` +
            `• 🏢 แผนก: ${profileData.department}\n` +
            `• 💼 ตำแหน่ง: ${profileData.position}\n` +
            `• 📅 วันเริ่มงาน: ${profileData.startDate}\n`,
          documents: [],
          intent: intent.type,
          source: 'system-data',
        };
      }
    }
  }

  // Handle policy questions & general — แบบไฮบริด (ประหยัดโควต้า Gemini)
  const relevantDocs = await findRelevantDocuments(intent, user.role, user.employeeId);
  const docsWithContent = relevantDocs.filter(d => d.content);
  const templateDocs = publicDocuments(relevantDocs.filter(d => d.category === 'templates').slice(0, 3));

  // เกณฑ์ความมั่นใจของ RAG (ปรับได้)
  const SIM_HIGH = 0.60; // ตรงพอ → ตอบจากเนื้อหาตรงๆ ไม่ต้องเรียก Gemini (จูนจากค่าจริงของ gemini-embedding-001)
  const SIM_LOW = 0.45;  // พอเกี่ยว → เรียก Gemini เรียบเรียง โดยส่งเฉพาะชิ้นที่เกี่ยว

  // คำถามที่ต้องให้ Gemini ช่วย "เรียบเรียง/สรุป/กรองเฉพาะส่วน/ตอบใช่-ไม่ใช่" แม้เจอชิ้นตรง
  // (เพราะการยกเนื้อหาทั้งชิ้นมาตอบจะไม่ตรงคำถาม เช่น ถามเฉพาะเดือน หรือถามว่ามี/ไม่มี)
  const requestedClauseNumber = parseRequestedClauseNumber(message);
  const monthNames = /มกราคม|กุมภาพันธ์|มีนาคม|เมษายน|พฤษภาคม|มิถุนายน|กรกฎาคม|สิงหาคม|กันยายน|ตุลาคม|พฤศจิกายน|ธันวาคม/;
  const yesNoQuestion = /มั้ย|ไหม|หรือไม่|รึเปล่า|หรือเปล่า|ได้ไหม|ใช่ไหม/;
  const listOrFollowUpQuestion = /อะไรบ้าง|มีอะไร|บ้าง|แล้ว.+ล่ะ|แล้ว.+ละ|ต่อจากนั้น|กรณีนี้/;
  const needsSynthesis =
    /สรุป|เปรียบเทียบ|ต่างกัน|แตกต่าง|ทำไม|เพราะอะไร|แนะนำ|ควรทำ|อธิบาย|ยังไง|อย่างไร|เฉพาะ|กี่วัน|วันไหน/.test(message) ||
    monthNames.test(message) ||
    yesNoQuestion.test(message) ||
    listOrFollowUpQuestion.test(message) ||
    !!requestedClauseNumber;

  // ค้นชิ้นที่ตรงคำถามที่สุดด้วย embedding (ใช้โควต้า embedding ซึ่งแยกจาก chat)
  const exactSections = extractRequestedNumberedSections(message, docsWithContent);
  let chunks = [...exactSections];
  try {
    const docIdToName = new Map(docsWithContent.map(d => [d.id, d.name]));
    const found = await retrieveChunks(message, [...docIdToName.keys()], 8);
    const ragChunks = found.map(c => ({ ...c, docName: docIdToName.get(c.documentId) || 'เอกสาร' }));
    const seen = new Set(chunks.map(c => `${c.documentId}:${c.content}`));
    chunks.push(...ragChunks.filter(c => !seen.has(`${c.documentId}:${c.content}`)));
  } catch (err) {
    console.error('RAG retrieve error:', err);
  }

  if (chunks.length === 0) {
    chunks = keywordSearchChunks(message, docsWithContent, 8);
  }

  const topSim = chunks.length > 0 ? chunks[0].similarity : 0;
  const relevantChunks = chunks.filter(c => c.similarity >= SIM_LOW);

  if (exactSections.length === 1) {
    const section = exactSections[0];
    return {
      text: `📋 ตามเอกสาร **${section.docName}** ข้อ ${section.clauseNumber} ระบุว่า:\n\n${section.content}\n\n💬 หากต้องการให้สรุปผลกระทบหรือแนวปฏิบัติต่อจากข้อนี้ สอบถามต่อได้เลยค่ะ`,
      documents: templateDocs,
      intent: intent.type,
      source: 'section-direct',
    };
  }

  // ----- ระดับ 1: มั่นใจสูง + ไม่ต้องเรียบเรียง → ตอบจากเนื้อหาตรงๆ (ไม่เรียก Gemini) -----
  if (topSim >= SIM_HIGH && !needsSynthesis) {
    const top = chunks[0];
    // รวมชิ้นถัดไปถ้ามาจากเอกสารเดียวกันและตรงพอๆ กัน (เนื้อหาต่อเนื่อง)
    const extra = chunks
      .slice(1, 3)
      .filter(c => c.documentId === top.documentId && c.similarity >= SIM_HIGH - 0.07);
    const body = [top, ...extra].map(c => c.content).join('\n\n');
    return {
      text: `📋 ตามเอกสาร **${top.docName}** ค่ะ:\n\n${body}\n\n💬 หากต้องการรายละเอียดเพิ่มเติม สอบถามฝ่าย HR ได้เลยค่ะ`,
      documents: templateDocs,
      intent: intent.type,
      source: 'rag-direct',
    };
  }

  // เตรียม context สำหรับ Gemini — ส่งเฉพาะชิ้นที่เกี่ยว (ถ้าไม่มี ใช้เนื้อหาเต็มแบบตัดสั้น)
  let context = exactSections.length > 0
    ? exactSections.map(c => `[${c.docName} ข้อ ${c.clauseNumber}]: ${c.content}`).join('\n\n')
    : relevantChunks.length > 0
    ? relevantChunks.map(c => `[${c.docName}]: ${c.content}`).join('\n\n')
    : docsWithContent.map(d => `[${d.name}]: ${d.content}`).join('\n\n').slice(0, 8000);

  // ----- ระดับ 2: เรียก Gemini โดยส่ง context ที่กระชับแล้ว -----
  if (genAI) {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const prompt = `${SYSTEM_PROMPT}

บริบทผู้ใช้:
${userContext}

บริบทสิทธิ์:
${roleContext}

ประวัติสนทนาล่าสุด:
${historyText || '(ไม่มี)'}

ข้อมูลอ้างอิง:
${context || '(ไม่มีข้อมูลอ้างอิงที่เกี่ยวข้องกับคำถามนี้)'}

คำถามล่าสุด: ${message}`;

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        return {
          text: response.text(),
          documents: templateDocs,
          intent: intent.type,
          source: 'gemini',
        };
      } catch (error) {
        console.error(`Gemini API error (attempt ${attempt}):`, error);
        if (attempt === 1) await new Promise(r => setTimeout(r, 1000));
      }
    }
  }

  // ----- ระดับ 3 (Gemini ล่ม/โควต้าหมด): ตอบจากชิ้นที่ค้นเจอตรงๆ ถ้ามี -----
  if (relevantChunks.length > 0) {
    const top = relevantChunks[0];
    return {
      text: `📋 ตามเอกสาร **${top.docName}** ค่ะ:\n\n${top.content}\n\n💬 (ระบบ AI กำลังใช้งานหนาแน่น จึงดึงเนื้อหาที่เกี่ยวข้องมาแสดง) สอบถามฝ่าย HR เพิ่มเติมได้ค่ะ`,
      documents: templateDocs,
      intent: intent.type,
      source: 'rag-fallback',
    };
  }

  return {
    text: '🤔 ขออภัยค่ะ ไม่พบข้อมูลที่ตรงกับคำถามนี้ในเอกสาร และระบบ AI กำลังใช้งานหนาแน่น กรุณาลองใหม่อีกครั้ง หรือติดต่อฝ่าย HR โดยตรงค่ะ',
    documents: [],
    intent: 'general',
    source: 'none',
  };
}
