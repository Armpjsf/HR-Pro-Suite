import { NextResponse } from 'next/server';
import { requireMenu } from '@/lib/hr-access';
import { GoogleGenerativeAI } from '@google/generative-ai';

export async function POST(request) {
  const { error, status } = await requireMenu(request, 'holidays');
  if (error) return NextResponse.json({ error }, { status });

  try {
    const formData = await request.formData();
    const file = formData.get('file');

    if (!file || typeof file === 'string') {
      return NextResponse.json({ error: 'กรุณาแนบไฟล์รูปภาพหรือเอกสาร PDF' }, { status: 400 });
    }

    const key = (process.env.GEMINI_API_KEY || '').replace(/^["']|["']$/g, '').trim();
    if (!key || key.length < 20) {
      return NextResponse.json({ error: 'ไม่พบ GEMINI_API_KEY ในการประมวลผล AI' }, { status: 500 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const mimeType = file.type || 'image/jpeg';

    const genAI = new GoogleGenerativeAI(key);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const prompt = `คุณคือผู้เชี่ยวชาญด้านงาน HR ให้วิเคราะห์และดึงรายการ "วันหยุดตามประเพณี / วันหยุดบริษัท / วันหยุดนักขัตฤกษ์" ทั้งหมดจากเอกสาร/รูปภาพนี้
ระบุปี ค.ศ. ให้ถูกต้องเสมอ (เช่น หากในเอกสารระบุเป็น พ.ศ. 2569 ให้แปลงเป็น ค.ศ. 2026 หรือหากเป็น 2570 ให้แปลงเป็น ค.ศ. 2027)
หากมีหมายเหตุ เช่น การสลับวันหยุด หรือวันหยุดชดเชย ให้ระบุใน note ด้วย

สำคัญ: ตอบเป็น JSON Array เท่านั้น ไม่มีข้อความอธิบายอื่นและไม่ต้องใส่ backticks หรือ markdown:
[
  {
    "holiday_date": "YYYY-MM-DD",
    "name": "ชื่อวันหยุดภาษาไทย",
    "note": "หมายเหตุ หรือชื่อภาษาอังกฤษ (ถ้ามี)"
  }
]`;

    const res = await model.generateContent([
      {
        inlineData: {
          data: buffer.toString('base64'),
          mimeType,
        },
      },
      prompt,
    ]);

    const rawText = res.response.text().trim();
    const cleanedJson = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

    let holidays = [];
    try {
      holidays = JSON.parse(cleanedJson);
    } catch (parseErr) {
      console.error('[scan-holidays] JSON parse error:', parseErr, 'Raw:', rawText);
      return NextResponse.json({ error: 'AI ประมวลผลผลลัพธ์ไม่ตรงรูปแบบ JSON กรุณาลองใหม่อีกครั้ง' }, { status: 500 });
    }

    if (!Array.isArray(holidays)) {
      return NextResponse.json({ error: 'ไม่พบรายการวันหยุดในเอกสารที่แนบ' }, { status: 400 });
    }

    // Filter and sanitize valid dates
    const sanitized = holidays
      .filter((h) => h && h.holiday_date && /^\d{4}-\d{2}-\d{2}$/.test(h.holiday_date) && h.name)
      .map((h) => ({
        holiday_date: h.holiday_date,
        name: String(h.name).trim(),
        note: h.note ? String(h.note).trim() : null,
      }))
      .sort((a, b) => a.holiday_date.localeCompare(b.holiday_date));

    return NextResponse.json({
      success: true,
      count: sanitized.length,
      holidays: sanitized,
    });
  } catch (err) {
    console.error('[scan-holidays] error:', err);
    return NextResponse.json({ error: 'เกิดข้อผิดพลาดในการสแกนไฟล์: ' + err.message }, { status: 500 });
  }
}
