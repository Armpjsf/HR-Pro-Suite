import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { writeStoredFile } from '@/lib/db';

/**
 * POST /api/me/upload — อัปโหลดไฟล์แนบ (ใบเสร็จเบิกจ่าย / ใบรับรองแพทย์)
 * Multipart form-data: field "file"
 */
export async function POST(request) {
  const { user, error, status } = requireAuth(request);
  if (error) return NextResponse.json({ error }, { status });

  try {
    const form = await request.formData();
    const file = form.get('file');
    if (!file || typeof file === 'string') {
      return NextResponse.json({ error: 'กรุณาเลือกไฟล์แนบ' }, { status: 400 });
    }
    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json({ error: 'ขนาดไฟล์ต้องไม่เกิน 5MB' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
    const stored = `attachments/${user.employeeId}-${Date.now()}.${ext || 'jpg'}`;
    await writeStoredFile(stored, buffer);

    return NextResponse.json({ success: true, fileUrl: stored });
  } catch (err) {
    console.error('[upload] failed:', err);
    return NextResponse.json({ error: 'อัปโหลดไฟล์ไม่สำเร็จ' }, { status: 500 });
  }
}
