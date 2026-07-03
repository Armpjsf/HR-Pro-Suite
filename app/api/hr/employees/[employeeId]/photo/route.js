import { NextResponse } from 'next/server';
import { requireMenu } from '@/lib/hr-access';
import { supabase } from '@/lib/supabase';
import { writeStoredFile } from '@/lib/db';

/**
 * POST /api/hr/employees/[employeeId]/photo — อัปโหลดรูปถ่ายพนักงาน (multipart, field "file")
 */
export async function POST(request, { params }) {
  const { error, status } = await requireMenu(request, 'employees');
  if (error) return NextResponse.json({ error }, { status });

  const { employeeId } = await params;

  const { data: user } = await supabase
    .from('users')
    .select('employee_id')
    .eq('employee_id', employeeId)
    .maybeSingle();
  if (!user) return NextResponse.json({ error: 'ไม่พบพนักงาน' }, { status: 404 });

  const form = await request.formData();
  const file = form.get('file');
  if (!file || typeof file === 'string') return NextResponse.json({ error: 'กรุณาเลือกรูป' }, { status: 400 });
  if (file.size > 5 * 1024 * 1024) return NextResponse.json({ error: 'รูปใหญ่เกิน 5MB' }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const stored = `employee-photos/${employeeId}-${Date.now()}.${ext}`;
  await writeStoredFile(stored, buffer);

  const { error: e } = await supabase
    .from('employee_records')
    .upsert({ employee_id: employeeId, photo_url: stored, updated_at: new Date().toISOString() });
  if (e) return NextResponse.json({ error: e.message }, { status: 500 });

  return NextResponse.json({ success: true, photo_url: stored });
}
