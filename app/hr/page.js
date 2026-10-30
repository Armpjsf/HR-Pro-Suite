'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { authHeaders } from '@/components/hr/exportUtils';

const LEAVE_LABELS = { annual: 'ลาพักร้อน', sick: 'ลาป่วย', personal: 'ลากิจ' };

export default function HrDashboardPage() {
  const [data, setData] = useState(null);
  const [alerts, setAlerts] = useState(null);

  useEffect(() => {
    fetch('/api/hr/dashboard', { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => { if (d.stats) setData(d); })
      .catch(() => {});
    fetch('/api/hr/alerts', { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => { if (d.alerts) setAlerts(d); })
      .catch(() => {});
  }, []);

  if (!data) return <div className="hr-empty">กำลังโหลด...</div>;

  const { stats, attendance, branchStats, driverAlerts, announcements, pendingLeaveList } = data;

  const cards = [
    { icon: '👥', value: stats.employees, label: 'พนักงานทั้งหมด', href: '/hr/employees' },
    { icon: '🏖️', value: stats.pendingLeave, label: 'ใบลารออนุมัติ', href: '/hr/leave' },
    { icon: '🧾', value: stats.pendingExpenses, label: 'เบิกจ่ายรออนุมัติ', href: '/hr/expenses' },
    { icon: '📣', value: stats.openJobs, label: 'ตำแหน่งเปิดรับ', href: '/hr/recruitment' },
    { icon: '💰', value: stats.payrollTotal.toLocaleString('th-TH') + ' ฿', label: `เงินเดือนงวด ${stats.period}`, href: '/hr/payroll' },
  ];

  return (
    <div>
      {/* ── 1. Real-Time Daily Attendance Banner ── */}
      {attendance && (
        <div className="hr-card" style={{ marginBottom: 16, background: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 100%)', color: '#fff', border: 'none' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 20 }}>⏰</span>
              <div>
                <div style={{ fontWeight: 700, fontSize: 16 }}>สถานะการเข้างานวันนี้ (Real-Time Attendance)</div>
                <div style={{ fontSize: 12, color: '#c7d2fe' }}>สรุปยอดการลงเวลาทำงานและตรวจสอบคนเข้างานแบบสด</div>
              </div>
            </div>
            <Link href="/hr/time" className="hr-btn" style={{ background: 'rgba(255,255,255,0.15)', color: '#fff', border: '1px solid rgba(255,255,255,0.25)', fontSize: 12 }}>
              ดูรายละเอียดบันทึกเวลา →
            </Link>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10 }}>
            <div style={{ background: 'rgba(255,255,255,0.1)', padding: '10px 14px', borderRadius: 10 }}>
              <div style={{ fontSize: 12, color: '#a5b4fc' }}>🟢 เข้างานตรงเวลา</div>
              <div style={{ fontSize: 24, fontWeight: 800, marginTop: 4 }}>{attendance.present} <small style={{ fontSize: 12, fontWeight: 400 }}>คน</small></div>
            </div>
            <div style={{ background: 'rgba(255,255,255,0.1)', padding: '10px 14px', borderRadius: 10 }}>
              <div style={{ fontSize: 12, color: '#fde047' }}>🟡 มาสาย</div>
              <div style={{ fontSize: 24, fontWeight: 800, marginTop: 4 }}>{attendance.late} <small style={{ fontSize: 12, fontWeight: 400 }}>คน</small></div>
            </div>
            <div style={{ background: 'rgba(255,255,255,0.1)', padding: '10px 14px', borderRadius: 10 }}>
              <div style={{ fontSize: 12, color: '#93c5fd' }}>🏖️ ลางาน (อนุมัติ)</div>
              <div style={{ fontSize: 24, fontWeight: 800, marginTop: 4 }}>{attendance.leave} <small style={{ fontSize: 12, fontWeight: 400 }}>คน</small></div>
            </div>
            <div style={{ background: 'rgba(255,255,255,0.1)', padding: '10px 14px', borderRadius: 10 }}>
              <div style={{ fontSize: 12, color: '#fca5a5' }}>⚪ ยังไม่เข้างาน / ขาด</div>
              <div style={{ fontSize: 24, fontWeight: 800, marginTop: 4 }}>{attendance.notInYet} <small style={{ fontSize: 12, fontWeight: 400 }}>คน</small></div>
            </div>
          </div>
        </div>
      )}

      {/* ── 2. Driver License Critical Alerts ── */}
      {driverAlerts && driverAlerts.length > 0 && (
        <div className="hr-card" style={{ marginBottom: 16, borderLeft: '5px solid #ef4444', background: '#fef2f2' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 20 }}>🚨</span>
            <div style={{ fontWeight: 700, fontSize: 15, color: '#991b1b' }}>
              แจ้งเตือนด่วน: ใบอนุญาตขับขี่คนขับรถใกล้หมดอายุ ({driverAlerts.length} ท่าน)
            </div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {driverAlerts.map((d, i) => (
              <div key={i} style={{ background: '#fff', border: '1px solid #fecaca', padding: '6px 12px', borderRadius: 8, fontSize: 13 }}>
                <span style={{ fontWeight: 600, color: '#1f2937' }}>{d.name}</span> ({d.employeeId}) · หมดอายุ: <span style={{ color: '#dc2626', fontWeight: 600 }}>{d.licenseExpiry}</span> (เหลือ {d.daysLeft} วัน)
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── 3. Branch Overview Breakdown ── */}
      {branchStats && branchStats.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, overflowX: 'auto', paddingBottom: 4 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#6b7280', whiteSpace: 'nowrap' }}>🏬 สรุปพนักงานรายสาขา:</span>
          {branchStats.map((b) => (
            <div key={b.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fff', border: '1px solid #e5e7eb', padding: '6px 14px', borderRadius: 20, fontSize: 13, whiteSpace: 'nowrap', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
              <span style={{ fontWeight: 600, color: '#374151' }}>{b.name}</span>
              <span className="hr-badge hr-badge-purple" style={{ fontSize: 11, padding: '2px 8px' }}>{b.count} คน</span>
            </div>
          ))}
        </div>
      )}

      {/* ── 4. Main Stats Cards ── */}
      <div className="hr-stat-row">
        {cards.map((c) => (
          <Link key={c.label} href={c.href} style={{ textDecoration: 'none', color: 'inherit' }}>
            <div className="hr-stat-card">
              <div className="hr-stat-icon">{c.icon}</div>
              <div>
                <div className="hr-stat-value">{c.value}</div>
                <div className="hr-stat-label">{c.label}</div>
              </div>
            </div>
          </Link>
        ))}
      </div>

      {alerts && alerts.totalCount > 0 && <AlertsPanel alerts={alerts.alerts} />}

      {/* ── 5. Pending Leaves & Latest Announcements ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
        <div className="hr-card">
          <h3 className="hr-section-title">🏖️ ใบลารออนุมัติล่าสุด</h3>
          {pendingLeaveList.length === 0 && <div className="hr-empty">ไม่มีใบลารออนุมัติ</div>}
          {pendingLeaveList.map((l) => (
            <div key={l.id} className="hr-emp-row">
              <span className="k">{l.employee_id} · {LEAVE_LABELS[l.leave_type] || l.leave_type} {l.days} วัน</span>
              <span className="v">{l.start_date}</span>
            </div>
          ))}
          {pendingLeaveList.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <Link href="/hr/leave" className="hr-btn">ไปหน้าอนุมัติ →</Link>
            </div>
          )}
        </div>

        <div className="hr-card">
          <h3 className="hr-section-title">📢 ประกาศล่าสุด</h3>
          {announcements.length === 0 && <div className="hr-empty">ยังไม่มีประกาศ</div>}
          {announcements.map((a) => (
            <div key={a.id} className="hr-emp-row">
              <span className="k">{a.pinned ? '📌 ' : ''}{a.title}</span>
              <span className="v">{a.publish_date || ''}</span>
            </div>
          ))}
          <div style={{ marginTop: 12 }}>
            <Link href="/hr/announcements" className="hr-btn">จัดการประกาศ →</Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function AlertsPanel({ alerts }) {
  const groups = [
    { key: 'license', icon: '🚗', title: 'ใบขับขี่ใกล้หมด/หมดอายุ', color: 'red',
      render: (a) => `${a.name} · ${a.date}${a.expired ? ' (หมดอายุแล้ว)' : ''}` },
    { key: 'probation', icon: '⏳', title: 'ครบกำหนดทดลองงาน', color: 'yellow',
      render: (a) => `${a.name} · ${a.date}` },
    { key: 'contract', icon: '📄', title: 'สัญญาจ้างใกล้หมด', color: 'yellow',
      render: (a) => `${a.name} · ${a.date}${a.expired ? ' (หมดแล้ว)' : ''}` },
    { key: 'birthday', icon: '🎂', title: 'วันเกิดใน 7 วัน', color: 'purple',
      render: (a) => `${a.name} · อีก ${a.inDays} วัน` },
    { key: 'anniversary', icon: '🎉', title: 'ครบรอบงานใน 7 วัน', color: 'blue',
      render: (a) => `${a.name} · ครบ ${a.years} ปี (อีก ${a.inDays} วัน)` },
    { key: 'leaveYearEnd', icon: '🏖️', title: 'วันลาพักร้อนคงเหลือก่อนสิ้นปี', color: 'green',
      render: (a) => `${a.name} · เหลือ ${a.remaining} วัน` },
  ].filter((g) => (alerts[g.key] || []).length > 0);

  return (
    <div className="hr-card" style={{ marginBottom: 16, borderLeft: '4px solid #f59e0b' }}>
      <h3 className="hr-section-title">🔔 แจ้งเตือนสิทธิและสัญญา</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
        {groups.map((g) => (
          <div key={g.key}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>
              {g.icon} {g.title} <span className={`hr-badge hr-badge-${g.color}`}>{alerts[g.key].length}</span>
            </div>
            {alerts[g.key].map((a, i) => (
              <div key={i} className="hr-emp-row" style={{ fontSize: 13 }}>
                <span className="k">{g.render(a)}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
