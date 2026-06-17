import { NextResponse } from 'next/server';
import { requireMenu } from '@/lib/hr-access';
import { supabase } from '@/lib/supabase';
import { writeStoredFile } from '@/lib/db';

const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

/**
 * POST /api/hr/document-assets/[id]/image — อัปโหลดรูปสำหรับลายเซ็น/ตราบริษัท
 */
export async function POST(request, { params }) {
  const { error, status } = await requireMenu(request, 'document-assets');
  if (error) return NextResponse.json({ error }, { status });

  const { id } = await params;
  const form = await request.formData();
  const file = form.get('file');
  if (!file || typeof file === 'string') return NextResponse.json({ error: 'กรุณาเลือกรูป' }, { status: 400 });
  if (!ALLOWED_TYPES.has(file.type)) return NextResponse.json({ error: 'รองรับเฉพาะ PNG, JPG หรือ WebP' }, { status: 400 });
  if (file.size > 5 * 1024 * 1024) return NextResponse.json({ error: 'รูปใหญ่เกิน 5MB' }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  const ext = (file.name.split('.').pop() || 'png').toLowerCase();
  const stored = `document-assets/${id}-${Date.now()}.${ext}`;
  await writeStoredFile(stored, buffer);

  const { error: dbError } = await supabase.from('document_assets').update({ image_url: stored, updated_at: new Date().toISOString() }).eq('id', id);
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  return NextResponse.json({ success: true, image_url: stored });
}
