import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { generateResponse } from '@/lib/gemini';
import { addAuditEntry } from '@/lib/db';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';

export async function POST(request) {
  const { user, error, status } = requireAuth(request);
  if (error) {
    return NextResponse.json({ error }, { status });
  }

  const rl = checkRateLimit(`chat:${user.id || getClientIp(request)}`, 20, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `ส่งข้อความเร็วเกินไป กรุณารอ ${rl.retryAfterSec} วินาที` },
      { status: 429 }
    );
  }

  try {
    const { message, history = [] } = await request.json();

    if (!message || !message.trim()) {
      return NextResponse.json(
        { error: 'กรุณาพิมพ์ข้อความ' },
        { status: 400 }
      );
    }

    const response = await generateResponse(message.trim(), user, {
      channel: 'PWA',
      history,
    });

    await addAuditEntry({
      user: user.name,
      action: message.trim().slice(0, 80),
      channel: 'PWA',
      type: 'chat',
    });

    return NextResponse.json({
      success: true,
      reply: response.text,
      documents: response.documents || [],
      intent: response.intent,
      source: response.source,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Chat error:', err);
    return NextResponse.json(
      { error: 'เกิดข้อผิดพลาดในการประมวลผล กรุณาลองใหม่' },
      { status: 500 }
    );
  }
}
