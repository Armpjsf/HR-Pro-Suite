import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { readStoredFile } from '@/lib/db';

const TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };

/**
 * GET /api/assets/image?file=<stored>&token=<jwt> — สตรีมรูปทรัพย์สิน (ต้อง login)
 * ใช้กับ <img src> ได้ (รับ token ผ่าน query)
 */
export async function GET(request) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const file = url.searchParams.get('file');
  if (!file || !file.startsWith('assets/')) return NextResponse.json({ error: 'ไฟล์ไม่ถูกต้อง' }, { status: 400 });

  const buf = await readStoredFile(file);
  if (!buf) return NextResponse.json({ error: 'ไม่พบรูป' }, { status: 404 });

  const ext = (file.split('.').pop() || 'jpg').toLowerCase();
  return new NextResponse(buf, {
    headers: { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Cache-Control': 'private, max-age=3600' },
  });
}
