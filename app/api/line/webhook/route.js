import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { generateResponse } from '@/lib/gemini.js';
import { getLineMappings, setLineMapping, findUserByEmployeeId, addAuditEntry } from '@/lib/db.js';
import { createToken } from '@/lib/auth.js';

const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET || '';
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';
const lineMemory = new Map();

function getLineHistory(userId) {
  return lineMemory.get(userId) || [];
}

function rememberLineTurn(userId, userText, assistantText) {
  const next = [
    ...getLineHistory(userId),
    { role: 'user', content: userText },
    { role: 'ai', content: assistantText },
  ].slice(-8);
  lineMemory.set(userId, next);
}

/**
 * ตรวจสอบความถูกต้องของ LINE Webhook Signature
 */
function verifySignature(body, signature) {
  if (!LINE_CHANNEL_SECRET) return true; // ข้ามใน dev ถ้าไม่ได้ตั้งค่า secret
  const hash = crypto
    .createHmac('SHA256', LINE_CHANNEL_SECRET)
    .update(body)
    .digest('base64');
  return hash === signature;
}

/**
 * ส่งข้อความตอบกลับไปยัง LINE Platform
 */
async function replyMessage(replyToken, messages) {
  if (!LINE_CHANNEL_ACCESS_TOKEN) {
    console.log('[LINE Mock] Reply token:', replyToken, JSON.stringify(messages, null, 2));
    return;
  }

  const res = await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({ replyToken, messages }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`LINE reply failed: ${res.status} ${detail}`);
  }
}

/**
 * Flex Message สำหรับการติดต่อ HR ตัวจริง (Human Escalation)
 */
function createHumanEscalationResponse(employeeName = '') {
  return {
    type: 'flex',
    altText: 'ช่องทางการติดต่อฝ่ายบุคคล (HR)',
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#7c3aed',
        paddingAll: '16px',
        contents: [
          { type: 'text', text: '👩‍💼 ฝ่ายทรัพยากรบุคคล (HR)', weight: 'bold', size: 'md', color: '#ffffff' },
          { type: 'text', text: 'บริษัท ดีดี เซอร์วิส แอนด์ ทรานสปอร์ต จำกัด', size: 'xs', color: '#ddd6fe', margin: 'xs' },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        contents: [
          {
            type: 'text',
            text: `สวัสดีค่ะคุณ ${employeeName || 'พนักงาน'} หากต้องการติดต่อเจ้าหน้าที่ HR เพื่อปรึกษาเรื่องส่วนตัว ร้องเรียน หรือสอบถามข้อมูลเพิ่มเติม สามารถติดต่อได้ตามช่องทางนี้ค่ะ:`,
            wrap: true,
            size: 'sm',
            color: '#374151',
          },
          {
            type: 'box',
            layout: 'vertical',
            margin: 'md',
            spacing: 'sm',
            backgroundColor: '#f3f4f6',
            paddingAll: '12px',
            cornerRadius: '8px',
            contents: [
              { type: 'text', text: '📞 โทรศัพท์: 02-123-4567 ต่อ 101-104', size: 'xs', weight: 'bold', color: '#1f2937' },
              { type: 'text', text: '⏰ เวลาทำการ: จันทร์ - ศุกร์ 08:30 - 17:30 น.', size: 'xs', color: '#4b5563' },
              { type: 'text', text: '✉️ อีเมล: hr@ddtransport.co.th', size: 'xs', color: '#4b5563' },
              { type: 'separator', margin: 'sm' },
              { type: 'text', text: '🚨 เหตุฉุกเฉิน/อุบัติเหตุ 24 ชม.: โทร 1669 / สายด่วนศูนย์ควบคุม', size: 'xs', color: '#dc2626', weight: 'bold' },
            ],
          },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          {
            type: 'button',
            action: { type: 'uri', label: '📞 โทรหาฝ่ายบุคคล', uri: 'tel:021234567' },
            style: 'primary',
            color: '#7c3aed',
            height: 'sm',
          },
          {
            type: 'button',
            action: { type: 'message', label: 'แจ้งให้ HR โทรกลับ', text: 'ต้องการให้เจ้าหน้าที่ HR ติดต่อกลับด่วน' },
            style: 'secondary',
            height: 'sm',
          },
        ],
      },
    },
  };
}

/**
 * Flex Message สำหรับการแสดงคำตอบและเอกสารแนบ
 */
function createFlexResponse(text, documents = [], userName = '', downloadToken = '') {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://hr-ai-chatbot-tawny.vercel.app';
  const contents = {
    type: 'bubble',
    header: {
      type: 'box',
      layout: 'horizontal',
      contents: [
        { type: 'text', text: '🤖 พี่ HR ผู้ช่วยอัจฉริยะ', weight: 'bold', size: 'sm', color: '#7c3aed' },
      ],
    },
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'text',
          text: text.replace(/\*\*/g, '').replace(/<br\/>/g, '\n').slice(0, 800),
          wrap: true,
          size: 'sm',
          color: '#1f2937',
          lineSpacing: '4px',
        },
      ],
    },
  };

  if (documents.length > 0) {
    contents.footer = {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      contents: [
        {
          type: 'text',
          text: '📄 แตะปุ่มด้านล่างเพื่อดาวน์โหลดไฟล์จริง:',
          size: 'xs',
          color: '#6b7280',
          weight: 'bold',
        },
        ...documents.slice(0, 3).map((doc) => {
          const downloadUrl = `${baseUrl}/api/documents/${doc.id}/download${downloadToken ? `?token=${encodeURIComponent(downloadToken)}` : ''}`;
          const cleanName = (doc.name || 'เอกสาร').replace(/^แบบฟอร์ม|^Template/i, '').trim();
          const label = `📥 โหลด: ${cleanName.slice(0, 11)}`;
          return {
            type: 'button',
            action: {
              type: 'uri',
              label,
              uri: downloadUrl,
            },
            style: 'primary',
            color: '#7c3aed',
            height: 'sm',
          };
        }),
      ],
    };
  }

  return {
    type: 'flex',
    altText: text.slice(0, 100),
    contents,
  };
}

/**
 * Flex Message ชวนลงทะเบียนครั้งแรก
 */
function createRegistrationPrompt() {
  return {
    type: 'flex',
    altText: 'ลงทะเบียนเพื่อใช้งาน HR Assistant',
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#7c3aed',
        paddingAll: '16px',
        contents: [
          { type: 'text', text: '🤖 ระบบ HR Assistant', weight: 'bold', size: 'lg', color: '#ffffff', align: 'center' },
          { type: 'text', text: 'บริษัท ดีดี เซอร์วิส แอนด์ ทรานสปอร์ต จำกัด', size: 'xs', color: '#ddd6fe', align: 'center', margin: 'xs' },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        contents: [
          { type: 'text', text: 'สวัสดีค่ะ! ยินดีต้อนรับสู่ระบบบริการข้อมูลพนักงาน', wrap: true, size: 'sm', color: '#374151' },
          { type: 'text', text: 'เพื่อความปลอดภัยและการดึงข้อมูลสิทธิ์ส่วนบุคคล กรุณาพิมพ์รหัสพนักงานของคุณเพื่อเริ่มใช้งานนะคะ', wrap: true, size: 'xs', color: '#6b7280' },
          {
            type: 'box',
            layout: 'vertical',
            backgroundColor: '#f5f3ff',
            paddingAll: '10px',
            cornerRadius: '6px',
            contents: [
              { type: 'text', text: 'ตัวอย่างการพิมพ์: ลงทะเบียน DD-001', weight: 'bold', size: 'xs', color: '#6d28d9', align: 'center' },
            ],
          },
        ],
      },
    },
  };
}

/**
 * Quick Reply buttons อัจฉริยะตามหมวดหมู่คำถาม (คุม Label ไม่เกิน 12-14 ตัวอักษร ป้องกันจอตัดคำ)
 */
function getQuickReply(intentType = '') {
  if (intentType === 'leave' || intentType === 'data_query') {
    return {
      items: [
        { type: 'action', action: { type: 'uri', label: '🌐 ยื่นลาในระบบ', uri: 'https://hr-ai-chatbot-tawny.vercel.app/me' } },
        { type: 'action', action: { type: 'message', label: '📝 ขอฟอร์มใบลา', text: 'ขอแบบฟอร์มใบลา' } },
        { type: 'action', action: { type: 'message', label: '📋 กฎการลาป่วย', text: 'ระเบียบการลาป่วยต้องใช้ใบรับรองแพทย์ไหม' } },
        { type: 'action', action: { type: 'message', label: '📞 ติดต่อ HR', text: 'ติดต่อ HR' } },
      ],
    };
  }

  return {
    items: [
      { type: 'action', action: { type: 'message', label: '📅 วันลาคงเหลือ', text: 'วันลาคงเหลือ' } },
      { type: 'action', action: { type: 'message', label: '📋 ระเบียบทำงาน', text: 'เวลาทำงานและกฎระเบียบบริษัท' } },
      { type: 'action', action: { type: 'message', label: '💰 เงินเดือน/โอที', text: 'รอบการจ่ายเงินเดือนและค่าโอที' } },
      { type: 'action', action: { type: 'message', label: '🛡️ กฎความปลอดภัย', text: 'แนวปฏิบัติด้านความปลอดภัยคนขับรถ' } },
      { type: 'action', action: { type: 'message', label: '📞 ติดต่อ HR', text: 'ติดต่อ HR' } },
    ],
  };
}

export async function POST(request) {
  try {
    const bodyText = await request.text();
    const signature = request.headers.get('x-line-signature');

    // ตรวจสอบลายเซ็น
    if (!verifySignature(bodyText, signature)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    const body = JSON.parse(bodyText);
    const events = body.events || [];

    // LINE platform verification event
    if (events.length === 0) {
      return NextResponse.json({ success: true });
    }

    for (const event of events) {
      const userId = event.source?.userId;

      // Event เพิ่มเพื่อนใหม่
      if (event.type === 'follow') {
        await replyMessage(event.replyToken, [createRegistrationPrompt()]);
        continue;
      }

      // Event ได้รับข้อความ
      if (event.type === 'message' && event.message?.type === 'text') {
        const text = event.message.text.trim();

        // 1. ตรวจสอบคำสั่งลงทะเบียน
        if (text.startsWith('ลงทะเบียน')) {
          const empId = text.replace('ลงทะเบียน', '').trim().toUpperCase();
          const employee = await findUserByEmployeeId(empId);

          if (!employee) {
            await replyMessage(event.replyToken, [{
              type: 'text',
              text: `❌ ไม่พบรหัสพนักงาน "${empId}" ในระบบบริษัท\nกรุณาตรวจสอบรหัสพนักงานที่ถูกต้อง หรือติดต่อฝ่ายบุคคลนะคะ`,
            }]);
            continue;
          }

          await setLineMapping(userId, {
            employeeId: employee.employeeId,
            name: employee.name,
            role: employee.role,
            registeredAt: new Date().toISOString(),
          });
          await addAuditEntry({ user: employee.name, action: 'ลงทะเบียน LINE สำเร็จ', channel: 'LINE' });

          await replyMessage(event.replyToken, [{
            type: 'text',
            text: `✅ ลงทะเบียนสำเร็จเรียบร้อยค่ะ!\n\nยินดีต้อนรับคุณ ${employee.name} (${employee.employeeId})\nคุณสามารถพิมพ์คำถามเกี่ยวกับระเบียบ สวัสดิการ วันลา หรือสอบถามข้อข้องใจกับพี่ HR ได้เลยนะคะ`,
            quickReply: getQuickReply(),
          }]);
          continue;
        }

        // 2. ตรวจสอบว่าผู้ใช้ผูกบัญชีหรือยัง
        const lineMappings = await getLineMappings();
        const userMapping = lineMappings[userId];
        if (!userMapping) {
          await replyMessage(event.replyToken, [createRegistrationPrompt()]);
          continue;
        }

        // 3. ตรวจสอบเคสขอติดต่อคนจริง / Human Escalation / แจ้งเหตุฉุกเฉิน
        if (/^(ติดต่อ hr|ขอเบอร์ hr|คุยกับคน|คุยกับ hr|แจ้งอุบัติเหตุ|ร้องเรียน|ติดต่อเจ้าหน้าที่|สายด่วน)/i.test(text)) {
          await addAuditEntry({
            user: userMapping.name,
            action: `[ร้องขอติดต่อ HR] ${text}`,
            channel: 'LINE',
            type: 'escalation',
          });

          await replyMessage(event.replyToken, [
            createHumanEscalationResponse(userMapping.name),
          ]);
          continue;
        }

        // 4. ส่งข้อความเข้าประมวลผลผ่าน Smart Hybrid AI (Gemini Flash / Tier 0)
        const response = await generateResponse(text, {
          ...userMapping,
          id: userId,
        }, {
          channel: 'LINE',
          history: getLineHistory(userId),
        });

        rememberLineTurn(userId, text, response.text);

        await addAuditEntry({
          user: userMapping.name,
          action: text.slice(0, 80),
          channel: 'LINE',
          type: 'chat',
        });

        // 5. ส่งคำตอบกลับ
        const messages = [];
        if (response.documents?.length > 0) {
          const downloadToken = createToken(userMapping);
          const flexMsg = createFlexResponse(response.text, response.documents, userMapping.name, downloadToken);
          flexMsg.quickReply = getQuickReply(response.intent);
          messages.push(flexMsg);
        } else {
          messages.push({
            type: 'text',
            text: response.text.replace(/\*\*/g, '').replace(/<br\/>/g, '\n'),
            quickReply: getQuickReply(response.intent),
          });
        }

        await replyMessage(event.replyToken, messages);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('LINE webhook error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

// LINE webhook GET verification
export async function GET() {
  return NextResponse.json({ status: 'LINE webhook is active and ready' });
}
