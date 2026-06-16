'use client';

import { useEffect, useState } from 'react';
import { authHeaders } from '@/components/hr/exportUtils';

export default function LocationsPage() {
  const [items, setItems] = useState([]);
  const [branches, setBranches] = useState([]);
  const [toast, setToast] = useState(null);
  const [form, setForm] = useState({ name: '', branch_id: '', latitude: '', longitude: '', radius_meters: 200 });
  const [editing, setEditing] = useState(null);
  const [loading, setLoading] = useState(false);

  const showToast = (msg, isError) => { setToast({ msg, isError }); setTimeout(() => setToast(null), 3000); };

  const load = () => {
    fetch('/api/hr/locations', { headers: authHeaders() })
      .then((r) => r.json()).then((d) => setItems(d.items || [])).catch(() => {});
  };

  useEffect(() => { load(); }, []);
  useEffect(() => {
    fetch('/api/hr/branches', { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => setBranches(d.items || []))
      .catch(() => {});
  }, []);

  const handleGetCurrentPosition = () => {
    if (!navigator.geolocation) { showToast('เบราว์เซอร์ไม่รองรับ GPS', true); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setForm((f) => ({ ...f, latitude: pos.coords.latitude.toFixed(6), longitude: pos.coords.longitude.toFixed(6) }));
        showToast('ได้รับพิกัดแล้ว');
      },
      () => showToast('ไม่สามารถรับพิกัดได้ กรุณาเปิด GPS', true),
      { enableHighAccuracy: true }
    );
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (editing) {
        const res = await fetch('/api/hr/locations', {
          method: 'PUT',
          headers: authHeaders(),
          body: JSON.stringify({
            id: editing.id,
            ...form,
            branch_id: form.branch_id === '' ? null : Number(form.branch_id),
            latitude: Number(form.latitude),
            longitude: Number(form.longitude),
            radius_meters: Number(form.radius_meters),
          }),
        });
        const d = await res.json();
        if (!res.ok) { showToast(d.error, true); return; }
        showToast('อัปเดตเรียบร้อย');
      } else {
        const res = await fetch('/api/hr/locations', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ ...form, branch_id: form.branch_id === '' ? null : Number(form.branch_id) }),
        });
        const d = await res.json();
        if (!res.ok) { showToast(d.error, true); return; }
        showToast('เพิ่มจุดปักหมุดเรียบร้อย');
      }
      setForm({ name: '', branch_id: '', latitude: '', longitude: '', radius_meters: 200 });
      setEditing(null);
      load();
    } catch { showToast('เกิดข้อผิดพลาด', true); }
    finally { setLoading(false); }
  };

  const handleEdit = (item) => {
    setEditing(item);
    setForm({
      name: item.name,
      branch_id: item.branch_id ?? '',
      latitude: String(item.latitude),
      longitude: String(item.longitude),
      radius_meters: item.radius_meters,
    });
  };

  const handleDelete = async (id) => {
    if (!confirm('ลบจุดปักหมุดนี้?')) return;
    await fetch(`/api/hr/locations?id=${id}`, { method: 'DELETE', headers: authHeaders() });
    showToast('ลบเรียบร้อย');
    load();
  };

  const handleToggle = async (item) => {
    await fetch('/api/hr/locations', {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ id: item.id, is_active: !item.is_active }),
    });
    load();
  };

  return (
    <div>
      {/* Form */}
      <div className="hr-card" style={{ marginBottom: 18 }}>
        <h3 className="hr-section-title">{editing ? '✏️ แก้ไขจุดปักหมุด' : '📍 เพิ่มจุดปักหมุดใหม่'}</h3>
        <form onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            <div className="hr-field">
              <label>ชื่อสถานที่</label>
              <input className="hr-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="เช่น สำนักงานใหญ่" required />
            </div>
            <div className="hr-field">
              <label>สาขา</label>
              <select value={form.branch_id} onChange={(e) => setForm({ ...form, branch_id: e.target.value })}>
                <option value="">ใช้ได้ทุกสาขา</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
              </select>
            </div>
            <div className="hr-field">
              <label>ละติจูด (Latitude)</label>
              <input className="hr-input" type="number" step="any" value={form.latitude} onChange={(e) => setForm({ ...form, latitude: e.target.value })} placeholder="13.7563" required />
            </div>
            <div className="hr-field">
              <label>ลองจิจูด (Longitude)</label>
              <input className="hr-input" type="number" step="any" value={form.longitude} onChange={(e) => setForm({ ...form, longitude: e.target.value })} placeholder="100.5018" required />
            </div>
            <div className="hr-field">
              <label>รัศมี (เมตร)</label>
              <input className="hr-input" type="number" min="50" value={form.radius_meters} onChange={(e) => setForm({ ...form, radius_meters: e.target.value })} required />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <button type="button" className="hr-btn" onClick={handleGetCurrentPosition}>📡 ใช้ตำแหน่งปัจจุบัน</button>
            <button type="submit" className="hr-btn hr-btn-primary" disabled={loading}>
              {loading ? '⏳' : editing ? '✅ บันทึก' : '➕ เพิ่มจุดปักหมุด'}
            </button>
            {editing && <button type="button" className="hr-btn" onClick={() => { setEditing(null); setForm({ name: '', branch_id: '', latitude: '', longitude: '', radius_meters: 200 }); }}>✖ ยกเลิก</button>}
          </div>
        </form>
      </div>

      {/* Table */}
      <div className="hr-table-wrap">
        <table className="hr-table">
          <thead>
            <tr>
              <th>ชื่อสถานที่</th>
              <th>สาขา</th>
              <th>Latitude</th>
              <th>Longitude</th>
              <th>รัศมี (ม.)</th>
              <th>สถานะ</th>
              <th>จัดการ</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr><td colSpan={7} className="hr-empty">ยังไม่มีจุดปักหมุด</td></tr>
            )}
            {items.map((item) => (
              <tr key={item.id}>
                <td style={{ fontWeight: 600 }}>📍 {item.name}</td>
                <td>{item.branchName || 'ใช้ได้ทุกสาขา'}</td>
                <td>{Number(item.latitude).toFixed(6)}</td>
                <td>{Number(item.longitude).toFixed(6)}</td>
                <td>{item.radius_meters}</td>
                <td>
                  <button className={`hr-badge ${item.is_active ? 'hr-badge-green' : 'hr-badge-gray'}`}
                    style={{ cursor: 'pointer', border: 'none' }} onClick={() => handleToggle(item)}>
                    {item.is_active ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}
                  </button>
                </td>
                <td>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="hr-btn hr-btn-icon" onClick={() => handleEdit(item)} title="แก้ไข">✏️</button>
                    <button className="hr-btn hr-btn-icon hr-btn-danger" onClick={() => handleDelete(item.id)} title="ลบ">🗑️</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {toast && <div className={`hr-toast${toast.isError ? ' error' : ''}`}>{toast.msg}</div>}
    </div>
  );
}
