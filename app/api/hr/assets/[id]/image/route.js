import { NextResponse } from 'next/server';
import { requireMenu } from '@/lib/hr-access';
import { supabase } from '@/lib/supabase';
import { writeStoredFile } from '@/lib/db';

/**
 * POST /api/hr/assets/[id]/image — อัปโหลดรูปทรัพย์สิน (multipart, field "file")
 */
export async function POST(request, { params }) {
  const { error, status } = await requireMenu(request, 'assets');
  if (error) return NextResponse.json({ error }, { status });

  const { id } = await params;
  const form = await request.formData();
  const file = form.get('file');
  if (!file || typeof file === 'string') return NextResponse.json({ error: 'กรุณาเลือกรูป' }, { status: 400 });
  if (file.size > 5 * 1024 * 1024) return NextResponse.json({ error: 'รูปใหญ่เกิน 5MB' }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const stored = `assets/${id}-${Date.now()}.${ext}`;
  await writeStoredFile(stored, buffer);

  const { error: e } = await supabase.from('assets').update({ image_url: stored }).eq('id', id);
  if (e) return NextResponse.json({ error: e.message }, { status: 500 });

  return NextResponse.json({ success: true, image_url: stored });
}
