'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { exportExcel, printPDF, authHeaders } from '@/components/hr/exportUtils';

const AVATAR_COLORS = ['#6d5ef5', '#0ea5e9', '#10b981', '#f97316', '#ec4899', '#8b5cf6', '#14b8a6'];

function avatarColor(employeeId) {
  let hash = 0;
  for (const ch of String(employeeId)) hash = (hash * 31 + ch.charCodeAt(0)) % 9973;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

const EXPORT_COLUMNS = [
  { key: 'employeeId', label: 'รหัสพนักงาน' },
  { key: 'name', label: 'ชื่อ' },
  { key: 'department', label: 'แผนก' },
  { key: 'position', label: 'ตำแหน่ง' },
  { key: 'startDate', label: 'วันเริ่มงาน' },
  { key: 'email', label: 'อีเมล' },
];

const EMPTY_FORM = {
  name: '', nameEn: '', email: '', department: '', position: '', startDate: '',
  leaveAnnualTotal: 0, leaveAnnualUsed: 0,
  leaveSickTotal: 0, leaveSickUsed: 0,
  leavePersonalTotal: 0, leavePersonalUsed: 0,
};

export default function EmployeesPage() {
  const [employees, setEmployees] = useState([]);
  const [view, setView] = useState('cards');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const load = useCallback(async () => {
    const res = await fetch('/api/hr/employees', { headers: authHeaders() });
    const data = await res.json();
    if (res.ok) setEmployees(data.employees || []);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = employees.filter((e) => {
    const q = search.toLowerCase();
    return !q || [e.name, e.employeeId, e.department, e.position].some((v) => String(v || '').toLowerCase().includes(q));
  });

  const departments = [...new Set(employees.map((e) => e.department).filter(Boolean))];

  function openEdit(emp) {
    setEditing(emp);
    setForm({
      name: emp.name || '', nameEn: emp.nameEn || '', email: emp.email || '',
      department: emp.department || '', position: emp.position || '', startDate: emp.startDate || '',
      leaveAnnualTotal: emp.leaveAnnualTotal, leaveAnnualUsed: emp.leaveAnnualUsed,
      leaveSickTotal: emp.leaveSickTotal, leaveSickUsed: emp.leaveSickUsed,
      leavePersonalTotal: emp.leavePersonalTotal, leavePersonalUsed: emp.leavePersonalUsed,
    });
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    const res = await fetch(`/api/hr/employees/${editing.employeeId}`, {
      method: 'PUT',
      headers: authHeaders(true),
      body: JSON.stringify(form),
    });
    const data = await res.json();
    if (res.ok) { setEditing(null); showToast('บันทึกข้อมูลพนักงานแล้ว'); load(); }
    else showToast(data.error || 'บันทึกไม่สำเร็จ', 'error');
    setSaving(false);
  }

  const set = (key) => (e) => setForm((p) => ({ ...p, [key]: e.target.value }));

  function fieldNum(label, key) {
    return (
      <div className="hr-field">
        <label>{label}</label>
        <input className="hr-input" type="number" step="any" value={form[key]}
          onChange={(e) => setForm((p) => ({ ...p, [key]: e.target.value === '' ? 0 : Number(e.target.value) }))} />
      </div>
    );
  }

  return (
    <div>
      <div className="hr-stat-row">
        <div className="hr-stat-card">
          <div className="hr-stat-icon">👥</div>
          <div><div className="hr-stat-value">{employees.length}</div><div className="hr-stat-label">พนักงานทั้งหมด</div></div>
        </div>
        <div className="hr-stat-card">
          <div className="hr-stat-icon">🏢</div>
          <div><div className="hr-stat-value">{departments.length}</div><div className="hr-stat-label">แผนก</div></div>
        </div>
        <div className="hr-stat-card">
          <div className="hr-stat-icon">🛡️</div>
          <div><div className="hr-stat-value">{employees.filter((e) => e.role !== 'employee').length}</div><div className="hr-stat-label">Admin / HR</div></div>
        </div>
      </div>

      <div className="hr-toolbar">
        <button className={`hr-tab${view === 'cards' ? ' active' : ''}`} onClick={() => setView('cards')}>🪪 การ์ด</button>
        <button className={`hr-tab${view === 'table' ? ' active' : ''}`} onClick={() => setView('table')}>📋 ตาราง</button>
        <input className="hr-search" placeholder="ค้นหาชื่อ/แผนก/ตำแหน่ง..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <button className="hr-btn" onClick={() => exportExcel(filtered, EXPORT_COLUMNS, 'employees')}>📄 Excel</button>
        <button className="hr-btn" onClick={printPDF}>📑 PDF</button>
        <Link href="/admin/users" className="hr-btn hr-btn-primary">+ เพิ่มพนักงาน</Link>
      </div>

      {view === 'cards' ? (
        <div className="hr-emp-grid">
          {filtered.map((emp) => (
            <div className="hr-emp-card" key={emp.employeeId}>
              <div className="hr-emp-head">
                <div className="hr-emp-avatar" style={{ background: avatarColor(emp.employeeId) }}>
                  {(emp.name || '?')[0]}
                </div>
                <div>
                  <div className="hr-emp-name">{emp.name}</div>
                  <div className="hr-emp-id">{emp.employeeId}</div>
                </div>
              </div>
              <div className="hr-emp-row"><span className="k">🏢 แผนก</span><span className="v">{emp.department || '-'}</span></div>
              <div className="hr-emp-row"><span className="k">💼 ตำแหน่ง</span><span className="v">{emp.position || '-'}</span></div>
              <div className="hr-emp-row"><span className="k">📅 เริ่มงาน</span><span className="v">{emp.startDate || '-'}</span></div>
              <div className="hr-emp-row">
                <span className="k">🏖️ พักร้อนคงเหลือ</span>
                <span className="v">{emp.leaveAnnualTotal - emp.leaveAnnualUsed} / {emp.leaveAnnualTotal} วัน</span>
              </div>
              <div className="hr-emp-actions">
                <button className="hr-btn" style={{ flex: 1 }} onClick={() => openEdit(emp)}>✏️ แก้ไข</button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="hr-table-wrap">
          <table className="hr-table">
            <thead>
              <tr>
                <th>รหัส</th><th>ชื่อ</th><th>แผนก</th><th>ตำแหน่ง</th><th>เริ่มงาน</th>
                <th>พักร้อน</th><th>ลาป่วย</th><th>ลากิจ</th><th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((emp) => (
                <tr key={emp.employeeId}>
                  <td>{emp.employeeId}</td>
                  <td>{emp.name}</td>
                  <td>{emp.department || '-'}</td>
                  <td>{emp.position || '-'}</td>
                  <td>{emp.startDate || '-'}</td>
                  <td>{emp.leaveAnnualTotal - emp.leaveAnnualUsed}/{emp.leaveAnnualTotal}</td>
                  <td>{emp.leaveSickTotal - emp.leaveSickUsed}/{emp.leaveSickTotal}</td>
                  <td>{emp.leavePersonalTotal - emp.leavePersonalUsed}/{emp.leavePersonalTotal}</td>
                  <td><button className="hr-btn hr-btn-icon" onClick={() => openEdit(emp)}>✏️</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <div className="hr-empty">ไม่พบพนักงาน</div>}
        </div>
      )}

      {editing && (
        <div className="hr-modal-overlay" onClick={() => setEditing(null)}>
          <div className="hr-modal" onClick={(e) => e.stopPropagation()}>
            <div className="hr-modal-header">
              <div className="hr-modal-title">แก้ไขพนักงาน · {editing.employeeId}</div>
              <button className="hr-modal-close" onClick={() => setEditing(null)}>✕</button>
            </div>
            <form onSubmit={save}>
              <div className="hr-field"><label>ชื่อ-สกุล</label><input className="hr-input" value={form.name} onChange={set('name')} required /></div>
              <div className="hr-field"><label>ชื่อ (อังกฤษ)</label><input className="hr-input" value={form.nameEn} onChange={set('nameEn')} /></div>
              <div className="hr-field"><label>อีเมล</label><input className="hr-input" value={form.email} onChange={set('email')} /></div>
              <div className="hr-field"><label>แผนก</label><input className="hr-input" value={form.department} onChange={set('department')} /></div>
              <div className="hr-field"><label>ตำแหน่ง</label><input className="hr-input" value={form.position} onChange={set('position')} /></div>
              <div className="hr-field"><label>วันเริ่มงาน</label><input className="hr-input" type="date" value={form.startDate} onChange={set('startDate')} /></div>

              <div className="hr-section-title" style={{ marginTop: 16 }}>สิทธิ์วันลา (chatbot ใช้ข้อมูลนี้ตอบพนักงาน)</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 12px' }}>
                {fieldNum('พักร้อนทั้งหมด (วัน)', 'leaveAnnualTotal')}
                {fieldNum('พักร้อนใช้ไป (วัน)', 'leaveAnnualUsed')}
                {fieldNum('ลาป่วยทั้งหมด (วัน)', 'leaveSickTotal')}
                {fieldNum('ลาป่วยใช้ไป (วัน)', 'leaveSickUsed')}
                {fieldNum('ลากิจทั้งหมด (วัน)', 'leavePersonalTotal')}
                {fieldNum('ลากิจใช้ไป (วัน)', 'leavePersonalUsed')}
              </div>

              <div className="hr-modal-actions">
                <button type="button" className="hr-btn" onClick={() => setEditing(null)}>ยกเลิก</button>
                <button type="submit" className="hr-btn hr-btn-primary" disabled={saving}>{saving ? 'กำลังบันทึก...' : 'บันทึก'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {toast && <div className={`hr-toast ${toast.type}`}>{toast.message}</div>}
    </div>
  );
}
