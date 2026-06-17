import { NextResponse } from 'next/server';
import { requireMenu } from '@/lib/hr-access';
import { supabase } from '@/lib/supabase';
import { addAuditEntry } from '@/lib/db';
import { createNotification } from '@/lib/notifications';

function nullableId(value) {
  if (value === '' || value === undefined || value === null) return null;
  const id = Number(value);
  return Number.isFinite(id) && id > 0 ? id : null;
}

async function validateAsset(id, type) {
  if (!id) return true;
  const { data } = await supabase
    .from('document_assets')
    .select('id')
    .eq('id', id)
    .eq('asset_type', type)
    .eq('active', true)
    .maybeSingle();
  return Boolean(data);
}

export async function POST(request, { params }) {
  const { user, error, status } = await requireMenu(request, 'document-requests');
  if (error) return NextResponse.json({ error }, { status });

  const { id } = await params;
  const body = await request.json();
  const action = body.action;
  const reviewNote = String(body.review_note || '').trim();

  if (!['approve', 'reject'].includes(action)) {
    return NextResponse.json({ error: 'action ไม่ถูกต้อง' }, { status: 400 });
  }

  const { data: req } = await supabase.from('document_requests').select('*').eq('id', id).maybeSingle();
  if (!req) return NextResponse.json({ error: 'ไม่พบคำขอเอกสาร' }, { status: 404 });

  if (action === 'reject') {
    const { error: updateError } = await supabase
      .from('document_requests')
      .update({
        status: 'rejected',
        rejected_by: user.name,
        rejected_at: new Date().toISOString(),
        approved_by: null,
        approved_at: null,
        review_note: reviewNote || null,
        signature_asset_id: null,
        stamp_asset_id: null,
        logo_asset_id: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);
    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });
  } else {
    const signatureId = nullableId(body.signature_asset_id);
    const stampId = nullableId(body.stamp_asset_id);
    const logoId = nullableId(body.logo_asset_id);
    const [signatureOk, stampOk, logoOk] = await Promise.all([
      validateAsset(signatureId, 'signature'),
      validateAsset(stampId, 'company_stamp'),
      validateAsset(logoId, 'company_logo'),
    ]);
    if (!signatureOk) return NextResponse.json({ error: 'ลายเซ็นที่เลือกไม่พร้อมใช้งาน' }, { status: 400 });
    if (!stampOk) return NextResponse.json({ error: 'ตราปั๊มที่เลือกไม่พร้อมใช้งาน' }, { status: 400 });
    if (!logoOk) return NextResponse.json({ error: 'โลโกบริษัทที่เลือกไม่พร้อมใช้งาน' }, { status: 400 });

    const { error: updateError } = await supabase
      .from('document_requests')
      .update({
        status: 'approved',
        approved_by: user.name,
        approved_at: new Date().toISOString(),
        rejected_by: null,
        rejected_at: null,
        review_note: reviewNote || null,
        signature_asset_id: signatureId,
        stamp_asset_id: stampId,
        logo_asset_id: logoId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);
    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  await addAuditEntry({
    user: user.name,
    action: `${action} คำขอเอกสาร ${req.document_type} ของ ${req.employee_id}`,
    channel: 'HR',
  });

  await createNotification({
    employeeId: req.employee_id,
    title: action === 'approve' ? 'เอกสารรับรองพร้อมใช้งานแล้ว' : 'คำขอเอกสารถูกปฏิเสธ',
    body: action === 'approve' ? 'คุณสามารถเปิดดู/บันทึก PDF ได้จากเมนูขอเอกสารรับรอง' : (reviewNote || 'HR ปฏิเสธคำขอเอกสาร'),
    url: '/me',
    type: action === 'approve' ? 'document_request_approved' : 'document_request_rejected',
  });

  return NextResponse.json({ success: true });
}
