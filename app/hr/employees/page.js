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
  name: '', nameEn: '', email: '', department: '', branchId: '', managerId: '', position: '', startDate: '',
  salary: 0, nationalId: '', bankName: '', bankAccount: '', taxId: '',
  birthDate: '', probationEnd: '', contractEnd: '', licenseExpiry: '',
  leaveAnnualTotal: 0, leaveAnnualUsed: 0,
  leaveSickTotal: 0, leaveSickUsed: 0,
  leavePersonalTotal: 0, leavePersonalUsed: 0,
  leaveBalances: [],
};

export default function EmployeesPage() {
  const [employees, setEmployees] = useState([]);
  const [view, setView] = useState('cards');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [leaveTypes, setLeaveTypes] = useState([]);
  const [leaveYear, setLeaveYear] = useState(new Date().getFullYear());

  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const [branches, setBranches] = useState([]);

  const load = useCallback(async () => {
    const res = await fetch('/api/hr/employees', { headers: authHeaders() });
    const data = await res.json();
    if (res.ok) {
      setEmployees(data.employees || []);
      setLeaveTypes(data.leaveTypes || []);
      if (data.year) setLeaveYear(data.year);
    }
  }, []);

  useEffect(() => {
    load();
    fetch('/api/hr/branches', { headers: authHeaders() })
      .then((r) => r.json()).then((d) => setBranches(d.items || [])).catch(() => {});
  }, [load]);

  const branchName = (id) => {
    const b = branches.find((x) => x.id === id);
    return b ? `${b.code} · ${b.name}` : '-';
  };

  const filtered = employees.filter((e) => {
    const q = search.toLowerCase();
    return !q || [e.name, e.employeeId, e.department, e.position].some((v) => String(v || '').toLowerCase().includes(q));
  });

  const departments = [...new Set(employees.map((e) => e.department).filter(Boolean))];
  const leaveTypeMap = new Map(leaveTypes.map((t) => [t.code, t]));

  function leaveRowsForForm(emp) {
    const existing = new Map((emp.leaveBalances || []).map((row) => [row.leave_type, row]));
    const rows = leaveTypes
      .filter((type) => type.deduct_balance || existing.has(type.code))
      .map((type) => {
        const row = existing.get(type.code);
        return {
          leave_type: type.code,
          year: row?.year || leaveYear,
          total_days: Number(row?.total_days) || 0,
          used_days: Number(row?.used_days) || 0,
          note: row?.note || '',
          enabled: existing.has(type.code),
        };
      });
    for (const row of emp.leaveBalances || []) {
      if (!rows.some((x) => x.leave_type === row.leave_type)) rows.push({ ...row, enabled: true });
    }
    return rows;
  }

  function leaveSummary(emp, max = 3) {
    const rows = emp.leaveBalances || [];
    if (rows.length === 0) return '-';
    return rows.slice(0, max).map((row) => {
      const type = leaveTypeMap.get(row.leave_type);
      const total = Number(row.total_days) || 0;
      const used = Number(row.used_days) || 0;
      return `${type?.name || row.leave_type}: ${total - used}/${total}`;
    }).join(' · ');
  }

  function openEdit(emp) {
    setEditing(emp);
    setForm({
      name: emp.name || '', nameEn: emp.nameEn || '', email: emp.email || '',
      department: emp.department || '', branchId: emp.branchId ?? '', managerId: emp.managerId || '', position: emp.position || '', startDate: emp.startDate || '',
      salary: emp.salary ?? 0, nationalId: emp.nationalId || '', bankName: emp.bankName || '', bankAccount: emp.bankAccount || '', taxId: emp.taxId || '',
      birthDate: emp.birthDate || '', probationEnd: emp.probationEnd || '', contractEnd: emp.contractEnd || '', licenseExpiry: emp.licenseExpiry || '',
      leaveAnnualTotal: emp.leaveAnnualTotal, leaveAnnualUsed: emp.leaveAnnualUsed,
      leaveSickTotal: emp.leaveSickTotal, leaveSickUsed: emp.leaveSickUsed,
      leavePersonalTotal: emp.leavePersonalTotal, leavePersonalUsed: emp.leavePersonalUsed,
      leaveBalances: leaveRowsForForm(emp),
    });
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    const payload = {
      ...form,
      leaveBalances: (form.leaveBalances || [])
        .filter((row) => row.enabled)
        .map(({ enabled, ...row }) => ({ ...row, year: Number(row.year) || leaveYear })),
    };
    const res = await fetch(`/api/hr/employees/${editing.employeeId}`, {
      method: 'PUT',
      headers: authHeaders(true),
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (res.ok) { setEditing(null); showToast('บันทึกข้อมูลพนักงานแล้ว'); load(); }
    else showToast(data.error || 'บันทึกไม่สำเร็จ', 'error');
    setSaving(false);
  }

  const set = (key) => (e) => setForm((p) => ({ ...p, [key]: e.target.value }));

  function updateLeaveBalance(index, key, value) {
    setForm((prev) => {
      const rows = [...(prev.leaveBalances || [])];
      rows[index] = { ...rows[index], [key]: value };
      return { ...prev, leaveBalances: rows };
    });
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
              <div className="hr-emp-row"><span className="k">🏬 สาขา</span><span className="v">{emp.branchId ? branchName(emp.branchId) : '-'}</span></div>
              <div className="hr-emp-row"><span className="k">💼 ตำแหน่ง</span><span className="v">{emp.position || '-'}</span></div>
              <div className="hr-emp-row"><span className="k">📅 เริ่มงาน</span><span className="v">{emp.startDate || '-'}</span></div>
              <div className="hr-emp-row">
                <span className="k">🏖️ สิทธิ์ลาคงเหลือ</span>
                <span className="v">{leaveSummary(emp)}</span>
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
                <th>สิทธิ์ลาคงเหลือ</th><th></th>
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
                  <td>{leaveSummary(emp, 5)}</td>
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
              <div className="hr-field">
                <label>สาขา</label>
                <select value={form.branchId} onChange={(e) => setForm((p) => ({ ...p, branchId: e.target.value }))}>
                  <option value="">— ไม่ระบุ —</option>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
                </select>
              </div>
              <div className="hr-field">
                <label>หัวหน้างาน (ผู้อนุมัติลำดับแรก)</label>
                <select value={form.managerId} onChange={(e) => setForm((p) => ({ ...p, managerId: e.target.value }))}>
                  <option value="">— ไม่ระบุ —</option>
                  {employees.filter((x) => x.employeeId !== editing?.employeeId).map((x) => (
                    <option key={x.employeeId} value={x.employeeId}>{x.employeeId} · {x.name}</option>
                  ))}
                </select>
              </div>
              <div className="hr-field"><label>ตำแหน่ง</label><input className="hr-input" value={form.position} onChange={set('position')} /></div>
              <div className="hr-field"><label>วันเริ่มงาน</label><input className="hr-input" type="date" value={form.startDate} onChange={set('startDate')} /></div>

              <div className="hr-section-title" style={{ marginTop: 16 }}>ข้อมูลสำหรับสลิป/ภาษี/โอนเงิน</div>
              <div className="hr-field"><label>เงินเดือนฐาน (บาท/เดือน)</label><input className="hr-input" type="number" step="any" value={form.salary} onChange={(e) => setForm((p) => ({ ...p, salary: e.target.value === '' ? 0 : Number(e.target.value) }))} /></div>
              <div className="hr-field"><label>เลขบัตรประชาชน</label><input className="hr-input" value={form.nationalId} onChange={set('nationalId')} /></div>
              <div className="hr-field"><label>เลขผู้เสียภาษี</label><input className="hr-input" value={form.taxId} onChange={set('taxId')} /></div>
              <div className="hr-field"><label>ธนาคาร</label><input className="hr-input" value={form.bankName} onChange={set('bankName')} /></div>
              <div className="hr-field"><label>เลขบัญชี</label><input className="hr-input" value={form.bankAccount} onChange={set('bankAccount')} /></div>

              <div className="hr-section-title" style={{ marginTop: 16 }}>วันสำคัญ (ใช้แจ้งเตือนอัตโนมัติ)</div>
              <div className="hr-field"><label>วันเกิด</label><input className="hr-input" type="date" value={form.birthDate} onChange={set('birthDate')} /></div>
              <div className="hr-field"><label>ครบกำหนดทดลองงาน</label><input className="hr-input" type="date" value={form.probationEnd} onChange={set('probationEnd')} /></div>
              <div className="hr-field"><label>วันหมดสัญญาจ้าง</label><input className="hr-input" type="date" value={form.contractEnd} onChange={set('contractEnd')} /></div>
              <div className="hr-field"><label>วันหมดอายุใบขับขี่</label><input className="hr-input" type="date" value={form.licenseExpiry} onChange={set('licenseExpiry')} /></div>

              <div className="hr-section-title" style={{ marginTop: 16 }}>สิทธิ์วันลารายพนักงาน ({leaveYear})</div>
              <div className="hr-table-wrap" style={{ marginTop: 8 }}>
                <table className="hr-table">
                  <thead>
                    <tr>
                      <th>ใช้กับพนักงาน</th>
                      <th>ประเภทการลา</th>
                      <th>สิทธิ์ทั้งหมด</th>
                      <th>ใช้ไป</th>
                      <th>คงเหลือ</th>
                      <th>หมายเหตุ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(form.leaveBalances || []).map((row, index) => {
                      const type = leaveTypeMap.get(row.leave_type);
                      const total = Number(row.total_days) || 0;
                      const used = Number(row.used_days) || 0;
                      return (
                        <tr key={row.leave_type}>
                          <td>
                            <input
                              type="checkbox"
                              checked={!!row.enabled}
                              onChange={(e) => updateLeaveBalance(index, 'enabled', e.target.checked)}
                            />
                          </td>
                          <td>{type?.name || row.leave_type}</td>
                          <td>
                            <input className="hr-input" type="number" step="any" value={row.total_days}
                              disabled={!row.enabled}
                              onChange={(e) => updateLeaveBalance(index, 'total_days', e.target.value === '' ? 0 : Number(e.target.value))} />
                          </td>
                          <td>
                            <input className="hr-input" type="number" step="any" value={row.used_days}
                              disabled={!row.enabled}
                              onChange={(e) => updateLeaveBalance(index, 'used_days', e.target.value === '' ? 0 : Number(e.target.value))} />
                          </td>
                          <td>{total - used}</td>
                          <td>
                            <input className="hr-input" value={row.note || ''} disabled={!row.enabled}
                              onChange={(e) => updateLeaveBalance(index, 'note', e.target.value)} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {leaveTypes.length === 0 && (
                  <div className="hr-empty">ตั้งค่าประเภทการลาก่อนที่เมนู “ตั้งค่าประเภทการลา”</div>
                )}
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
