'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';

function authHeaders(json = false) {
  const token = localStorage.getItem('hr-token');
  return {
    Authorization: `Bearer ${token}`,
    ...(json ? { 'Content-Type': 'application/json' } : {}),
  };
}

export default function UsersPage() {
  const [user, setUser] = useState(null);
  const [activeTab, setActiveTab] = useState('users');
  const [users, setUsers] = useState([]);
  const [lineMappings, setLineMappings] = useState({});
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [mounted, setMounted] = useState(false);
  const router = useRouter();

  // Form state
  const [formName, setFormName] = useState('');
  const [formUsername, setFormUsername] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [formRole, setFormRole] = useState('employee');
  const [formDepartment, setFormDepartment] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formEmployeeId, setFormEmployeeId] = useState('');

  const loadData = useCallback(async () => {
    try {
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
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    setMounted(true);
    const storedUser = localStorage.getItem('hr-user');
    if (!storedUser) { router.push('/'); return; }
    const parsed = JSON.parse(storedUser);
    if (parsed.role !== 'admin') {
      router.push('/chat');
      return;
    }
    setUser(parsed);
    loadData();
  }, [router, loadData]);

  function showToastMsg(message, type = 'success') {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }

  function handleAddUser() {
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

  function handleEditUser(u) {
    setEditingUser(u);
    setFormName(u.name);
    setFormUsername(u.username);
    setFormPassword('');
    setFormRole(u.role);
    setFormDepartment(u.department || '');
    setFormEmail(u.email || '');
    setFormEmployeeId(u.employeeId || '');
    setShowModal(true);
  }

  async function handleSaveUser() {
    if (!formName || !formUsername) {
      showToastMsg('กรุณากรอกข้อมูลให้ครบ', 'error');
      return;
    }
    if (!editingUser && !formPassword) {
      showToastMsg('กรุณากำหนดรหัสผ่าน', 'error');
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

      const res = await fetch(
        editingUser ? `/api/users/${editingUser.id}` : '/api/users',
        {
          method: editingUser ? 'PUT' : 'POST',
          headers: authHeaders(true),
          body: JSON.stringify(payload),
        }
      );
      const data = await res.json();

      if (!res.ok) {
        showToastMsg(data.error || 'บันทึกไม่สำเร็จ', 'error');
        return;
      }

      showToastMsg(editingUser ? 'อัพเดทผู้ใช้สำเร็จ' : 'เพิ่มผู้ใช้สำเร็จ');
      setShowModal(false);
      await loadData();
    } catch {
      showToastMsg('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteUser(userId) {
    if (!confirm('ต้องการลบผู้ใช้นี้หรือไม่?')) return;
    try {
      const res = await fetch(`/api/users/${userId}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      const data = await res.json();
      if (!res.ok) {
        showToastMsg(data.error || 'ลบไม่สำเร็จ', 'error');
        return;
      }
      showToastMsg('ลบผู้ใช้สำเร็จ');
      await loadData();
    } catch {
      showToastMsg('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้', 'error');
    }
  }

  async function handleUnlinkLine(lineId) {
    if (!confirm('ต้องการยกเลิกการผูกบัญชี LINE นี้หรือไม่?')) return;
    try {
      const res = await fetch(`/api/line/mappings/${encodeURIComponent(lineId)}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      const data = await res.json();
      if (!res.ok) {
        showToastMsg(data.error || 'ยกเลิกไม่สำเร็จ', 'error');
        return;
      }
      showToastMsg('ยกเลิกการผูก LINE สำเร็จ');
      await loadData();
    } catch {
      showToastMsg('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้', 'error');
    }
  }

  const lineEntries = Object.entries(lineMappings);

  if (!mounted || !user) return null;

  return (
    <div className="admin-layout">
      <header className="admin-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button className="btn btn-secondary btn-sm" onClick={() => router.push('/admin')}>
            ← กลับ
          </button>
          <h2 style={{ fontSize: '18px', fontWeight: 700 }}>👥 จัดการผู้ใช้</h2>
        </div>
        <button className="btn btn-primary" onClick={handleAddUser}>
          ➕ เพิ่มผู้ใช้ใหม่
        </button>
      </header>

      <div className="admin-content">
        {/* Tabs */}
        <div className="tabs">
          <button className={`tab ${activeTab === 'users' ? 'active' : ''}`} onClick={() => setActiveTab('users')}>
            👥 ผู้ใช้ระบบ ({users.length})
          </button>
          <button className={`tab ${activeTab === 'line' ? 'active' : ''}`} onClick={() => setActiveTab('line')}>
            📱 LINE Mapping ({lineEntries.length})
          </button>
        </div>

        {/* Users Tab */}
        {activeTab === 'users' && (
          <div className="glass-card" style={{ padding: '24px', overflow: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>ผู้ใช้</th>
                  <th>Username</th>
                  <th>บทบาท</th>
                  <th>แผนก</th>
                  <th>รหัสพนักงาน</th>
                  <th>จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ fontSize: '20px' }}>{u.avatar}</span>
                        <div>
                          <div style={{ fontWeight: 600 }}>{u.name}</div>
                          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td><code style={{ fontSize: '13px' }}>{u.username}</code></td>
                    <td><span className={`role-badge ${u.role}`}>{u.role}</span></td>
                    <td>{u.department}</td>
                    <td>{u.employeeId}</td>
                    <td>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button className="btn btn-secondary btn-sm" onClick={() => handleEditUser(u)}>✏️</button>
                        <button
                          className="btn btn-danger btn-sm"
                          onClick={() => handleDeleteUser(u.id)}
                          disabled={u.id === user.id}
                          title={u.id === user.id ? 'ลบบัญชีตัวเองไม่ได้' : 'ลบผู้ใช้'}
                        >
                          🗑️
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* LINE Mapping Tab */}
        {activeTab === 'line' && (
          <div className="glass-card" style={{ padding: '24px', overflow: 'auto' }}>
            <div style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                พนักงานที่ผูก LINE: {lineEntries.length} คน
              </span>
            </div>
            {lineEntries.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '32px', color: 'var(--text-muted)' }}>
                <div style={{ fontSize: '40px', marginBottom: '12px' }}>📱</div>
                <p>ยังไม่มีพนักงานผูกบัญชี LINE — พนักงานพิมพ์ &quot;ลงทะเบียน [รหัสพนักงาน]&quot; ใน LINE Bot เพื่อผูกบัญชี</p>
              </div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>LINE User ID</th>
                    <th>พนักงาน</th>
                    <th>บทบาท</th>
                    <th>วันที่ลงทะเบียน</th>
                    <th>จัดการ</th>
                  </tr>
                </thead>
                <tbody>
                  {lineEntries.map(([lineId, info]) => (
                    <tr key={lineId}>
                      <td><code style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{lineId.slice(0, 12)}...</code></td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{info.name}</div>
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{info.employeeId}</div>
                      </td>
                      <td><span className={`role-badge ${info.role}`}>{info.role}</span></td>
                      <td style={{ fontSize: '13px' }}>{info.registeredAt ? new Date(info.registeredAt).toLocaleDateString('th-TH') : '-'}</td>
                      <td>
                        <button className="btn btn-danger btn-sm" onClick={() => handleUnlinkLine(lineId)}>
                          ✕ ยกเลิก
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* Add/Edit User Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="glass-card modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editingUser ? '✏️ แก้ไขผู้ใช้' : '➕ เพิ่มผู้ใช้ใหม่'}</h3>
              <button className="modal-close" onClick={() => setShowModal(false)}>✕</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div className="input-group">
                <label>ชื่อ-นามสกุล</label>
                <input className="input-field" value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="สมชาย ใจดี" />
              </div>
              <div className="input-group">
                <label>Username</label>
                <input className="input-field" value={formUsername} onChange={(e) => setFormUsername(e.target.value)} placeholder="somchai" />
              </div>
              <div className="input-group">
                <label>{editingUser ? 'รหัสผ่านใหม่ (เว้นว่างถ้าไม่เปลี่ยน)' : 'รหัสผ่าน'}</label>
                <input className="input-field" type="password" value={formPassword} onChange={(e) => setFormPassword(e.target.value)} placeholder="อย่างน้อย 6 ตัวอักษร" />
              </div>
              {!editingUser && (
                <div className="input-group">
                  <label>รหัสพนักงาน (เว้นว่างให้ระบบสร้างอัตโนมัติ)</label>
                  <input className="input-field" value={formEmployeeId} onChange={(e) => setFormEmployeeId(e.target.value)} placeholder="EMP001" />
                </div>
              )}
              <div className="input-group">
                <label>บทบาท</label>
                <select className="input-field" value={formRole} onChange={(e) => setFormRole(e.target.value)}>
                  <option value="employee">Employee</option>
                  <option value="hr">HR</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div className="input-group">
                <label>แผนก</label>
                <input className="input-field" value={formDepartment} onChange={(e) => setFormDepartment(e.target.value)} placeholder="Engineering" />
              </div>
              <div className="input-group">
                <label>Email</label>
                <input className="input-field" type="email" value={formEmail} onChange={(e) => setFormEmail(e.target.value)} placeholder="somchai@company.com" />
              </div>

              <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
                <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleSaveUser} disabled={saving}>
                  {saving ? '⏳ กำลังบันทึก...' : '💾 บันทึก'}
                </button>
                <button className="btn btn-secondary" onClick={() => setShowModal(false)}>
                  ยกเลิก
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={`toast ${toast.type}`}>
          {toast.type === 'success' ? '✅' : '❌'} {toast.message}
        </div>
      )}
    </div>
  );
}
