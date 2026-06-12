import { GoogleGenerativeAI } from '@google/generative-ai';
import { filterDocumentsByRole, getRoleContext, canAccessEmployeeData } from './permissions';
import { getDocuments, getEmployeeRecord } from './db';

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

${COMPANY_PROFILE}`;

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

  // Try Gemini AI — retry once on transient errors (เช่น rate limit/network) ก่อน fallback
  if (genAI) {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const prompt = `${SYSTEM_PROMPT}\n\n${roleContext}\n\nข้อมูลอ้างอิง:\n${context || '(ไม่มีข้อมูลอ้างอิงที่เกี่ยวข้องกับคำถามนี้)'}\n\nคำถาม: ${message}`;

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const result = await model.generateContent(prompt);
        const response = await result.response;

        return {
          text: response.text(),
          documents: relevantDocs.filter(d => d.category === 'templates').slice(0, 3),
          intent: intent.type,
        };
      } catch (error) {
        console.error(`Gemini API error (attempt ${attempt}):`, error);
        if (attempt === 1) await new Promise(r => setTimeout(r, 1000));
      }
    }
  }

  // Fallback (ไม่มี Gemini หรือ Gemini ล้มเหลวทั้งสองครั้ง): ตอบจากข้อมูลที่มีโดยไม่ใช้ AI
  // ใช้การ dump เนื้อหาเอกสารตรงๆ เฉพาะตอนที่เอกสารถูกกรองตาม category ที่เกี่ยวข้องกับคำถามจริง
  // (policy_question/announcement_query) เพื่อไม่ให้เอาเอกสารที่ไม่เกี่ยวข้องมาแสดงตอน intent เป็น 'general'
  if (context && (intent.type === 'policy_question' || intent.type === 'announcement_query')) {
    return {
      text: `จากข้อมูลที่มี ขอตอบดังนี้ค่ะ:\n\n${context.slice(0, 1000)}\n\n📎 *หมายเหตุ: ข้อมูลจาก ${relevantDocs.map(d => d.name).join(', ')}*`,
      documents: relevantDocs.filter(d => d.category === 'templates').slice(0, 3),
      intent: intent.type,
    };
  }

  return {
    text: '🤔 ขออภัยค่ะ ระบบ AI ไม่สามารถตอบคำถามนี้ได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง หรือติดต่อฝ่าย HR โดยตรงค่ะ',
    documents: [],
    intent: 'general',
  };
}
