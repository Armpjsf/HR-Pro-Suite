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
    const token = getCookie('hr-token');
    if (token) {
      try {
        const storedUser = localStorage.getItem('hr-user');
        const u = storedUser ? JSON.parse(storedUser) : null;
        router.push(u?.role === 'admin' || u?.role === 'hr' ? '/hr' : '/me');
      } catch { router.push('/me'); }
    }
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
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
      if (!res.ok) { setError(data.error || 'เข้าสู่ระบบไม่สำเร็จ'); setLoading(false); return; }
      localStorage.setItem('hr-user', JSON.stringify(data.user));
      localStorage.setItem('hr-token', data.token);
      router.push(data.user.role === 'admin' || data.user.role === 'hr' ? '/hr' : '/me');
    } catch {
      setError('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้');
      setLoading(false);
    }
  }

  if (!mounted) return null;

  return (
    <div className="lg-root">
      <div className="lg-orb lg-orb-1" />
      <div className="lg-orb lg-orb-2" />

      <div className="lg-card">
        <div className="lg-brand">
          <div className="lg-logo">
            <img src="/brand/hr-pro-logo.svg" alt="HR Pro Suite" />
          </div>
          <div>
            <div className="lg-title">HR Pro Suite</div>
            <div className="lg-sub">All-in-one HR Management</div>
          </div>
        </div>

        <h1 className="lg-welcome">ยินดีต้อนรับกลับ 👋</h1>
        <p className="lg-welcome-sub">เข้าสู่ระบบเพื่อเริ่มใช้งาน</p>

        <form onSubmit={handleSubmit}>
          {error && <div className="lg-error">{error}</div>}

          <div className="lg-field">
            <label htmlFor="username">ชื่อผู้ใช้</label>
            <input id="username" type="text" placeholder="กรอก username" value={username}
              onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
          </div>

          <div className="lg-field">
            <label htmlFor="password">รหัสผ่าน</label>
            <input id="password" type="password" placeholder="กรอกรหัสผ่าน" value={password}
              onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </div>

          <button type="submit" className="lg-btn" disabled={loading}>
            {loading ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ'}
          </button>
        </form>
      </div>

      <style jsx>{`
        .lg-root {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
          position: relative;
          overflow: hidden;
          background: linear-gradient(135deg, #eef0fb 0%, #e7ecfb 40%, #eaf6ff 100%);
          font-family: 'Inter', 'Noto Sans Thai', sans-serif;
        }
        .lg-orb { position: fixed; border-radius: 50%; pointer-events: none; z-index: 0; filter: blur(8px); }
        .lg-orb-1 { top: -15%; left: -8%; width: 460px; height: 460px;
          background: radial-gradient(circle, rgba(109,94,245,0.22), transparent 70%); }
        .lg-orb-2 { bottom: -18%; right: -8%; width: 520px; height: 520px;
          background: radial-gradient(circle, rgba(56,189,248,0.20), transparent 70%); }

        .lg-card {
          position: relative;
          z-index: 1;
          width: 100%;
          max-width: 400px;
          background: #fff;
          border-radius: 24px;
          box-shadow: 0 20px 50px rgba(16, 24, 40, 0.12);
          padding: 32px 28px;
        }
        .lg-brand { display: flex; align-items: center; gap: 12px; margin-bottom: 26px; }
        .lg-logo {
          width: 46px; height: 46px; border-radius: 13px;
          background: #fff;
          display: flex; align-items: center; justify-content: center;
          overflow: hidden;
          box-shadow: 0 8px 18px rgba(37, 99, 235, 0.18);
        }
        .lg-logo img { width: 100%; height: 100%; display: block; }
        .lg-title { font-weight: 800; font-size: 18px; background: linear-gradient(90deg,#38bdf8,#6d5ef5);
          -webkit-background-clip: text; background-clip: text; color: transparent; }
        .lg-sub { font-size: 11px; color: #9aa1b5; }

        .lg-welcome { font-size: 22px; font-weight: 800; color: #1d2433; margin: 0 0 4px; }
        .lg-welcome-sub { font-size: 13.5px; color: #9aa1b5; margin: 0 0 22px; }

        .lg-field { margin-bottom: 14px; }
        .lg-field label { display: block; font-size: 12.5px; font-weight: 600; color: #5b6478; margin-bottom: 6px; }
        .lg-field input {
          width: 100%; padding: 12px 14px;
          border: 1px solid #e7e9f4; border-radius: 12px;
          background: #f6f7fc; font-size: 14px; font-family: inherit; color: #1d2433;
          box-sizing: border-box;
        }
        .lg-field input:focus { outline: none; border-color: #6d5ef5; background: #fff; }

        .lg-btn {
          width: 100%; margin-top: 8px; padding: 13px;
          border: none; border-radius: 12px;
          background: linear-gradient(135deg, #6d5ef5, #8b7cf8);
          color: #fff; font-size: 15px; font-weight: 700; font-family: inherit; cursor: pointer;
          box-shadow: 0 8px 18px rgba(109, 94, 245, 0.35);
        }
        .lg-btn:disabled { opacity: 0.6; }

        .lg-error {
          background: #fee2e2; color: #b91c1c; border: 1px solid #fecaca;
          padding: 10px 14px; border-radius: 10px; font-size: 13px; margin-bottom: 14px;
        }
      `}</style>
    </div>
  );
}
