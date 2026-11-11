'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const router = useRouter();

  useEffect(() => {
    setMounted(true);
    const token = getCookie('hr-token');
    if (token) {
      redirectByAccess().catch(() => router.push('/me'));
    }
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  }, [router]);

  function getCookie(name) {
    if (typeof document === 'undefined') return null;
    const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
    return match ? match[2] : null;
  }

  async function redirectByAccess() {
    const token = localStorage.getItem('hr-token') || getCookie('hr-token');
    const storedUser = localStorage.getItem('hr-user');
    const u = storedUser ? JSON.parse(storedUser) : null;
    if (token) {
      const res = await fetch('/api/hr/access', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const d = await res.json();
        if (u && d.role && u.role !== d.role) {
          localStorage.setItem('hr-user', JSON.stringify({ ...u, role: d.role }));
        }
        const allowed = d.allowed;
        const canEnter = d.isAdmin || allowed === '__all__' || (Array.isArray(allowed) && allowed.length > 0);
        router.push(canEnter ? '/hr' : '/me');
        return;
      }
    }
    router.push('/me');
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
      await redirectByAccess();
    } catch {
      setError('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้');
      setLoading(false);
    }
  }

  if (!mounted) return null;

  return (
    <div className="lg-root">
      {/* 3D Soft Gradient Spheres (Apple Glass Reference Style) */}
      <div className="lg-sphere lg-sphere-lg" aria-hidden="true" />
      <div className="lg-sphere lg-sphere-md" aria-hidden="true" />
      <div className="lg-sphere lg-sphere-sm" aria-hidden="true" />

      <div className="lg-card">
        <div className="lg-brand">
          <div className="lg-logo">
            <img src="/brand/hr-pro-logo.svg" alt="HR Pro Suite" />
          </div>
          <div>
            <div className="lg-title">HR Pro Suite</div>
            <div className="lg-sub">บริษัท ดีดี เซอร์วิส แอนด์ ทรานสปอร์ต</div>
          </div>
        </div>

        <h1 className="lg-welcome">Welcome back</h1>
        <p className="lg-welcome-sub">เข้าสู่ระบบเพื่อเริ่มใช้งานระบบบริหารทรัพยากรบุคคล</p>

        <form onSubmit={handleSubmit}>
          {error && <div className="lg-error" role="alert">⚠️ {error}</div>}

          <div className="lg-field">
            <label htmlFor="username">ชื่อผู้ใช้ (Username)</label>
            <input
              id="username"
              type="text"
              placeholder="กรอกชื่อผู้ใช้งาน"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
            />
          </div>

          <div className="lg-field">
            <label htmlFor="password">รหัสผ่าน (Password)</label>
            <div className="lg-pass-wrap">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                placeholder="กรอกรหัสผ่าน"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                className="lg-pass-toggle"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
                title={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
              >
                {showPassword ? '🙈' : '👁️'}
              </button>
            </div>
          </div>

          <button type="submit" className="lg-btn" disabled={loading}>
            {loading ? '⏳ กำลังเข้าสู่ระบบ...' : 'Sign in · เข้าสู่ระบบ'}
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
          background: linear-gradient(135deg, #E8EEFF 0%, #EFF3FF 48%, #E4F1FF 100%);
          font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', 'Inter', 'Noto Sans Thai', sans-serif;
          -webkit-font-smoothing: antialiased;
        }

        /* 3D Blue/Indigo Orbs */
        .lg-sphere {
          position: fixed;
          border-radius: 50%;
          pointer-events: none;
          z-index: 0;
        }
        .lg-sphere-lg {
          bottom: -90px;
          left: calc(50% - 360px);
          width: 340px;
          height: 340px;
          background: radial-gradient(circle at 30% 28%, #8EC5FF 0%, #2E6FF2 58%, #1D4ED8 100%);
          box-shadow: 0 28px 60px rgba(37, 99, 235, 0.35);
        }
        .lg-sphere-md {
          top: calc(50% - 270px);
          right: calc(50% - 290px);
          width: 190px;
          height: 190px;
          background: radial-gradient(circle at 30% 28%, #A5B4FC 0%, #5856D6 62%, #3730A3 100%);
          box-shadow: 0 20px 44px rgba(88, 86, 214, 0.32);
        }
        .lg-sphere-sm {
          top: 16%;
          left: 18%;
          width: 68px;
          height: 68px;
          background: radial-gradient(circle at 32% 30%, #93C5FD 0%, #2563EB 72%, #1E40AF 100%);
          box-shadow: 0 12px 24px rgba(37, 99, 235, 0.25);
        }

        .lg-card {
          position: relative;
          z-index: 1;
          width: 100%;
          max-width: 410px;
          background: rgba(255, 255, 255, 0.72);
          backdrop-filter: saturate(190%) blur(28px);
          -webkit-backdrop-filter: saturate(190%) blur(28px);
          border: 1px solid rgba(255, 255, 255, 0.85);
          border-radius: 28px;
          box-shadow: 0 24px 60px rgba(15, 23, 42, 0.14), inset 0 1px 1px rgba(255, 255, 255, 0.9);
          padding: 36px 32px;
        }

        .lg-brand {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 24px;
        }
        .lg-logo {
          width: 44px;
          height: 44px;
          border-radius: 12px;
          background: #fff;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          box-shadow: 0 6px 16px rgba(0, 122, 255, 0.18);
        }
        .lg-logo img { width: 100%; height: 100%; display: block; }
        .lg-title {
          font-weight: 800;
          font-size: 17px;
          color: #1C1C1E;
          letter-spacing: -0.02em;
        }
        .lg-sub { font-size: 11.5px; color: #6C6C70; }

        .lg-welcome {
          font-size: 24px;
          font-weight: 800;
          color: #1C1C1E;
          letter-spacing: -0.02em;
          text-align: center;
          margin: 0 0 4px;
        }
        .lg-welcome-sub {
          font-size: 13px;
          color: #6C6C70;
          text-align: center;
          margin: 0 0 24px;
        }

        .lg-field { margin-bottom: 15px; }
        .lg-field label {
          display: block;
          font-size: 12.5px;
          font-weight: 600;
          color: #3C3C43;
          margin-bottom: 6px;
        }
        .lg-field input {
          width: 100%;
          padding: 12px 14px;
          border: 1px solid rgba(255, 255, 255, 0.9);
          border-radius: 13px;
          background: rgba(255, 255, 255, 0.72);
          font-size: 14px;
          font-family: inherit;
          color: #1C1C1E;
          box-sizing: border-box;
          transition: all 0.15s;
          box-shadow: 0 2px 6px rgba(15, 23, 42, 0.03);
        }
        .lg-field input:focus {
          outline: none;
          border-color: #007AFF;
          background: #FFFFFF;
          box-shadow: 0 0 0 3px rgba(0, 122, 255, 0.18);
        }

        .lg-pass-wrap {
          position: relative;
          display: flex;
          align-items: center;
        }
        .lg-pass-wrap input {
          padding-right: 42px;
        }
        .lg-pass-toggle {
          position: absolute;
          right: 10px;
          border: none;
          background: transparent;
          font-size: 16px;
          cursor: pointer;
          opacity: 0.65;
          padding: 4px;
        }
        .lg-pass-toggle:hover { opacity: 1; }

        .lg-btn {
          width: 100%;
          margin-top: 10px;
          padding: 13.5px;
          border: none;
          border-radius: 13px;
          background: linear-gradient(135deg, #4F46E5 0%, #007AFF 100%);
          color: #FFFFFF;
          font-size: 15px;
          font-weight: 700;
          font-family: inherit;
          cursor: pointer;
          box-shadow: 0 8px 20px rgba(0, 122, 255, 0.32);
          transition: transform 0.12s cubic-bezier(0.32, 0.72, 0, 1), opacity 0.15s;
        }
        .lg-btn:active:not(:disabled) { transform: scale(0.98); }
        .lg-btn:disabled { opacity: 0.6; cursor: not-allowed; }

        .lg-error {
          background: rgba(255, 59, 48, 0.12);
          color: #C81E1E;
          border: 1px solid rgba(255, 59, 48, 0.25);
          padding: 10px 14px;
          border-radius: 12px;
          font-size: 13px;
          font-weight: 600;
          margin-bottom: 14px;
        }
      `}</style>
    </div>
  );
}
