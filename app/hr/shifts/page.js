'use client';

import { useCallback, useEffect, useState } from 'react';
import ResourceTable from '@/components/hr/ResourceTable';
import { authHeaders } from '@/components/hr/exportUtils';

const THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];
const DOW = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัส', 'ศุกร์', 'เสาร์'];
const SHIFT_LABELS = { morning: 'เช้า', afternoon: 'บ่าย', night: 'ดึก', off: 'หยุด' };

const SHIFT_OPTIONS = Object.entries(SHIFT_LABELS).map(([value, label]) => ({ value, label }));

const TABLE_CONFIG = {
  resource: 'shifts',
  exportName: 'shifts',
  searchPlaceholder: 'ค้นหารหัสพนักงาน...',
  columns: [
    { key: 'employee_id', label: 'พนักงาน' },
    { key: 'shift_date', label: 'วันที่' },
    {
      key: 'shift_type', label: 'กะ',
      badge: { morning: 'blue', afternoon: 'yellow', night: 'purple', off: 'gray' },
      badgeLabels: SHIFT_LABELS,
    },
    { key: 'start_time', label: 'เริ่ม' },
    { key: 'end_time', label: 'ถึง' },
    { key: 'note', label: 'หมายเหตุ' },
  ],
  fields: [
    { key: 'employee_id', label: 'พนักงาน', type: 'employee', required: true },
    { key: 'shift_date', label: 'วันที่', type: 'date', required: true },
    { key: 'shift_type', label: 'กะ', type: 'select', required: true, options: SHIFT_OPTIONS },
    { key: 'start_time', label: 'เวลาเริ่ม', type: 'time' },
    { key: 'end_time', label: 'เวลาสิ้นสุด', type: 'time' },
    { key: 'note', label: 'หมายเหตุ', type: 'text' },
  ],
};

export default function ShiftsPage() {
  const [view, setView] = useState('calendar');
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth()); // 0-11
  const [shifts, setShifts] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [modalDate, setModalDate] = useState(null);
  const [form, setForm] = useState({ employee_id: '', shift_type: 'morning', start_time: '', end_time: '' });
  const [toast, setToast] = useState(null);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const load = useCallback(async () => {
    const res = await fetch('/api/hr/shifts', { headers: authHeaders() });
    const data = await res.json();
    if (res.ok) setShifts(data.items || []);
  }, []);

  useEffect(() => {
    load();
    fetch('/api/hr/employees', { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => setEmployees(d.employees || []))
      .catch(() => {});
  }, [load]);

  function nav(delta) {
    let m = month + delta;
    let y = year;
    if (m < 0) { m = 11; y -= 1; }
    if (m > 11) { m = 0; y += 1; }
    setMonth(m);
    setYear(y);
  }

  const empName = (id) => {
    const emp = employees.find((e) => e.employeeId === id);
    return emp ? emp.name.split(' ')[0] : id;
  };

  async function addShift(e) {
    e.preventDefault();
    const res = await fetch('/api/hr/shifts', {
      method: 'POST',
      headers: authHeaders(true),
      body: JSON.stringify({ ...form, shift_date: modalDate }),
    });
    const data = await res.json();
    if (res.ok) { setModalDate(null); showToast('เพิ่มกะแล้ว'); load(); }
    else showToast(data.error || 'บันทึกไม่สำเร็จ', 'error');
  }

  // สร้าง grid ของเดือน
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const dateStr = (d) => `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const todayStr = new Date().toISOString().slice(0, 10);
  const monthShifts = shifts.filter((s) => s.shift_date?.startsWith(`${year}-${String(month + 1).padStart(2, '0')}`));

  return (
    <div>
      <div className="hr-tabs">
        <button className={`hr-tab${view === 'calendar' ? ' active' : ''}`} onClick={() => setView('calendar')}>🗓️ ปฏิทิน</button>
        <button className={`hr-tab${view === 'list' ? ' active' : ''}`} onClick={() => setView('list')}>📋 รายการ</button>
      </div>

      {view === 'list' ? (
        <ResourceTable config={TABLE_CONFIG} />
      ) : (
        <div className="hr-card">
          <div className="hr-cal-head">
            <button className="hr-btn hr-btn-icon" onClick={() => nav(-1)}>‹</button>
            <div className="hr-cal-month">{THAI_MONTHS[month]} {year + 543}</div>
            <button className="hr-btn hr-btn-icon" onClick={() => nav(1)}>›</button>
            <button className="hr-btn" onClick={() => { setYear(today.getFullYear()); setMonth(today.getMonth()); }}>วันนี้</button>
            <span style={{ marginLeft: 'auto' }} className="hr-badge hr-badge-purple">{monthShifts.length} กะเดือนนี้</span>
          </div>

          <div className="hr-cal-grid">
            {DOW.map((d, i) => (
              <div key={d} className={`hr-cal-dow${i === 0 || i === 6 ? ' weekend' : ''}`}>{d}</div>
            ))}
            {cells.map((d, i) => {
              if (d === null) return <div key={`e${i}`} className="hr-cal-day empty" />;
              const ds = dateStr(d);
              const dayShifts = shifts.filter((s) => s.shift_date === ds);
              const dow = (firstDow + d - 1) % 7;
              return (
                <div
                  key={ds}
                  className={`hr-cal-day${ds === todayStr ? ' today' : ''}`}
                  onClick={() => { setForm({ employee_id: '', shift_type: 'morning', start_time: '', end_time: '' }); setModalDate(ds); }}
                >
                  <div className={`hr-cal-date${dow === 0 || dow === 6 ? ' weekend' : ''}`}>{d}</div>
                  {dayShifts.slice(0, 3).map((s) => (
                    <div key={s.id} className={`hr-cal-chip hr-chip-${s.shift_type}`}>
                      {empName(s.employee_id)} · {SHIFT_LABELS[s.shift_type]}
                    </div>
                  ))}
                  {dayShifts.length > 3 && <div className="hr-cal-chip hr-chip-off">+{dayShifts.length - 3} เพิ่มเติม</div>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {modalDate && (
        <div className="hr-modal-overlay" onClick={() => setModalDate(null)}>
          <div className="hr-modal" onClick={(e) => e.stopPropagation()}>
            <div className="hr-modal-header">
              <div className="hr-modal-title">จัดกะ · {modalDate}</div>
              <button className="hr-modal-close" onClick={() => setModalDate(null)}>✕</button>
            </div>
            <form onSubmit={addShift}>
              <div className="hr-field">
                <label>พนักงาน *</label>
                <select value={form.employee_id} onChange={(e) => setForm((p) => ({ ...p, employee_id: e.target.value }))} required>
                  <option value="">— เลือกพนักงาน —</option>
                  {employees.map((emp) => (
                    <option key={emp.employeeId} value={emp.employeeId}>{emp.employeeId} · {emp.name}</option>
                  ))}
                </select>
              </div>
              <div className="hr-field">
                <label>กะ *</label>
                <select value={form.shift_type} onChange={(e) => setForm((p) => ({ ...p, shift_type: e.target.value }))}>
                  {SHIFT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div className="hr-field"><label>เวลาเริ่ม</label><input className="hr-input" type="time" value={form.start_time} onChange={(e) => setForm((p) => ({ ...p, start_time: e.target.value }))} /></div>
              <div className="hr-field"><label>เวลาสิ้นสุด</label><input className="hr-input" type="time" value={form.end_time} onChange={(e) => setForm((p) => ({ ...p, end_time: e.target.value }))} /></div>
              <div className="hr-modal-actions">
                <button type="button" className="hr-btn" onClick={() => setModalDate(null)}>ยกเลิก</button>
                <button type="submit" className="hr-btn hr-btn-primary">บันทึก</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {toast && <div className={`hr-toast ${toast.type}`}>{toast.message}</div>}
    </div>
  );
}
