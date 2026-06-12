import { GoogleGenerativeAI } from '@google/generative-ai';
import { filterDocumentsByRole, getRoleContext, canAccessEmployeeData } from './permissions';
import { getDocuments, getEmployeeRecord } from './db';

const genAI = process.env.GEMINI_API_KEY
  ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  : null;

const SYSTEM_PROMPT = `คุณคือ "HR Assistant" ผู้ช่วย HR อัจฉริยะของบริษัท คุณต้อง:
1. ตอบคำถามเป็นภาษาไทยเสมอ ใช้ภาษาสุภาพ เป็นมิตร
2. ตอบจากข้อมูลที่ให้เท่านั้น ห้ามสมมุติหรือคิดเอง
3. ถ้าไม่มีข้อมูลที่เกี่ยวข้อง ให้แจ้งว่า "ไม่พบข้อมูลที่เกี่ยวข้อง กรุณาติดต่อฝ่าย HR โดยตรง"
4. ถ้าเป็นคำขอเอกสาร/Template ให้แจ้งชื่อเอกสารและบอกว่าสามารถดาวน์โหลดได้
5. อ้างอิงเอกสารที่ใช้ตอบทุกครั้ง
6. จัดรูปแบบคำตอบให้อ่านง่าย ใช้ bullet points หรือรายการ
7. ห้ามเปิดเผยข้อมูลที่ผู้ใช้ไม่มีสิทธิ์เห็น`;

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

  // ขอเอกสาร/Template — ใช้ ขอ(?!ง) กันไม่ให้คำว่า "ของ" ถูกตีความเป็น "ขอ"
  if (msg.match(/ขอ(?!ง)|ต้องการ|ดาวน์โหลด|template|แบบฟอร์ม|ใบสมัคร|ใบลา|เอกสาร/)) {
    if (msg.match(/ใบสมัคร|สมัครงาน|application/)) return { type: 'document_request', docName: 'ใบสมัครงาน' };
    if (msg.match(/ใบลา|ลาพักร้อน|ลาป่วย|ลากิจ|leave/)) return { type: 'document_request', docName: 'ใบลา' };
    if (msg.match(/ประเมิน|performance|review/)) return { type: 'document_request', docName: 'แบบประเมินผล' };
    if (msg.match(/สัญญา|contract/)) return { type: 'document_request', docName: 'สัญญาจ้าง' };
    return { type: 'document_request', docName: null };
  }

  // ถามระเบียบ/Policy (รวมถึงคำถามทั่วไปเกี่ยวกับประเภท/สิทธิการลา)
  if (msg.match(/ระเบียบ|กฎ|นโยบาย|policy|สวัสดิการ|benefit|แต่งกาย|การลา|ได้กี่วัน|วันลา|ลาพักร้อน|ลาป่วย|ลากิจ/)) {
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
      return accessibleDocs.filter(d => d.category === 'templates');

    case 'policy_question':
      return accessibleDocs.filter(d => d.category === 'policies');

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
export async function generateResponse(message, user) {
  const intent = analyzeIntent(message);
  const roleContext = getRoleContext(user.role);

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
        documents: matchedDoc ? [matchedDoc] : docs.slice(0, 5),
        intent: intent.type,
      };
    }
    return {
      text: '❌ ไม่พบเอกสารที่ต้องการ หรือคุณไม่มีสิทธิ์เข้าถึงเอกสารนี้ กรุณาติดต่อฝ่าย HR',
      documents: [],
      intent: intent.type,
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
        };
      }

      const leaveData = await getEmployeeData(targetEmployeeId, 'leave');
      if (leaveData && leaveData.leave) {
        const { leave } = leaveData;
        return {
          text: `📅 **วันลาคงเหลือของคุณ ${leaveData.name}** ณ ปัจจุบัน:\n\n` +
            `• 🏖️ **ลาพักร้อน**: ใช้ไป ${leave.annual.used} วัน | คงเหลือ **${leave.annual.remaining} วัน** (จาก ${leave.annual.total} วัน)\n` +
            `• 🏥 **ลาป่วย**: ใช้ไป ${leave.sick.used} วัน | คงเหลือ **${leave.sick.remaining} วัน** (จาก ${leave.sick.total} วัน)\n` +
            `• 📋 **ลากิจ**: ใช้ไป ${leave.personal.used} วัน | คงเหลือ **${leave.personal.remaining} วัน** (จาก ${leave.personal.total} วัน)\n\n` +
            `📎 อ้างอิง: employee-data/leave-balance`,
          documents: [],
          intent: intent.type,
        };
      }
      return {
        text: '❌ ไม่พบข้อมูลวันลาของคุณในระบบ กรุณาติดต่อฝ่าย HR',
        documents: [],
        intent: intent.type,
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
        };
      }
    }
  }

  // Handle policy questions & general with AI or fallback
  const relevantDocs = await findRelevantDocuments(intent, user.role, user.employeeId);
  const context = relevantDocs
    .filter(d => d.content)
    .map(d => `[${d.name}]: ${d.content}`)
    .join('\n\n');

  // Try Gemini AI
  if (genAI) {
    try {
      const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
      const prompt = `${SYSTEM_PROMPT}\n\n${roleContext}\n\nข้อมูลอ้างอิง:\n${context}\n\nคำถาม: ${message}`;

      const result = await model.generateContent(prompt);
      const response = await result.response;

      return {
        text: response.text(),
        documents: relevantDocs.filter(d => d.category === 'templates').slice(0, 3),
        intent: intent.type,
      };
    } catch (error) {
      console.error('Gemini API error:', error);
      // fallback will execute next
    }
  }

  // Fallback: ตอบจากข้อมูลที่มีโดยไม่ใช้ AI
  if (context) {
    return {
      text: `จากข้อมูลที่มี ขอตอบดังนี้ค่ะ:\n\n${context.slice(0, 1000)}\n\n📎 *หมายเหตุ: ข้อมูลจาก ${relevantDocs.map(d => d.name).join(', ')}*`,
      documents: relevantDocs.filter(d => d.category === 'templates').slice(0, 3),
      intent: intent.type,
    };
  }

  return {
    text: '🤔 ไม่พบข้อมูลที่เกี่ยวข้องกับคำถามของคุณ กรุณาลองถามใหม่ หรือติดต่อฝ่าย HR โดยตรงค่ะ',
    documents: [],
    intent: 'general',
  };
}
