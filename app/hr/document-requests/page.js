'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { authHeaders } from '@/components/hr/exportUtils';

const STATUS = {
  pending: { c: 'yellow', l: 'รออนุมัติ' },
  approved: { c: 'green', l: 'อนุมัติแล้ว' },
  rejected: { c: 'red', l: 'ปฏิเสธ' },
};

const DOC_TYPES = {
  salary_certificate: 'หนังสือรับรองเงินเดือน',
  employment_certificate: 'หนังสือรับรองการทำงาน',
};

function fmtDate(value) {
  if (!value) return '-';
  return new Date(value).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function DocumentRequestsPage() {
  const [items, setItems] = useState([]);
  const [assets, setAssets] = useState([]);
  const [status, setStatus] = useState('pending');
  const [modal, setModal] = useState(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = (message, isError = false) => {
    setToast({ message, isError });
    setTimeout(() => setToast(null), 3000);
  };

  const load = useCallback(async () => {
    const res = await fetch('/api/hr/document-requests', { headers: authHeaders() });
    const data = await res.json();
    setItems(data.items || []);
    setAssets(data.assets || []);
  }, []);

  useEffect(() => { load().catch(() => {}); }, [load]);

  const signatures = useMemo(() => assets.filter((a) => a.asset_type === 'signature'), [assets]);
  const stamps = useMemo(() => assets.filter((a) => a.asset_type === 'company_stamp'), [assets]);
  const filtered = status === 'all' ? items : items.filter((item) => item.status === status);
  const counts = {
    all: items.length,
    pending: items.filter((item) => item.status === 'pending').length,
    approved: items.filter((item) => item.status === 'approved').length,
    rejected: items.filter((item) => item.status === 'rejected').length,
  };

  function openApprove(item) {
    setModal({
      mode: 'approve',
      item,
      signature_asset_id: signatures[0]?.id || '',
      stamp_asset_id: stamps[0]?.id || '',
      review_note: '',
    });
  }

  function openReject(item) {
    setModal({ mode: 'reject', item, signature_asset_id: '', stamp_asset_id: '', review_note: '' });
  }

  async function submitAction(e) {
    e.preventDefault();
    if (!modal) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/hr/document-requests/${modal.item.id}/action`, {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({
          action: modal.mode === 'approve' ? 'approve' : 'reject',
          review_note: modal.review_note,
          signature_asset_id: modal.mode === 'approve' ? modal.signature_asset_id || null : null,
          stamp_asset_id: modal.mode === 'approve' ? modal.stamp_asset_id || null : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'ดำเนินการไม่สำเร็จ', true);
        return;
      }
      showToast(modal.mode === 'approve' ? 'อนุมัติคำขอแล้ว' : 'ปฏิเสธคำขอแล้ว');
      setModal(null);
      await load();
    } catch {
      showToast('เชื่อมต่อไม่สำเร็จ', true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="hr-card" style={{ marginBottom: 14 }}>
        <div className="hr-section-title">📄 คำขอเอกสารรับรอง</div>
        <div style={{ color: '#5b6478', fontSize: 13, lineHeight: 1.6 }}>
          อนุมัติหนังสือรับรองเงินเดือนและหนังสือรับรองการทำงาน แล้วเลือกลายเซ็น/ตราปั๊มที่จะวางบนเอกสารได้แบบยืดหยุ่น
        </div>
      </div>

      <div className="hr-tabs">
        {[
          ['pending', 'รออนุมัติ'],
          ['approved', 'อนุมัติแล้ว'],
          ['rejected', 'ปฏิเสธ'],
          ['all', 'ทั้งหมด'],
        ].map(([key, label]) => (
          <button key={key} className={`hr-tab${status === key ? ' active' : ''}`} onClick={() => setStatus(key)}>
            {label} {counts[key] > 0 && <span className="hr-badge hr-badge-gray">{counts[key]}</span>}
          </button>
        ))}
      </div>

      <div className="hr-table-wrap">
        <table className="hr-table">
          <thead>
            <tr>
              <th>พนักงาน</th>
              <th>เอกสาร</th>
              <th>วัตถุประสงค์</th>
              <th>วันที่ขอ</th>
              <th>สถานะ</th>
              <th>ลายเซ็น/ตรา</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((item) => {
              const badge = STATUS[item.status] || STATUS.pending;
              return (
                <tr key={item.id}>
                  <td>
                    <div style={{ fontWeight: 700 }}>{item.employeeName}</div>
                    <div style={{ color: '#9aa1b5', fontSize: 12 }}>{item.employee_id} · {item.employeeProfile?.position || '-'}</div>
                  </td>
                  <td>{DOC_TYPES[item.document_type] || item.document_type}</td>
                  <td>{item.purpose || '-'}</td>
                  <td>{fmtDate(item.requested_at)}</td>
                  <td><span className={`hr-badge hr-badge-${badge.c}`}>{badge.l}</span></td>
                  <td>
                    <div style={{ fontSize: 12, color: '#5b6478' }}>เซ็น: {item.signatureAsset?.name || '-'}</div>
                    <div style={{ fontSize: 12, color: '#5b6478' }}>ตรา: {item.stampAsset?.name || '-'}</div>
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {item.status === 'pending' && (
                      <>
                        <button className="hr-btn hr-btn-success" onClick={() => openApprove(item)}>อนุมัติ</button>
                        <button className="hr-btn hr-btn-danger" style={{ marginLeft: 6 }} onClick={() => openReject(item)}>ปฏิเสธ</button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 && <div className="hr-empty">ยังไม่มีคำขอในสถานะนี้</div>}
      </div>

      {modal && (
        <div className="hr-modal-overlay">
          <div className="hr-modal" onClick={(e) => e.stopPropagation()}>
            <div className="hr-modal-header">
              <div className="hr-modal-title">{modal.mode === 'approve' ? 'อนุมัติเอกสาร' : 'ปฏิเสธเอกสาร'}</div>
              <button className="hr-modal-close" onClick={() => setModal(null)}>×</button>
            </div>
            <form onSubmit={submitAction}>
              <div className="hr-field">
                <label>พนักงาน</label>
                <input className="hr-input" value={`${modal.item.employee_id} · ${modal.item.employeeName}`} disabled />
              </div>
              <div className="hr-field">
                <label>ประเภทเอกสาร</label>
                <input className="hr-input" value={DOC_TYPES[modal.item.document_type] || modal.item.document_type} disabled />
              </div>
              {modal.mode === 'approve' && (
                <>
                  <div className="hr-field">
                    <label>ลายเซ็นบนเอกสาร</label>
                    <select value={modal.signature_asset_id} onChange={(e) => setModal((p) => ({ ...p, signature_asset_id: e.target.value }))}>
                      <option value="">ไม่ใส่ลายเซ็น</option>
                      {signatures.map((asset) => <option key={asset.id} value={asset.id}>{asset.name} {asset.signer_name ? `· ${asset.signer_name}` : ''}</option>)}
                    </select>
                  </div>
                  <div className="hr-field">
                    <label>ตราปั๊มบริษัทบนเอกสาร</label>
                    <select value={modal.stamp_asset_id} onChange={(e) => setModal((p) => ({ ...p, stamp_asset_id: e.target.value }))}>
                      <option value="">ไม่ใส่ตราปั๊ม</option>
                      {stamps.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}
                    </select>
                  </div>
                </>
              )}
              <div className="hr-field">
                <label>{modal.mode === 'approve' ? 'หมายเหตุถึงพนักงาน' : 'เหตุผลที่ปฏิเสธ'}</label>
                <textarea value={modal.review_note} onChange={(e) => setModal((p) => ({ ...p, review_note: e.target.value }))} />
              </div>
              <div className="hr-modal-actions">
                <button type="button" className="hr-btn" onClick={() => setModal(null)}>ยกเลิก</button>
                <button type="submit" className={`hr-btn ${modal.mode === 'approve' ? 'hr-btn-primary' : 'hr-btn-danger'}`} disabled={saving}>
                  {saving ? 'กำลังบันทึก...' : modal.mode === 'approve' ? 'อนุมัติ' : 'ปฏิเสธ'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {toast && <div className={`hr-toast ${toast.isError ? 'error' : ''}`}>{toast.message}</div>}
    </div>
  );
}
