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
 * ตาราง CRUD อเนกประสงค์สำหรับทุกหน้า /hr — ขับเคลื่อนด้วย config:
 * {
 *   resource, title, icon,
 *   columns: [{ key, label, badge?: {value: colorName}, format?: (v,row)=>node }],
 *   fields:  [{ key, label, type: text|number|date|time|select|textarea|employee|checkbox,
 *               options?: [{value,label}], required?, default? }],
 *   searchPlaceholder?, canEdit?, canDelete?, exportName?,
 *   renderActions?: (row, reload, showToast) => node,
 *   headerExtra?: node,
 * }
 */
export default function ResourceTable({ config }) {
  const {
    resource, columns, fields,
    searchPlaceholder = 'ค้นหา...',
    canEdit = true, canDelete = true,
    exportName = resource,
    renderActions, headerExtra, transformBeforeSave,
  } = config;

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [employees, setEmployees] = useState([]);
  const searchTimer = useRef(null);

  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
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

  // โหลดรายชื่อพนักงานเมื่อมี field type 'employee'
  const needEmployees = fields?.some((f) => f.type === 'employee');
  useEffect(() => {
    if (!needEmployees) return;
    fetch('/api/hr/employees', { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => setEmployees(d.employees || []))
      .catch(() => {});
  }, [needEmployees]);

  // โหลดรายชื่อสาขาเมื่อมี field type 'branch'
  const [branches, setBranches] = useState([]);
  const needBranches = fields?.some((f) => f.type === 'branch');
  useEffect(() => {
    if (!needBranches) return;
    fetch('/api/hr/branches', { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => setBranches(d.items || []))
      .catch(() => {});
  }, [needBranches]);

  function onSearch(value) {
    setSearch(value);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => load(value), 350);
  }

  function openAdd() {
    setEditing(null);
    const initial = {};
    for (const f of fields) initial[f.key] = f.default ?? (f.type === 'checkbox' ? false : '');
    setForm(initial);
    setShowModal(true);
  }

  function openEdit(row) {
    setEditing(row);
    const initial = {};
    for (const f of fields) initial[f.key] = row[f.key] ?? (f.type === 'checkbox' ? false : '');
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
        showToast(editing ? 'แก้ไขข้อมูลแล้ว' : 'เพิ่มข้อมูลแล้ว');
        load(search);
      } else {
        showToast(data.error || 'บันทึกไม่สำเร็จ', 'error');
      }
    } catch {
      showToast('เชื่อมต่อไม่สำเร็จ', 'error');
    }
    setSaving(false);
  }

  async function remove(row) {
    if (!confirm('ยืนยันการลบข้อมูลนี้?')) return;
    const res = await fetch(`/api/hr/${resource}/${row.id}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    if (res.ok) { showToast('ลบข้อมูลแล้ว'); load(search); }
    else showToast('ลบไม่สำเร็จ', 'error');
  }

  function renderCell(col, row) {
    const value = row[col.key];
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
          style={{ width: 'auto' }}
          className="hr-input"
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

  return (
    <div>
      {headerExtra}

      <div className="hr-toolbar">
        <input
          className="hr-search"
          placeholder={searchPlaceholder}
          value={search}
          onChange={(e) => onSearch(e.target.value)}
        />
        <button className="hr-btn" onClick={() => exportExcel(items, columns, exportName)}>📄 Excel</button>
        <button className="hr-btn" onClick={printPDF}>📑 PDF</button>
        <button className="hr-btn hr-btn-primary" onClick={openAdd}>+ เพิ่ม</button>
      </div>

      <div className="hr-table-wrap">
        <table className="hr-table">
          <thead>
            <tr>
              {columns.map((c) => <th key={c.key}>{c.label}</th>)}
              {hasRowActions && <th></th>}
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr key={row.id}>
                {columns.map((c) => <td key={c.key}>{renderCell(c, row)}</td>)}
                {hasRowActions && (
                  <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                    {renderActions && renderActions(row, () => load(search), showToast)}
                    {canEdit && (
                      <button className="hr-btn hr-btn-icon" title="แก้ไข" onClick={() => openEdit(row)} style={{ marginLeft: 6 }}>✏️</button>
                    )}
                    {canDelete && (
                      <button className="hr-btn hr-btn-icon hr-btn-danger" title="ลบ" onClick={() => remove(row)} style={{ marginLeft: 6 }}>🗑️</button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && items.length === 0 && <div className="hr-empty">ยังไม่มีข้อมูล</div>}
        {loading && <div className="hr-empty">กำลังโหลด...</div>}
      </div>

      {showModal && (
        <div className="hr-modal-overlay">
          <div className="hr-modal" onClick={(e) => e.stopPropagation()}>
            <div className="hr-modal-header">
              <div className="hr-modal-title">{editing ? 'แก้ไขข้อมูล' : 'เพิ่มข้อมูล'}</div>
              <button className="hr-modal-close" onClick={() => setShowModal(false)}>✕</button>
            </div>
            <form onSubmit={save}>
              {fields.map((f) => (
                <div className="hr-field" key={f.key}>
                  <label>{f.label}{f.required ? ' *' : ''}</label>
                  {renderField(f)}
                </div>
              ))}
              <div className="hr-modal-actions">
                <button type="button" className="hr-btn" onClick={() => setShowModal(false)}>ยกเลิก</button>
                <button type="submit" className="hr-btn hr-btn-primary" disabled={saving}>
                  {saving ? 'กำลังบันทึก...' : 'บันทึก'}
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
