// lib/twilio.js — โทรออกผ่าน Twilio REST เพื่อเชื่อมเข้าตัว Voice Bridge (เฟส 3)
//
// env ที่ต้องตั้ง (ฝั่ง HR app):
//   TWILIO_ACCOUNT_SID   = ACxxxx...
//   TWILIO_AUTH_TOKEN    = xxxx...
//   TWILIO_FROM_NUMBER   = +1xxxxxxxxxx (เบอร์ที่ซื้อจาก Twilio)
//   BRIDGE_PUBLIC_URL    = https://interview.yourdomain.com  (base ของ voice-bridge, ต้อง public)
//   APP_PUBLIC_URL       = https://hr.yourdomain.com          (สำหรับ StatusCallback, ไม่บังคับ)

export function twilioConfigured() {
  return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_FROM_NUMBER && process.env.BRIDGE_PUBLIC_URL);
}

// แปลงเบอร์ไทยเป็น E.164 (+66) — รองรับ 08x-xxxxxxx, 0812345678, +66..., 66...
export function toE164TH(raw) {
  if (!raw) return null;
  let n = String(raw).replace(/[^\d+]/g, '');
  if (n.startsWith('+')) return n;
  if (n.startsWith('66')) return `+${n}`;
  if (n.startsWith('0')) return `+66${n.slice(1)}`;
  if (n.length === 9) return `+66${n}`; // เผลอตัด 0 นำหน้า
  return `+${n}`;
}

/**
 * สั่ง Twilio โทรออก โดย TwiML ชี้ไปที่ voice-bridge /twiml/:sessionId
 * คืน { sid } หรือ throw
 */
export async function placeInterviewCall({ sessionId, toPhone }) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  const bridge = process.env.BRIDGE_PUBLIC_URL.replace(/\/$/, '');
  const app = (process.env.APP_PUBLIC_URL || '').replace(/\/$/, '');

  const to = toE164TH(toPhone);
  if (!to) throw new Error('เบอร์โทรไม่ถูกต้อง');

  const form = new URLSearchParams({
    To: to,
    From: from,
    Url: `${bridge}/twiml/${sessionId}`,
    Method: 'POST',
    // ไม่รับสายภายใน 30 วิ = ตัด
    Timeout: '30',
  });
  // แจ้งสถานะสายกลับมาที่ HR app (no-answer/busy/failed/completed)
  if (app) {
    form.set('StatusCallback', `${app}/api/hr/interviews/twilio-status?session=${sessionId}`);
    form.set('StatusCallbackMethod', 'POST');
    for (const ev of ['initiated', 'ringing', 'answered', 'completed']) {
      form.append('StatusCallbackEvent', ev);
    }
  }

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Twilio โทรออกไม่สำเร็จ');
  return { sid: data.sid };
}
