-- เฟส 20: ปรับปรุงการตั้งค่าเอกสาร 50 ทวิ (ลายเซ็นผู้จ่ายเงิน และ ตราปั๊มบริษัท)
-- เพิ่มคอลัมน์ tax_cert_signature_asset_id และ tax_cert_stamp_asset_id ใน work_settings

alter table work_settings
  add column if not exists tax_cert_signature_asset_id bigint references document_assets(id) on delete set null,
  add column if not exists tax_cert_stamp_asset_id bigint references document_assets(id) on delete set null;
