'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { exportExcel, printPDF, authHeaders } from './exportUtils';

const WEEKDAY_OPTIONS = [
  { value: '1', label: 'จันทร์' },
  { value: '2', label: 'อังคาร' },
  { value: '3', label: 'พุธ' },
  { value: '4', label: 'พฤหัส' },
  { value: '5', label: 'ศุกร์' },
  { value: '6', label: 'เสาร์' },
  { value: '0', label: 'อาทิตย์' },
];

function formatWeekdays(value) {
  const days = String(value || '').split(',').filter(Boolean);
  if (days.length === 0) return '-';
  const byValue = new Map(WEEKDAY_OPTIONS.map((d) => [d.value, d.label]));
  return days.map((day) => byValue.get(day) || day).join(', ');
}

/**
 * ตาราง CRUD อเนกประสงค์สำหรับทุกหน้า /hr — Apple iOS / iPadOS Design System
 */
export default function ResourceTable({ config }) {
  const {
    resource, columns, fields,
    searchPlaceholder = 'ค้นหา...',
    canEdit = true, canDelete = true,
    exportName = resource,
    renderActions, headerExtra, transformBeforeSave,
    rowFilter, onItemsChange,
    statusFilter = true,
    emptyHint,
  } = config;

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusTab, setStatusTab] = useState('all');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [confirmDeleteRow, setConfirmDeleteRow] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [employees, setEmployees] = useState([]);
  const searchTimer = useRef(null);

  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3200);
  }, []);

  const load = useCallback(async (q = '') => {
    setLoading(true);
    try {
      const url = `/api/hr/${resource}${q ? `?q=${encodeURIComponent(q)}` : ''}`;
      const res = await fetch(url, { headers: authHeaders() });
      const data = await res.json();
      if (res.ok) setItems(data.items || []);
      else showToast(data.error || 'โหลดข้อมูลไม่สำเร็จ', 'error');
    } catch {
      showToast('เชื่อมต่อไม่สำเร็จ', 'error');
    }
    setLoading(false);
  }, [resource, showToast]);

  useEffect(() => { load(); }, [load]);

  // ติดตาม active branch สำหรับกรองข้อมูลทุกตาราง
  const [activeBranch, setActiveBranch] = useState(
    typeof window !== 'undefined' ? localStorage.getItem('hr-active-branch') || 'all' : 'all'
  );
  useEffect(() => {
    const handleBranch = (e) => setActiveBranch(e.detail || 'all');
    window.addEventListener('hr-branch-change', handleBranch);
    return () => window.removeEventListener('hr-branch-change', handleBranch);
  }, []);

  // โหลดรายชื่อพนักงานเมื่อมี field หรือ column ที่เกี่ยวกับ employee
  const needEmployees =
    fields?.some((f) => f.type === 'employee') ||
    columns?.some((c) => c.key === 'employee_id' || c.employeeLookup);
  useEffect(() => {
    if (!needEmployees) return;
    fetch('/api/hr/employees', { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => setEmployees(d.employees || []))
      .catch(() => {});
  }, [needEmployees]);

  // โหลดรายชื่อสาขาเมื่อมี field type 'branch'
  const [branches, setBranches] = useState([]);
  const needBranches = fields?.some((f) => f.type === 'branch') || columns?.some((c) => c.branchLookup);
  useEffect(() => {
    if (!needBranches) return;
    fetch('/api/hr/branches', { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => setBranches(d.items || []))
      .catch(() => {});
  }, [needBranches]);

  // โหลดรายชื่อแผนกเมื่อมี field type 'department'
  const [departments, setDepartments] = useState([]);
  const needDepartments = fields?.some((f) => f.type === 'department');
  useEffect(() => {
    if (!needDepartments) return;
    fetch('/api/hr/departments', { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => setDepartments(d.items || []))
      .catch(() => {});
  }, [needDepartments]);

  // โหลดรายชื่อตำแหน่งเมื่อมี field type 'position'
  const [positions, setPositions] = useState([]);
  const needPositions = fields?.some((f) => f.type === 'position');
  useEffect(() => {
    if (!needPositions) return;
    fetch('/api/hr/positions', { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => setPositions(d.items || []))
      .catch(() => {});
  }, [needPositions]);

  function onSearch(value) {
    setSearch(value);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => load(value), 300);
  }

  function openAdd() {
    setEditing(null);
    const initial = {};
    for (const f of fields || []) initial[f.key] = f.default ?? (f.type === 'checkbox' ? false : '');
    setForm(initial);
    setShowModal(true);
  }

  function openEdit(row) {
    setEditing(row);
    const initial = {};
    for (const f of fields || []) initial[f.key] = row[f.key] ?? (f.type === 'checkbox' ? false : '');
    setForm(initial);
    setShowModal(true);
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const url = editing ? `/api/hr/${resource}/${editing.id}` : `/api/hr/${resource}`;
      const payload = transformBeforeSave ? transformBeforeSave(form) : form;
      const res = await fetch(url, {
        method: editing ? 'PUT' : 'POST',
        headers: authHeaders(true),
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok) {
        setShowModal(false);
        showToast(editing ? 'บันทึกการแก้ไขเรียบร้อย' : 'เพิ่มรายการใหม่เรียบร้อย');
        load(search);
      } else {
        showToast(data.error || 'บันทึกไม่สำเร็จ', 'error');
      }
    } catch {
      showToast('เชื่อมต่อไม่สำเร็จ', 'error');
    }
    setSaving(false);
  }

  async function executeRemove() {
    if (!confirmDeleteRow) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/hr/${resource}/${confirmDeleteRow.id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (res.ok) {
        showToast('ลบรายการเรียบร้อยแล้ว');
        setConfirmDeleteRow(null);
        load(search);
      } else {
        const d = await res.json().catch(() => ({}));
        showToast(d.error || 'ลบไม่สำเร็จ', 'error');
      }
    } catch {
      showToast('เกิดข้อผิดพลาดในการลบ', 'error');
    }
    setDeleting(false);
  }

  function renderCell(col, row) {
    const value = row[col.key];
    if (col.key === 'employee_id' || col.employeeLookup) {
      const emp = employees.find((e) => e.employeeId === value);
      if (emp) {
        return (
          <span title={`${emp.name} (${emp.department || '-'})`}>
            <strong style={{ color: '#000' }}>{value}</strong>{' '}
            <span style={{ color: '#3C3C43', fontSize: 13 }}>· {emp.name}</span>
          </span>
        );
      }
      return value || '-';
    }
    if (col.branchLookup) {
      if (value === null || value === undefined || value === '') return 'ทุกสาขา';
      const b = branches.find((x) => x.id === value);
      return b ? `${b.code} · ${b.name}` : value;
    }
    if (col.type === 'weekdays') return formatWeekdays(value);
    if (col.badge) {
      const color = col.badge[value] || 'gray';
      return <span className={`hr-badge hr-badge-${color}`}>{col.badgeLabels?.[value] || value || '-'}</span>;
    }
    if (col.format) return col.format(value, row);
    return value === null || value === undefined || value === '' ? '-' : String(value);
  }

  function renderField(f) {
    const value = form[f.key];
    const set = (v) => setForm((prev) => ({ ...prev, [f.key]: v }));

    if (typeof f.render === 'function') {
      return f.render({ value, set, form, setForm });
    }

    if (f.type === 'select') {
      return (
        <select value={value} onChange={(e) => set(e.target.value)} required={f.required}>
          <option value="">— เลือก —</option>
          {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      );
    }
    if (f.type === 'employee') {
      return (
        <select value={value} onChange={(e) => set(e.target.value)} required={f.required}>
          <option value="">— เลือกพนักงาน —</option>
          {employees.map((emp) => (
            <option key={emp.employeeId} value={emp.employeeId}>
              {emp.employeeId} · {emp.name}
            </option>
          ))}
        </select>
      );
    }
    if (f.type === 'department') {
      return (
        <select value={value || ''} onChange={(e) => set(e.target.value)} required={f.required}>
          <option value="">— เลือกแผนก —</option>
          {departments.map((d) => (
            <option key={d.code || d.name} value={d.name}>{d.name} {d.code ? `(${d.code})` : ''}</option>
          ))}
          {value && !departments.some((d) => d.name === value || d.code === value) && (
            <option value={value}>{value} (เดิม)</option>
          )}
        </select>
      );
    }
    if (f.type === 'position') {
      const isKnown = positions.some((p) => p.title === value);
      const isCustomMode = value !== undefined && value !== null && value !== '' && !isKnown;
      return (
        <div>
          <select
            value={isCustomMode ? '__custom__' : (value || '')}
            onChange={(e) => {
              if (e.target.value === '__custom__') {
                set(value && !isKnown ? value : ' ');
              } else {
                set(e.target.value);
              }
            }}
            required={f.required && !isCustomMode}
          >
            <option value="">— เลือกตำแหน่ง —</option>
            {positions.map((p) => (
              <option key={p.id || p.title} value={p.title}>{p.title} {p.level ? `(${p.level})` : ''}</option>
            ))}
            <option value="__custom__">✏️ ระบุตำแหน่งอื่น (พิมพ์ชื่อเอง)...</option>
          </select>
          {(isCustomMode || value === ' ') && (
            <input
              type="text"
              className="hr-input"
              style={{ marginTop: 6 }}
              placeholder="พิมพ์ชื่อตำแหน่งงานที่ต้องการ..."
              value={value === ' ' ? '' : (value || '')}
              onChange={(e) => set(e.target.value)}
              required={f.required}
              autoFocus
            />
          )}
        </div>
      );
    }
    if (f.type === 'branch') {
      return (
        <select value={value ?? ''} onChange={(e) => set(e.target.value === '' ? '' : Number(e.target.value))} required={f.required}>
          <option value="">{f.allLabel || '— ทุกสาขา —'}</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>{b.code} · {b.name}</option>
          ))}
        </select>
      );
    }
    if (f.type === 'textarea') {
      return <textarea value={value} onChange={(e) => set(e.target.value)} required={f.required} />;
    }
    if (f.type === 'checkbox') {
      return (
        <input
          type="checkbox"
          checked={!!value}
          onChange={(e) => set(e.target.checked)}
          style={{ width: 20, height: 20, accentColor: '#007AFF', cursor: 'pointer' }}
        />
      );
    }
    if (f.type === 'weekdays') {
      const selected = new Set(String(value || '').split(',').filter(Boolean));
      const toggle = (day) => {
        const next = new Set(selected);
        next.has(day) ? next.delete(day) : next.add(day);
        const ordered = WEEKDAY_OPTIONS.map((d) => d.value).filter((d) => next.has(d));
        set(ordered.join(','));
      };
      return (
        <div>
          <div className="hr-weekday-picker">
            {WEEKDAY_OPTIONS.map((day) => (
              <button
                key={day.value}
                type="button"
                className={`hr-tab${selected.has(day.value) ? ' active' : ''}`}
                onClick={() => toggle(day.value)}
              >
                {day.label}
              </button>
            ))}
          </div>
          <div className="hr-help-text">{f.help || 'เว้นว่าง = ใช้วันทำงานค่ากลางของบริษัท'}</div>
        </div>
      );
    }
    return (
      <input
        className="hr-input"
        type={f.type || 'text'}
        value={value}
        onChange={(e) => set(f.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)}
        required={f.required}
        step={f.type === 'number' ? 'any' : undefined}
      />
    );
  }

  const hasRowActions = canEdit || canDelete || renderActions;
  const empMap = new Map((employees || []).map((e) => [e.employeeId, e]));
  const statusCol = statusFilter ? columns.find((c) => c.key === 'status' && c.badge) : null;

  // กรองตามสาขา + rowFilter ภายนอก (ยังไม่กรองสถานะ/ค้นหา) — ใช้นับจำนวนใน segmented
  const scopedItems = items.filter((row) => {
    if (activeBranch !== 'all') {
      if (row.branch_id !== undefined && row.branch_id !== null && row.branch_id !== '') {
        if (String(row.branch_id) !== String(activeBranch)) return false;
      } else if (row.employee_id) {
        const emp = empMap.get(row.employee_id);
        if (emp && emp.branchId && String(emp.branchId) !== String(activeBranch)) return false;
      }
    }
    if (rowFilter && !rowFilter(row)) return false;
    return true;
  });

  const filteredItems = scopedItems.filter((row) => {
    if (statusCol && statusTab !== 'all' && String(row.status) !== statusTab) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    for (const c of columns) {
      const v = row[c.key];
      if (v !== undefined && v !== null && String(v).toLowerCase().includes(q)) return true;
    }
    if (row.employee_id) {
      const emp = empMap.get(row.employee_id);
      if (emp && ((emp.name && emp.name.toLowerCase().includes(q)) || (emp.department && emp.department.toLowerCase().includes(q)))) {
        return true;
      }
    }
    return false;
  });

  // แจ้งรายการทั้งหมด (หลังกรองสาขา) ให้หน้าแม่ใช้ทำสรุป — ใช้ ref กัน loop
  const onItemsRef = useRef(onItemsChange);
  onItemsRef.current = onItemsChange;
  useEffect(() => {
    if (onItemsRef.current) onItemsRef.current(items, { loading, activeBranch, empMap });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, loading, activeBranch, employees]);

  const statusCounts = {};
  if (statusCol) {
    for (const row of scopedItems) statusCounts[row.status] = (statusCounts[row.status] || 0) + 1;
  }
  const statusOptions = statusCol
    ? Object.keys({ ...(statusCol.badgeLabels || statusCol.badge), ...statusCounts })
    : [];
  const thStyle = (c) => (c.align ? { textAlign: c.align } : undefined);

  return (
    <div>
      {headerExtra}

      {statusCol && statusOptions.length > 0 && (
        <div className="hr-segmented-wrap" style={{ marginBottom: 12 }}>
          <div className="hr-segmented-control" role="tablist">
            <button
              type="button"
              className={`hr-segmented-item${statusTab === 'all' ? ' active' : ''}`}
              onClick={() => setStatusTab('all')}
            >
              ทั้งหมด ({scopedItems.length})
            </button>
            {statusOptions.map((opt) => (
              <button
                key={opt}
                type="button"
                className={`hr-segmented-item${statusTab === opt ? ' active' : ''}`}
                onClick={() => setStatusTab(opt)}
              >
                {statusCol.badgeLabels?.[opt] || opt} ({statusCounts[opt] || 0})
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="hr-toolbar">
        <div className="hr-search-box">
          <span className="hr-search-icon" aria-hidden="true">🔍</span>
          <input
            className="hr-search"
            placeholder={searchPlaceholder}
            value={search}
            onChange={(e) => onSearch(e.target.value)}
          />
          {search && (
            <button
              type="button"
              className="hr-search-clear"
              onClick={() => onSearch('')}
              aria-label="ล้างคำค้นหา"
            >
              ✕
            </button>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, marginLeft: 'auto', flexWrap: 'wrap' }}>
          <button className="hr-btn" onClick={() => exportExcel(filteredItems, columns, exportName)}>
            <span>📊</span> ส่งออก Excel
          </button>
          <button className="hr-btn" onClick={printPDF}>
            <span>🖨️</span> พิมพ์ PDF
          </button>
          {fields && fields.length > 0 && (
            <button className="hr-btn hr-btn-primary" onClick={openAdd}>
              <span>＋</span> เพิ่มรายการ
            </button>
          )}
        </div>
      </div>

      <div className="hr-table-wrap hr-responsive-cards">
        <table className="hr-table">
          <thead>
            <tr>
              {columns.map((c) => <th key={c.key}>{c.label}</th>)}
              {hasRowActions && <th style={{ textAlign: 'right' }}>จัดการ</th>}
            </tr>
          </thead>
          <tbody>
            {loading && Array.from({ length: 5 }).map((_, idx) => (
              <tr key={`sk-${idx}`}>
                {columns.map((c) => (
                  <td key={c.key}>
                    <div className="ios-skeleton" style={{ height: 16, width: '75%' }} />
                  </td>
                ))}
                {hasRowActions && (
                  <td style={{ textAlign: 'right' }}>
                    <div className="ios-skeleton" style={{ height: 24, width: 64, marginLeft: 'auto' }} />
                  </td>
                )}
              </tr>
            ))}

            {!loading && filteredItems.map((row) => (
              <tr key={row.id}>
                {columns.map((c) => <td key={c.key}>{renderCell(c, row)}</td>)}
                {hasRowActions && (
                  <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                    {renderActions && renderActions(row, () => load(search), showToast)}
                    {canEdit && (
                      <button className="hr-btn hr-btn-icon" title="แก้ไข" onClick={() => openEdit(row)} style={{ marginLeft: 6 }}>✏️</button>
                    )}
                    {canDelete && (
                      <button className="hr-btn hr-btn-icon hr-btn-danger" title="ลบ" onClick={() => setConfirmDeleteRow(row)} style={{ marginLeft: 6 }}>🗑️</button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>

        {!loading && filteredItems.length === 0 && (
          <div className="hr-empty">
            <div style={{ fontSize: 34, marginBottom: 8, opacity: 0.7 }}>🗂️</div>
            <div style={{ fontWeight: 600, color: '#1d2433', fontSize: 15, marginBottom: 4 }}>
              {activeBranch !== 'all' && items.length > 0
                ? 'ไม่พบข้อมูลในสาขาที่เลือก'
                : search
                  ? `ไม่พบข้อมูลที่ตรงกับ "${search}"`
                  : 'ยังไม่มีรายการข้อมูล'}
            </div>
            <div style={{ fontSize: 13, color: '#8E8E93' }}>
              {activeBranch !== 'all' && items.length > 0
                ? `มีทั้งหมด ${items.length} รายการในสาขาอื่น — ลองสลับตัวกรองเป็น "ทุกสาขา" ที่แถบด้านบน`
                : 'คลิกปุ่ม "+ เพิ่มรายการ" ด้านบนเพื่อสร้างข้อมูลใหม่'}
            </div>
          </div>
        )}

        <div className="hr-mobile-cards">
          {!loading && filteredItems.map((row) => {
            const titleCol = columns[0];
            const subCol = columns[1];
            return (
              <div className="hr-mobile-row-card" key={row.id}>
                <div className="hr-mobile-row-head">
                  <div>
                    <div className="hr-mobile-row-title">{renderCell(titleCol, row)}</div>
                    {subCol && <div className="hr-mobile-row-sub">{subCol.label}: {renderCell(subCol, row)}</div>}
                  </div>
                  {columns.find((c) => c.key === 'status') && renderCell(columns.find((c) => c.key === 'status'), row)}
                </div>
                {columns.slice(1).filter((c) => c.key !== 'status').map((c) => (
                  <div className="hr-mobile-row-field" key={c.key}>
                    <span className="k">{c.label}</span>
                    <span className="v">{renderCell(c, row)}</span>
                  </div>
                ))}
                {hasRowActions && (
                  <div className="hr-mobile-row-actions">
                    {renderActions && renderActions(row, () => load(search), showToast)}
                    {canEdit && (
                      <button className="hr-btn" title="แก้ไข" onClick={() => openEdit(row)}>✏️ แก้ไข</button>
                    )}
                    {canDelete && (
                      <button className="hr-btn hr-btn-danger" title="ลบ" onClick={() => setConfirmDeleteRow(row)}>🗑️ ลบ</button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Form Sheet Modal */}
      {showModal && (
        <div className="hr-modal-overlay" onClick={() => setShowModal(false)}>
          <div className="hr-modal" onClick={(e) => e.stopPropagation()}>
            <div className="hr-modal-header">
              <div className="hr-modal-title">{editing ? 'แก้ไขข้อมูล' : 'เพิ่มข้อมูลใหม่'}</div>
              <button className="hr-modal-close" onClick={() => setShowModal(false)} aria-label="ปิดหน้าต่าง">✕</button>
            </div>
            <form onSubmit={save}>
              {(fields || []).map((f) => (
                <div className="hr-field" key={f.key}>
                  <label>{f.label}{f.required ? ' *' : ''}</label>
                  {renderField(f)}
                </div>
              ))}
              <div className="hr-modal-actions">
                <button type="button" className="hr-btn" onClick={() => setShowModal(false)}>ยกเลิก</button>
                <button type="submit" className="hr-btn hr-btn-primary" disabled={saving}>
                  {saving ? 'กำลังบันทึก...' : 'บันทึกข้อมูล'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Native iOS Alert Confirmation Dialog for Deletion */}
      {confirmDeleteRow && (
        <div className="hr-modal-overlay" onClick={() => !deleting && setConfirmDeleteRow(null)}>
          <div className="hr-ios-alert" onClick={(e) => e.stopPropagation()} role="alertdialog" aria-modal="true">
            <div className="hr-ios-alert-body">
              <div className="hr-ios-alert-title">ยืนยันการลบรายการ?</div>
              <div className="hr-ios-alert-desc">
                คุณต้องการลบข้อมูลนี้ใช่หรือไม่ การดำเนินการนี้ไม่สามารถเรียกคืนได้
              </div>
            </div>
            <div className="hr-ios-alert-actions">
              <button
                type="button"
                className="hr-ios-alert-btn cancel"
                disabled={deleting}
                onClick={() => setConfirmDeleteRow(null)}
              >
                ยกเลิก
              </button>
              <button
                type="button"
                className="hr-ios-alert-btn destructive"
                disabled={deleting}
                onClick={executeRemove}
              >
                {deleting ? 'กำลังลบ...' : 'ลบรายการ'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className={`hr-toast ${toast.type}`}>{toast.message}</div>}
    </div>
  );
}
