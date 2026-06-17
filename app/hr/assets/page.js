'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { authHeaders } from '@/components/hr/exportUtils';

const STATUS = { available: { c: 'green', l: 'ว่าง' }, assigned: { c: 'blue', l: 'มีคนใช้' }, repair: { c: 'yellow', l: 'ส่งซ่อม' }, retired: { c: 'gray', l: 'ปลดระวาง' } };
const REQ_TYPE = { borrow: 'ขอเบิก', return: 'ขอคืน', replace: 'ขอเปลี่ยน' };
const REQ_STATUS = { pending: { c: 'yellow', l: 'รออนุมัติ' }, approved: { c: 'green', l: 'อนุมัติ' }, rejected: { c: 'red', l: 'ปฏิเสธ' }, delivered: { c: 'blue', l: 'จัดส่งแล้ว' } };
const EMPTY = { code: '', name: '', category: '', status: 'available', branch_id: '', assigned_to: '', note: '' };

function imgSrc(file) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('hr-token') : '';
  return `/api/assets/image?file=${encodeURIComponent(file)}&token=${encodeURIComponent(token || '')}`;
}

export default function AssetsPage() {
  const [tab, setTab] = useState('list');
  const [assets, setAssets] = useState([]);
  const [branches, setBranches] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [requests, setRequests] = useState([]);
  const [editing, setEditing] = useState(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [imageFile, setImageFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const fileRef = useRef(null);

  const showToast = (m, e) => { setToast({ m, e }); setTimeout(() => setToast(null), 3000); };

  const load = useCallback(async () => {
    const [a, b, e, r] = await Promise.all([
      fetch('/api/hr/assets', { headers: authHeaders() }).then((x) => x.json()),
      fetch('/api/hr/branches', { headers: authHeaders() }).then((x) => x.json()),
      fetch('/api/hr/employees', { headers: authHeaders() }).then((x) => x.json()),
      fetch('/api/hr/asset-requests', { headers: authHeaders() }).then((x) => x.json()),
    ]);
    setAssets(a.items || []);
    setBranches(b.items || []);
    setEmployees(e.employees || []);
    setRequests(r.items || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const branchName = (id) => { const b = branches.find((x) => x.id === id); return b ? `${b.code} · ${b.name}` : '-'; };

  function close() { setOpen(false); setEditing(null); setForm(EMPTY); setImageFile(null); }
  function openAdd() { setEditing(null); setForm(EMPTY); setImageFile(null); setOpen(true); }
  function openEdit(a) {
    setEditing(a);
    setForm({ code: a.code || '', name: a.name || '', category: a.category || '', status: a.status || 'available',
      branch_id: a.branch_id ?? '', assigned_to: a.assigned_to || '', note: a.note || '' });
    setImageFile(null);
    setOpen(true);
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { ...form, branch_id: form.branch_id === '' ? null : Number(form.branch_id) };
      const url = editing ? `/api/hr/assets/${editing.id}` : '/api/hr/assets';
      const res = await fetch(url, { method: editing ? 'PUT' : 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const d = await res.json();
      if (!res.ok) { showToast(d.error || 'บันทึกไม่สำเร็จ', true); setSaving(false); return; }
      const assetId = editing ? editing.id : d.item.id;
      if (imageFile) {
        const fd = new FormData(); fd.append('file', imageFile);
        await fetch(`/api/hr/assets/${assetId}/image`, { method: 'POST', headers: authHeaders(), body: fd });
      }
      showToast('บันทึกแล้ว'); close(); load();
    } catch { showToast('เชื่อมต่อไม่สำเร็จ', true); }
    setSaving(false);
  }

  async function remove(a) {
    if (!confirm('ลบทรัพย์สินนี้?')) return;
    const res = await fetch(`/api/hr/assets/${a.id}`, { method: 'DELETE', headers: authHeaders() });
    if (res.ok) { showToast('ลบแล้ว'); load(); } else showToast('ลบไม่สำเร็จ', true);
  }

  async function reqAction(id, action) {
    const res = await fetch(`/api/hr/asset-requests/${id}/action`, { method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) });
    if (res.ok) { showToast('ดำเนินการแล้ว'); load(); } else showToast('ไม่สำเร็จ', true);
  }

  const pendingCount = requests.filter((r) => r.status === 'pending').length;

  return (
    <div>
      <div className="hr-tabs">
        <button className={`hr-tab${tab === 'list' ? ' active' : ''}`} onClick={() => setTab('list')}>📦 ทรัพย์สิน</button>
        <button className={`hr-tab${tab === 'req' ? ' active' : ''}`} onClick={() => setTab('req')}>
          📨 คำขอเบิก/คืน {pendingCount > 0 && <span className="hr-badge hr-badge-red">{pendingCount}</span>}
        </button>
      </div>

      {tab === 'list' && (
        <>
          <div className="hr-toolbar">
            <button className="hr-btn hr-btn-primary" onClick={openAdd}>+ เพิ่มทรัพย์สิน</button>
          </div>
          <div className="hr-emp-grid">
            {assets.map((a) => (
              <div className="hr-emp-card" key={a.id}>
                {a.image_url
                  ? <img src={imgSrc(a.image_url)} alt={a.name} style={{ width: '100%', height: 120, objectFit: 'cover', borderRadius: 12, marginBottom: 10 }} />
                  : <div style={{ width: '100%', height: 120, borderRadius: 12, marginBottom: 10, background: '#f1f2f8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 38 }}>📦</div>}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div className="hr-emp-name">{a.name}</div>
                  <span className={`hr-badge hr-badge-${STATUS[a.status]?.c || 'gray'}`}>{STATUS[a.status]?.l || a.status}</span>
                </div>
                <div className="hr-emp-id">{a.code} · {a.category || '-'}</div>
                <div className="hr-emp-row"><span className="k">🏬 สาขา</span><span className="v">{branchName(a.branch_id)}</span></div>
                <div className="hr-emp-row"><span className="k">👤 ผู้ใช้</span><span className="v">{a.assigned_to || '-'}</span></div>
                <div className="hr-emp-actions">
                  <button className="hr-btn" style={{ flex: 1 }} onClick={() => openEdit(a)}>✏️ แก้ไข</button>
                  <button className="hr-btn hr-btn-icon hr-btn-danger" onClick={() => remove(a)}>🗑️</button>
                </div>
              </div>
            ))}
          </div>
          {assets.length === 0 && <div className="hr-empty">ยังไม่มีทรัพย์สิน</div>}
        </>
      )}

      {tab === 'req' && (
        <div className="hr-table-wrap">
          <table className="hr-table">
            <thead><tr><th>ทรัพย์สิน</th><th>พนักงาน</th><th>ประเภท</th><th>ส่งไปสาขา</th><th>เหตุผล</th><th>สถานะ</th><th>ผู้อนุมัติ</th><th></th></tr></thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id}>
                  <td>{r.assetCode} · {r.assetName}</td>
                  <td>{r.employeeName}</td>
                  <td><span className="hr-badge hr-badge-purple">{REQ_TYPE[r.type] || r.type}</span></td>
                  <td>{r.targetBranchName}</td>
                  <td>{r.reason || '-'}</td>
                  <td><span className={`hr-badge hr-badge-${REQ_STATUS[r.status]?.c}`}>{REQ_STATUS[r.status]?.l}</span></td>
                  <td>{r.approved_by || '-'}</td>
                  <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                    {r.status === 'pending' && <>
                      <button className="hr-btn hr-btn-icon hr-btn-success" title="อนุมัติ" onClick={() => reqAction(r.id, 'approve')}>✓</button>
                      <button className="hr-btn hr-btn-icon hr-btn-danger" title="ปฏิเสธ" onClick={() => reqAction(r.id, 'reject')} style={{ marginLeft: 6 }}>✗</button>
                    </>}
                    {r.status === 'approved' && <button className="hr-btn" onClick={() => reqAction(r.id, 'deliver')}>🚚 จัดส่งแล้ว</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {requests.length === 0 && <div className="hr-empty">ยังไม่มีคำขอ</div>}
        </div>
      )}

      {open ? (
        <div className="hr-modal-overlay">
          <div className="hr-modal" onClick={(e) => e.stopPropagation()}>
            <div className="hr-modal-header">
              <div className="hr-modal-title">{editing ? 'แก้ไขทรัพย์สิน' : 'เพิ่มทรัพย์สิน'}</div>
              <button className="hr-modal-close" onClick={close}>✕</button>
            </div>
            <form onSubmit={save}>
              <div className="hr-field"><label>รหัส *</label><input className="hr-input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required /></div>
              <div className="hr-field"><label>ชื่อทรัพย์สิน *</label><input className="hr-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
              <div className="hr-field"><label>หมวด</label><input className="hr-input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="รถ/โทรศัพท์/อุปกรณ์" /></div>
              <div className="hr-field"><label>สถานะ</label>
                <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                  {Object.entries(STATUS).map(([v, o]) => <option key={v} value={v}>{o.l}</option>)}
                </select>
              </div>
              <div className="hr-field"><label>สาขาที่อยู่</label>
                <select value={form.branch_id} onChange={(e) => setForm({ ...form, branch_id: e.target.value })}>
                  <option value="">— ไม่ระบุ —</option>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
                </select>
              </div>
              <div className="hr-field"><label>มอบให้พนักงาน</label>
                <select value={form.assigned_to} onChange={(e) => setForm({ ...form, assigned_to: e.target.value })}>
                  <option value="">— ไม่ระบุ —</option>
                  {employees.map((x) => <option key={x.employeeId} value={x.employeeId}>{x.employeeId} · {x.name}</option>)}
                </select>
              </div>
              <div className="hr-field"><label>รูปภาพ</label>
                <input ref={fileRef} type="file" accept="image/*" onChange={(e) => setImageFile(e.target.files?.[0] || null)} />
                {editing && editing.image_url && !imageFile &&
                  <img src={imgSrc(editing.image_url)} alt="" style={{ width: 100, marginTop: 8, borderRadius: 8 }} />}
              </div>
              <div className="hr-field"><label>หมายเหตุ</label><textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></div>
              <div className="hr-modal-actions">
                <button type="button" className="hr-btn" onClick={close}>ยกเลิก</button>
                <button type="submit" className="hr-btn hr-btn-primary" disabled={saving}>{saving ? 'กำลังบันทึก...' : 'บันทึก'}</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {toast && <div className={`hr-toast ${toast.e ? 'error' : ''}`}>{toast.m}</div>}
    </div>
  );
}
