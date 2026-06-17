'use client';

import { useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { authHeaders } from '@/components/hr/exportUtils';

const TYPES = {
  employees: {
    label: 'พนักงาน',
    headers: ['employee_id', 'name', 'username', 'password', 'name_en', 'email', 'role', 'department', 'branch_code', 'position', 'start_date', 'salary', 'national_id', 'bank_name', 'bank_account', 'tax_id', 'birth_date'],
    sample: ['DD-100', 'สมชาย ใจดี', 'dd100', 'emp123', 'Somchai', 'somchai@dd.co.th', 'employee', 'ปฏิบัติการ', 'HQ', 'พนักงานขับรถ', '2026-01-15', 18000, '1234567890123', 'กสิกรไทย', '123-4-56789-0', '', '1995-05-20'],
    note: 'employee_id + name จำเป็น · ไม่ใส่ password = emp123 · branch_code ต้องตรงรหัสสาขาที่มี · ถ้ามี employee_id เดิมจะเป็นการอัปเดต (ไม่เปลี่ยนรหัสผ่าน)',
  },
  branches: {
    label: 'สาขา',
    headers: ['code', 'name', 'province', 'phone', 'address', 'work_days', 'standard_in', 'standard_out', 'late_grace_min'],
    sample: ['HQ', 'สำนักงานใหญ่', 'สมุทรสาคร', '034000000', '99/2 ...', '1,2,3,4,5', '08:00', '17:00', 15],
    note: 'code + name จำเป็น · work_days ใช้เลขวัน 0=อา..6=ส คั่นด้วย , · ถ้ามี code เดิมจะอัปเดต',
  },
  holidays: {
    label: 'วันหยุดนักขัตฤกษ์',
    headers: ['holiday_date', 'name', 'branch_code', 'note'],
    sample: ['2026-12-31', 'วันสิ้นปี', '', 'หยุดทุกสาขา'],
    note: 'holiday_date (YYYY-MM-DD) + name จำเป็น · branch_code เว้นว่าง = ทุกสาขา',
  },
};

export default function ImportPage() {
  const [type, setType] = useState('employees');
  const [rows, setRows] = useState([]);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const fileRef = useRef(null);

  const cfg = TYPES[type];
  const showToast = (m, e) => { setToast({ m, e }); setTimeout(() => setToast(null), 3000); };

  function downloadTemplate() {
    const ws = XLSX.utils.aoa_to_sheet([cfg.headers, cfg.sample]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, cfg.label);
    XLSX.writeFile(wb, `template_${type}.xlsx`);
  }

  function onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setResult(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(ev.target.result, { type: 'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(sheet, { defval: '' });
        setRows(json);
        if (json.length === 0) showToast('ไฟล์ว่าง', true);
      } catch { showToast('อ่านไฟล์ไม่สำเร็จ', true); }
    };
    reader.readAsArrayBuffer(file);
  }

  async function doImport() {
    if (rows.length === 0) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch('/api/hr/import', {
        method: 'POST', headers: authHeaders(true), body: JSON.stringify({ type, rows }),
      });
      const d = await res.json();
      if (!res.ok) showToast(d.error || 'นำเข้าไม่สำเร็จ', true);
      else { setResult(d); showToast(`นำเข้าเสร็จ: ใหม่ ${d.created} · อัปเดต ${d.updated}`); }
    } catch { showToast('เชื่อมต่อไม่สำเร็จ', true); }
    setBusy(false);
  }

  const previewCols = rows.length ? Object.keys(rows[0]) : [];

  return (
    <div>
      <div className="hr-card" style={{ marginBottom: 16 }}>
        <p style={{ margin: 0, fontSize: 13, color: '#5b6478' }}>
          นำเข้าข้อมูลทีละหลายรายการจากไฟล์ Excel — เลือกประเภท → ดาวน์โหลดเทมเพลต → กรอกข้อมูล → อัปโหลด → ตรวจดู → นำเข้า
        </p>
      </div>

      <div className="hr-toolbar">
        {Object.entries(TYPES).map(([k, v]) => (
          <button key={k} className={`hr-tab${type === k ? ' active' : ''}`}
            onClick={() => { setType(k); setRows([]); setResult(null); if (fileRef.current) fileRef.current.value = ''; }}>
            {v.label}
          </button>
        ))}
      </div>

      <div className="hr-card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="hr-btn" onClick={downloadTemplate}>📄 ดาวน์โหลดเทมเพลต {cfg.label}</button>
          <button className="hr-btn" onClick={() => fileRef.current?.click()}>📤 เลือกไฟล์ Excel</button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={onFile} />
          {rows.length > 0 && <button className="hr-btn hr-btn-primary" disabled={busy} onClick={doImport}>{busy ? 'กำลังนำเข้า...' : `นำเข้า ${rows.length} รายการ`}</button>}
        </div>
        <p style={{ fontSize: 12, color: '#9aa1b5', marginBottom: 0, marginTop: 10 }}>ℹ️ {cfg.note}</p>
      </div>

      {result && (
        <div className="hr-card" style={{ marginBottom: 16, borderLeft: `4px solid ${result.errors.length ? '#f59e0b' : '#16a34a'}` }}>
          <div style={{ fontWeight: 700 }}>ผลการนำเข้า: เพิ่มใหม่ {result.created} · อัปเดต {result.updated} · ผิดพลาด {result.errors.length}</div>
          {result.errors.length > 0 && (
            <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 13, color: '#b91c1c' }}>
              {result.errors.slice(0, 20).map((e, i) => <li key={i}>{e}</li>)}
              {result.errors.length > 20 && <li>... อีก {result.errors.length - 20} รายการ</li>}
            </ul>
          )}
        </div>
      )}

      {rows.length > 0 && (
        <div className="hr-table-wrap">
          <table className="hr-table">
            <thead><tr><th>#</th>{previewCols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
            <tbody>
              {rows.slice(0, 50).map((r, i) => (
                <tr key={i}><td>{i + 2}</td>{previewCols.map((c) => <td key={c}>{String(r[c] ?? '')}</td>)}</tr>
              ))}
            </tbody>
          </table>
          {rows.length > 50 && <div className="hr-empty">แสดง 50 จาก {rows.length} แถว (นำเข้าทั้งหมดเมื่อกดปุ่ม)</div>}
        </div>
      )}

      {toast && <div className={`hr-toast ${toast.e ? 'error' : ''}`}>{toast.m}</div>}
    </div>
  );
}
