'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { authHeaders } from '@/components/hr/exportUtils';
import { AppIcon } from '@/components/ui/Icons';
import { confirmDialog } from '@/components/ui/ConfirmDialog';

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
    const ok = await confirmDialog({
      title: 'ยืนยันส่งแจ้งเตือนด่วน?',
      message: 'ระบบจะสแกนและส่งแจ้งเตือนไปยังพนักงานและผู้เกี่ยวข้องทันที ต้องการดำเนินการต่อหรือไม่?',
      confirmLabel: 'ส่งแจ้งเตือน',
      destructive: false,
    });
    if (!ok) return;

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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: 20 }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="hr-card" style={{ padding: 20 }}>
              <div className="ios-skeleton" style={{ width: '100%', height: 50, borderRadius: 10 }} />
            </div>
          ))}
        </div>
        <div className="hr-card"><div className="ios-skeleton" style={{ width: '100%', height: 160, borderRadius: 14 }} /></div>
      </div>
    );
  }

  const { stats, attendance, branchStats, driverAlerts, todayBookingList = [], announcements, pendingLeaveList } = data;
  const branchSuffix = activeBranch !== 'all' ? ' (สาขานี้)' : '';

  const att = attendance || { present: 0, late: 0, leave: 0, notInYet: 0 };
  const attItems = [
    { key: 'present', label: 'ตรงเวลา', value: att.present, color: '#10B981' },
    { key: 'late', label: 'มาสาย', value: att.late, color: '#F59E0B' },
    { key: 'leave', label: 'ลางาน', value: att.leave, color: '#0284C7' },
    { key: 'notInYet', label: 'ยังไม่เข้า / ขาด', value: att.notInYet, color: '#EF4444' },
  ];
  const attTotal = attItems.reduce((s, i) => s + (Number(i.value) || 0), 0);
  const attRate = attTotal ? Math.round(((Number(att.present) || 0) + (Number(att.late) || 0)) / attTotal * 100) : 0;

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'สวัสดีตอนเช้า' : hour < 17 ? 'สวัสดีตอนบ่าย' : 'สวัสดีตอนเย็น';
  let userName = '';
  try { userName = JSON.parse(localStorage.getItem('hr-user') || '{}').name || ''; } catch {}

  const AVATAR_COLORS = ['#0284C7', '#0F2942', '#D97706', '#059669', '#DC2626', '#0D9488', '#7C3AED'];
  const avatarColor = (s = '') => AVATAR_COLORS[[...String(s)].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_COLORS.length];
  const EVENT_COLORS = ['#0284C7', '#0F2942', '#059669', '#D97706', '#DC2626'];

  return (
    <div>
      {/* Greeting Banner */}
      <div style={{ marginTop: -12, marginBottom: 18, fontSize: 15, color: '#475569', fontWeight: 500 }}>
        {greeting}{userName ? `, ${userName}` : ''} — ภาพรวมองค์กรและกำลังพลประจำวัน{branchSuffix}
      </div>

      {/* Critical: driver license */}
      {driverAlerts && driverAlerts.length > 0 && (
        <div className="hr-banner-critical" style={{ marginBottom: 20 }}>
          <span
            style={{
              width: 40,
              height: 40,
              minWidth: 40,
              borderRadius: 10,
              background: '#FEE2E2',
              color: '#DC2626',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <AppIcon name="alert-triangle" size={20} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: '#991B1B' }}>
              ใบอนุญาตขับขี่ใกล้หมดอายุ · {driverAlerts.length} ท่าน
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
              {driverAlerts.map((d, i) => (
                <span key={i} className="hr-badge hr-badge-red">
                  {d.name} ({d.employeeId}) · {d.licenseExpiry} · เหลือ {d.daysLeft} วัน
                </span>
              ))}
            </div>
          </div>
          <button
            className="hr-btn"
            style={{ background: '#DC2626', color: '#fff', borderColor: 'transparent', display: 'inline-flex', alignItems: 'center', gap: 6 }}
            onClick={dispatchPushAlerts}
            disabled={sendingPush}
          >
            {sendingPush ? (
              <>
                <AppIcon name="clock" size={15} /> กำลังส่ง...
              </>
            ) : (
              <>
                <AppIcon name="bell" size={15} /> แจ้งเตือนด่วน
              </>
            )}
          </button>
        </div>
      )}

      {/* Executive Summary Strip */}
      <div
        className="hr-card"
        style={{
          padding: '20px 24px',
          marginBottom: 20,
          background: 'linear-gradient(135deg, #FFFFFF 0%, #F8FAFC 100%)',
          border: '1px solid #E2E8F0',
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 20 }}>
          {/* Primary Hero KPI: Workforce & Real-time Attendance Rate */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: 14,
                background: '#0284C7',
                color: '#FFFFFF',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 4px 14px rgba(2, 132, 199, 0.3)',
              }}
            >
              <AppIcon name="employees" size={26} />
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                กำลังพลทั้งหมด{branchSuffix}
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 2 }}>
                <span style={{ fontSize: 28, fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em' }}>
                  {stats.employees}
                </span>
                <span style={{ fontSize: 13, color: '#059669', fontWeight: 600, background: '#ECFDF5', padding: '2px 8px', borderRadius: 999 }}>
                  เข้างาน {attRate}%
                </span>
              </div>
            </div>
          </div>

          {/* Compact Inline Operational Indicators */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <Link
              href="/hr/leave"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 14px',
                borderRadius: 10,
                background: '#FFFFFF',
                border: '1px solid #E2E8F0',
                textDecoration: 'none',
                color: 'inherit',
              }}
            >
              <div style={{ width: 32, height: 32, borderRadius: 8, background: '#FEF3C7', color: '#D97706', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <AppIcon name="leave" size={17} />
              </div>
              <div>
                <div style={{ fontSize: 11, color: '#64748B', fontWeight: 600 }}>ใบลารออนุมัติ</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#0F172A' }}>{stats.pendingLeave} <small style={{ fontSize: 11, color: '#94A3B8' }}>รายการ</small></div>
              </div>
            </Link>

            <Link
              href="/hr/expenses"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 14px',
                borderRadius: 10,
                background: '#FFFFFF',
                border: '1px solid #E2E8F0',
                textDecoration: 'none',
                color: 'inherit',
              }}
            >
              <div style={{ width: 32, height: 32, borderRadius: 8, background: '#F1F5F9', color: '#475569', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <AppIcon name="expenses" size={17} />
              </div>
              <div>
                <div style={{ fontSize: 11, color: '#64748B', fontWeight: 600 }}>เบิกจ่ายรอตรวจ</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#0F172A' }}>{stats.pendingExpenses} <small style={{ fontSize: 11, color: '#94A3B8' }}>รายการ</small></div>
              </div>
            </Link>

            <Link
              href="/hr/rooms?tab=bookings"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 14px',
                borderRadius: 10,
                background: '#FFFFFF',
                border: '1px solid #E2E8F0',
                textDecoration: 'none',
                color: 'inherit',
              }}
            >
              <div style={{ width: 32, height: 32, borderRadius: 8, background: '#E0F2FE', color: '#0284C7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <AppIcon name="rooms" size={17} />
              </div>
              <div>
                <div style={{ fontSize: 11, color: '#64748B', fontWeight: 600 }}>จองห้องประชุมวันนี้</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#0F172A' }}>{stats.todayBookings} <small style={{ fontSize: 11, color: '#94A3B8' }}>ห้อง</small></div>
              </div>
            </Link>

            <Link
              href="/hr/recruitment"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 14px',
                borderRadius: 10,
                background: '#FFFFFF',
                border: '1px solid #E2E8F0',
                textDecoration: 'none',
                color: 'inherit',
              }}
            >
              <div style={{ width: 32, height: 32, borderRadius: 8, background: '#FDF2F8', color: '#DB2777', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <AppIcon name="recruitment" size={17} />
              </div>
              <div>
                <div style={{ fontSize: 11, color: '#64748B', fontWeight: 600 }}>ตำแหน่งเปิดรับ</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#0F172A' }}>{stats.openJobs} <small style={{ fontSize: 11, color: '#94A3B8' }}>อัตรา</small></div>
              </div>
            </Link>

            <Link
              href="/hr/payroll"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 14px',
                borderRadius: 10,
                background: '#FFFFFF',
                border: '1px solid #E2E8F0',
                textDecoration: 'none',
                color: 'inherit',
              }}
            >
              <div style={{ width: 32, height: 32, borderRadius: 8, background: '#ECFDF5', color: '#059669', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <AppIcon name="payroll" size={17} />
              </div>
              <div>
                <div style={{ fontSize: 11, color: '#64748B', fontWeight: 600 }}>งวด {stats.period}</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#0F172A' }}>
                  {stats.payrollTotal.toLocaleString('th-TH')} ฿
                </div>
              </div>
            </Link>
          </div>
        </div>
      </div>

      <div className="hr-widget-grid">
        {/* Attendance widget */}
        <div className="hr-card hr-span-8">
          <div className="hr-widget-head">
            <div className="hr-widget-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  background: '#ECFDF5',
                  color: '#059669',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <AppIcon name="clock" size={18} />
              </span>
              <div>
                <div style={{ fontWeight: 700 }}>การเข้างานวันนี้</div>
                <div className="hr-widget-sub">อัปเดตแบบเรียลไทม์ · อัตราเข้างาน {attRate}%</div>
              </div>
            </div>
            <Link href="/hr/time" className="hr-link-more" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span>ดูบันทึกเวลา</span>
              <AppIcon name="chevron-right" size={13} />
            </Link>
          </div>
          <div className="hr-stack-bar" aria-label={`อัตราเข้างาน ${attRate}%`} style={{ height: 10, borderRadius: 5, overflow: 'hidden' }}>
            {attTotal > 0 && attItems.map((i) => (
              <span key={i.key} style={{ width: `${(Number(i.value) || 0) / attTotal * 100}%`, background: i.color }} />
            ))}
          </div>
          <div className="hr-metric-grid" style={{ marginTop: 14 }}>
            {attItems.map((i) => (
              <div key={i.key} className="hr-metric">
                <div className="hr-metric-label">
                  <span className="hr-metric-dot" style={{ background: i.color }} />
                  {i.label}
                </div>
                <div className="hr-metric-value">{i.value || 0}<small>คน</small></div>
              </div>
            ))}
          </div>
        </div>

        {/* Pending leave list */}
        <div className="hr-card hr-span-4">
          <div className="hr-widget-head">
            <div className="hr-widget-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  background: '#FEF3C7',
                  color: '#D97706',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <AppIcon name="leave" size={18} />
              </span>
              <div style={{ fontWeight: 700 }}>ใบลารออนุมัติ</div>
            </div>
            <Link href="/hr/leave" className="hr-link-more" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span>ทั้งหมด</span>
              <AppIcon name="chevron-right" size={13} />
            </Link>
          </div>
          {pendingLeaveList.length === 0 ? (
            <div className="hr-empty" style={{ padding: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: '#059669' }}>
              <AppIcon name="check-circle" size={18} />
              <span>ไม่มีใบลารออนุมัติ</span>
            </div>
          ) : (
            <div className="hr-list">
              {pendingLeaveList.map((l) => (
                <Link key={l.id} href="/hr/leave" className="hr-list-row" style={{ borderBottom: '1px solid #F1F5F9' }}>
                  <span className="hr-avatar-sm" style={{ background: avatarColor(l.employeeName || l.employee_id) }}>
                    {(l.employeeName || l.employee_id || '?')[0]}
                  </span>
                  <div className="hr-list-main">
                    <div className="hr-list-title">{l.employeeName || l.employee_id}</div>
                    <div className="hr-list-sub">{LEAVE_LABELS[l.leave_type] || l.leave_type} · {l.days} วัน</div>
                  </div>
                  <span className="hr-list-trail">{l.start_date}</span>
                  <AppIcon name="chevron-right" size={14} style={{ color: '#94A3B8' }} />
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Branch chips */}
      {branchStats && branchStats.length > 0 && (
        <div className="hr-chip-row" style={{ margin: '16px 0' }}>
          {branchStats.map((b) => (
            <span key={b.id} className="hr-chip" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <AppIcon name="branches" size={13} style={{ color: '#0284C7' }} />
              <span>{b.name}</span>
              <b>{b.count}</b>
            </span>
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
            <div className="hr-widget-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  background: '#E0F2FE',
                  color: '#0284C7',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <AppIcon name="calendar" size={18} />
              </span>
              <div>
                <div style={{ fontWeight: 700 }}>กำหนดการวันนี้</div>
                <div className="hr-widget-sub">การจองห้องประชุม {todayBookingList.length} รายการ</div>
              </div>
            </div>
            <Link href="/hr/rooms?tab=bookings" className="hr-link-more" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span>ตารางห้อง</span>
              <AppIcon name="chevron-right" size={13} />
            </Link>
          </div>
          {todayBookingList.length === 0 ? (
            <div className="hr-empty" style={{ padding: 24, textAlign: 'center', color: '#64748B' }}>
              วันนี้ยังไม่มีการจองห้องประชุม
            </div>
          ) : (
            todayBookingList.map((b, i) => {
              const c = EVENT_COLORS[i % EVENT_COLORS.length];
              return (
                <div key={b.id} className="hr-event" style={{ '--ev': c, '--ev-bg': `${c}12`, marginBottom: 8 }}>
                  <div className="hr-event-time">{b.startTime?.slice(0, 5)} - {b.endTime?.slice(0, 5)}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="hr-event-title" style={{ fontWeight: 600 }}>{b.title || 'ไม่ระบุหัวข้อ'}</div>
                    <div className="hr-event-meta" style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4, color: '#64748B', fontSize: 12 }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <AppIcon name="locations" size={12} /> {b.roomName}
                      </span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <AppIcon name="user" size={12} /> {b.employeeName} ({b.employeeId})
                      </span>
                    </div>
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
            <div className="hr-widget-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  background: '#FDF2F8',
                  color: '#DB2777',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <AppIcon name="announcements" size={18} />
              </span>
              <div style={{ fontWeight: 700 }}>ประกาศล่าสุด</div>
            </div>
            <Link href="/hr/announcements" className="hr-link-more" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span>จัดการ</span>
              <AppIcon name="chevron-right" size={13} />
            </Link>
          </div>
          {announcements.length === 0 ? (
            <div className="hr-empty" style={{ padding: 24, textAlign: 'center', color: '#64748B' }}>
              ยังไม่มีประกาศ
            </div>
          ) : (
            <div className="hr-list">
              {announcements.map((a) => (
                <Link key={a.id} href="/hr/announcements" className="hr-list-row" style={{ borderBottom: '1px solid #F1F5F9' }}>
                  <span
                    style={{
                      width: 32,
                      height: 32,
                      minWidth: 32,
                      borderRadius: 8,
                      background: a.pinned ? '#FEF3C7' : '#F1F5F9',
                      color: a.pinned ? '#D97706' : '#64748B',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <AppIcon name={a.pinned ? 'pin' : 'documents'} size={15} />
                  </span>
                  <div className="hr-list-main">
                    <div className="hr-list-title" style={{ fontWeight: 600 }}>{a.title}</div>
                    <div className="hr-list-sub">{a.publish_date || 'ไม่ระบุวันที่'}</div>
                  </div>
                  <AppIcon name="chevron-right" size={14} style={{ color: '#94A3B8' }} />
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
    { key: 'license', icon: 'truck', title: 'ใบขับขี่ใกล้หมด/หมดอายุ', color: 'red', sq: '#EF4444',
      render: (a) => `${a.name} · ${a.date}${a.expired ? ' (หมดอายุแล้ว)' : ` (อีก ${a.daysLeft} วัน)`}` },
    { key: 'probation', icon: 'clock', title: 'ครบกำหนดทดลองงาน', color: 'yellow', sq: '#F59E0B',
      render: (a) => `${a.name} · ${a.date} (อีก ${a.daysLeft} วัน)` },
    { key: 'contract', icon: 'documents', title: 'สัญญาจ้างใกล้หมด', color: 'yellow', sq: '#F59E0B',
      render: (a) => `${a.name} · ${a.date}${a.expired ? ' (หมดแล้ว)' : ` (อีก ${a.daysLeft} วัน)`}` },
    { key: 'birthday', icon: 'gift', title: 'วันเกิดใน 7 วัน', color: 'purple', sq: '#8B5CF6',
      render: (a) => `${a.name} · อีก ${a.inDays} วัน` },
    { key: 'anniversary', icon: 'star', title: 'ครบรอบงานใน 7 วัน', color: 'blue', sq: '#0284C7',
      render: (a) => `${a.name} · ครบ ${a.years} ปี (อีก ${a.inDays} วัน)` },
    { key: 'leaveYearEnd', icon: 'leave', title: 'วันลาพักร้อนคงเหลือก่อนสิ้นปี', color: 'green', sq: '#10B981',
      render: (a) => `${a.name} · เหลือ ${a.remaining} วัน` },
  ].filter((g) => (alerts[g.key] || []).length > 0);

  return (
    <div className="hr-card" style={{ marginBottom: 20, padding: 20 }}>
      <div className="hr-widget-head" style={{ marginBottom: 16 }}>
        <div className="hr-widget-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span
            style={{
              width: 34,
              height: 34,
              borderRadius: 8,
              background: '#FEF3C7',
              color: '#D97706',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <AppIcon name="bell" size={18} />
          </span>
          <div>
            <div style={{ fontWeight: 700 }}>แจ้งเตือนอัตโนมัติ</div>
            <div className="hr-widget-sub">สิทธิ สัญญา และวันสำคัญของพนักงาน</div>
          </div>
        </div>
        <button
          className="hr-btn hr-btn-primary"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          onClick={onSendPush}
          disabled={sendingPush}
        >
          {sendingPush ? (
            <>
              <AppIcon name="clock" size={15} /> กำลังส่ง...
            </>
          ) : (
            <>
              <AppIcon name="send" size={15} /> ส่ง Push ทั้งหมด
            </>
          )}
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
        {groups.map((g) => (
          <div
            key={g.key}
            style={{
              background: '#F8FAFC',
              border: '1px solid #E2E8F0',
              borderRadius: 12,
              padding: '12px 14px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 13.5, marginBottom: 8 }}>
              <span
                style={{
                  width: 26,
                  height: 26,
                  minWidth: 26,
                  borderRadius: 6,
                  background: '#FFFFFF',
                  border: '1px solid #CBD5E1',
                  color: g.sq,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <AppIcon name={g.icon} size={14} />
              </span>
              <span style={{ flex: 1, color: '#1E293B' }}>{g.title}</span>
              <span className={`hr-badge hr-badge-${g.color}`}>{alerts[g.key].length}</span>
            </div>
            {alerts[g.key].map((a, i) => (
              <div
                key={i}
                style={{
                  fontSize: 13,
                  padding: '6px 0',
                  borderTop: i ? '1px solid #E2E8F0' : 'none',
                  color: '#475569',
                }}
              >
                {g.render(a)}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
