'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { HR_MENUS } from '@/lib/hr-menus';
import { authHeaders } from '@/components/hr/exportUtils';
import NotificationBell from '@/components/NotificationBell';
import SubNavTabs from '@/components/hr/SubNavTabs';
import './hr.css';

const SUB_NAV_GROUPS = {
  '/hr/departments': [
    { href: '/hr/departments', icon: '🏢', label: 'แผนก' },
    { href: '/hr/positions', icon: '💼', label: 'ตำแหน่งงาน' },
  ],
  '/hr/positions': [
    { href: '/hr/departments', icon: '🏢', label: 'แผนก' },
    { href: '/hr/positions', icon: '💼', label: 'ตำแหน่งงาน' },
  ],
  '/hr/branches': [
    { href: '/hr/branches', icon: '🏬', label: 'ตั้งค่าสาขา' },
    { href: '/hr/locations', icon: '📍', label: 'จุดปักหมุด GPS' },
  ],
  '/hr/locations': [
    { href: '/hr/branches', icon: '🏬', label: 'ตั้งค่าสาขา' },
    { href: '/hr/locations', icon: '📍', label: 'จุดปักหมุด GPS' },
  ],
  '/hr/shifts': [
    { href: '/hr/shifts', icon: '📅', label: 'จัดกะรายวัน' },
    { href: '/hr/shift-patterns', icon: '🔄', label: 'รูปแบบกะ' },
    { href: '/hr/settings', icon: '⚙️', label: 'เวลาทำงาน' },
  ],
  '/hr/shift-patterns': [
    { href: '/hr/shifts', icon: '📅', label: 'จัดกะรายวัน' },
    { href: '/hr/shift-patterns', icon: '🔄', label: 'รูปแบบกะ' },
    { href: '/hr/settings', icon: '⚙️', label: 'เวลาทำงาน' },
  ],
  '/hr/settings': [
    { href: '/hr/shifts', icon: '📅', label: 'จัดกะรายวัน' },
    { href: '/hr/shift-patterns', icon: '🔄', label: 'รูปแบบกะ' },
    { href: '/hr/settings', icon: '⚙️', label: 'เวลาทำงาน' },
  ],
  '/hr/leave': [
    { href: '/hr/leave', icon: '🏖️', label: 'การลา' },
    { href: '/hr/leave-types', icon: '🗒️', label: 'ประเภทการลา' },
  ],
  '/hr/leave-types': [
    { href: '/hr/leave', icon: '🏖️', label: 'การลา' },
    { href: '/hr/leave-types', icon: '🗒️', label: 'ประเภทการลา' },
  ],
  '/hr/document-requests': [
    { href: '/hr/document-requests', icon: '📄', label: 'คำขอเอกสารรับรอง' },
    { href: '/hr/document-assets', icon: '🔏', label: 'ลายเซ็นและตราประทับ' },
  ],
  '/hr/document-assets': [
    { href: '/hr/document-requests', icon: '📄', label: 'คำขอเอกสารรับรอง' },
    { href: '/hr/document-assets', icon: '🔏', label: 'ลายเซ็นและตราประทับ' },
  ],
  '/hr/recruitment': [
    { href: '/hr/recruitment', icon: '📣', label: 'ตำแหน่งที่เปิดรับ' },
    { href: '/hr/applicants', icon: '🧑‍💼', label: 'ผู้สมัครงาน' },
    { href: '/hr/interviews', icon: '🎙️', label: 'AI สัมภาษณ์งาน' },
  ],
  '/hr/applicants': [
    { href: '/hr/recruitment', icon: '📣', label: 'ตำแหน่งที่เปิดรับ' },
    { href: '/hr/applicants', icon: '🧑‍💼', label: 'ผู้สมัครงาน' },
    { href: '/hr/interviews', icon: '🎙️', label: 'AI สัมภาษณ์งาน' },
  ],
  '/hr/interviews': [
    { href: '/hr/recruitment', icon: '📣', label: 'ตำแหน่งที่เปิดรับ' },
    { href: '/hr/applicants', icon: '🧑‍💼', label: 'ผู้สมัครงาน' },
    { href: '/hr/interviews', icon: '🎙️', label: 'AI สัมภาษณ์งาน' },
  ],
  '/hr/evaluation': [
    { href: '/hr/evaluation', icon: '🎯', label: 'ประเมินผลงาน' },
    { href: '/hr/okr', icon: '📈', label: 'เป้าหมาย OKRs' },
  ],
  '/hr/okr': [
    { href: '/hr/evaluation', icon: '🎯', label: 'ประเมินผลงาน' },
    { href: '/hr/okr', icon: '📈', label: 'เป้าหมาย OKRs' },
  ],
  '/hr/training': [
    { href: '/hr/training', icon: '🎓', label: 'หลักสูตรอบรม' },
    { href: '/hr/trips', icon: '✈️', label: 'ทริปและกิจกรรม' },
  ],
  '/hr/trips': [
    { href: '/hr/training', icon: '🎓', label: 'หลักสูตรอบรม' },
    { href: '/hr/trips', icon: '✈️', label: 'ทริปและกิจกรรม' },
  ],
};

const MENUS = HR_MENUS;
const MOBILE_PRIMARY_KEYS = ['dashboard', 'employees', 'leave', 'time', 'chat'];

function groupMenus(menus) {
  const groups = [];
  for (const menu of menus) {
    const name = menu.group || 'อื่นๆ';
    let group = groups.find((g) => g.name === name);
    if (!group) {
      group = { name, items: [] };
      groups.push(group);
    }
    group.items.push(menu);
  }
  return groups;
}

export default function HrLayout({ children }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState(null);
  const [access, setAccess] = useState(null); // { allowed, isAdmin }
  const [branches, setBranches] = useState([]);
  const [activeBranch, setActiveBranch] = useState(
    typeof window !== 'undefined' ? localStorage.getItem('hr-active-branch') || 'all' : 'all'
  );
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    typeof window !== 'undefined' ? localStorage.getItem('hr-sidebar-collapsed') === '1' : false
  );

  const toggleSidebar = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      if (typeof window !== 'undefined') {
        localStorage.setItem('hr-sidebar-collapsed', next ? '1' : '0');
      }
      return next;
    });
  };

  useEffect(() => {
    fetch('/api/hr/branches', { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => setBranches(d.items || []))
      .catch(() => {});
  }, []);

  const handleBranchChange = (bId) => {
    setActiveBranch(bId);
    if (typeof window !== 'undefined') {
      localStorage.setItem('hr-active-branch', bId);
      window.dispatchEvent(new CustomEvent('hr-branch-change', { detail: bId }));
    }
  };

  useEffect(() => {
    const storedUser = localStorage.getItem('hr-user');
    if (!storedUser) { router.push('/'); return; }
    const parsed = JSON.parse(storedUser);
    setUser(parsed);

    fetch('/api/hr/access', { headers: authHeaders() })
      .then(async (r) => {
        if (r.status === 401) {
          localStorage.removeItem('hr-user');
          localStorage.removeItem('hr-token');
          document.cookie = 'hr-token=; path=/; max-age=0';
          router.replace('/');
          return null;
        }
        return r.json();
      })
      .then((d) => {
        if (!d) return;
        if (d.role && parsed.role !== d.role) {
          const updated = { ...parsed, role: d.role };
          localStorage.setItem('hr-user', JSON.stringify(updated));
          setUser(updated);
        }
        const allowed = d.allowed ?? [];
        const canEnter = d.isAdmin || allowed === '__all__' || (Array.isArray(allowed) && allowed.length > 0);
        if (!canEnter) {
          router.replace('/me');
          return;
        }
        setAccess({ allowed, isAdmin: !!d.isAdmin });
      })
      .catch(() => router.replace('/'));
  }, [router]);

  if (!user || !access) return null;

  const isAll = access.allowed === '__all__';
  const allowedMenus = MENUS.filter((m) => {
    if (m.adminOnly) return access.isAdmin;
    if (access.isAdmin || isAll) return true;
    return access.allowed.includes(m.key);
  });

  const visibleMenus = allowedMenus.filter((m) => !m.hiddenInSidebar);

  const current = allowedMenus.find((m) => m.href === pathname) ||
    allowedMenus.find((m) => m.href !== '/hr' && pathname.startsWith(m.href));
  const pageLabel = current ? current.label : 'Dashboard';
  const groupedMenus = groupMenus(visibleMenus);
  const mobilePrimary = MOBILE_PRIMARY_KEYS
    .map((key) => visibleMenus.find((m) => m.key === key))
    .filter(Boolean);
  const mobileMore = visibleMenus.filter((m) => !mobilePrimary.some((p) => p.key === m.key));

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
      <aside className={`hr-sidebar${sidebarCollapsed ? ' collapsed' : ''}`}>
        <div className="hr-logo">
          <div className="hr-logo-icon" title="HR Pro Suite">
            <img src="/brand/hr-pro-logo.svg" alt="HR Pro Suite" />
          </div>
          {!sidebarCollapsed && (
            <div className="hr-logo-text">
              <div className="hr-logo-title">HR Pro Suite</div>
              <div className="hr-logo-sub">บริษัท ดีดี เซอร์วิส แอนด์ ทรานสปอร์ต</div>
            </div>
          )}
          <button
            type="button"
            className="hr-sidebar-toggle"
            onClick={toggleSidebar}
            title={sidebarCollapsed ? 'ขยายแถบเมนูด้านข้าง' : 'ย่อแถบเมนูเป็นไอคอน (เพิ่มพื้นที่ตาราง)'}
            aria-label={sidebarCollapsed ? 'ขยายแถบเมนูด้านข้าง' : 'ย่อแถบเมนูเป็นไอคอน'}
          >
            {sidebarCollapsed ? '»' : '«'}
          </button>
        </div>

        <nav className="hr-nav" aria-label="เมนูจัดการทรัพยากรบุคคล">
          {groupedMenus.map((group) => (
            <div className="hr-nav-group" key={group.name}>
              {!sidebarCollapsed && <div className="hr-nav-heading">{group.name}</div>}
              {group.items.map((m) => (
                <Link
                  key={m.key}
                  href={m.href}
                  title={sidebarCollapsed ? `${m.label} (${group.name})` : undefined}
                  className={`hr-nav-item${pathname === m.href ? ' active' : ''}`}
                >
                  <span className="hr-nav-icon">{m.icon}</span>
                  {!sidebarCollapsed && <span className="hr-nav-label">{m.label}</span>}
                </Link>
              ))}
            </div>
          ))}
        </nav>

        <div className="hr-sidebar-user" title={sidebarCollapsed ? `${user.name} (${user.role})` : undefined}>
          <div className="hr-sidebar-avatar">{(user.name || '?')[0]}</div>
          {!sidebarCollapsed && (
            <div className="hr-sidebar-user-meta">
              <div className="hr-sidebar-user-name">{user.name}</div>
              <div className="hr-sidebar-user-role">{user.role === 'admin' ? '👑 Administrator' : user.role}</div>
            </div>
          )}
        </div>
      </aside>

      <div className="hr-main">
        <header className="hr-topbar">
          <div className="hr-topbar-left">
            <div className="hr-breadcrumb">HR Pro Suite / {pageLabel}</div>
            <div className="hr-page-title">{pageLabel}</div>
          </div>
          <div className="hr-topbar-right">
            {branches.length > 0 && (
              <div className="hr-branch-pill">
                <span style={{ fontSize: 14 }}>🏬</span>
                <select
                  value={activeBranch}
                  onChange={(e) => handleBranchChange(e.target.value)}
                  className="hr-branch-select"
                  title="กรองข้อมูลตามสาขา"
                  aria-label="กรองข้อมูลตามสาขา"
                >
                  <option value="all">ทุกสาขา (ภาพรวม)</option>
                  {branches.map((b) => (
                    <option key={b.id} value={String(b.id)}>{b.code} · {b.name}</option>
                  ))}
                </select>
              </div>
            )}
            <Link
              href="/me"
              className="hr-btn hr-emp-mode-btn"
              title="สลับไปยังหน้าบริการตนเองของพนักงาน"
            >
              <span>👤</span> โหมดพนักงาน
            </Link>
            <span className="hr-topbar-date">{today}</span>
            <NotificationBell />
            <Link href="/hr/chat" className="hr-btn hr-btn-icon" title="แชท AI">💬</Link>
            <button className="hr-btn hr-btn-icon" title="ออกจากระบบ" onClick={logout}>⏻</button>
          </div>
        </header>
        <main className="hr-content">
          {SUB_NAV_GROUPS[pathname] && <SubNavTabs items={SUB_NAV_GROUPS[pathname]} />}
          {children}
        </main>
        <nav className="hr-mobile-nav">
          {mobilePrimary.map((m) => (
            <Link key={m.key} href={m.href} className={`hr-mobile-nav-item${pathname === m.href ? ' active' : ''}`}>
              <span>{m.icon}</span>
              <small>{m.label}</small>
            </Link>
          ))}
          {mobileMore.length > 0 && (
            <details className="hr-mobile-more">
              <summary>☰<small>เมนู</small></summary>
              <div className="hr-mobile-menu-sheet">
                {groupMenus(mobileMore).map((group) => (
                  <div className="hr-mobile-menu-group" key={group.name}>
                    <div className="hr-mobile-menu-heading">{group.name}</div>
                    {group.items.map((m) => (
                      <Link key={m.key} href={m.href} className={pathname === m.href ? 'active' : ''}>{m.icon} {m.label}</Link>
                    ))}
                  </div>
                ))}
              </div>
            </details>
          )}
        </nav>
      </div>
    </div>
  );
}
