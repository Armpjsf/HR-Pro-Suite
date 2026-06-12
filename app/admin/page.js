'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function AdminPage() {
  const [user, setUser] = useState(null);
  const [mounted, setMounted] = useState(false);
  const [statsData, setStatsData] = useState({ documents: 0, users: 0, chatsToday: 0, lineUsers: 0 });
  const [recentActivity, setRecentActivity] = useState([]);
  const router = useRouter();

  useEffect(() => {
    setMounted(true);
    const storedUser = localStorage.getItem('hr-user');
    if (!storedUser) {
      router.push('/');
      return;
    }
    const parsed = JSON.parse(storedUser);
    if (parsed.role !== 'admin' && parsed.role !== 'hr') {
      router.push('/chat');
      return;
    }
    setUser(parsed);

    // โหลดสถิติจริง
    const token = localStorage.getItem('hr-token');
    fetch('/api/stats', { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) {
          setStatsData(data.stats);
          setRecentActivity(data.recentActivity || []);
        }
      })
      .catch(() => {});
  }, [router]);

  if (!mounted || !user) return null;

  const stats = [
    { icon: '📄', label: 'เอกสารทั้งหมด', value: String(statsData.documents), color: 'purple' },
    { icon: '👥', label: 'ผู้ใช้ระบบ', value: String(statsData.users), color: 'emerald' },
    { icon: '💬', label: 'คำถามวันนี้', value: String(statsData.chatsToday), color: 'amber' },
    { icon: '📱', label: 'LINE Users', value: String(statsData.lineUsers), color: 'pink' },
  ];

  return (
    <div className="admin-layout">
      <header className="admin-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button className="btn btn-secondary btn-sm" onClick={() => router.push('/chat')}>
            ← กลับแชท
          </button>
          <h2 style={{ fontSize: '18px', fontWeight: 700 }}>⚙️ แดชบอร์ดผู้ดูแล</h2>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span className={`role-badge ${user.role}`}>{user.role}</span>
          <span style={{ fontSize: '14px' }}>{user.name}</span>
        </div>
      </header>

      <div className="admin-content">
        {/* Stats */}
        <div className="admin-grid">
          {stats.map((stat, i) => (
            <div key={i} className="glass-card stat-card">
              <div className={`stat-icon ${stat.color}`}>{stat.icon}</div>
              <div>
                <div className="stat-value">{stat.value}</div>
                <div className="stat-label">{stat.label}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Quick Actions */}
        <div className="glass-card" style={{ padding: '24px', marginBottom: '24px' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '16px' }}>🚀 เมนูด่วน</h3>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <button className="btn btn-primary" style={{ backgroundColor: '#4f46e5', borderColor: '#4f46e5' }} onClick={() => router.push('/hr')}>
              🏢 ระบบจัดการ HR (HR Pro)
            </button>
            <button className="btn btn-primary" onClick={() => router.push('/admin/documents')}>
              📤 จัดการเอกสาร
            </button>
            <button className="btn btn-success" onClick={() => router.push('/admin/users')}>
              👥 จัดการผู้ใช้
            </button>
            <button className="btn btn-secondary" onClick={() => router.push('/chat')}>
              💬 ทดสอบแชท
            </button>
          </div>
        </div>

        {/* Recent Activity */}
        <div className="glass-card" style={{ padding: '24px' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '16px' }}>📋 กิจกรรมล่าสุด</h3>
          <table className="data-table">
            <thead>
              <tr>
                <th>เวลา</th>
                <th>ผู้ใช้</th>
                <th>กิจกรรม</th>
                <th>ช่องทาง</th>
              </tr>
            </thead>
            <tbody>
              {recentActivity.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '24px' }}>
                    ยังไม่มีกิจกรรมในระบบ
                  </td>
                </tr>
              )}
              {recentActivity.map((item, i) => (
                <tr key={i}>
                  <td style={{ color: 'var(--text-muted)' }}>{item.time}</td>
                  <td>{item.user}</td>
                  <td>{item.action}</td>
                  <td>
                    <span
                      className={`role-badge ${item.channel === 'LINE' ? 'employee' : 'hr'}`}
                      style={{ fontSize: '11px' }}
                    >
                      {item.channel === 'LINE' ? '📱 LINE' : '🌐 PWA'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
