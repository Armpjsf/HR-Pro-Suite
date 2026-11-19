import { NextResponse } from 'next/server';
import { requireMenu } from '@/lib/hr-access';
import { supabase } from '@/lib/supabase';
import { addAuditEntry } from '@/lib/db';
import { createNotification } from '@/lib/notifications';
import { attachDocumentRequestLookups, createIssuedSnapshot } from '@/lib/document-requests';
import { getTenantCompanyProfile, getDocumentIssuerProfile } from '@/lib/company';
import { createDocumentSnapshot } from '@/lib/document-snapshot';
import { getDeploymentTenantId } from '@/lib/tenantContext';

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
  if (req.status !== 'pending') return NextResponse.json({ error: 'คำขอนี้พิจารณาแล้ว ไม่สามารถแก้เอกสารย้อนหลังได้ กรุณายื่นคำขอใหม่' }, { status: 409 });

  if (action === 'reject') {
    const { data: changed, error: updateError } = await supabase
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
      .eq('id', id).eq('status', 'pending').select('id').maybeSingle();
    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });
    if (!changed) return NextResponse.json({ error: 'รายการถูกพิจารณาแล้ว กรุณาโหลดใหม่' }, { status: 409 });
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

    const ids = [signatureId, stampId, logoId].filter(Boolean);
    const lookup = await Promise.all([
      supabase.from('users').select('employee_id,name,department,branch_id,avatar').eq('employee_id', req.employee_id),
      supabase.from('employee_records').select('employee_id,position,start_date,salary,national_id,tax_id').eq('employee_id', req.employee_id),
      ids.length ? supabase.from('document_assets').select('*').in('id', ids) : Promise.resolve({ data: [] }),
    ]);
    if (lookup.some((r) => r.error) || !lookup[0].data?.length || !lookup[1].data?.length) return NextResponse.json({ error: 'ข้อมูลพนักงานไม่ครบ จึงยังไม่ออกเอกสาร กรุณาตรวจข้อมูลก่อน' }, { status: 409 });
    const [item] = attachDocumentRequestLookups([{ ...req, signature_asset_id: signatureId, stamp_asset_id: stampId, logo_asset_id: logoId }], {
      users: lookup[0].data, records: lookup[1].data, assets: lookup[2].data,
    });
    const tenantId = user.tenantId || getDeploymentTenantId();
    const companyProfile = await getTenantCompanyProfile(tenantId);
    const issuerProfile = getDocumentIssuerProfile(companyProfile);
    if (!issuerProfile.setupComplete) {
      return NextResponse.json(
        {
          error: 'SETUP_REQUIRED: กรุณาตั้งค่าข้อมูลนิติบุคคล (ชื่อบริษัท, เลขผู้เสียภาษี, ที่อยู่) ก่อนอนุมัติเอกสารรับรอง',
          code: 'SETUP_REQUIRED',
        },
        { status: 400 },
      );
    }

    const docSnapshotMeta = createDocumentSnapshot({
      tenantId,
      legalEntityId: issuerProfile.legalEntityId,
      documentType: req.document_type,
      documentNo: `DOC-${req.id}`,
      issuerProfile,
      templateVersion: issuerProfile.version,
      payload: { requestId: req.id, employeeId: req.employee_id },
    });
    const snapshot = {
      ...createIssuedSnapshot(item, issuerProfile),
      ...docSnapshotMeta,
    };

    const { data: changed, error: updateError } = await supabase
      .from('document_requests')
      .update({
        status: 'approved',
        issued_snapshot: snapshot,
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
      .eq('id', id).eq('status', 'pending').select('id').maybeSingle();
    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });
    if (!changed) return NextResponse.json({ error: 'รายการถูกพิจารณาแล้ว กรุณาโหลดใหม่' }, { status: 409 });
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
