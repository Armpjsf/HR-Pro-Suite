'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { authHeaders } from '@/components/hr/exportUtils';

const EMPTY = {
  asset_type: 'signature',
  name: '',
  signer_name: '',
  signer_title: '',
  active: true,
  note: '',
};

const TYPE_LABELS = {
  signature: 'ลายเซ็นผู้มีอำนาจ',
  company_stamp: 'ตราปั๊มบริษัท',
};

function imageSrc(file) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('hr-token') : '';
  return `/api/assets/image?file=${encodeURIComponent(file)}&token=${encodeURIComponent(token || '')}`;
}

export default function DocumentAssetsPage() {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [imageFile, setImageFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const fileRef = useRef(null);

  const showToast = (message, isError = false) => {
    setToast({ message, isError });
    setTimeout(() => setToast(null), 3000);
  };

  const load = useCallback(async () => {
    const res = await fetch('/api/hr/document-assets', { headers: authHeaders() });
    const data = await res.json();
    setItems(data.items || []);
  }, []);

  useEffect(() => { load().catch(() => {}); }, [load]);

  function close() {
    setOpen(false);
    setEditing(null);
    setForm(EMPTY);
    setImageFile(null);
  }

  function openAdd(type = 'signature') {
    setEditing(null);
    setForm({ ...EMPTY, asset_type: type });
    setImageFile(null);
    setOpen(true);
  }

  function openEdit(item) {
    setEditing(item);
    setForm({
      asset_type: item.asset_type || 'signature',
      name: item.name || '',
      signer_name: item.signer_name || '',
      signer_title: item.signer_title || '',
      active: item.active !== false,
      note: item.note || '',
    });
    setImageFile(null);
    setOpen(true);
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const url = editing ? `/api/hr/document-assets/${editing.id}` : '/api/hr/document-assets';
      const res = await fetch(url, {
        method: editing ? 'PUT' : 'POST',
        headers: authHeaders(true),
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'บันทึกไม่สำเร็จ', true);
        return;
      }

      const itemId = editing ? editing.id : data.item.id;
      if (imageFile) {
        const fd = new FormData();
        fd.append('file', imageFile);
        const uploadRes = await fetch(`/api/hr/document-assets/${itemId}/image`, {
          method: 'POST',
          headers: authHeaders(),
          body: fd,
        });
        const uploadData = await uploadRes.json();
        if (!uploadRes.ok) {
          showToast(uploadData.error || 'อัปโหลดรูปไม่สำเร็จ', true);
          return;
        }
      }

      showToast('บันทึกแล้ว');
      close();
      await load();
    } catch {
      showToast('เชื่อมต่อไม่สำเร็จ', true);
    } finally {
      setSaving(false);
    }
  }

  async function remove(item) {
    if (!confirm(`ลบ ${item.name} หรือไม่?`)) return;
    const res = await fetch(`/api/hr/document-assets/${item.id}`, { method: 'DELETE', headers: authHeaders() });
    if (res.ok) {
      showToast('ลบแล้ว');
      await load();
    } else {
      showToast('ลบไม่สำเร็จ', true);
    }
  }

  const signatures = items.filter((item) => item.asset_type === 'signature');
  const stamps = items.filter((item) => item.asset_type === 'company_stamp');

  const renderCard = (item) => (
    <div className="hr-emp-card" key={item.id}>
      <div className="hr-emp-head">
        <div className="hr-stat-icon">{item.asset_type === 'company_stamp' ? '🏢' : '🖋️'}</div>
        <div>
          <div className="hr-emp-name">{item.name}</div>
          <div className="hr-emp-id">{TYPE_LABELS[item.asset_type] || item.asset_type}</div>
        </div>
      </div>
      {item.image_url ? (
        <div style={{ height: 130, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f6f7fc', borderRadius: 12, marginBottom: 10 }}>
          <img src={imageSrc(item.image_url)} alt={item.name} style={{ maxWidth: '100%', maxHeight: 110, objectFit: 'contain' }} />
        </div>
      ) : (
        <div className="hr-empty" style={{ padding: 24, marginBottom: 10 }}>ยังไม่มีรูป</div>
      )}
      <div className="hr-emp-row"><span className="k">ชื่อผู้ลงนาม</span><span className="v">{item.signer_name || '-'}</span></div>
      <div className="hr-emp-row"><span className="k">ตำแหน่ง</span><span className="v">{item.signer_title || '-'}</span></div>
      <div className="hr-emp-row"><span className="k">สถานะ</span><span className="v"><span className={`hr-badge hr-badge-${item.active ? 'green' : 'gray'}`}>{item.active ? 'ใช้งาน' : 'ปิดใช้'}</span></span></div>
      <div className="hr-emp-actions">
        <button className="hr-btn" onClick={() => openEdit(item)}>แก้ไข</button>
        <button className="hr-btn hr-btn-danger" onClick={() => remove(item)}>ลบ</button>
      </div>
    </div>
  );

  return (
    <div>
      <div className="hr-card" style={{ marginBottom: 14 }}>
        <div className="hr-section-title">🖋️ ลายเซ็น/ตราบริษัท</div>
        <div style={{ color: '#5b6478', fontSize: 13, lineHeight: 1.6 }}>
          เก็บลายเซ็นผู้มีอำนาจและตราปั๊มบริษัท เพื่อใช้กับหนังสือรับรองเงินเดือน หนังสือรับรองการทำงาน และเอกสาร HR ที่ระบบจะสร้างให้พนักงาน
        </div>
      </div>

      <div className="hr-toolbar">
        <button className="hr-btn hr-btn-primary" onClick={() => openAdd('signature')}>+ เพิ่มลายเซ็น</button>
        <button className="hr-btn" onClick={() => openAdd('company_stamp')}>+ เพิ่มตราปั๊มบริษัท</button>
      </div>

      <div className="hr-section-title">ลายเซ็นผู้มีอำนาจ</div>
      <div className="hr-emp-grid" style={{ marginBottom: 18 }}>
        {signatures.map(renderCard)}
      </div>
      {signatures.length === 0 && <div className="hr-empty">ยังไม่มีลายเซ็น</div>}

      <div className="hr-section-title">ตราปั๊มบริษัท</div>
      <div className="hr-emp-grid">
        {stamps.map(renderCard)}
      </div>
      {stamps.length === 0 && <div className="hr-empty">ยังไม่มีตราปั๊มบริษัท</div>}

      {open && (
        <div className="hr-modal-overlay">
          <div className="hr-modal" onClick={(e) => e.stopPropagation()}>
            <div className="hr-modal-header">
              <div className="hr-modal-title">{editing ? 'แก้ไขรายการ' : 'เพิ่มรายการ'}</div>
              <button className="hr-modal-close" onClick={close}>✕</button>
            </div>
            <form onSubmit={save}>
              <div className="hr-field">
                <label>ประเภท *</label>
                <select value={form.asset_type} onChange={(e) => setForm((p) => ({ ...p, asset_type: e.target.value }))} required>
                  <option value="signature">ลายเซ็นผู้มีอำนาจ</option>
                  <option value="company_stamp">ตราปั๊มบริษัท</option>
                </select>
              </div>
              <div className="hr-field"><label>ชื่อรายการ *</label><input className="hr-input" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} required placeholder="เช่น ลายเซ็นกรรมการ / ตราบริษัทหลัก" /></div>
              <div className="hr-field"><label>ชื่อผู้ลงนาม</label><input className="hr-input" value={form.signer_name} onChange={(e) => setForm((p) => ({ ...p, signer_name: e.target.value }))} /></div>
              <div className="hr-field"><label>ตำแหน่งผู้ลงนาม</label><input className="hr-input" value={form.signer_title} onChange={(e) => setForm((p) => ({ ...p, signer_title: e.target.value }))} /></div>
              <div className="hr-field">
                <label>รูปภาพ PNG/JPG/WebP</label>
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setImageFile(e.target.files?.[0] || null)} />
                {editing?.image_url && !imageFile && (
                  <div style={{ marginTop: 8 }}>
                    <img src={imageSrc(editing.image_url)} alt="" style={{ maxWidth: 180, maxHeight: 100, objectFit: 'contain', background: '#f6f7fc', borderRadius: 8, padding: 8 }} />
                  </div>
                )}
              </div>
              <div className="hr-field"><label>หมายเหตุ</label><textarea value={form.note} onChange={(e) => setForm((p) => ({ ...p, note: e.target.value }))} /></div>
              <div className="hr-field">
                <label>เปิดใช้งาน</label>
                <input className="hr-input" type="checkbox" checked={form.active} onChange={(e) => setForm((p) => ({ ...p, active: e.target.checked }))} style={{ width: 'auto' }} />
              </div>
              <div className="hr-modal-actions">
                <button type="button" className="hr-btn" onClick={close}>ยกเลิก</button>
                <button type="submit" className="hr-btn hr-btn-primary" disabled={saving}>{saving ? 'กำลังบันทึก...' : 'บันทึก'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {toast && <div className={`hr-toast ${toast.isError ? 'error' : ''}`}>{toast.message}</div>}
    </div>
  );
}
