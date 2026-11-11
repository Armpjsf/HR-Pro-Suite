'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { authHeaders } from '@/components/hr/exportUtils';

const LEAVE_LABELS = { annual: 'ลาพักร้อน', sick: 'ลาป่วย', personal: 'ลากิจ' };

export default function HrDashboardPage() {
  const [data, setData] = useState(null);
  const [alerts, setAlerts] = useState(null);
  const [sendingPush, setSendingPush] = useState(false);
  const [toast, setToast] = useState(null);
  const [activeBranch, setActiveBranch] = useState(
    typeof window !== 'undefined' ? localStorage.getItem('hr-active-branch') || 'all' : 'all'
  );

  useEffect(() => {
    const handleBranch = (e) => setActiveBranch(e.detail || 'all');
    window.addEventListener('hr-branch-change', handleBranch);
    return () => window.removeEventListener('hr-branch-change', handleBranch);
  }, []);

  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const loadDashboard = useCallback((branch) => {
    const q = branch && branch !== 'all' ? `?branchId=${encodeURIComponent(branch)}` : '';
    fetch(`/api/hr/dashboard${q}`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => { if (d.stats) setData(d); })
      .catch(() => {});
    fetch(`/api/hr/alerts${q}`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => { if (d.alerts) setAlerts(d); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadDashboard(activeBranch);
  }, [activeBranch, loadDashboard]);

  async function dispatchPushAlerts() {
    setSendingPush(true);
    try {
      const res = await fetch('/api/hr/alerts', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({ branchId: activeBranch }),
      });
      const d = await res.json();
      if (res.ok) {
        showToast(d.message || `ส่งแจ้งเตือนสำเร็จ (${d.sentCount} รายการ)`);
      } else {
        showToast(d.error || 'ส่งแจ้งเตือนไม่สำเร็จ', 'error');
      }
    } catch {
      showToast('เชื่อมต่อเซิร์ฟเวอร์ล้มเหลว', 'error');
    } finally {
      setSendingPush(false);
    }
  }

  if (!data) {
    return (
      <div>
        <div className="hr-stat-row">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="hr-stat-card"><div className="ios-skeleton" style={{ width: '100%', height: 46, borderRadius: 12 }} /></div>
          ))}
        </div>
        <div className="hr-card"><div className="ios-skeleton" style={{ width: '100%', height: 160, borderRadius: 14 }} /></div>
      </div>
    );
  }

  const { stats, attendance, branchStats, driverAlerts, todayBookingList = [], announcements, pendingLeaveList } = data;
  const branchSuffix = activeBranch !== 'all' ? ' (สาขานี้)' : '';

  const cards = [
    { icon: '👥', value: stats.employees, label: `พนักงานทั้งหมด${branchSuffix}`, href: '/hr/employees' },
    { icon: '🏖️', value: stats.pendingLeave, label: `ใบลารออนุมัติ${branchSuffix}`, href: '/hr/leave' },
    { icon: '🧾', value: stats.pendingExpenses, label: `เบิกจ่ายรออนุมัติ${branchSuffix}`, href: '/hr/expenses' },
    { icon: '🎦', value: stats.todayBookings, label: 'ห้องประชุมที่จองวันนี้', href: '/hr/rooms?tab=bookings' },
    { icon: '📣', value: stats.openJobs, label: 'ตำแหน่งเปิดรับ', href: '/hr/recruitment' },
    { icon: '💰', value: stats.payrollTotal.toLocaleString('th-TH') + ' ฿', label: `เงินเดือนงวด ${stats.period}${branchSuffix}`, href: '/hr/payroll' },
  ];

  const att = attendance || { present: 0, late: 0, leave: 0, notInYet: 0 };
  const attItems = [
    { key: 'present', label: 'ตรงเวลา', value: att.present, color: '#34C759' },
    { key: 'late', label: 'มาสาย', value: att.late, color: '#FF9500' },
    { key: 'leave', label: 'ลางาน', value: att.leave, color: '#007AFF' },
    { key: 'notInYet', label: 'ยังไม่เข้า / ขาด', value: att.notInYet, color: '#FF3B30' },
  ];
  const attTotal = attItems.reduce((s, i) => s + (Number(i.value) || 0), 0);
  const attRate = attTotal ? Math.round(((Number(att.present) || 0) + (Number(att.late) || 0)) / attTotal * 100) : 0;

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'สวัสดีตอนเช้า' : hour < 17 ? 'สวัสดีตอนบ่าย' : 'สวัสดีตอนเย็น';
  let userName = '';
  try { userName = JSON.parse(localStorage.getItem('hr-user') || '{}').name || ''; } catch {}

  const AVATAR_COLORS = ['#007AFF', '#5856D6', '#FF9500', '#34C759', '#FF2D55', '#00C7BE', '#AF52DE'];
  const avatarColor = (s = '') => AVATAR_COLORS[[...String(s)].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_COLORS.length];
  const EVENT_COLORS = ['#007AFF', '#5856D6', '#34C759', '#FF9500', '#FF2D55'];

  return (
    <div>
      {/* Greeting */}
      <div style={{ marginTop: -12, marginBottom: 18, fontSize: 15, color: 'var(--hr-text-2)', fontWeight: 500 }}>
        {greeting}{userName ? `, ${userName}` : ''} 👋 — นี่คือภาพรวมองค์กรของคุณวันนี้{branchSuffix}
      </div>

      {/* Critical: driver license */}
      {driverAlerts && driverAlerts.length > 0 && (
        <div className="hr-banner-critical">
          <span className="hr-squircle" style={{ '--sq': '#FF3B30', width: 40, height: 40, minWidth: 40, fontSize: 20, borderRadius: 11 }}>🚨</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>ใบอนุญาตขับขี่ใกล้หมดอายุ · {driverAlerts.length} ท่าน</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
              {driverAlerts.map((d, i) => (
                <span key={i} className="hr-badge hr-badge-red">
                  {d.name} ({d.employeeId}) · {d.licenseExpiry} · เหลือ {d.daysLeft} วัน
                </span>
              ))}
            </div>
          </div>
          <button className="hr-btn" style={{ background: '#FF3B30', color: '#fff', borderColor: 'transparent' }} onClick={dispatchPushAlerts} disabled={sendingPush}>
            {sendingPush ? '⏳ กำลังส่ง...' : '🔔 แจ้งเตือนด่วน'}
          </button>
        </div>
      )}

      {/* Stat widgets */}
      <div className="hr-stat-row">
        {cards.map((c) => (
          <Link key={c.label} href={c.href} style={{ textDecoration: 'none', color: 'inherit' }}>
            <div className="hr-stat-card">
              <div className="hr-stat-icon">{c.icon}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="hr-stat-value">{c.value}</div>
                <div className="hr-stat-label">{c.label}</div>
              </div>
              <span className="hr-chevron">›</span>
            </div>
          </Link>
        ))}
      </div>

      <div className="hr-widget-grid">
        {/* Attendance widget */}
        <div className="hr-card hr-span-8">
          <div className="hr-widget-head">
            <div className="hr-widget-title">
              <span className="hr-squircle" style={{ '--sq': '#34C759' }}>⏰</span>
              <div>
                <div>การเข้างานวันนี้</div>
                <div className="hr-widget-sub">อัปเดตแบบเรียลไทม์ · อัตราเข้างาน {attRate}%</div>
              </div>
            </div>
            <Link href="/hr/time" className="hr-link-more">ดูบันทึกเวลา ›</Link>
          </div>
          <div className="hr-stack-bar" aria-label={`อัตราเข้างาน ${attRate}%`}>
            {attTotal > 0 && attItems.map((i) => (
              <span key={i.key} style={{ width: `${(Number(i.value) || 0) / attTotal * 100}%`, background: i.color }} />
            ))}
          </div>
          <div className="hr-metric-grid">
            {attItems.map((i) => (
              <div key={i.key} className="hr-metric">
                <div className="hr-metric-label"><span className="hr-metric-dot" style={{ background: i.color }} />{i.label}</div>
                <div className="hr-metric-value">{i.value || 0}<small>คน</small></div>
              </div>
            ))}
          </div>
        </div>

        {/* Pending leave list */}
        <div className="hr-card hr-span-4">
          <div className="hr-widget-head">
            <div className="hr-widget-title">
              <span className="hr-squircle" style={{ '--sq': '#FF9500' }}>🏖️</span>
              <div>ใบลารออนุมัติ</div>
            </div>
            <Link href="/hr/leave" className="hr-link-more">ทั้งหมด ›</Link>
          </div>
          {pendingLeaveList.length === 0 ? (
            <div className="hr-empty" style={{ padding: 20 }}>✅ ไม่มีใบลารออนุมัติ</div>
          ) : (
            <div className="hr-list">
              {pendingLeaveList.map((l) => (
                <Link key={l.id} href="/hr/leave" className="hr-list-row">
                  <span className="hr-avatar-sm" style={{ background: avatarColor(l.employeeName || l.employee_id) }}>
                    {(l.employeeName || l.employee_id || '?')[0]}
                  </span>
                  <div className="hr-list-main">
                    <div className="hr-list-title">{l.employeeName || l.employee_id}</div>
                    <div className="hr-list-sub">{LEAVE_LABELS[l.leave_type] || l.leave_type} · {l.days} วัน</div>
                  </div>
                  <span className="hr-list-trail">{l.start_date}</span>
                  <span className="hr-chevron">›</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Branch chips */}
      {branchStats && branchStats.length > 0 && (
        <div className="hr-chip-row">
          {branchStats.map((b) => (
            <span key={b.id} className="hr-chip">🏬 {b.name} <b>{b.count}</b></span>
          ))}
        </div>
      )}

      {alerts && alerts.totalCount > 0 && (
        <AlertsPanel alerts={alerts.alerts} onSendPush={dispatchPushAlerts} sendingPush={sendingPush} />
      )}

      <div className="hr-widget-grid">
        {/* Today: meeting rooms */}
        <div className="hr-card hr-span-7">
          <div className="hr-widget-head">
            <div className="hr-widget-title">
              <span className="hr-squircle" style={{ '--sq': '#5856D6' }}>📅</span>
              <div>
                <div>วันนี้</div>
                <div className="hr-widget-sub">การจองห้องประชุม {todayBookingList.length} รายการ</div>
              </div>
            </div>
            <Link href="/hr/rooms?tab=bookings" className="hr-link-more">ตารางห้อง ›</Link>
          </div>
          {todayBookingList.length === 0 ? (
            <div className="hr-empty" style={{ padding: 20 }}>วันนี้ยังไม่มีการจองห้องประชุม</div>
          ) : (
            todayBookingList.map((b, i) => {
              const c = EVENT_COLORS[i % EVENT_COLORS.length];
              return (
                <div key={b.id} className="hr-event" style={{ '--ev': c, '--ev-bg': `${c}12` }}>
                  <div className="hr-event-time">{b.startTime?.slice(0, 5)}<br />{b.endTime?.slice(0, 5)}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="hr-event-title">{b.title || 'ไม่ระบุหัวข้อ'}</div>
                    <div className="hr-event-meta">📍 {b.roomName} · 👤 {b.employeeName} ({b.employeeId})</div>
                  </div>
                  <span className={`hr-badge hr-badge-${b.status === 'confirmed' ? 'green' : b.status === 'booked' ? 'blue' : 'gray'}`} style={{ alignSelf: 'flex-start' }}>
                    {b.status === 'confirmed' ? 'ยืนยันแล้ว' : b.status === 'booked' ? 'จองแล้ว' : b.status}
                  </span>
                </div>
              );
            })
          )}
        </div>

        {/* Announcements */}
        <div className="hr-card hr-span-5">
          <div className="hr-widget-head">
            <div className="hr-widget-title">
              <span className="hr-squircle" style={{ '--sq': '#FF2D55' }}>📢</span>
              <div>ประกาศล่าสุด</div>
            </div>
            <Link href="/hr/announcements" className="hr-link-more">จัดการ ›</Link>
          </div>
          {announcements.length === 0 ? (
            <div className="hr-empty" style={{ padding: 20 }}>ยังไม่มีประกาศ</div>
          ) : (
            <div className="hr-list">
              {announcements.map((a) => (
                <Link key={a.id} href="/hr/announcements" className="hr-list-row">
                  <span className="hr-squircle" style={{ '--sq': a.pinned ? '#FF9500' : 'rgba(118,118,128,0.14)', width: 34, height: 34, minWidth: 34 }}>
                    {a.pinned ? '📌' : '📰'}
                  </span>
                  <div className="hr-list-main">
                    <div className="hr-list-title">{a.title}</div>
                    <div className="hr-list-sub">{a.publish_date || 'ไม่ระบุวันที่'}</div>
                  </div>
                  <span className="hr-chevron">›</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {toast && <div className={`hr-toast ${toast.type}`}>{toast.message}</div>}
    </div>
  );
}

function AlertsPanel({ alerts, onSendPush, sendingPush }) {
  const groups = [
    { key: 'license', icon: '🚗', title: 'ใบขับขี่ใกล้หมด/หมดอายุ', color: 'red', sq: '#FF3B30',
      render: (a) => `${a.name} · ${a.date}${a.expired ? ' (หมดอายุแล้ว)' : ` (อีก ${a.daysLeft} วัน)`}` },
    { key: 'probation', icon: '⏳', title: 'ครบกำหนดทดลองงาน', color: 'yellow', sq: '#FF9500',
      render: (a) => `${a.name} · ${a.date} (อีก ${a.daysLeft} วัน)` },
    { key: 'contract', icon: '📄', title: 'สัญญาจ้างใกล้หมด', color: 'yellow', sq: '#FFCC00',
      render: (a) => `${a.name} · ${a.date}${a.expired ? ' (หมดแล้ว)' : ` (อีก ${a.daysLeft} วัน)`}` },
    { key: 'birthday', icon: '🎂', title: 'วันเกิดใน 7 วัน', color: 'purple', sq: '#AF52DE',
      render: (a) => `${a.name} · อีก ${a.inDays} วัน` },
    { key: 'anniversary', icon: '🎉', title: 'ครบรอบงานใน 7 วัน', color: 'blue', sq: '#007AFF',
      render: (a) => `${a.name} · ครบ ${a.years} ปี (อีก ${a.inDays} วัน)` },
    { key: 'leaveYearEnd', icon: '🏖️', title: 'วันลาพักร้อนคงเหลือก่อนสิ้นปี', color: 'green', sq: '#34C759',
      render: (a) => `${a.name} · เหลือ ${a.remaining} วัน` },
  ].filter((g) => (alerts[g.key] || []).length > 0);

  return (
    <div className="hr-card" style={{ marginBottom: 16 }}>
      <div className="hr-widget-head">
        <div className="hr-widget-title">
          <span className="hr-squircle" style={{ '--sq': '#FF9500' }}>🔔</span>
          <div>
            <div>แจ้งเตือนอัตโนมัติ</div>
            <div className="hr-widget-sub">สิทธิ สัญญา และวันสำคัญของพนักงาน</div>
          </div>
        </div>
        <button className="hr-btn hr-btn-primary" onClick={onSendPush} disabled={sendingPush}>
          {sendingPush ? '⏳ กำลังส่ง...' : '📲 ส่ง Push ทั้งหมด'}
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
        {groups.map((g) => (
          <div key={g.key} style={{ background: '#F7F7FA', borderRadius: 16, padding: '12px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 13.5, marginBottom: 6 }}>
              <span className="hr-squircle" style={{ '--sq': g.sq, width: 26, height: 26, minWidth: 26, fontSize: 13, borderRadius: 7 }}>{g.icon}</span>
              <span style={{ flex: 1 }}>{g.title}</span>
              <span className={`hr-badge hr-badge-${g.color}`}>{alerts[g.key].length}</span>
            </div>
            {alerts[g.key].map((a, i) => (
              <div key={i} style={{ fontSize: 13, padding: '6px 0', borderTop: i ? '1px solid rgba(60,60,67,0.08)' : 'none', color: 'var(--hr-text-2)' }}>
                {g.render(a)}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
