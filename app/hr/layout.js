'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { HR_MENUS } from '@/lib/hr-menus';
import { authHeaders } from '@/components/hr/exportUtils';
import NotificationBell from '@/components/NotificationBell';
import './hr.css';

const MENUS = HR_MENUS;

export default function HrLayout({ children }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState(null);
  const [access, setAccess] = useState(null); // { allowed, isAdmin }

  useEffect(() => {
    const storedUser = localStorage.getItem('hr-user');
    if (!storedUser) { router.push('/'); return; }
    const parsed = JSON.parse(storedUser);
    setUser(parsed);

    fetch('/api/hr/access', { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => {
        const allowed = d.allowed ?? [];
        const canEnter = d.isAdmin || allowed === '__all__' || (Array.isArray(allowed) && allowed.length > 0);
        if (!canEnter) { router.push('/me'); return; }
        setAccess({ allowed, isAdmin: !!d.isAdmin });
      })
      .catch(() => router.push('/me'));
  }, [router]);

  if (!user || !access) return null;

  const isAll = access.allowed === '__all__';
  const visibleMenus = MENUS.filter((m) => {
    if (m.adminOnly) return access.isAdmin;
    if (access.isAdmin || isAll) return true;
    return access.allowed.includes(m.key);
  });

  const current = visibleMenus.find((m) => m.href === pathname) ||
    visibleMenus.find((m) => m.href !== '/hr' && pathname.startsWith(m.href));
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
          <div className="hr-logo-icon">
            <img src="/brand/hr-pro-logo.svg" alt="HR Pro Suite" />
          </div>
          <div>
            <div className="hr-logo-title">HR Pro Suite</div>
            <div className="hr-logo-sub">บริษัท ดีดี เซอร์วิส แอนด์ ทรานสปอร์ต</div>
          </div>
        </div>
        <nav className="hr-nav">
          {visibleMenus.map((m) => (
            <Link
              key={m.key}
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
            <div className="hr-sidebar-user-role">{user.role === 'admin' ? '👑 Administrator' : user.role}</div>
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
            <NotificationBell />
            <Link href="/hr/chat" className="hr-btn hr-btn-icon" title="แชท AI">💬</Link>
            <button className="hr-btn hr-btn-icon" title="ออกจากระบบ" onClick={logout}>⏻</button>
          </div>
        </header>
        <main className="hr-content">{children}</main>
        <nav className="hr-mobile-nav">
          {visibleMenus.slice(0, 5).map((m) => (
            <Link key={m.key} href={m.href} className={`hr-mobile-nav-item${pathname === m.href ? ' active' : ''}`}>
              <span>{m.icon}</span>
              <small>{m.label}</small>
            </Link>
          ))}
          {visibleMenus.length > 5 && (
            <details className="hr-mobile-more">
              <summary>☰<small>เมนู</small></summary>
              <div className="hr-mobile-menu-sheet">
                {visibleMenus.slice(5).map((m) => (
                  <Link key={m.key} href={m.href} className={pathname === m.href ? 'active' : ''}>{m.icon} {m.label}</Link>
                ))}
              </div>
            </details>
          )}
        </nav>
      </div>
    </div>
  );
}
