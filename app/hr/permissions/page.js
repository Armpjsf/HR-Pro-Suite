'use client';

import { useEffect, useState } from 'react';
import { authHeaders } from '@/components/hr/exportUtils';
import { HR_MENUS } from '@/lib/hr-menus';

const MENU_DEFS = HR_MENUS.filter((m) => m.key !== 'permissions'); // สิทธิ์จัดการสิทธิ์ = admin เท่านั้น

export default function PermissionsPage() {
  const [roles, setRoles] = useState(null);
  const [newRole, setNewRole] = useState('');
  const [toast, setToast] = useState(null);

  const showToast = (m) => { setToast(m); setTimeout(() => setToast(null), 2500); };

  const load = () => fetch('/api/hr/permissions', { headers: authHeaders() })
    .then((r) => r.json()).then((d) => setRoles(d.roles || [])).catch(() => {});

  useEffect(() => { load(); }, []);

  if (!roles) return <div className="hr-empty">กำลังโหลด...</div>;

  const isAll = (menus) => menus.includes('__all__');
  const has = (menus, key) => isAll(menus) || menus.includes(key);

  const setRoleMenus = (role, menus) => setRoles((rs) => rs.map((r) => r.role === role ? { ...r, menus } : r));

  const toggle = (role, key) => {
    const r = roles.find((x) => x.role === role);
    let menus = isAll(r.menus) ? MENU_DEFS.map((m) => m.key) : [...r.menus];
    menus = menus.includes(key) ? menus.filter((k) => k !== key) : [...menus, key];
    setRoleMenus(role, menus);
  };

  const toggleAll = (role) => {
    const r = roles.find((x) => x.role === role);
    setRoleMenus(role, isAll(r.menus) ? [] : ['__all__']);
  };

  const save = async (role) => {
    const r = roles.find((x) => x.role === role);
    const res = await fetch('/api/hr/permissions', {
      method: 'PUT', headers: authHeaders(true), body: JSON.stringify({ role, menus: r.menus }),
    });
    showToast(res.ok ? `บันทึกสิทธิ์ ${role} แล้ว` : 'บันทึกไม่สำเร็จ');
  };

  const addRole = () => {
    const name = newRole.trim();
    if (!name || name === 'admin' || roles.some((r) => r.role === name)) return;
    setRoles((rs) => [...rs, { role: name, menus: [] }]);
    setNewRole('');
  };

  return (
    <div>
      <div className="hr-card" style={{ marginBottom: 16 }}>
        <p style={{ margin: 0, fontSize: 13, color: '#5b6478' }}>
          กำหนดว่าแต่ละ role เข้าเมนูไหนได้ — <b>admin</b> เข้าได้ทุกเมนูเสมอ ·
          การกั้นมีผลทั้งการซ่อนเมนูและการเรียก API (ปลอดภัยจริง) ·
          ตั้ง role ให้พนักงานได้ที่หน้า “ตั้งค่าผู้ใช้งาน”
        </p>
      </div>

      <div className="hr-toolbar">
        <input className="hr-search" placeholder="เพิ่ม role ใหม่ เช่น accounting, manager" value={newRole}
          onChange={(e) => setNewRole(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addRole()} />
        <button className="hr-btn hr-btn-primary" onClick={addRole}>+ เพิ่ม role</button>
      </div>

      {roles.map((r) => (
        <div className="hr-card" key={r.role} style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <h3 className="hr-section-title" style={{ margin: 0 }}>
              👤 {r.role} <span className="hr-badge hr-badge-purple">{isAll(r.menus) ? 'ทุกเมนู' : `${r.menus.length} เมนู`}</span>
            </h3>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="hr-btn" onClick={() => toggleAll(r.role)}>{isAll(r.menus) ? 'ยกเลิกทุกเมนู' : 'เลือกทุกเมนู'}</button>
              <button className="hr-btn hr-btn-primary" onClick={() => save(r.role)}>💾 บันทึก</button>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 6 }}>
            {MENU_DEFS.map((m) => (
              <label key={m.key} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, cursor: 'pointer', padding: '4px 6px' }}>
                <input type="checkbox" checked={has(r.menus, m.key)} onChange={() => toggle(r.role, m.key)} />
                <span>{m.icon} {m.label}</span>
              </label>
            ))}
          </div>
        </div>
      ))}

      {toast && <div className="hr-toast">{toast}</div>}
    </div>
  );
}
