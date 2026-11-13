'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import NotificationBell from '@/components/NotificationBell';
import { AppIcon } from '@/components/ui/Icons';
import { authHeaders } from '@/components/me/SecondaryTabs';
import './me.css';

/* ─── Lazy Loaded Sub-Views for Fast Mobile First Load ─── */
const DynamicChatTab = dynamic(() => import('@/components/me/ChatTab'), {
  loading: () => <div className="me-card me-empty">กำลังโหลดระบบแชท...</div>,
  ssr: false,
});

const DynamicPayslipTab = dynamic(
  () => import('@/components/me/SecondaryTabs').then((m) => m.PayslipTab),
  { loading: () => <div className="me-card me-empty">กำลังโหลดสลิปเงินเดือน...</div>, ssr: false }
);

const DynamicExpensesSection = dynamic(
  () => import('@/components/me/SecondaryTabs').then((m) => m.ExpensesSection),
  { loading: () => <div className="me-card me-empty">กำลังโหลด...</div>, ssr: false }
);

const DynamicOtSection = dynamic(
  () => import('@/components/me/SecondaryTabs').then((m) => m.OtSection),
  { loading: () => <div className="me-card me-empty">กำลังโหลด...</div>, ssr: false }
);

const DynamicRoomsSection = dynamic(
  () => import('@/components/me/SecondaryTabs').then((m) => m.RoomsSection),
  { loading: () => <div className="me-card me-empty">กำลังโหลด...</div>, ssr: false }
);

const DynamicWorkplaceSection = dynamic(
  () => import('@/components/me/SecondaryTabs').then((m) => m.WorkplaceSection),
  { loading: () => <div className="me-card me-empty">กำลังโหลด...</div>, ssr: false }
);

const DynamicCalendarSection = dynamic(
  () => import('@/components/me/SecondaryTabs').then((m) => m.CalendarSection),
  { loading: () => <div className="me-card me-empty">กำลังโหลด...</div>, ssr: false }
);

const DynamicAttendanceSection = dynamic(
  () => import('@/components/me/SecondaryTabs').then((m) => m.AttendanceSection),
  { loading: () => <div className="me-card me-empty">กำลังโหลด...</div>, ssr: false }
);

const DynamicEvaluationSection = dynamic(
  () => import('@/components/me/SecondaryTabs').then((m) => m.EvaluationSection),
  { loading: () => <div className="me-card me-empty">กำลังโหลด...</div>, ssr: false }
);

const DynamicTaxCertSection = dynamic(
  () => import('@/components/me/SecondaryTabs').then((m) => m.TaxCertSection),
  { loading: () => <div className="me-card me-empty">กำลังโหลด...</div>, ssr: false }
);

const DynamicAllowanceSection = dynamic(
  () => import('@/components/me/SecondaryTabs').then((m) => m.AllowanceSection),
  { loading: () => <div className="me-card me-empty">กำลังโหลด...</div>, ssr: false }
);

const DynamicTeamLeaveSection = dynamic(
  () => import('@/components/me/SecondaryTabs').then((m) => m.TeamLeaveSection),
  { loading: () => <div className="me-card me-empty">กำลังโหลด...</div>, ssr: false }
);

const DynamicDocumentRequestsSection = dynamic(
  () => import('@/components/me/SecondaryTabs').then((m) => m.DocumentRequestsSection),
  { loading: () => <div className="me-card me-empty">กำลังโหลด...</div>, ssr: false }
);

const DynamicAssetsSection = dynamic(
  () => import('@/components/me/SecondaryTabs').then((m) => m.AssetsSection),
  { loading: () => <div className="me-card me-empty">กำลังโหลด...</div>, ssr: false }
);

const DynamicBenefitsTab = dynamic(
  () => import('@/components/me/SecondaryTabs').then((m) => m.BenefitsTab),
  { loading: () => <div className="me-card me-empty">กำลังโหลด...</div>, ssr: false }
);

const DynamicOnboardingTab = dynamic(
  () => import('@/components/me/SecondaryTabs').then((m) => m.OnboardingTab),
  { loading: () => <div className="me-card me-empty">กำลังโหลด...</div>, ssr: false }
);

const DynamicShiftSwapTab = dynamic(
  () => import('@/components/me/SecondaryTabs').then((m) => m.ShiftSwapTab),
  { loading: () => <div className="me-card me-empty">กำลังโหลด...</div>, ssr: false }
);

const DynamicProfileTab = dynamic(
  () => import('@/components/me/SecondaryTabs').then((m) => m.ProfileTab),
  { loading: () => <div className="me-card me-empty">กำลังโหลด...</div>, ssr: false }
);

const DynamicAnnouncementsTab = dynamic(
  () => import('@/components/me/SecondaryTabs').then((m) => m.AnnouncementsTab),
  { loading: () => <div className="me-card me-empty">กำลังโหลด...</div>, ssr: false }
);

const DynamicDriverManualsTab = dynamic(
  () => import('@/components/me/SecondaryTabs').then((m) => m.DriverManualsTab),
  { loading: () => <div className="me-card me-empty">กำลังโหลด...</div>, ssr: false }
);

/* ─── Constants ─── */
const LEAVE_LABELS = { annual: 'พักร้อน', sick: 'ลาป่วย', personal: 'ลากิจ' };
const LEAVE_ICON_NAMES = { annual: 'leave', sick: 'heart-pulse', personal: 'file-text' };

function leaveLabel(key, val, leaveTypes = []) {
  return val?.label || leaveTypes.find((t) => t.code === key)?.name || LEAVE_LABELS[key] || key;
}

const STATUS_BADGE = {
  pending: { cls: 'me-badge-yellow', label: 'รออนุมัติ' },
  approved: { cls: 'me-badge-green', label: 'อนุมัติ' },
  rejected: { cls: 'me-badge-red', label: 'ไม่อนุมัติ' },
  paid: { cls: 'me-badge-blue', label: 'จ่ายแล้ว' },
  draft: { cls: 'me-badge-gray', label: 'แบบร่าง' },
  submitted: { cls: 'me-badge-green', label: 'ส่งแล้ว' },
};

/* ═══════════════════════════════════════════════════════════════
   MAIN EMPLOYEE SELF-SERVICE SHELL
   ═══════════════════════════════════════════════════════════════ */
export default function EmployeePage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [tab, setTab] = useState('home');
  const [subTab, setSubTab] = useState(null);
  const [data, setData] = useState(null);
  const [toast, setToast] = useState(null);
  const [loadError, setLoadError] = useState(false);

  /* ─── Android Hardware Back Button Synchronization (User Control & Freedom) ─── */
  const navigateToTab = useCallback((nextTab) => {
    setTab(nextTab);
    setSubTab(null);
    if (typeof window !== 'undefined') {
      window.history.pushState({ tab: nextTab, subTab: null }, '', `#${nextTab}`);
    }
  }, []);

  const navigateToSubTab = useCallback((nextSubTab) => {
    setSubTab(nextSubTab);
    if (typeof window !== 'undefined') {
      window.history.pushState({ tab: 'more', subTab: nextSubTab }, '', `#more/${nextSubTab}`);
    }
  }, []);

  const closeSubTab = useCallback(() => {
    setSubTab(null);
    if (typeof window !== 'undefined') {
      if (window.history.state?.subTab) {
        window.history.back();
      } else {
        window.history.pushState({ tab: 'more', subTab: null }, '', '#more');
      }
    }
  }, []);

  useEffect(() => {
    const handlePopState = (e) => {
      if (e.state) {
        if (e.state.tab) setTab(e.state.tab);
        setSubTab(e.state.subTab || null);
      } else {
        const hash = window.location.hash.replace('#', '');
        if (hash.startsWith('more/')) {
          setTab('more');
          setSubTab(hash.replace('more/', ''));
        } else if (hash) {
          setTab(hash);
          setSubTab(null);
        } else {
          setTab('home');
          setSubTab(null);
        }
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  /* ─── Auth & Initial Data Load ─── */
  useEffect(() => {
    const stored = localStorage.getItem('hr-user');
    const token = localStorage.getItem('hr-token');
    if (!stored || !token) {
      router.replace('/');
      return;
    }
    try {
      setUser(JSON.parse(stored));
    } catch {
      localStorage.removeItem('hr-user');
      localStorage.removeItem('hr-token');
      router.replace('/');
      return;
    }

    fetch('/api/me', { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } })
      .then(async (r) => {
        if (r.status === 401) {
          localStorage.removeItem('hr-user');
          localStorage.removeItem('hr-token');
          document.cookie = 'hr-token=; path=/; max-age=0';
          router.replace('/');
          return null;
        }
        if (!r.ok) {
          setLoadError(true);
          return null;
        }
        return r.json();
      })
      .then((d) => {
        if (d && d.profile) {
          setData(d);
        } else if (d) {
          setLoadError(true);
        }
      })
      .catch(() => setLoadError(true));
  }, [router]);

  const refreshMeData = useCallback(async () => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('hr-token') : '';
    if (!token) return;
    try {
      const res = await fetch('/api/me', {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      if (res.ok) {
        const d = await res.json();
        if (d?.profile) setData(d);
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (tab === 'leave' || tab === 'home') {
      refreshMeData();
    }
  }, [tab, refreshMeData]);

  function handleLogout() {
    localStorage.removeItem('hr-user');
    localStorage.removeItem('hr-token');
    document.cookie = 'hr-token=; path=/; max-age=0';
    router.replace('/');
  }

  const showToast = useCallback((msg, isError) => {
    setToast({ msg, isError });
    setTimeout(() => setToast(null), 3200);
  }, []);

  if (loadError) {
    return (
      <div className="me-root">
        <div className="me-empty" style={{ padding: '48px 20px', textAlign: 'center' }}>
          <div style={{ color: '#DC2626', marginBottom: 14 }}>
            <AppIcon name="alert-triangle" size={44} />
          </div>
          <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 8, color: '#0F172A' }}>
            เซสชันหมดอายุ หรือไม่สามารถโหลดข้อมูลได้
          </div>
          <div style={{ fontSize: 13, color: '#64748B', marginBottom: 24 }}>
            กรุณาเข้าสู่ระบบใหม่อีกครั้งเพื่อความปลอดภัยของข้อมูล
          </div>
          <button className="me-btn" onClick={handleLogout} style={{ maxWidth: 220, margin: '0 auto' }}>
            <AppIcon name="logout" size={16} /> เข้าสู่ระบบใหม่
          </button>
        </div>
      </div>
    );
  }

  if (!user || !data) {
    return (
      <div className="me-root">
        <div className="me-empty" style={{ paddingTop: 80 }}>
          <div style={{ color: '#0284C7', marginBottom: 12 }}>
            <AppIcon name="clock" size={36} />
          </div>
          <div style={{ fontWeight: 600 }}>กำลังโหลดข้อมูลพนักงาน...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="me-root">
      {/* ── Operational Sticky Header ── */}
      <header className="me-header">
        <div className="me-avatar" aria-label="รูปโปรไฟล์">
          {data.profile.avatar ? (
            data.profile.avatar
          ) : (
            <AppIcon name="user" size={22} />
          )}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="me-name" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            คุณ{data.profile.name}
          </div>
          <div className="me-sub" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {data.profile.department} · {data.profile.position}
          </div>
        </div>
        <div className="me-header-actions">
          <NotificationBell compact />
        </div>
      </header>

      {/* ── Main Tab Content ── */}
      <main className="me-content">
        {tab === 'home' && (
          <HomeTab
            data={data}
            setData={setData}
            showToast={showToast}
            onNavigateTab={navigateToTab}
            onNavigateSubTab={(s) => {
              setTab('more');
              navigateToSubTab(s);
            }}
          />
        )}
        {tab === 'leave' && (
          <LeaveTab
            data={data}
            setData={setData}
            showToast={showToast}
            refreshData={refreshMeData}
          />
        )}
        {tab === 'chat' && <DynamicChatTab user={user} />}
        {tab === 'payslip' && <DynamicPayslipTab data={data} />}
        {tab === 'more' && (
          <MoreTab
            user={user}
            data={data}
            subTab={subTab}
            onOpenSubTab={navigateToSubTab}
            onCloseSubTab={closeSubTab}
            showToast={showToast}
            onLogout={handleLogout}
          />
        )}
      </main>

      {/* ── Bottom Floating Dock Tab Bar ── */}
      <nav className="me-tabbar" aria-label="แถบเมนูหลัก">
        {[
          { id: 'home', icon: 'home', label: 'หน้าแรก' },
          { id: 'leave', icon: 'calendar', label: 'ลางาน' },
          { id: 'chat', icon: 'chat', label: 'แชท' },
          { id: 'payslip', icon: 'payroll', label: 'เงินเดือน' },
          { id: 'more', icon: 'more', label: 'เพิ่มเติม' },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            className={`me-tab${tab === t.id ? ' active' : ''}`}
            onClick={() => navigateToTab(t.id)}
            aria-selected={tab === t.id}
            role="tab"
          >
            <span className="ico">
              <AppIcon name={t.icon} size={20} />
            </span>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>

      {/* ── Toast Notifications ── */}
      {toast && (
        <div className={`me-toast${toast.isError ? ' error' : ''}`} role="alert">
          <AppIcon name={toast.isError ? 'alert-triangle' : 'check-circle'} size={16} />
          <span>{toast.msg}</span>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   HOME TAB (Logistics Station Mode, GPS Status, Operations First)
   ═══════════════════════════════════════════════════════════════ */
function HomeTab({ data, setData, showToast, onNavigateTab, onNavigateSubTab }) {
  const [clockLoading, setClockLoading] = useState(false);
  const [gpsStage, setGpsStage] = useState('idle'); // 'idle' | 'locating' | 'submitting'
  const [gpsMessage, setGpsMessage] = useState('');
  const [clockStatus, setClockStatus] = useState(data.todayClock);
  const [clockType, setClockType] = useState('office');
  const [selectedAnnouncement, setSelectedAnnouncement] = useState(null);
  const [nowTime, setNowTime] = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setNowTime(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  const handleClock = async (action) => {
    setClockLoading(true);
    setGpsStage('locating');
    setGpsMessage('กำลังค้นหาพิกัดดาวเทียม GPS...');
    try {
      let lat = null, lng = null;
      if (clockType === 'office' || clockType === 'offsite') {
        const pos = await new Promise((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0,
          })
        );
        lat = pos.coords.latitude;
        lng = pos.coords.longitude;
      }

      setGpsStage('submitting');
      setGpsMessage('กำลังบันทึกเวลาปฏิบัติงาน...');

      const res = await fetch('/api/me/clock', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ action, latitude: lat, longitude: lng, check_type: clockType }),
      });
      const d = await res.json();
      if (!res.ok) {
        showToast(d.error || 'เกิดข้อผิดพลาดในการลงเวลา', true);
        return;
      }
      setClockStatus(d.record);
      showToast(d.message);
    } catch (err) {
      showToast(
        err.code === 1
          ? 'กรุณาอนุญาตการเข้าถึงพิกัด GPS บนอุปกรณ์ของท่าน'
          : 'ไม่สามารถระบุพิกัดดาวเทียม GPS ได้',
        true
      );
    } finally {
      setClockLoading(false);
      setGpsStage('idle');
      setGpsMessage('');
    }
  };

  const clockedIn = !!clockStatus?.clock_in;
  const clockedOut = !!clockStatus?.clock_out;
  const attendanceStats = data.attendanceStats || { late: 0, absent: 0 };
  const dateLabel = nowTime.toLocaleDateString('th-TH', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  const timeLabel = nowTime.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });

  const todayStr = data.today || nowTime.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
  const todayShift = (data.shifts || []).find((s) => s.shift_date === todayStr);
  const ws = data.workSettings || { standard_in: '08:00', standard_out: '17:00' };
  const fmtHm = (t) => String(t || '').slice(0, 5);

  let shiftLabel = 'เวลาทำงานปกติ';
  let shiftTimeText = `${fmtHm(ws.standard_in || '08:00')} – ${fmtHm(ws.standard_out || '17:00')} น.`;
  if (todayShift) {
    if (todayShift.shift_type === 'off') {
      shiftLabel = 'ตารางกะวันนี้';
      shiftTimeText = 'วันหยุดตามกะงาน';
    } else if (todayShift.start_time && todayShift.end_time) {
      shiftLabel = 'เวลาทำงานตามกะวันนี้';
      shiftTimeText = `${fmtHm(todayShift.start_time)} – ${fmtHm(todayShift.end_time)} น.`;
    }
  }

  return (
    <>
      {/* ── 1. Attendance GPS Clock Station Widget ── */}
      <section className="me-clock-widget" aria-label="สถานีลงเวลาทำงาน GPS">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div className="me-clock-date-label">{dateLabel}</div>
            <div className="me-clock-digital">
              {timeLabel} <span style={{ fontSize: 15, fontWeight: 600, color: '#64748B' }}>น.</span>
            </div>
          </div>
          <span className={`me-badge ${clockedOut ? 'me-badge-blue' : clockedIn ? 'me-badge-green' : 'me-badge-gray'}`}>
            <AppIcon name={clockedOut ? 'check-circle' : clockedIn ? 'check' : 'clock'} size={13} />
            <span>{clockedOut ? 'เลิกงานแล้ว' : clockedIn ? 'กำลังปฏิบัติงาน' : 'ยังไม่ได้เข้างาน'}</span>
          </span>
        </div>

        <div className="me-clock-hours-bar">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <AppIcon name="clock" size={15} />
            <span>{shiftLabel}</span>
          </span>
          <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{shiftTimeText}</strong>
        </div>

        {/* Work Location Mode Picker */}
        <div className="me-segmented-picker" role="radiogroup" aria-label="สถานที่ปฏิบัติงาน">
          {[
            { id: 'office', icon: 'map-pin', label: 'สถานี / สาขา' },
            { id: 'offsite', icon: 'truck', label: 'นอกสถานที่' },
            { id: 'wfh', icon: 'home', label: 'WFH' },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={clockType === t.id}
              className={`me-segmented-opt${clockType === t.id ? ' active' : ''}`}
              onClick={() => setClockType(t.id)}
            >
              <AppIcon name={t.icon} size={15} />
              <span>{t.label}</span>
            </button>
          ))}
        </div>

        {/* 56px Tall Touch Targets with GPS Status Feedback */}
        <div className="me-clock-btn-row">
          <button
            type="button"
            className="me-clock-btn in"
            disabled={clockLoading || clockedIn}
            onClick={() => handleClock('in')}
            aria-label="บันทึกเวลาเข้างาน"
          >
            <AppIcon name="map-pin" size={19} />
            <span>
              {clockLoading && gpsStage !== 'idle'
                ? gpsStage === 'locating'
                  ? 'ค้นหา GPS...'
                  : 'บันทึกเวลา...'
                : 'Clock In · เข้างาน'}
            </span>
          </button>
          <button
            type="button"
            className="me-clock-btn out"
            disabled={clockLoading || !clockedIn || clockedOut}
            onClick={() => handleClock('out')}
            aria-label="บันทึกเวลาออกงาน"
          >
            <AppIcon name="logout" size={19} />
            <span>
              {clockLoading && gpsStage !== 'idle' ? 'กำลังบันทึก...' : 'Clock Out · ออกงาน'}
            </span>
          </button>
        </div>

        {gpsStage !== 'idle' && (
          <div className="me-gps-feedback" role="status">
            <AppIcon name="clock" size={15} />
            <span>{gpsMessage}</span>
          </div>
        )}

        {clockedIn && (
          <div
            style={{
              marginTop: 14,
              paddingTop: 11,
              borderTop: '1px solid #E2E8F0',
              fontSize: 13,
              color: '#334155',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <AppIcon name="check-circle" size={15} />
              <span>
                เข้างาน <strong>{clockStatus.clock_in?.slice(0, 5)} น.</strong>{' '}
                {clockStatus.location_name && `(${clockStatus.location_name})`}
              </span>
            </span>
            {clockedOut && (
              <span>
                ออกงาน <strong>{clockStatus.clock_out?.slice(0, 5)} น.</strong>
              </span>
            )}
          </div>
        )}
      </section>

      {/* ── 2. Operational Quick Actions (Fast Access) ── */}
      <section className="me-quick-grid" aria-label="ทางลัดการปฏิบัติงาน">
        <button
          type="button"
          className="me-quick-btn"
          onClick={() => onNavigateTab('leave')}
        >
          <div className="me-quick-icon">
            <AppIcon name="calendar" size={18} />
          </div>
          <span>ลางาน</span>
        </button>
        <button
          type="button"
          className="me-quick-btn"
          onClick={() => onNavigateSubTab('ot')}
        >
          <div className="me-quick-icon">
            <AppIcon name="ot" size={18} />
          </div>
          <span>ขอโอที</span>
        </button>
        <button
          type="button"
          className="me-quick-btn"
          onClick={() => onNavigateSubTab('expenses')}
        >
          <div className="me-quick-icon">
            <AppIcon name="receipt" size={18} />
          </div>
          <span>เบิกค่าเที่ยว</span>
        </button>
        <button
          type="button"
          className="me-quick-btn"
          onClick={() => onNavigateTab('payslip')}
        >
          <div className="me-quick-icon">
            <AppIcon name="payroll" size={18} />
          </div>
          <span>สลิปเงินเดือน</span>
        </button>
      </section>

      {/* ── 3. Attendance Statistics ── */}
      <section className="me-leave-grid me-attendance-grid" aria-label="สถิติการมาทำงานเดือนนี้">
        <div className="me-leave-card">
          <div className="me-leave-icon" style={{ color: '#D97706' }}>
            <AppIcon name="clock" size={22} />
          </div>
          <div className="me-leave-remain" style={{ color: '#D97706' }}>
            {attendanceStats.late || 0}
          </div>
          <div className="me-leave-label">มาสายเดือนนี้ (ครั้ง)</div>
        </div>
        <div className="me-leave-card">
          <div className="me-leave-icon" style={{ color: '#DC2626' }}>
            <AppIcon name="alert-triangle" size={22} />
          </div>
          <div className="me-leave-remain" style={{ color: '#DC2626' }}>
            {attendanceStats.absent || 0}
          </div>
          <div className="me-leave-label">ขาดงานเดือนนี้ (วัน)</div>
        </div>
      </section>

      {/* ── 4. Leave Balance Quotas ── */}
      <section className="me-leave-grid me-balance-grid" aria-label="โควตาวันลาคงเหลือ">
        {Object.entries(data.leaveBalance || {}).map(([key, val]) => (
          <div key={key} className="me-leave-card">
            <div className="me-leave-icon">
              <AppIcon name={LEAVE_ICON_NAMES[key] || 'calendar'} size={20} />
            </div>
            <div className="me-leave-remain">{val.remaining}</div>
            <div className="me-leave-label">{leaveLabel(key, val, data.leaveTypes)}</div>
          </div>
        ))}
      </section>

      {/* ── 5. Recent Leave Requests ── */}
      {(data.leaves || []).length > 0 && (
        <section className="me-card" aria-label="คำขอลางานล่าสุด">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div className="me-section-title" style={{ marginBottom: 0 }}>
              <AppIcon name="file-text" size={18} /> สถานะคำขอล่าสุด
            </div>
            <button
              type="button"
              onClick={() => onNavigateTab && onNavigateTab('leave')}
              style={{
                border: 'none',
                background: 'transparent',
                color: '#0284C7',
                fontSize: 12.5,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              ดูทั้งหมด ›
            </button>
          </div>
          {(data.leaves || []).slice(0, 3).map((l) => {
            const badge = STATUS_BADGE[l.status] || STATUS_BADGE.pending;
            return (
              <div key={l.id} className="me-row">
                <span className="k" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <AppIcon name={LEAVE_ICON_NAMES[l.leave_type] || 'calendar'} size={16} />
                  <span>
                    {LEAVE_LABELS[l.leave_type] || l.leave_type} {l.days} วัน · {l.start_date}
                  </span>
                </span>
                <span className={`me-badge ${badge.cls}`}>{badge.label}</span>
              </div>
            );
          })}
        </section>
      )}

      {/* ── 6. Operational Announcements ── */}
      <section className="me-card" aria-label="ประกาศล่าสุด">
        <div className="me-section-title">
          <AppIcon name="megaphone" size={18} /> ข่าวสารและประกาศบริษัท
        </div>
        {(data.announcements || []).length === 0 && <div className="me-empty">ไม่มีประกาศใหม่</div>}
        {(data.announcements || []).slice(0, 4).map((a) => (
          <button
            key={a.id}
            type="button"
            className="me-row me-announcement-row"
            onClick={() => setSelectedAnnouncement(a)}
          >
            <span className="k" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {a.pinned && <AppIcon name="pin" size={14} />}
              <span>{a.title}</span>
            </span>
            <span className="v" style={{ fontSize: 12 }}>
              {a.publish_date || '›'}
            </span>
          </button>
        ))}
      </section>

      {/* Announcement Detail Sheet */}
      {selectedAnnouncement && (
        <div className="me-sheet-overlay" onClick={() => setSelectedAnnouncement(null)}>
          <div className="me-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="me-sheet-head">
              <div>
                <div className="me-sheet-title">{selectedAnnouncement.title}</div>
                <div className="me-sheet-meta">
                  {[selectedAnnouncement.category, selectedAnnouncement.publish_date, selectedAnnouncement.author]
                    .filter(Boolean)
                    .join(' · ') || 'ประกาศบริษัท'}
                </div>
              </div>
              <button
                type="button"
                className="me-sheet-close"
                onClick={() => setSelectedAnnouncement(null)}
                aria-label="ปิด"
              >
                ✕
              </button>
            </div>
            <div className="me-sheet-body">
              {selectedAnnouncement.body ? (
                selectedAnnouncement.body.split('\n').map((line, idx) => <p key={idx}>{line || '\u00a0'}</p>)
              ) : (
                <p>ไม่มีรายละเอียดเพิ่มเติม</p>
              )}
              {selectedAnnouncement.docId && (
                <div style={{ marginTop: 18 }}>
                  <button
                    type="button"
                    className="me-btn"
                    onClick={() => {
                      const token = localStorage.getItem('hr-token');
                      window.open(
                        `/api/documents/${selectedAnnouncement.docId}/download?token=${encodeURIComponent(token || '')}`,
                        '_blank'
                      );
                    }}
                  >
                    <AppIcon name="download" size={16} /> ดาวน์โหลดเอกสารแนบ ({selectedAnnouncement.fileName || 'เอกสาร'})
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════
   LEAVE TAB (Accessible radiogroup, segmented duration, balance)
   ═══════════════════════════════════════════════════════════════ */
function LeaveTab({ data, setData, showToast, refreshData }) {
  const leaveOptions =
    data.leaveTypes && data.leaveTypes.length > 0
      ? data.leaveTypes
      : [
          { code: 'annual', name: 'ลาพักร้อน' },
          { code: 'sick', name: 'ลาป่วย' },
          { code: 'personal', name: 'ลากิจ' },
        ];
  const firstLeaveType = leaveOptions[0]?.code || 'annual';

  const [form, setForm] = useState({
    leave_type: firstLeaveType,
    start_date: '',
    end_date: '',
    days: 1,
    reason: '',
  });
  const [durationMode, setDurationMode] = useState('full'); // 'full' | 'morning' | 'afternoon' | 'custom'
  const [loading, setLoading] = useState(false);
  const [leaves, setLeaves] = useState(data.leaves || []);

  useEffect(() => {
    setLeaves(data.leaves || []);
  }, [data.leaves]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch('/api/me/leave', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(form),
      });
      const d = await res.json();
      if (!res.ok) {
        showToast(d.error || 'ยื่นใบลาไม่สำเร็จ', true);
        return;
      }
      showToast('ยื่นใบลาเรียบร้อยแล้ว');
      setLeaves((prev) => [d.item, ...prev]);
      if (setData) {
        setData((prev) => ({
          ...prev,
          leaves: [d.item, ...(prev?.leaves || [])],
        }));
      }
      setForm({ leave_type: firstLeaveType, start_date: '', end_date: '', days: 1, reason: '' });
      setDurationMode('full');
      if (refreshData) refreshData();
    } catch {
      showToast('เกิดข้อผิดพลาดในการเชื่อมต่อ', true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* Leave Balance Quotas */}
      <div className="me-leave-grid" style={{ marginTop: 0, padding: 0 }}>
        {Object.entries(data.leaveBalance || {}).map(([key, val]) => (
          <div key={key} className="me-leave-card">
            <div className="me-leave-icon">
              <AppIcon name={LEAVE_ICON_NAMES[key] || 'calendar'} size={20} />
            </div>
            <div className="me-leave-remain">
              {val.remaining}
              <span style={{ fontSize: 11, fontWeight: 500, color: '#64748B' }}>/{val.total}</span>
            </div>
            <div className="me-leave-label">{leaveLabel(key, val, data.leaveTypes)}</div>
          </div>
        ))}
      </div>

      {/* Leave Form */}
      <div className="me-card" style={{ marginTop: 14 }}>
        <div className="me-section-title">
          <AppIcon name="file-text" size={18} /> ยื่นใบลาออนไลน์
        </div>
        <form onSubmit={handleSubmit}>
          <div className="me-field">
            <label>ประเภทการลา</label>
            <select
              value={form.leave_type}
              onChange={(e) => setForm({ ...form, leave_type: e.target.value })}
              required
            >
              {leaveOptions.map((t) => {
                const bal = data.leaveBalance?.[t.code];
                const remainText = bal ? ` (คงเหลือ ${bal.remaining} วัน)` : '';
                return (
                  <option key={t.code} value={t.code}>
                    {t.name}
                    {remainText}
                  </option>
                );
              })}
            </select>
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <div className="me-field" style={{ flex: 1 }}>
              <label>วันที่เริ่มลา</label>
              <input
                type="date"
                className="me-input"
                value={form.start_date}
                onChange={(e) => {
                  const s = e.target.value;
                  const end = form.end_date && form.end_date >= s ? form.end_date : s;
                  const diff = Math.max(1, Math.round((new Date(end) - new Date(s)) / 86400000) + 1);
                  setForm({ ...form, start_date: s, end_date: end, days: durationMode.startsWith('half') ? 0.5 : diff });
                }}
                required
              />
            </div>
            <div className="me-field" style={{ flex: 1 }}>
              <label>วันที่สิ้นสุด</label>
              <input
                type="date"
                className="me-input"
                min={form.start_date}
                value={form.end_date}
                onChange={(e) => {
                  const end = e.target.value;
                  const s = form.start_date || end;
                  const diff = Math.max(1, Math.round((new Date(end) - new Date(s)) / 86400000) + 1);
                  setForm({ ...form, end_date: end, days: durationMode.startsWith('half') ? 0.5 : diff });
                }}
                required
              />
            </div>
          </div>

          {/* Accessible Segmented Duration Picker (Fix WCAG role="radiogroup") */}
          <div className="me-field">
            <label>ช่วงเวลา / ระยะเวลาการลา</label>
            <div className="me-segmented-picker" role="radiogroup" aria-label="ช่วงเวลาการลา">
              {[
                { id: 'full', label: 'เต็มวัน (1.0)', days: 1 },
                { id: 'half_morning', label: 'ครึ่งเช้า (0.5)', days: 0.5 },
                { id: 'half_afternoon', label: 'ครึ่งบ่าย (0.5)', days: 0.5 },
              ].map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  role="radio"
                  aria-checked={durationMode === opt.id}
                  className={`me-segmented-opt${durationMode === opt.id ? ' active' : ''}`}
                  onClick={() => {
                    setDurationMode(opt.id);
                    setForm({ ...form, days: opt.days });
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="me-field">
            <label>จำนวนวันลา (วัน)</label>
            <input
              type="number"
              className="me-input"
              min="0.5"
              step="0.5"
              value={form.days}
              onChange={(e) => {
                setDurationMode('custom');
                setForm({ ...form, days: e.target.value });
              }}
              required
            />
          </div>

          <div className="me-field">
            <label>เหตุผลการลา</label>
            <textarea
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              placeholder="ระบุเหตุผลการลา เช่น ธุระครอบครัว หรือลาป่วย..."
            />
          </div>

          <button className="me-btn" disabled={loading}>
            <AppIcon name="calendar" size={16} />
            <span>{loading ? 'กำลังส่งคำขอ...' : 'ส่งใบลา'}</span>
          </button>
        </form>
      </div>

      {/* Leave History */}
      <div className="me-card">
        <div className="me-section-title">
          <AppIcon name="file-text" size={18} /> ประวัติการลาของฉัน
        </div>
        {leaves.length === 0 && <div className="me-empty">ยังไม่มีประวัติการลา</div>}
        {leaves.map((l) => {
          const badge = STATUS_BADGE[l.status] || STATUS_BADGE.pending;
          return (
            <div key={l.id} className="me-row">
              <span className="k" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <AppIcon name={LEAVE_ICON_NAMES[l.leave_type] || 'calendar'} size={15} />
                <span>
                  {LEAVE_LABELS[l.leave_type] || l.leave_type} {l.days} วัน · {l.start_date}
                </span>
              </span>
              <span className={`me-badge ${badge.cls}`}>{badge.label}</span>
            </div>
          );
        })}
      </div>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════
   MORE TAB (Logistics 3 Clear Operational Groups)
   ═══════════════════════════════════════════════════════════════ */
function MoreTab({ user, data, subTab, onOpenSubTab, onCloseSubTab, showToast, onLogout }) {
  // Render active sub-view if selected
  if (subTab === 'payslip') return <DynamicPayslipTab data={data} back={onCloseSubTab} />;
  if (subTab === 'expenses') return <DynamicExpensesSection back={onCloseSubTab} showToast={showToast} />;
  if (subTab === 'ot') return <DynamicOtSection back={onCloseSubTab} showToast={showToast} />;
  if (subTab === 'rooms') return <DynamicRoomsSection back={onCloseSubTab} showToast={showToast} />;
  if (subTab === 'workplace') return <DynamicWorkplaceSection back={onCloseSubTab} showToast={showToast} />;
  if (subTab === 'calendar') return <DynamicCalendarSection back={onCloseSubTab} />;
  if (subTab === 'attendance') return <DynamicAttendanceSection back={onCloseSubTab} />;
  if (subTab === 'evaluation') return <DynamicEvaluationSection back={onCloseSubTab} showToast={showToast} />;
  if (subTab === 'taxcert') return <DynamicTaxCertSection back={onCloseSubTab} profile={data?.profile} />;
  if (subTab === 'allowance') return <DynamicAllowanceSection back={onCloseSubTab} showToast={showToast} />;
  if (subTab === 'teamleave') return <DynamicTeamLeaveSection back={onCloseSubTab} showToast={showToast} />;
  if (subTab === 'assets') return <DynamicAssetsSection back={onCloseSubTab} showToast={showToast} />;
  if (subTab === 'documentRequests') return <DynamicDocumentRequestsSection back={onCloseSubTab} showToast={showToast} profile={data?.profile} />;
  if (subTab === 'benefits') return <DynamicBenefitsTab back={onCloseSubTab} />;
  if (subTab === 'onboarding') return <DynamicOnboardingTab back={onCloseSubTab} />;
  if (subTab === 'shiftswap') return <DynamicShiftSwapTab back={onCloseSubTab} showToast={showToast} />;
  if (subTab === 'profile') return <DynamicProfileTab user={user} profile={data?.profile} back={onCloseSubTab} />;
  if (subTab === 'announcements') return <DynamicAnnouncementsTab announcements={data?.announcements} back={onCloseSubTab} />;
  if (subTab === 'manuals') return <DynamicDriverManualsTab back={onCloseSubTab} />;

  // 3 Clear Logistics Groups
  const MENU_GROUPS = [
    {
      groupTitle: 'การเงินและเอกสารสำคัญ',
      icon: 'wallet',
      items: [
        { id: 'payslip', icon: 'payroll', label: 'สลิปเงินเดือนและภาษี', desc: 'ตรวจสอบสลิปย้อนหลังและพิมพ์เอกสาร PDF' },
        { id: 'expenses', icon: 'receipt', label: 'เบิกค่าเที่ยว / ค่าใช้จ่าย', desc: 'ยื่นเบิกค่าน้ำมัน ทางด่วน และเบี้ยเลี้ยง' },
        { id: 'ot', icon: 'ot', label: 'ขอค่าล่วงเวลา (OT)', desc: 'ยื่นคำขอ OT พร้อมติดตามผลการอนุมัติ' },
        { id: 'documentRequests', icon: 'document-requests', label: 'ขอหนังสือรับรอง', desc: 'ขอหนังสือรับรองเงินเดือนและการทำงาน' },
        { id: 'taxcert', icon: 'file-text', label: 'หนังสือรับรองหักภาษี (50 ทวิ)', desc: 'สรุปรายได้และภาษีสะสมประจำปี' },
        { id: 'allowance', icon: 'file-signature', label: 'แบบลดหย่อนภาษี (ลย.01)', desc: 'กรอกรายการลดหย่อนส่งให้ฝ่ายบุคคล' },
        { id: 'benefits', icon: 'benefits', label: 'สวัสดิการและเงินกู้', desc: 'สิทธิประกันสังคม และเงินกู้สวัสดิการ' },
      ],
    },
    {
      groupTitle: 'การปฏิบัติงานและทรัพย์สิน',
      icon: 'truck',
      items: [
        { id: 'calendar', icon: 'calendar', label: 'ตารางกะและปฏิทินงาน', desc: 'ดูตารางเวร วันหยุด และวันทำงาน' },
        { id: 'shiftswap', icon: 'refresh', label: 'การขอสลับกะงาน', desc: 'ยื่นเรื่องขอเปลี่ยนกะหรือสลับเวร' },
        { id: 'attendance', icon: 'clock', label: 'ประวัติเข้า-ออกงาน', desc: 'ดูสถิติเวลาและพิกัดลงเวลาย้อนหลัง' },
        { id: 'assets', icon: 'package', label: 'รถและทรัพย์สินที่เบิกใช้', desc: 'ขอเบิก คืน หรือเปลี่ยนยานพาหนะ/อุปกรณ์' },
        { id: 'manuals', icon: 'rocket', label: 'คู่มือ & คลิปอบรมพนักงานขับรถ', desc: 'วิดีโอสอนการใช้งานและขั้นตอนการทำงาน' },
        { id: 'announcements', icon: 'megaphone', label: 'ข่าวสารและประกาศบริษัท', desc: 'ระเบียบปฏิบัติและข่าวสารองค์กร' },
        { id: 'profile', icon: 'id-card', label: 'ข้อมูลส่วนตัวพนักงาน', desc: 'ตรวจสอบรหัสพนักงาน ตำแหน่ง และฝ่าย' },
        ...(data?.isManager
          ? [
              {
                id: 'teamleave',
                icon: 'check-circle',
                label: 'อนุมัติคำขอลูกทีม (ลา/OT/เบิกจ่าย)',
                desc: 'การอนุมัติขั้นต้นสำหรับหัวหน้างาน',
              },
            ]
          : []),
      ],
    },
    {
      groupTitle: 'การพัฒนาและสวัสดิการสำนักงาน',
      icon: 'graduation-cap',
      items: [
        { id: 'onboarding', icon: 'rocket', label: 'ปฐมนิเทศพนักงานใหม่', desc: 'ขั้นตอนและคู่มือสำหรับพนักงานใหม่' },
        { id: 'workplace', icon: 'trending-up', label: 'อบรม ทริปบริษัท และ OKR', desc: 'พัฒนาทักษะ ทริปประจำปี และเป้าหมายงาน' },
        { id: 'evaluation', icon: 'star', label: 'ประเมินผล 360° เพื่อนร่วมงาน', desc: 'ให้คะแนนและดูผลประเมินสมรรถนะ' },
        { id: 'rooms', icon: 'rooms', label: 'จองห้องประชุม', desc: 'ดูตารางห้องว่างและจองเวลาประชุม' },
      ],
    },
  ];

  return (
    <>
      {MENU_GROUPS.map((group, gIdx) => (
        <div key={gIdx} className="me-card">
          <div className="me-section-title">
            <AppIcon name={group.icon} size={18} /> {group.groupTitle}
          </div>
          {group.items.map((m) => (
            <div
              key={m.id}
              className="me-row"
              style={{ cursor: 'pointer', padding: '12px 0' }}
              onClick={() => onOpenSubTab(m.id)}
            >
              <span className="k" style={{ display: 'flex', alignItems: 'center' }}>
                <span className="me-menu-icon-badge">
                  <AppIcon name={m.icon} size={18} />
                </span>
                <span>
                  <div style={{ fontWeight: 700, color: '#0F172A', fontSize: 14 }}>{m.label}</div>
                  <div style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>{m.desc}</div>
                </span>
              </span>
              <span className="v" style={{ color: '#94A3B8' }}>
                <AppIcon name="chevron-right" size={16} />
              </span>
            </div>
          ))}
        </div>
      ))}

      {/* Logout Action */}
      <button
        type="button"
        className="me-btn"
        style={{
          background: '#DC2626',
          boxShadow: '0 4px 12px rgba(220, 38, 38, 0.22)',
          marginTop: 6,
          marginBottom: 16,
        }}
        onClick={onLogout}
      >
        <AppIcon name="logout" size={18} /> ออกจากระบบ
      </button>
    </>
  );
}
