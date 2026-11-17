import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { readStoredFile } from '@/lib/db';
import { supabase } from '@/lib/supabase';
import { getAllowedMenus, isAllowed } from '@/lib/hr-access';

const TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', pdf: 'application/pdf' };

/**
 * GET /api/assets/image?file=<stored>&token=<jwt> — สตรีมรูปจาก storage (ต้อง login)
 * ใช้กับ <img src> ได้ (รับ token ผ่าน query)
 */
export async function GET(request) {
  const user = await getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const file = url.searchParams.get('file');
  const allowedPrefixes = ['assets/', 'document-assets/', 'employee-photos/', 'attachments/'];
  if (!file || file.includes('..') || !allowedPrefixes.some((prefix) => file.startsWith(prefix))) {
    return NextResponse.json({ error: 'ไฟล์ไม่ถูกต้อง' }, { status: 400 });
  }

  const menus = await getAllowedMenus(user.role);
  let allowed = user.role === 'admin';
  if (file.startsWith('assets/')) {
    const { data, error } = await supabase.from('assets').select('id').eq('image_url', file).limit(1);
    allowed ||= !error && !!data?.length; // The employee asset catalogue is available to signed-in users.
  } else if (file.startsWith('employee-photos/')) {
    const { data, error } = await supabase.from('employee_records').select('employee_id').eq('photo_url', file).eq('employee_id', user.employeeId).maybeSingle();
    allowed ||= isAllowed(menus, 'employees') || (!error && !!data);
  } else if (file.startsWith('document-assets/')) {
    allowed ||= ['document-assets', 'document-requests', 'settings'].some((m) => isAllowed(menus, m));
    if (!allowed) {
      const { data, error } = await supabase.from('document_requests').select('issued_snapshot').eq('employee_id', user.employeeId).eq('status', 'approved');
      allowed = !error && (data || []).some((r) => ['signatureAsset', 'stampAsset', 'logoAsset'].some((k) => r.issued_snapshot?.[k]?.image_url === file));
    }
    if (!allowed) {
      const [settings, slips] = await Promise.all([
        supabase.from('work_settings').select('tax_cert_signature_asset_id,tax_cert_stamp_asset_id').eq('id', 1).maybeSingle(),
        supabase.from('payroll_slips').select('id').eq('employee_id', user.employeeId).eq('status', 'paid').limit(1),
      ]);
      const ids = [settings.data?.tax_cert_signature_asset_id, settings.data?.tax_cert_stamp_asset_id].filter(Boolean);
      if (!settings.error && !slips.error && slips.data?.length && ids.length) {
        const { data, error } = await supabase.from('document_assets').select('id').in('id', ids).eq('image_url', file).eq('active', true);
        allowed = !error && !!data?.length;
      }
    }
  } else if (file.startsWith('attachments/')) {
    allowed ||= isAllowed(menus, 'expenses');
    if (!allowed) {
      const { data, error } = await supabase.from('expense_claims').select('description').eq('employee_id', user.employeeId);
      allowed = !error && (data || []).some((r) => r.description?.includes(`[RECEIPT:${file}]`));
    }
  }
  if (!allowed) return NextResponse.json({ error: 'คุณไม่มีสิทธิ์เข้าถึงไฟล์นี้' }, { status: 403 });

  const buf = await readStoredFile(file);
  if (!buf) return NextResponse.json({ error: 'ไม่พบรูป' }, { status: 404 });

  const ext = (file.split('.').pop() || 'jpg').toLowerCase();
  return new NextResponse(buf, {
    headers: { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}
