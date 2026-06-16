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

  const { stats, announcements, pendingLeaveList } = data;

  const cards = [
    { icon: '👥', value: stats.employees, label: 'พนักงานทั้งหมด', href: '/hr/employees' },
    { icon: '🏖️', value: stats.pendingLeave, label: 'ใบลารออนุมัติ', href: '/hr/leave' },
    { icon: '🧾', value: stats.pendingExpenses, label: 'เบิกจ่ายรออนุมัติ', href: '/hr/expenses' },
    { icon: '📣', value: stats.openJobs, label: 'ตำแหน่งเปิดรับ', href: '/hr/recruitment' },
    { icon: '🎦', value: stats.todayBookings, label: 'จองห้องวันนี้', href: '/hr/rooms' },
    { icon: '💰', value: stats.payrollTotal.toLocaleString('th-TH') + ' ฿', label: `เงินเดือนงวด ${stats.period}`, href: '/hr/payroll' },
  ];

  return (
    <div>
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
      <h3 className="hr-section-title">🔔 แจ้งเตือนสำหรับ HR</h3>
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
