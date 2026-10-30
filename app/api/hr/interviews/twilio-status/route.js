import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { supabase } from '@/lib/supabase';

// Webhook สาธารณะที่ Twilio เรียกเพื่อแจ้งสถานะสาย (ไม่มี JWT — ยืนยันด้วยลายเซ็น Twilio แทน)
// POST /api/hr/interviews/twilio-status?session=<id>

// ยืนยัน X-Twilio-Signature: HMAC-SHA1(url + คีย์+ค่าที่เรียงตามลำดับ) ด้วย auth token
function verifyTwilioSignature(fullUrl, params, signature) {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token) return false;
  let data = fullUrl;
  for (const key of Object.keys(params).sort()) data += key + params[key];
  const expected = crypto.createHmac('sha1', token).update(Buffer.from(data, 'utf-8')).digest('base64');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature || ''));
  } catch {
    return false;
  }
}

export async function POST(request) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get('session');

  const form = await request.formData();
  const params = {};
  for (const [k, v] of form.entries()) params[k] = String(v);

  // ยืนยันลายเซ็น (ต้องใช้ URL เต็มแบบที่ Twilio เรียก — อิง APP_PUBLIC_URL ถ้ามี)
  const base = (process.env.APP_PUBLIC_URL || `${url.protocol}//${url.host}`).replace(/\/$/, '');
  const fullUrl = `${base}${url.pathname}${url.search}`;
  const sig = request.headers.get('x-twilio-signature');
  if (!verifyTwilioSignature(fullUrl, params, sig)) {
    return NextResponse.json({ error: 'ลายเซ็นไม่ถูกต้อง' }, { status: 403 });
  }

  const callStatus = params.CallStatus; // queued/ringing/in-progress/completed/busy/no-answer/failed/canceled
  if (!sessionId) return NextResponse.json({ ok: true });

  // จัดการเฉพาะสถานะที่สายไม่สำเร็จ — ปล่อยให้ bridge เป็นคนปิดเป็น completed เอง
  const map = {
    'no-answer': 'no_answer',
    busy: 'no_answer',
    failed: 'failed',
    canceled: 'failed',
  };
  const newStatus = map[callStatus];
  if (newStatus) {
    // อัปเดตเฉพาะกรณีสายยังไม่เข้าสู่การสัมภาษณ์ (กัน clobber ทับผลจริง)
    const { data: s } = await supabase
      .from('interview_sessions')
      .select('status')
      .eq('id', sessionId)
      .maybeSingle();
    if (s && ['queued', 'calling'].includes(s.status)) {
      await supabase.from('interview_sessions').update({ status: newStatus }).eq('id', sessionId);
    }
  }

  return NextResponse.json({ ok: true });
}
