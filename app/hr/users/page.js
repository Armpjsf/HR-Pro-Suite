'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { authHeaders } from '@/components/hr/exportUtils';

const ROLE_BADGES = {
  admin: 'red',
  hr: 'purple',
  employee: 'gray',
  accounting: 'blue',
  manager: 'green',
};

function badgeColor(role) {
  return ROLE_BADGES[role] || 'gray';
}

export default function UsersPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState(null);
  const [activeTab, setActiveTab] = useState('users');
  const [users, setUsers] = useState([]);
  const [lineMappings, setLineMappings] = useState({});
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  const [formName, setFormName] = useState('');
  const [formUsername, setFormUsername] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [formRole, setFormRole] = useState('employee');
  const [formDepartment, setFormDepartment] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formEmployeeId, setFormEmployeeId] = useState('');

  const loadData = useCallback(async () => {
    const [usersRes, lineRes] = await Promise.all([
      fetch('/api/users', { headers: authHeaders() }),
      fetch('/api/line/mappings', { headers: authHeaders() }),
    ]);
    if (usersRes.ok) {
      const data = await usersRes.json();
      setUsers(data.users || []);
    }
    if (lineRes.ok) {
      const data = await lineRes.json();
      setLineMappings(data.mappings || {});
    }
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem('hr-user');
    if (!stored) { router.push('/'); return; }
    const parsed = JSON.parse(stored);
    if (parsed.role !== 'admin') { router.push('/hr'); return; }
    setCurrentUser(parsed);
    loadData().catch(() => {});
  }, [loadData, router]);

  function showToast(message, type = 'success') {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }

  function openAdd() {
    setEditingUser(null);
    setFormName('');
    setFormUsername('');
    setFormPassword('');
    setFormRole('employee');
    setFormDepartment('');
    setFormEmail('');
    setFormEmployeeId('');
    setShowModal(true);
  }

  function openEdit(user) {
    setEditingUser(user);
    setFormName(user.name || '');
    setFormUsername(user.username || '');
    setFormPassword('');
    setFormRole(user.role || 'employee');
    setFormDepartment(user.department || '');
    setFormEmail(user.email || '');
    setFormEmployeeId(user.employeeId || '');
    setShowModal(true);
  }

  async function saveUser() {
    if (!formName || !formUsername) {
      showToast('กรุณากรอกชื่อและ username', 'error');
      return;
    }
    if (!editingUser && !formPassword) {
      showToast('กรุณากำหนดรหัสผ่าน', 'error');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: formName,
        username: formUsername,
        role: formRole,
        department: formDepartment,
        email: formEmail,
      };
      if (formPassword) payload.password = formPassword;
      if (!editingUser && formEmployeeId) payload.employeeId = formEmployeeId;

      const res = await fetch(editingUser ? `/api/users/${editingUser.id}` : '/api/users', {
        method: editingUser ? 'PUT' : 'POST',
        headers: authHeaders(true),
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'บันทึกไม่สำเร็จ', 'error');
        return;
      }
      setShowModal(false);
      showToast(editingUser ? 'แก้ไขผู้ใช้แล้ว' : 'เพิ่มผู้ใช้แล้ว');
      await loadData();
    } catch {
      showToast('เชื่อมต่อไม่สำเร็จ', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function deleteUser(user) {
    if (!confirm(`ต้องการลบผู้ใช้ ${user.name} หรือไม่?`)) return;
    const res = await fetch(`/api/users/${user.id}`, { method: 'DELETE', headers: authHeaders() });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'ลบไม่สำเร็จ', 'error');
      return;
    }
    showToast('ลบผู้ใช้แล้ว');
    await loadData();
  }

  async function unlinkLine(lineId) {
    if (!confirm('ต้องการยกเลิกการผูกบัญชี LINE นี้หรือไม่?')) return;
    const res = await fetch(`/api/line/mappings/${encodeURIComponent(lineId)}`, { method: 'DELETE', headers: authHeaders() });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'ยกเลิกไม่สำเร็จ', 'error');
      return;
    }
    showToast('ยกเลิกการผูก LINE แล้ว');
    await loadData();
  }

  if (!currentUser) return null;

  const lineEntries = Object.entries(lineMappings);

  return (
    <div>
      <div className="hr-stat-row">
        <div className="hr-stat-card">
          <div className="hr-stat-icon">👥</div>
          <div><div className="hr-stat-value">{users.length}</div><div className="hr-stat-label">ผู้ใช้ระบบ</div></div>
        </div>
        <div className="hr-stat-card">
          <div className="hr-stat-icon">🛡️</div>
          <div><div className="hr-stat-value">{users.filter((u) => u.role !== 'employee').length}</div><div className="hr-stat-label">Admin / HR / Role พิเศษ</div></div>
        </div>
        <div className="hr-stat-card">
          <div className="hr-stat-icon">📱</div>
          <div><div className="hr-stat-value">{lineEntries.length}</div><div className="hr-stat-label">ผูก LINE แล้ว</div></div>
        </div>
      </div>

      <div className="hr-card" style={{ marginBottom: 14 }}>
        <div className="hr-section-title">ตั้งค่าผู้ใช้งานระบบ</div>
        <div style={{ color: '#5b6478', fontSize: 13, lineHeight: 1.6 }}>
          หน้านี้ใช้สำหรับ username, password และ role สิทธิ์ระบบเท่านั้น ส่วนข้อมูลพนักงานจริง เช่น สาขา ตำแหน่ง หัวหน้า และข้อมูลเงินเดือน ให้แก้ที่หน้า <Link href="/hr/employees">พนักงาน</Link>
        </div>
      </div>

      <div className="hr-toolbar">
        <button className={`hr-tab${activeTab === 'users' ? ' active' : ''}`} onClick={() => setActiveTab('users')}>👥 ผู้ใช้ระบบ</button>
        <button className={`hr-tab${activeTab === 'line' ? ' active' : ''}`} onClick={() => setActiveTab('line')}>📱 LINE Mapping</button>
        <button className="hr-btn hr-btn-primary" onClick={openAdd}>+ เพิ่มผู้ใช้</button>
      </div>

      {activeTab === 'users' && (
        <div className="hr-table-wrap">
          <table className="hr-table">
            <thead>
              <tr>
                <th>ผู้ใช้</th>
                <th>Username</th>
                <th>บทบาท</th>
                <th>แผนก</th>
                <th>รหัสพนักงาน</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 20 }}>{user.avatar || '👤'}</span>
                      <div>
                        <div style={{ fontWeight: 700 }}>{user.name}</div>
                        <div style={{ fontSize: 12, color: '#9aa1b5' }}>{user.email || '-'}</div>
                      </div>
                    </div>
                  </td>
                  <td><code>{user.username}</code></td>
                  <td><span className={`hr-badge hr-badge-${badgeColor(user.role)}`}>{user.role}</span></td>
                  <td>{user.department || '-'}</td>
                  <td>{user.employeeId || '-'}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button className="hr-btn hr-btn-icon" title="แก้ไข" onClick={() => openEdit(user)}>✏️</button>
                    <button className="hr-btn hr-btn-icon hr-btn-danger" title="ลบ" disabled={user.id === currentUser.id} onClick={() => deleteUser(user)} style={{ marginLeft: 6 }}>🗑️</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {users.length === 0 && <div className="hr-empty">ยังไม่มีข้อมูล</div>}
        </div>
      )}

      {activeTab === 'line' && (
        <div className="hr-table-wrap">
          <table className="hr-table">
            <thead>
              <tr>
                <th>LINE User ID</th>
                <th>พนักงาน</th>
                <th>บทบาท</th>
                <th>วันที่ลงทะเบียน</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {lineEntries.map(([lineId, info]) => (
                <tr key={lineId}>
                  <td><code>{lineId.slice(0, 16)}...</code></td>
                  <td>
                    <div style={{ fontWeight: 700 }}>{info.name}</div>
                    <div style={{ fontSize: 12, color: '#9aa1b5' }}>{info.employeeId}</div>
                  </td>
                  <td><span className={`hr-badge hr-badge-${badgeColor(info.role)}`}>{info.role}</span></td>
                  <td>{info.registeredAt ? new Date(info.registeredAt).toLocaleDateString('th-TH') : '-'}</td>
                  <td style={{ textAlign: 'right' }}><button className="hr-btn hr-btn-danger" onClick={() => unlinkLine(lineId)}>ยกเลิก</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {lineEntries.length === 0 && <div className="hr-empty">ยังไม่มีพนักงานผูกบัญชี LINE</div>}
        </div>
      )}

      {showModal && (
        <div className="hr-modal-overlay">
          <div className="hr-modal" onClick={(e) => e.stopPropagation()}>
            <div className="hr-modal-header">
              <div className="hr-modal-title">{editingUser ? 'แก้ไขผู้ใช้' : 'เพิ่มผู้ใช้'}</div>
              <button className="hr-modal-close" onClick={() => setShowModal(false)}>✕</button>
            </div>
            <div className="hr-field"><label>ชื่อ-นามสกุล *</label><input className="hr-input" value={formName} onChange={(e) => setFormName(e.target.value)} /></div>
            <div className="hr-field"><label>Username *</label><input className="hr-input" value={formUsername} onChange={(e) => setFormUsername(e.target.value)} /></div>
            <div className="hr-field"><label>{editingUser ? 'รหัสผ่านใหม่ (เว้นว่างถ้าไม่เปลี่ยน)' : 'รหัสผ่าน *'}</label><input className="hr-input" type="password" value={formPassword} onChange={(e) => setFormPassword(e.target.value)} /></div>
            {!editingUser && <div className="hr-field"><label>รหัสพนักงาน (เว้นว่างให้ระบบสร้าง)</label><input className="hr-input" value={formEmployeeId} onChange={(e) => setFormEmployeeId(e.target.value)} /></div>}
            <div className="hr-field">
              <label>บทบาท *</label>
              <input className="hr-input" list="role-options" value={formRole} onChange={(e) => setFormRole(e.target.value.toLowerCase())} />
              <datalist id="role-options">
                <option value="employee" />
                <option value="hr" />
                <option value="admin" />
                <option value="accounting" />
                <option value="manager" />
              </datalist>
            </div>
            <div className="hr-field"><label>แผนก</label><input className="hr-input" value={formDepartment} onChange={(e) => setFormDepartment(e.target.value)} /></div>
            <div className="hr-field"><label>Email</label><input className="hr-input" type="email" value={formEmail} onChange={(e) => setFormEmail(e.target.value)} /></div>
            <div className="hr-modal-actions">
              <button className="hr-btn" onClick={() => setShowModal(false)}>ยกเลิก</button>
              <button className="hr-btn hr-btn-primary" onClick={saveUser} disabled={saving}>{saving ? 'กำลังบันทึก...' : 'บันทึก'}</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className={`hr-toast ${toast.type}`}>{toast.message}</div>}
    </div>
  );
}
