'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import './hr.css';

const MENUS = [
  { href: '/hr', icon: '📊', label: 'Dashboard' },
  { href: '/hr/employees', icon: '👥', label: 'พนักงาน' },
  { href: '/hr/departments', icon: '🏢', label: 'แผนก' },
  { href: '/hr/positions', icon: '💼', label: 'ตำแหน่งงาน' },
  { href: '/hr/time', icon: '🕐', label: 'บันทึกเวลา' },
  { href: '/hr/leave', icon: '🏖️', label: 'การลา' },
  { href: '/hr/payroll', icon: '💰', label: 'เงินเดือน' },
  { href: '/hr/ot', icon: '⏱️', label: 'ค่าล่วงเวลา (OT)' },
  { href: '/hr/shifts', icon: '📅', label: 'จัดกะ' },
  { href: '/hr/recruitment', icon: '📣', label: 'สรรหา' },
  { href: '/hr/applicants', icon: '🧑‍💼', label: 'ผู้สมัคร' },
  { href: '/hr/onboarding', icon: '🚀', label: 'ปฐมนิเทศ' },
  { href: '/hr/training', icon: '🎓', label: 'อบรม' },
  { href: '/hr/evaluation', icon: '🎯', label: 'ประเมินผล' },
  { href: '/hr/okr', icon: '📈', label: 'OKR' },
  { href: '/admin/documents', icon: '📄', label: 'เอกสาร HR' },
  { href: '/hr/assets', icon: '📦', label: 'ทรัพย์สิน' },
  { href: '/hr/expenses', icon: '🧾', label: 'เบิกค่าใช้จ่าย' },
  { href: '/hr/benefits', icon: '🎁', label: 'สวัสดิการ/กู้' },
  { href: '/hr/social-security', icon: '🏥', label: 'สิทธิ์ประกันสังคม' },
  { href: '/hr/rooms', icon: '🎦', label: 'ห้องประชุม' },
  { href: '/hr/trips', icon: '✈️', label: 'ทริปบริษัท' },
  { href: '/hr/announcements', icon: '📢', label: 'ประกาศ' },
  { href: '/hr/reports', icon: '📑', label: 'รายงาน' },
  { href: '/admin/users', icon: '🛡️', label: 'จัดการผู้ใช้' },
];

export default function HrLayout({ children }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState(null);

  useEffect(() => {
    const storedUser = localStorage.getItem('hr-user');
    if (!storedUser) { router.push('/'); return; }
    const parsed = JSON.parse(storedUser);
    if (parsed.role !== 'admin' && parsed.role !== 'hr') {
      router.push('/chat');
      return;
    }
    setUser(parsed);
  }, [router]);

  if (!user) return null;

  const current = MENUS.find((m) => m.href === pathname) ||
    MENUS.find((m) => m.href !== '/hr' && pathname.startsWith(m.href));
  const pageLabel = current ? current.label : 'Dashboard';

  const today = new Date().toLocaleDateString('th-TH', {
    weekday: 'long', day: 'numeric', month: 'short',
  });

  function logout() {
    localStorage.removeItem('hr-token');
    localStorage.removeItem('hr-user');
    document.cookie = 'hr-token=; path=/; max-age=0';
    router.push('/');
  }

  return (
    <div className="hr-root">
      <aside className="hr-sidebar">
        <div className="hr-logo">
          <div className="hr-logo-icon">✦</div>
          <div>
            <div className="hr-logo-title">HR Pro Suite</div>
            <div className="hr-logo-sub">บริษัท ดีดี เซอร์วิส แอนด์ ทรานสปอร์ต</div>
          </div>
        </div>
        <nav className="hr-nav">
          {MENUS.map((m) => (
            <Link
              key={m.href}
              href={m.href}
              className={`hr-nav-item${pathname === m.href ? ' active' : ''}`}
            >
              <span className="hr-nav-icon">{m.icon}</span>
              {m.label}
            </Link>
          ))}
        </nav>
        <div className="hr-sidebar-user">
          <div className="hr-sidebar-avatar">{(user.name || '?')[0]}</div>
          <div>
            <div className="hr-sidebar-user-name">{user.name}</div>
            <div className="hr-sidebar-user-role">{user.role === 'admin' ? '👑 Administrator' : 'HR'}</div>
          </div>
        </div>
      </aside>

      <div className="hr-main">
        <header className="hr-topbar">
          <div>
            <div className="hr-breadcrumb">HR Pro Suite / {pageLabel}</div>
            <div className="hr-page-title">{pageLabel}</div>
          </div>
          <div className="hr-topbar-right">
            <span className="hr-topbar-date">{today}</span>
            <Link href="/chat" className="hr-btn hr-btn-icon" title="กลับไปแชท">💬</Link>
            <button className="hr-btn hr-btn-icon" title="ออกจากระบบ" onClick={logout}>⏻</button>
          </div>
        </header>
        <main className="hr-content">{children}</main>
      </div>
    </div>
  );
}
