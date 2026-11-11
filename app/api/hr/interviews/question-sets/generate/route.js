import { NextResponse } from 'next/server';
import { requireMenu } from '@/lib/hr-access';
import { chatComplete } from '@/lib/llm';

// POST /api/hr/interviews/question-sets/generate — ให้ AI ช่วยออกแบบชุดคำถามสัมภาษณ์ตามตำแหน่งงาน
export async function POST(request) {
  // สิทธิ์: ผู้มีสิทธิ์เข้าเมนู interviews หรือ applicants
  let auth = await requireMenu(request, 'interviews');
  if (auth.error) {
    auth = await requireMenu(request, 'applicants');
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const body = await request.json();
  const position = (body.position || '').trim();
  const department = (body.department || '').trim();
  const details = (body.details || '').trim();

  if (!position) {
    return NextResponse.json({ error: 'กรุณาระบุตำแหน่งงานที่ต้องการให้ AI ออกแบบคำถาม' }, { status: 400 });
  }

  const prompt = `คุณเป็นผู้เชี่ยวชาญด้านการสรรหาและคัดเลือกบุคลากร (Senior Talent Acquisition Specialist) ของบริษัท ดีดี เซอร์วิส แอนด์ ทรานสปอร์ต จำกัด
กรุณาออกแบบชุดคำถามสำหรับใช้ในการ "สัมภาษณ์งานเบื้องต้นด้วยระบบ AI (Voice Interview)" สำหรับตำแหน่งงานต่อไปนี้:

ตำแหน่ง: ${position}
${department ? `แผนก/สายงาน: ${department}` : ''}
${details ? `รายละเอียดหน้าที่/ข้อกำหนดเพิ่มเติม: ${details}` : ''}

ข้อกำหนดในการออกแบบ:
1. ออกแบบคำถาม 4 ถึง 5 ข้อ ที่ตรงสายงาน เจาะลึกทักษะความสามารถจริง (Hard Skills), ทัศนคติและการแก้ปัญหาเฉพาะหน้า (Soft Skills & Problem Solving), และความพร้อมในการทำงาน
2. ภาษาที่ใช้ต้องสุภาพ เป็นมืออาชีพ ชัดเจน เข้าใจง่ายเมื่อผู้สมัครฟังผ่านระบบเสียง (AI Voice)
3. กำหนดน้ำหนักความสำคัญ (weight) ของแต่ละคำถามเป็นตัวเลข 1, 1.5 หรือ 2 (โดยคำถามที่ชี้ขาดความเหมาะสมในหน้าที่หลักให้น้ำหนัก 2)
4. ข้อความขอความยินยอม (PDPA) ต้องถูกต้อง ชัดเจน
5. ตอบกลับเป็น JSON รูปแบบนี้เท่านั้น ห้ามมี markdown หรือข้อความอื่นนอก JSON:
{
  "name": "สัมภาษณ์: ${position}",
  "position": "${position}",
  "intro_script": "ข้อความเกริ่นนำและทักทายผู้สมัครภาษาไทย",
  "consent_script": "ข้อความขอความยินยอมบันทึกเสียงและประมวลผลคำตอบตามกฎหมาย PDPA ภาษาไทย",
  "questions": [
    {
      "q": "ข้อความคำถามภาษาไทย",
      "weight": 2
    }
  ]
}`;

  try {
    const raw = await chatComplete(prompt);
    const startIdx = raw.indexOf('{');
    const endIdx = raw.lastIndexOf('}');
    if (startIdx === -1 || endIdx === -1) {
      throw new Error('AI ไม่ได้ส่งผลลัพธ์ในรูปแบบ JSON');
    }
    const parsed = JSON.parse(raw.slice(startIdx, endIdx + 1));

    // Normalize questions
    const questions = Array.isArray(parsed.questions)
      ? parsed.questions.map((q) => ({
          q: (q.q || '').trim(),
          weight: Number(q.weight) > 0 ? Number(q.weight) : 1,
        })).filter((q) => q.q)
      : [];

    if (questions.length === 0) {
      throw new Error('ไม่พบรายการคำถามในผลลัพธ์ของ AI');
    }

    return NextResponse.json({
      ok: true,
      data: {
        name: parsed.name || `สัมภาษณ์: ${position}`,
        position: position,
        lang: 'th',
        intro_script: parsed.intro_script || `สวัสดีครับ ยินดีต้อนรับสู่การสัมภาษณ์งานเบื้องต้นในตำแหน่ง ${position} ครับ`,
        consent_script: parsed.consent_script || 'การสัมภาษณ์นี้จะถูกบันทึกเสียงและประมวลผลคำตอบเพื่อส่งให้ฝ่ายบุคคลพิจารณา ท่านยินยอมที่จะดำเนินการต่อหรือไม่ครับ',
        questions,
        active: true,
      },
    });
  } catch (err) {
    console.error('Generate questions error:', err);
    return NextResponse.json(
      { error: 'เกิดข้อผิดพลาดในการให้ AI ออกแบบคำถาม: ' + err.message },
      { status: 500 }
    );
  }
}
