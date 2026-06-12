import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { generateResponse } from '@/lib/gemini';
import { getLineMappings, setLineMapping, findUserByEmployeeId, addAuditEntry } from '@/lib/db';

const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET || '';
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';

/**
 * Verify LINE webhook signature
 */
function verifySignature(body, signature) {
  if (!LINE_CHANNEL_SECRET) return true; // Skip in dev
  const hash = crypto
    .createHmac('SHA256', LINE_CHANNEL_SECRET)
    .update(body)
    .digest('base64');
  return hash === signature;
}

/**
 * Reply to LINE user
 */
async function replyMessage(replyToken, messages) {
  if (!LINE_CHANNEL_ACCESS_TOKEN) {
    console.log('[LINE Mock] Reply:', JSON.stringify(messages, null, 2));
    return;
  }

  await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({ replyToken, messages }),
  });
}

/**
 * Create Flex Message for AI response
 */
function createFlexResponse(text, documents = []) {
  const contents = {
    type: 'bubble',
    header: {
      type: 'box',
      layout: 'horizontal',
      contents: [
        { type: 'text', text: '🤖 HR Assistant', weight: 'bold', size: 'sm', color: '#7c3aed' },
      ],
    },
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'text',
          text: text.replace(/\*\*/g, '').replace(/<br\/>/g, '\n').slice(0, 500),
          wrap: true,
          size: 'sm',
          color: '#333333',
        },
      ],
    },
  };

  // Add document buttons
  if (documents.length > 0) {
    contents.footer = {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      contents: documents.slice(0, 3).map(doc => ({
        type: 'button',
        action: {
          type: 'message',
          label: `📥 ${doc.name.slice(0, 20)}`,
          text: `ขอดาวน์โหลด ${doc.name}`,
        },
        style: 'secondary',
        height: 'sm',
      })),
    };
  }

  return {
    type: 'flex',
    altText: text.slice(0, 100),
    contents,
  };
}

/**
 * Create registration prompt
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
        contents: [
          { type: 'text', text: '🤖 HR AI Assistant', weight: 'bold', size: 'lg', color: '#7c3aed', align: 'center' },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: 'สวัสดีค่ะ! ยินดีต้อนรับสู่ระบบ HR Assistant', wrap: true, size: 'sm' },
          { type: 'text', text: 'กรุณาพิมพ์รหัสพนักงานของคุณเพื่อลงทะเบียน', wrap: true, size: 'sm', margin: 'md', color: '#888888' },
          { type: 'text', text: 'ตัวอย่าง: ลงทะเบียน EMP001', wrap: true, size: 'xs', margin: 'md', color: '#7c3aed' },
        ],
      },
    },
  };
}

/**
 * Quick Reply buttons
 */
function getQuickReply() {
  return {
    items: [
      { type: 'action', action: { type: 'message', label: '📅 วันลา', text: 'วันลาคงเหลือ' } },
      { type: 'action', action: { type: 'message', label: '📄 ใบสมัคร', text: 'ขอ Template ใบสมัครงาน' } },
      { type: 'action', action: { type: 'message', label: '📝 ใบลา', text: 'ขอ Template ใบลา' } },
      { type: 'action', action: { type: 'message', label: '📋 ระเบียบ', text: 'ระเบียบบริษัทมีอะไรบ้าง' } },
      { type: 'action', action: { type: 'message', label: '📢 ประกาศ', text: 'ประกาศล่าสุด' } },
    ],
  };
}
export async function POST(request) {
  try {
    const bodyText = await request.text();
    const signature = request.headers.get('x-line-signature');

    // Verify signature
    if (!verifySignature(bodyText, signature)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    const body = JSON.parse(bodyText);
    const events = body.events || [];

    // LINE platform verification event support
    if (events.length === 0) {
      return NextResponse.json({ success: true });
    }

    for (const event of events) {
      const userId = event.source?.userId;

      // Follow event — new user
      if (event.type === 'follow') {
        await replyMessage(event.replyToken, [createRegistrationPrompt()]);
        continue;
      }

      // Message event
      if (event.type === 'message' && event.message?.type === 'text') {
        const text = event.message.text.trim();

        // Check registration — ตรวจรหัสพนักงานกับระบบจริง แล้วบันทึกการผูกบัญชี
        if (text.startsWith('ลงทะเบียน')) {
          const empId = text.replace('ลงทะเบียน', '').trim().toUpperCase();
          const employee = await findUserByEmployeeId(empId);

          if (!employee) {
            await replyMessage(event.replyToken, [{
              type: 'text',
              text: `❌ ไม่พบรหัสพนักงาน "${empId}" ในระบบ\nกรุณาตรวจสอบรหัสพนักงาน หรือติดต่อฝ่าย HR`,
            }]);
            continue;
          }

          await setLineMapping(userId, {
            employeeId: employee.employeeId,
            name: employee.name,
            role: employee.role,
            registeredAt: new Date().toISOString(),
          });
          await addAuditEntry({ user: employee.name, action: 'ลงทะเบียน LINE', channel: 'LINE' });

          await replyMessage(event.replyToken, [{
            type: 'text',
            text: `✅ ลงทะเบียนสำเร็จ! ยินดีต้อนรับคุณ${employee.name}\nรหัสพนักงาน: ${employee.employeeId}\nคุณสามารถเริ่มถามคำถามได้เลยค่ะ`,
            quickReply: getQuickReply(),
          }]);
          continue;
        }

        // Check if user is registered
        const lineMappings = await getLineMappings();
        const userMapping = lineMappings[userId];
        if (!userMapping) {
          await replyMessage(event.replyToken, [createRegistrationPrompt()]);
          continue;
        }

        // Generate AI response
        const response = await generateResponse(text, {
          ...userMapping,
          id: userId,
        });

        await addAuditEntry({
          user: userMapping.name,
          action: text.slice(0, 80),
          channel: 'LINE',
          type: 'chat',
        });

        // Create response messages
        const messages = [];
        
        if (response.documents?.length > 0) {
          messages.push(createFlexResponse(response.text, response.documents));
        } else {
          messages.push({
            type: 'text',
            text: response.text.replace(/\*\*/g, '').replace(/<br\/>/g, '\n'),
            quickReply: getQuickReply(),
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

// LINE webhook verification
export async function GET() {
  return NextResponse.json({ status: 'LINE webhook is active' });
}
