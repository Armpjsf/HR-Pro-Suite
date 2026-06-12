'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const router = useRouter();

  useEffect(() => {
    setMounted(true);
    // Check if already logged in
    const token = getCookie('hr-token');
    if (token) {
      router.push('/chat');
    }
    // Register service worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, [router]);

  function getCookie(name) {
    if (typeof document === 'undefined') return null;
    const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
    return match ? match[2] : null;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'เข้าสู่ระบบไม่สำเร็จ');
        setLoading(false);
        return;
      }

      // Store user info
      localStorage.setItem('hr-user', JSON.stringify(data.user));
      localStorage.setItem('hr-token', data.token);
      
      router.push('/chat');
    } catch (err) {
      setError('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้');
      setLoading(false);
    }
  }

  if (!mounted) return null;

  return (
    <div className="login-page">
      {/* Decorative orbs */}
      <div style={{
        position: 'fixed', top: '-20%', left: '-10%', width: '500px', height: '500px',
        background: 'radial-gradient(circle, rgba(124,58,237,0.15), transparent 70%)',
        borderRadius: '50%', pointerEvents: 'none', zIndex: 0, animation: 'float 8s ease-in-out infinite'
      }} />
      <div style={{
        position: 'fixed', bottom: '-20%', right: '-10%', width: '600px', height: '600px',
        background: 'radial-gradient(circle, rgba(16,185,129,0.1), transparent 70%)',
        borderRadius: '50%', pointerEvents: 'none', zIndex: 0, animation: 'float 10s ease-in-out infinite reverse'
      }} />

      <div className="login-container">
        <div className="glass-card login-card">
          <div className="login-logo">
            <div className="logo-icon">🤖</div>
            <h1>HR AI Assistant</h1>
            <p>ระบบตอบข้อมูล HR อัจฉริยะ</p>
          </div>

          <form className="login-form" onSubmit={handleSubmit}>
            {error && <div className="login-error">{error}</div>}

            <div className="input-group">
              <label htmlFor="username">ชื่อผู้ใช้</label>
              <input
                id="username"
                type="text"
                className="input-field"
                placeholder="กรอก username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                required
              />
            </div>

            <div className="input-group">
              <label htmlFor="password">รหัสผ่าน</label>
              <input
                id="password"
                type="password"
                className="input-field"
                placeholder="กรอกรหัสผ่าน"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>

            <button
              type="submit"
              className="btn btn-primary btn-lg"
              disabled={loading}
            >
              {loading ? 'กำลังเข้าสู่ระบบ...' : '🔐 เข้าสู่ระบบ'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
