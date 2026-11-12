'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { exportExcel, printPDF, authHeaders } from '@/components/hr/exportUtils';
import { confirmDialog } from '@/components/ui/ConfirmDialog';

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
  phone: '', address: '', emergencyName: '', emergencyPhone: '', emergencyRelation: '',
  employmentType: 'monthly', payCycle: 'monthly', status: 'active', resignDate: '',
  birthDate: '', probationEnd: '', contractEnd: '', licenseExpiry: '',
  leaveAnnualTotal: 0, leaveAnnualUsed: 0,
  leaveSickTotal: 0, leaveSickUsed: 0,
  leavePersonalTotal: 0, leavePersonalUsed: 0,
  leaveBalances: [],
};

const EMPLOYMENT_TYPE_LABELS = {
  monthly: 'รายเดือน', daily: 'รายวัน', contract: 'สัญญาจ้าง', parttime: 'พาร์ทไทม์',
};
const PAY_CYCLE_LABELS = {
  monthly: 'รายเดือน (จ่ายสิ้นเดือน)',
  end_month: 'รวบจ่ายสิ้นเดือน (ตามวันมาทำงานจริง)',
  biweekly: 'รวบจ่ายทุก 15 วัน (งวด 1-15 และ 16-สิ้นเดือน)',
  daily: 'จ่ายวันต่อวัน (โอน/จ่ายสดทันทีหลังเลิกงาน)',
};
const STATUS_LABELS = {
  active: 'ทำงานอยู่', resigned: 'ลาออก/พ้นสภาพ', suspended: 'พักงาน',
};
const HISTORY_LABELS = { salary: 'เงินเดือน', position: 'ตำแหน่ง', status: 'สถานะ' };

function photoSrc(photoUrl) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('hr-token') : '';
  return `/api/assets/image?file=${encodeURIComponent(photoUrl)}&token=${encodeURIComponent(token || '')}`;
}

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
  const [showResigned, setShowResigned] = useState(false);
  const [history, setHistory] = useState([]);
  const [granting, setGranting] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [addForm, setAddForm] = useState({
    name: '', nameEn: '', employeeId: '', username: '', password: '',
    role: 'employee', department: '', branchId: '', position: '',
    startDate: new Date().toISOString().slice(0, 10), salary: 0,
    phone: '', nationalId: '', bankName: '', bankAccount: '',
    employmentType: 'monthly', payCycle: 'monthly',
  });

  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const [branches, setBranches] = useState([]);
  const [departmentsList, setDepartmentsList] = useState([]);
  const [positionsList, setPositionsList] = useState([]);
  const [activeBranch, setActiveBranch] = useState(
    typeof window !== 'undefined' ? localStorage.getItem('hr-active-branch') || 'all' : 'all'
  );

  useEffect(() => {
    const handleBranch = (e) => setActiveBranch(e.detail || 'all');
    window.addEventListener('hr-branch-change', handleBranch);
    return () => window.removeEventListener('hr-branch-change', handleBranch);
  }, []);

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
    fetch('/api/hr/departments', { headers: authHeaders() })
      .then((r) => r.json()).then((d) => setDepartmentsList(d.items || [])).catch(() => {});
    fetch('/api/hr/positions', { headers: authHeaders() })
      .then((r) => r.json()).then((d) => setPositionsList(d.items || [])).catch(() => {});
  }, [load]);

  const branchName = (id) => {
    const b = branches.find((x) => x.id === id);
    return b ? `${b.code} · ${b.name}` : '-';
  };

  const filtered = employees.filter((e) => {
    if (activeBranch !== 'all' && String(e.branchId || '') !== String(activeBranch)) return false;
    if (!showResigned && e.status && e.status !== 'active') return false;
    const q = search.toLowerCase();
    return !q || [e.name, e.employeeId, e.department, e.position].some((v) => String(v || '').toLowerCase().includes(q));
  });

  const activeCount = filtered.filter((e) => !e.status || e.status === 'active').length;
  const departments = [...new Set(filtered.map((e) => e.department).filter(Boolean))];
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
      phone: emp.phone || '', address: emp.address || '',
      emergencyName: emp.emergencyName || '', emergencyPhone: emp.emergencyPhone || '', emergencyRelation: emp.emergencyRelation || '',
      employmentType: emp.employmentType || 'monthly', payCycle: emp.payCycle || (emp.employmentType === 'daily' ? 'end_month' : 'monthly'), status: emp.status || 'active', resignDate: emp.resignDate || '',
      birthDate: emp.birthDate || '', probationEnd: emp.probationEnd || '', contractEnd: emp.contractEnd || '', licenseExpiry: emp.licenseExpiry || '',
      leaveAnnualTotal: emp.leaveAnnualTotal, leaveAnnualUsed: emp.leaveAnnualUsed,
      leaveSickTotal: emp.leaveSickTotal, leaveSickUsed: emp.leaveSickUsed,
      leavePersonalTotal: emp.leavePersonalTotal, leavePersonalUsed: emp.leavePersonalUsed,
      leaveBalances: leaveRowsForForm(emp),
    });
    setHistory([]);
    fetch(`/api/hr/employees/${emp.employeeId}`, { headers: authHeaders() })
      .then((r) => r.json()).then((d) => setHistory(d.history || [])).catch(() => {});
  }

  async function grantLeave() {
    const ok = await confirmDialog({
      title: `ยืนยันแจกสิทธิ์ลาประจำปี ${leaveYear}?`,
      message: `แจกสิทธิ์ลาประจำปี ${leaveYear} ให้พนักงานที่ยังไม่มียอด (ตาม "สิทธิ์ต่อปี" ของประเภทลา)?`,
      confirmLabel: 'ยืนยันแจกสิทธิ์',
    });
    if (!ok) return;
    setGranting(true);
    try {
      const res = await fetch('/api/hr/leave/grant', {
        method: 'POST', headers: authHeaders(true), body: JSON.stringify({ year: leaveYear }),
      });
      const d = await res.json();
      if (!res.ok) { showToast(d.error || 'แจกสิทธิ์ไม่สำเร็จ', 'error'); return; }
      showToast(`แจกสิทธิ์ลาปี ${d.year} แล้ว ${d.granted} รายการ (${d.types.join(', ')})`);
      load();
    } finally { setGranting(false); }
  }

  async function uploadPhoto(file) {
    if (!file || !editing) return;
    setUploadingPhoto(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`/api/hr/employees/${editing.employeeId}/photo`, {
        method: 'POST', headers: authHeaders(), body: fd,
      });
      const d = await res.json();
      if (!res.ok) { showToast(d.error || 'อัปโหลดรูปไม่สำเร็จ', 'error'); return; }
      showToast('อัปโหลดรูปถ่ายแล้ว');
      setEditing((p) => ({ ...p, photoUrl: d.photo_url }));
      load();
    } finally { setUploadingPhoto(false); }
  }

  async function saveNewEmployee(e) {
    e.preventDefault();
    if (!addForm.name.trim()) {
      showToast('กรุณากรอกชื่อ-นามสกุล', 'error');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/hr/employees', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify(addForm),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'เพิ่มพนักงานไม่สำเร็จ', 'error');
        return;
      }
      showToast(data.message || 'เพิ่มพนักงานสำเร็จแล้ว');
      setIsAdding(false);
      load();
    } catch {
      showToast('เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ', 'error');
    } finally {
      setSaving(false);
    }
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
          <div><div className="hr-stat-value">{activeCount}</div><div className="hr-stat-label">พนักงานทำงานอยู่</div></div>
        </div>
        <div className="hr-stat-card">
          <div className="hr-stat-icon">🏢</div>
          <div><div className="hr-stat-value">{departments.length}</div><div className="hr-stat-label">แผนก</div></div>
        </div>
        <div className="hr-stat-card">
          <div className="hr-stat-icon">🛡️</div>
          <div><div className="hr-stat-value">{filtered.filter((e) => e.role && e.role !== 'employee').length}</div><div className="hr-stat-label">Admin / HR {activeBranch !== 'all' && '(สาขานี้)'}</div></div>
        </div>
      </div>

      <div className="hr-toolbar">
        <div className="hr-segmented-control" role="tablist">
          <button
            type="button"
            className={`hr-segmented-item${view === 'cards' ? ' active' : ''}`}
            onClick={() => setView('cards')}
          >
            🪪 การ์ด
          </button>
          <button
            type="button"
            className={`hr-segmented-item${view === 'table' ? ' active' : ''}`}
            onClick={() => setView('table')}
          >
            📋 ตาราง
          </button>
        </div>

        <div className="hr-search-box">
          <span className="hr-search-icon" aria-hidden="true">🔍</span>
          <input
            className="hr-search"
            placeholder="ค้นหาชื่อ/แผนก/ตำแหน่ง..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              type="button"
              className="hr-search-clear"
              onClick={() => setSearch('')}
              aria-label="ล้างคำค้นหา"
            >
              ✕
            </button>
          )}
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--hr-text-2)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
          <input
            type="checkbox"
            checked={showResigned}
            onChange={(e) => setShowResigned(e.target.checked)}
            style={{ width: 16, height: 16, accentColor: '#007AFF' }}
          />
          แสดงคนพ้นสภาพ
        </label>
        <button className="hr-btn" onClick={grantLeave} disabled={granting}>{granting ? '⏳...' : `🎁 แจกสิทธิ์ลาปี ${leaveYear}`}</button>
        <button className="hr-btn" onClick={() => exportExcel(filtered, EXPORT_COLUMNS, 'employees')}><span>📊</span> Excel</button>
        <button className="hr-btn" onClick={printPDF}><span>🖨️</span> PDF</button>
        <button className="hr-btn hr-btn-primary" onClick={() => {
          setAddForm({
            name: '', nameEn: '', employeeId: '', username: '', password: '',
            role: 'employee', department: '', branchId: activeBranch !== 'all' ? activeBranch : '',
            position: '', startDate: new Date().toISOString().slice(0, 10), salary: 0,
            phone: '', nationalId: '', bankName: '', bankAccount: '',
            employmentType: 'monthly',
          });
          setIsAdding(true);
        }}><span>＋</span> เพิ่มพนักงาน</button>
      </div>

      {view === 'cards' ? (
        <div className="hr-emp-grid">
          {filtered.map((emp) => (
            <div className="hr-emp-card" key={emp.employeeId} style={{ display: 'flex', flexDirection: 'column' }}>
              <div className="hr-emp-head" style={{ marginBottom: 14 }}>
                {emp.photoUrl ? (
                  <img src={photoSrc(emp.photoUrl)} alt={emp.name}
                    className="hr-emp-avatar" style={{ objectFit: 'cover' }} />
                ) : (
                  <div className="hr-emp-avatar" style={{ background: avatarColor(emp.employeeId) }}>
                    {(emp.name || '?')[0]}
                  </div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="hr-emp-name" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                    <span>{emp.name}</span>
                    {emp.status && emp.status !== 'active' ? (
                      <span className="hr-badge hr-badge-red">
                        {STATUS_LABELS[emp.status] || emp.status}
                      </span>
                    ) : (
                      <span className="hr-badge hr-badge-green" style={{ fontSize: 10 }}>
                        ปกติ
                      </span>
                    )}
                  </div>
                  <div className="hr-emp-id" style={{ marginTop: 2 }}>
                    {emp.employeeId} · {EMPLOYMENT_TYPE_LABELS[emp.employmentType] || 'รายเดือน'}
                    {emp.employmentType === 'daily' && emp.payCycle && (
                      <span style={{ color: 'var(--hr-accent)', marginLeft: 4, fontWeight: 600 }}>
                        ({emp.payCycle === 'biweekly' ? 'ทุก 15 วัน' : emp.payCycle === 'daily' ? 'จ่ายวันต่อวัน' : 'สิ้นเดือน'})
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div style={{ background: '#F8F9FE', borderRadius: 14, padding: '6px 12px', border: '1px solid rgba(60,60,67,0.06)', flex: 1 }}>
                <div className="hr-emp-row"><span className="k">🏢 แผนก</span><span className="v">{emp.department || '-'}</span></div>
                <div className="hr-emp-row"><span className="k">🏬 สาขา</span><span className="v">{emp.branchId ? branchName(emp.branchId) : '-'}</span></div>
                <div className="hr-emp-row"><span className="k">💼 ตำแหน่ง</span><span className="v">{emp.position || '-'}</span></div>
                <div className="hr-emp-row"><span className="k">📅 เริ่มงาน</span><span className="v">{emp.startDate || '-'}</span></div>
                <div className="hr-emp-row" style={{ borderBottom: 'none' }}>
                  <span className="k">🏖️ สิทธิ์ลา</span>
                  <span className="v" style={{ fontSize: 12 }}>{leaveSummary(emp)}</span>
                </div>
              </div>

              <div className="hr-emp-actions" style={{ marginTop: 14 }}>
                <button className="hr-btn" style={{ flex: 1, justifyContent: 'center' }} onClick={() => openEdit(emp)}>
                  <span>✏️</span> แก้ไขข้อมูล
                </button>
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
          {filtered.length === 0 && (
            <div className="hr-empty">
              {activeBranch !== 'all'
                ? 'ไม่พบพนักงานในสาขานี้ (ลองสลับฟิลเตอร์เป็น "ทุกสาขา (ภาพรวม)" ที่มุมบนขวา หรือกดแก้ไขเพื่อกำหนดสาขาให้พนักงาน)'
                : 'ไม่พบพนักงาน'}
            </div>
          )}
        </div>
      )}

      {editing && (
        <div className="hr-modal-overlay" onClick={() => setEditing(null)}>
          <div className="hr-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 680 }}>
            <div className="hr-modal-header" style={{ borderBottom: '1px solid var(--hr-border)', paddingBottom: 12 }}>
              <div>
                <div className="hr-modal-title">แก้ไขข้อมูลพนักงาน</div>
                <div style={{ fontSize: 12, color: 'var(--hr-text-3)', marginTop: 2 }}>{editing.employeeId} · {editing.name}</div>
              </div>
              <button className="hr-modal-close" onClick={() => setEditing(null)}>✕</button>
            </div>
            <form onSubmit={save}>
              {/* Card Section 1: ข้อมูลส่วนตัว & การทำงาน */}
              <div style={{ background: '#F8F9FE', borderRadius: 16, padding: '14px 16px', margin: '14px 0', border: '1px solid rgba(60,60,67,0.08)' }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--hr-text)' }}>
                  <span>👤</span> ข้อมูลทั่วไปและตำแหน่งงาน
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
                  <div className="hr-field"><label>ชื่อ-สกุล (ไทย) *</label><input className="hr-input" value={form.name} onChange={set('name')} required /></div>
                  <div className="hr-field"><label>ชื่อ (อังกฤษ)</label><input className="hr-input" value={form.nameEn} onChange={set('nameEn')} /></div>
                  <div className="hr-field"><label>อีเมล</label><input className="hr-input" value={form.email} onChange={set('email')} /></div>
                  <div className="hr-field">
                    <label>แผนก</label>
                    <select className="hr-input" value={form.department} onChange={set('department')}>
                      <option value="">— ไม่ระบุ —</option>
                      {departmentsList.map((d) => (
                        <option key={d.code || d.name} value={d.name}>{d.name} {d.code ? `(${d.code})` : ''}</option>
                      ))}
                      {form.department && !departmentsList.some((d) => d.name === form.department) && (
                        <option value={form.department}>{form.department} (เดิม)</option>
                      )}
                    </select>
                  </div>
                  <div className="hr-field">
                    <label>สาขา</label>
                    <select className="hr-input" value={form.branchId} onChange={(e) => setForm((p) => ({ ...p, branchId: e.target.value }))}>
                      <option value="">— ไม่ระบุ —</option>
                      {branches.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
                    </select>
                  </div>
                  <div className="hr-field">
                    <label>ตำแหน่ง</label>
                    <select className="hr-input" value={form.position} onChange={set('position')}>
                      <option value="">— ไม่ระบุ —</option>
                      {positionsList.map((p) => (
                        <option key={p.id || p.title} value={p.title}>{p.title} {p.level ? `(${p.level})` : ''}</option>
                      ))}
                      {form.position && !positionsList.some((p) => p.title === form.position) && (
                        <option value={form.position}>{form.position} (เดิม)</option>
                      )}
                    </select>
                  </div>
                  <div className="hr-field">
                    <label>หัวหน้างาน</label>
                    <select className="hr-input" value={form.managerId} onChange={(e) => setForm((p) => ({ ...p, managerId: e.target.value }))}>
                      <option value="">— ไม่ระบุ —</option>
                      {employees.filter((x) => x.employeeId !== editing?.employeeId).map((x) => (
                        <option key={x.employeeId} value={x.employeeId}>{x.employeeId} · {x.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="hr-field"><label>วันเริ่มงาน</label><input className="hr-input" type="date" value={form.startDate} onChange={set('startDate')} /></div>
                  <div className="hr-field">
                    <label>ประเภทการจ้าง</label>
                    <select className="hr-input" value={form.employmentType} onChange={(e) => {
                      const val = e.target.value;
                      setForm((p) => ({
                        ...p,
                        employmentType: val,
                        payCycle: val === 'daily' ? (p.payCycle === 'monthly' ? 'end_month' : p.payCycle) : 'monthly',
                      }));
                    }}>
                      {Object.entries(EMPLOYMENT_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </div>
                  <div className="hr-field">
                    <label>รอบการจ่ายเงิน {form.employmentType === 'daily' && <span style={{ color: 'var(--hr-accent)', fontWeight: 700 }}>*</span>}</label>
                    <select className="hr-input" value={form.payCycle} onChange={set('payCycle')}>
                      {form.employmentType === 'daily' ? (
                        <>
                          <option value="end_month">รวบจ่ายทุกสิ้นเดือน (ตามวันมาทำงานจริง)</option>
                          <option value="biweekly">รวบจ่ายทุก 15 วัน (งวด 1-15 และ 16-สิ้นเดือน)</option>
                          <option value="daily">โอนจ่ายวันต่อวัน (จ่ายทันทีหลังเช็คเอาต์)</option>
                        </>
                      ) : (
                        <option value="monthly">รายเดือน (จ่ายทุกสิ้นเดือน)</option>
                      )}
                    </select>
                  </div>
                  <div className="hr-field">
                    <label>สถานะพนักงาน</label>
                    <select className="hr-input" value={form.status} onChange={set('status')}>
                      {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </div>
                </div>
                {form.status !== 'active' && (
                  <div className="hr-field" style={{ marginTop: 10 }}>
                    <label>วันพ้นสภาพ/พักงาน</label>
                    <input className="hr-input" type="date" value={form.resignDate} onChange={set('resignDate')} />
                  </div>
                )}

                <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 14, paddingTop: 12, borderTop: '1px solid rgba(60,60,67,0.08)' }}>
                  {editing.photoUrl && (
                    <img src={photoSrc(editing.photoUrl)} alt="" style={{ width: 48, height: 48, borderRadius: 12, objectFit: 'cover' }} />
                  )}
                  <div>
                    <label style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--hr-text-2)', display: 'block', marginBottom: 4 }}>อัปโหลดรูปถ่ายพนักงาน</label>
                    <input type="file" accept="image/*" disabled={uploadingPhoto} onChange={(e) => uploadPhoto(e.target.files?.[0])} style={{ fontSize: 12 }} />
                    {uploadingPhoto && <span style={{ fontSize: 12, marginLeft: 8 }}>⏳ กำลังอัปโหลด...</span>}
                  </div>
                </div>
              </div>

              {/* Card Section 2: การติดต่อ & การเงิน */}
              <div style={{ background: '#F8F9FE', borderRadius: 16, padding: '14px 16px', margin: '14px 0', border: '1px solid rgba(60,60,67,0.08)' }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--hr-text)' }}>
                  <span>💳</span> ข้อมูลติดต่อและการเงิน
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
                  <div className="hr-field"><label>เบอร์โทรศัพท์</label><input className="hr-input" value={form.phone} onChange={set('phone')} /></div>
                  <div className="hr-field">
                    <label>{form.employmentType === 'daily' ? 'ค่าจ้างรายวัน (บาท/วัน) *' : 'เงินเดือนฐาน (บาท/เดือน) *'}</label>
                    <input className="hr-input" type="number" step="any" value={form.salary} onChange={(e) => setForm((p) => ({ ...p, salary: e.target.value === '' ? 0 : Number(e.target.value) }))} />
                    {form.employmentType === 'daily' && (
                      <span style={{ fontSize: 11, color: 'var(--hr-text-3)', display: 'block', marginTop: 3 }}>
                        ⚠️ จ่ายเฉพาะวันที่เช็คอินเข้างานจริง (ขาดงาน/ไม่เช็คอิน/ลาหยุด ไม่จ่าย)
                      </span>
                    )}
                  </div>
                  <div className="hr-field"><label>เลขบัตรประชาชน (13 หลัก)</label><input className="hr-input" value={form.nationalId} onChange={set('nationalId')} maxLength={13} /></div>
                  <div className="hr-field"><label>เลขผู้เสียภาษี</label><input className="hr-input" value={form.taxId} onChange={set('taxId')} /></div>
                  <div className="hr-field"><label>ธนาคาร</label><input className="hr-input" value={form.bankName} onChange={set('bankName')} /></div>
                  <div className="hr-field"><label>เลขที่บัญชี</label><input className="hr-input" value={form.bankAccount} onChange={set('bankAccount')} /></div>
                </div>
                <div className="hr-field" style={{ marginTop: 10 }}><label>ที่อยู่</label><textarea className="hr-input" rows={2} value={form.address} onChange={set('address')} /></div>
              </div>

              {/* Card Section 3: วันสำคัญ */}
              <div style={{ background: '#F8F9FE', borderRadius: 16, padding: '14px 16px', margin: '14px 0', border: '1px solid rgba(60,60,67,0.08)' }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--hr-text)' }}>
                  <span>🔔</span> วันสำคัญ (แจ้งเตือนอัตโนมัติ)
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
                  <div className="hr-field"><label>วันเกิด</label><input className="hr-input" type="date" value={form.birthDate} onChange={set('birthDate')} /></div>
                  <div className="hr-field"><label>ครบกำหนดทดลองงาน</label><input className="hr-input" type="date" value={form.probationEnd} onChange={set('probationEnd')} /></div>
                  <div className="hr-field"><label>วันหมดสัญญาจ้าง</label><input className="hr-input" type="date" value={form.contractEnd} onChange={set('contractEnd')} /></div>
                  <div className="hr-field"><label>วันหมดอายุใบขับขี่</label><input className="hr-input" type="date" value={form.licenseExpiry} onChange={set('licenseExpiry')} /></div>
                </div>
              </div>

              {/* Card Section 4: สิทธิ์วันลา */}
              <div style={{ background: '#F8F9FE', borderRadius: 16, padding: '14px 16px', margin: '14px 0', border: '1px solid rgba(60,60,67,0.08)' }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--hr-text)' }}>
                  <span>🏖️</span> สิทธิ์วันลารายพนักงาน ({leaveYear})
                </div>
                <div className="hr-table-wrap" style={{ border: '1px solid var(--hr-border)' }}>
                  <table className="hr-table">
                    <thead>
                      <tr>
                        <th>ใช้สิทธิ์</th>
                        <th>ประเภท</th>
                        <th>สิทธิ์เต็ม</th>
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
                                style={{ width: 16, height: 16, accentColor: '#007AFF' }}
                              />
                            </td>
                            <td><strong>{type?.name || row.leave_type}</strong></td>
                            <td>
                              <input className="hr-input" type="number" step="any" value={row.total_days}
                                disabled={!row.enabled}
                                style={{ width: 75, padding: '6px 8px' }}
                                onChange={(e) => updateLeaveBalance(index, 'total_days', e.target.value === '' ? 0 : Number(e.target.value))} />
                            </td>
                            <td>
                              <input className="hr-input" type="number" step="any" value={row.used_days}
                                disabled={!row.enabled}
                                style={{ width: 75, padding: '6px 8px' }}
                                onChange={(e) => updateLeaveBalance(index, 'used_days', e.target.value === '' ? 0 : Number(e.target.value))} />
                            </td>
                            <td><strong style={{ color: 'var(--hr-accent)' }}>{total - used}</strong></td>
                            <td>
                              <input className="hr-input" value={row.note || ''} disabled={!row.enabled}
                                style={{ padding: '6px 8px' }}
                                onChange={(e) => updateLeaveBalance(index, 'note', e.target.value)} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="hr-modal-actions" style={{ marginTop: 18 }}>
                <button type="button" className="hr-btn" onClick={() => setEditing(null)}>ยกเลิก</button>
                <button type="submit" className="hr-btn hr-btn-primary" disabled={saving}>{saving ? 'กำลังบันทึก...' : 'บันทึกการแก้ไข'}</button>
              </div>
            </form>
          </div>
        </div>
      )}


      {isAdding && (
        <div className="hr-modal-overlay" onClick={() => setIsAdding(false)}>
          <div className="hr-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 680 }}>
            <div className="hr-modal-header" style={{ borderBottom: '1px solid var(--hr-border)', paddingBottom: 12 }}>
              <div>
                <div className="hr-modal-title">✨ เพิ่มพนักงานใหม่</div>
                <div style={{ fontSize: 12, color: 'var(--hr-text-3)', marginTop: 2 }}>สร้างข้อมูลและบัญชีผู้ใช้งานอัตโนมัติ</div>
              </div>
              <button className="hr-modal-close" onClick={() => setIsAdding(false)}>✕</button>
            </div>
            <form onSubmit={saveNewEmployee}>
              {/* Card Section 1: ข้อมูลส่วนตัว & การทำงาน */}
              <div style={{ background: '#F8F9FE', borderRadius: 16, padding: '14px 16px', margin: '14px 0', border: '1px solid rgba(60,60,67,0.08)' }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--hr-text)' }}>
                  <span>👤</span> ข้อมูลทั่วไปและตำแหน่งงาน
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
                  <div className="hr-field">
                    <label>ชื่อ-นามสกุล (ไทย) *</label>
                    <input className="hr-input" value={addForm.name} onChange={(e) => setAddForm(p => ({ ...p, name: e.target.value }))} required placeholder="เช่น สมชาย ใจดี" />
                  </div>
                  <div className="hr-field">
                    <label>ชื่อ (อังกฤษ)</label>
                    <input className="hr-input" value={addForm.nameEn} onChange={(e) => setAddForm(p => ({ ...p, nameEn: e.target.value }))} placeholder="เช่น Somchai Jaidee" />
                  </div>
                  <div className="hr-field">
                    <label>รหัสพนักงาน (เว้นว่าง = Auto)</label>
                    <input className="hr-input" value={addForm.employeeId} onChange={(e) => setAddForm(p => ({ ...p, employeeId: e.target.value }))} placeholder="เช่น EMP007" />
                  </div>
                  <div className="hr-field">
                    <label>สาขา *</label>
                    <select className="hr-input" value={addForm.branchId} onChange={(e) => setAddForm(p => ({ ...p, branchId: e.target.value }))} required>
                      <option value="">— เลือกสาขา —</option>
                      {branches.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
                    </select>
                  </div>
                  <div className="hr-field">
                    <label>แผนก</label>
                    <select className="hr-input" value={addForm.department} onChange={(e) => setAddForm(p => ({ ...p, department: e.target.value }))}>
                      <option value="">— เลือกแผนก —</option>
                      {departmentsList.map((d) => <option key={d.code || d.name} value={d.name}>{d.name}</option>)}
                    </select>
                  </div>
                  <div className="hr-field">
                    <label>ตำแหน่ง</label>
                    <select className="hr-input" value={addForm.position} onChange={(e) => setAddForm(p => ({ ...p, position: e.target.value }))}>
                      <option value="">— เลือกตำแหน่ง —</option>
                      {positionsList.map((p) => <option key={p.id || p.title} value={p.title}>{p.title}</option>)}
                    </select>
                  </div>
                  <div className="hr-field">
                    <label>ประเภทการจ้าง</label>
                    <select className="hr-input" value={addForm.employmentType} onChange={(e) => {
                      const val = e.target.value;
                      setAddForm(p => ({
                        ...p,
                        employmentType: val,
                        payCycle: val === 'daily' ? 'end_month' : 'monthly',
                      }));
                    }}>
                      {Object.entries(EMPLOYMENT_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </div>
                  <div className="hr-field">
                    <label>รอบการจ่ายเงิน {addForm.employmentType === 'daily' && <span style={{ color: 'var(--hr-accent)', fontWeight: 700 }}>*</span>}</label>
                    <select className="hr-input" value={addForm.payCycle} onChange={(e) => setAddForm(p => ({ ...p, payCycle: e.target.value }))}>
                      {addForm.employmentType === 'daily' ? (
                        <>
                          <option value="end_month">รวบจ่ายทุกสิ้นเดือน (ตามวันมาทำงานจริง)</option>
                          <option value="biweekly">รวบจ่ายทุก 15 วัน (งวด 1-15 และ 16-สิ้นเดือน)</option>
                          <option value="daily">โอนจ่ายวันต่อวัน (จ่ายทันทีหลังเช็คเอาต์)</option>
                        </>
                      ) : (
                        <option value="monthly">รายเดือน (จ่ายทุกสิ้นเดือน)</option>
                      )}
                    </select>
                  </div>
                  <div className="hr-field">
                    <label>วันเริ่มงาน</label>
                    <input className="hr-input" type="date" value={addForm.startDate} onChange={(e) => setAddForm(p => ({ ...p, startDate: e.target.value }))} />
                  </div>
                </div>
              </div>

              {/* Card Section 2: การเงิน & ติดต่อ */}
              <div style={{ background: '#F8F9FE', borderRadius: 16, padding: '14px 16px', margin: '14px 0', border: '1px solid rgba(60,60,67,0.08)' }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--hr-text)' }}>
                  <span>💳</span> ข้อมูลการเงินและติดต่อ
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
                  <div className="hr-field">
                    <label>{addForm.employmentType === 'daily' ? 'ค่าจ้างรายวัน (บาท/วัน) *' : 'เงินเดือนฐาน (บาท/เดือน) *'}</label>
                    <input className="hr-input" type="number" value={addForm.salary} onChange={(e) => setAddForm(p => ({ ...p, salary: Number(e.target.value) }))} />
                    {addForm.employmentType === 'daily' && (
                      <span style={{ fontSize: 11, color: 'var(--hr-text-3)', display: 'block', marginTop: 3 }}>
                        ⚠️ จ่ายเฉพาะวันที่เช็คอินเข้างานจริง (ขาดงาน/ไม่เช็คอิน/ลาหยุด ไม่จ่าย)
                      </span>
                    )}
                  </div>
                  <div className="hr-field">
                    <label>เบอร์โทรศัพท์</label>
                    <input className="hr-input" value={addForm.phone} onChange={(e) => setAddForm(p => ({ ...p, phone: e.target.value }))} placeholder="08xxxxxxxx" />
                  </div>
                  <div className="hr-field">
                    <label>เลขบัตรประชาชน (13 หลัก)</label>
                    <input className="hr-input" value={addForm.nationalId} maxLength={13} onChange={(e) => setAddForm(p => ({ ...p, nationalId: e.target.value }))} />
                  </div>
                </div>
              </div>

              {/* Card Section 3: บัญชีผู้ใช้งานระบบ */}
              <div style={{ background: 'rgba(0,122,255,0.06)', borderRadius: 16, padding: '14px 16px', margin: '14px 0', border: '1px solid rgba(0,122,255,0.18)' }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--hr-accent)' }}>
                  <span>🔐</span> บัญชีเข้าสู่ระบบ (Self-Service Mobile & PWA)
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
                  <div className="hr-field">
                    <label>บทบาท (Role)</label>
                    <select className="hr-input" value={addForm.role} onChange={(e) => setAddForm(p => ({ ...p, role: e.target.value }))}>
                      <option value="employee">พนักงานทั่วไป</option>
                      <option value="hr">ฝ่ายบุคคล (HR)</option>
                      <option value="manager">ผู้จัดการ / หัวหน้างาน</option>
                      <option value="accounting">บัญชีและการเงิน</option>
                      <option value="admin">ผู้ดูแลระบบ</option>
                    </select>
                  </div>
                  <div className="hr-field">
                    <label>Username (เว้นว่าง = รหัส พนง.)</label>
                    <input className="hr-input" value={addForm.username} onChange={(e) => setAddForm(p => ({ ...p, username: e.target.value }))} placeholder="auto" />
                  </div>
                  <div className="hr-field">
                    <label>รหัสผ่าน (เริ่มต้น 123456)</label>
                    <input className="hr-input" type="password" value={addForm.password} onChange={(e) => setAddForm(p => ({ ...p, password: e.target.value }))} placeholder="123456" />
                  </div>
                </div>
              </div>

              <div className="hr-modal-actions" style={{ marginTop: 18 }}>
                <button type="button" className="hr-btn" onClick={() => setIsAdding(false)}>ยกเลิก</button>
                <button type="submit" className="hr-btn hr-btn-primary" disabled={saving}>
                  {saving ? 'กำลังบันทึก...' : '✅ บันทึกพนักงานใหม่'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

            {toast && <div className={`hr-toast ${toast.type}`}>{toast.message}</div>}
    </div>
  );
}
