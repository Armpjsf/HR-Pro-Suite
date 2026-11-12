'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import AppIcon from '@/components/ui/Icons';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const router = useRouter();

  function getCookie(name) {
    if (typeof document === 'undefined') return null;
    const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
    return match ? match[2] : null;
  }

  const redirectByAccess = useCallback(async () => {
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
  }, [router]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
    const token = getCookie('hr-token');
    if (token) {
      redirectByAccess().catch(() => router.push('/me'));
    }
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, [router, redirectByAccess]);

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
        setError(data.error || 'เข้าสู่ระบบไม่สำเร็จ กรุณาตรวจสอบข้อมูล');
        setLoading(false);
        return;
      }
      localStorage.setItem('hr-user', JSON.stringify(data.user));
      localStorage.setItem('hr-token', data.token);
      await redirectByAccess();
    } catch {
      setError('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาลองใหม่อีกครั้ง');
      setLoading(false);
    }
  }

  if (!mounted) return null;

  return (
    <div className="login-root">
      <div className="login-card">
        {/* Enterprise Brand Header */}
        <div className="login-brand">
          <div className="login-logo">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/hr-pro-logo.svg"
              alt="ดีดี เซอร์วิส แอนด์ ทรานสปอร์ต"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
                if (e.currentTarget.nextElementSibling) {
                  e.currentTarget.nextElementSibling.style.display = 'flex';
                }
              }}
            />
            <div className="login-logo-fallback" style={{ display: 'none' }}>
              <AppIcon name="truck" size={26} style={{ color: '#0284C7' }} />
            </div>
          </div>
          <div className="login-brand-text">
            <div className="login-company">บริษัท ดีดี เซอร์วิส แอนด์ ทรานสปอร์ต จำกัด</div>
            <div className="login-system">ระบบบริหารทรัพยากรบุคคลและปฏิบัติการขนส่ง</div>
          </div>
        </div>

        <div className="login-header">
          <h1 className="login-heading">เข้าสู่ระบบงานบุคคล</h1>
          <p className="login-subheading">กรุณากรอกชื่อผู้ใช้งานและรหัสผ่านเพื่อเข้าใช้งานระบบ</p>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          {error && (
            <div className="login-error-banner" role="alert">
              <AppIcon name="alert-triangle" size={18} style={{ color: '#DC2626' }} />
              <span>{error}</span>
            </div>
          )}

          <div className="form-group">
            <label htmlFor="username">ชื่อผู้ใช้งาน (Username)</label>
            <div className="input-with-icon">
              <span className="input-icon" aria-hidden="true">
                <AppIcon name="user" size={18} />
              </span>
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
          </div>

          <div className="form-group">
            <label htmlFor="password">รหัสผ่าน (Password)</label>
            <div className="input-with-icon password-wrap">
              <span className="input-icon" aria-hidden="true">
                <AppIcon name="shield" size={18} />
              </span>
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
                className="password-toggle-btn"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
                title={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
              >
                <AppIcon name={showPassword ? 'eye-off' : 'eye'} size={18} />
              </button>
            </div>
          </div>

          <button type="submit" className="login-submit-btn" disabled={loading}>
            {loading ? (
              <>
                <span className="login-spinner" aria-hidden="true">
                  <AppIcon name="loader" size={18} />
                </span>
                <span>กำลังเข้าสู่ระบบ...</span>
              </>
            ) : (
              <span>เข้าสู่ระบบ</span>
            )}
          </button>
        </form>

        <div className="login-card-footer">
          <AppIcon name="shield" size={14} style={{ color: '#64748B' }} />
          <span>ระบบรักษาความปลอดภัยมาตรฐานองค์กร · DD Service & Transport</span>
        </div>
      </div>

      <style jsx>{`
        .login-root {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px 16px;
          background: linear-gradient(135deg, #F1F5F9 0%, #E2E8F0 50%, #F8FAFC 100%);
          font-family: var(--font-sans), var(--font-thai), sans-serif;
          -webkit-font-smoothing: antialiased;
        }

        .login-card {
          position: relative;
          width: 100%;
          max-width: 430px;
          background: #FFFFFF;
          border: 1px solid #CBD5E1;
          border-radius: 20px;
          box-shadow: 0 20px 48px rgba(15, 41, 66, 0.10), 0 4px 14px rgba(15, 23, 42, 0.04);
          padding: 36px 32px 30px;
          animation: cardSlideUp 0.3s cubic-bezier(0.22, 1, 0.36, 1);
        }

        @keyframes cardSlideUp {
          from {
            opacity: 0;
            transform: translateY(12px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .login-brand {
          display: flex;
          align-items: center;
          gap: 14px;
          margin-bottom: 24px;
          padding-bottom: 18px;
          border-bottom: 1px solid #F1F5F9;
        }

        .login-logo {
          width: 46px;
          height: 46px;
          border-radius: 12px;
          background: #F8FAFC;
          border: 1px solid #E2E8F0;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          flex-shrink: 0;
        }

        .login-logo img {
          width: 100%;
          height: 100%;
          object-fit: contain;
          display: block;
        }

        .login-logo-fallback {
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #E0F2FE;
        }

        .login-brand-text {
          flex: 1;
          min-width: 0;
        }

        .login-company {
          font-weight: 700;
          font-size: 14px;
          color: #0F2942;
          line-height: 1.3;
          letter-spacing: -0.01em;
        }

        .login-system {
          font-size: 12px;
          color: #475569;
          margin-top: 2px;
          line-height: 1.35;
        }

        .login-header {
          text-align: left;
          margin-bottom: 22px;
        }

        .login-heading {
          font-size: 22px;
          font-weight: 800;
          color: #0F2942;
          letter-spacing: -0.02em;
          margin: 0 0 6px;
        }

        .login-subheading {
          font-size: 13.5px;
          color: #475569;
          margin: 0;
          line-height: 1.5;
        }

        .login-form {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .login-error-banner {
          background: #FEE2E2;
          border: 1px solid #FCA5A5;
          color: #991B1B;
          padding: 11px 14px;
          border-radius: 12px;
          font-size: 13px;
          font-weight: 600;
          display: flex;
          align-items: center;
          gap: 10px;
          line-height: 1.4;
          animation: bannerFade 0.2s ease-out;
        }

        @keyframes bannerFade {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .form-group {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .form-group label {
          font-size: 13px;
          font-weight: 600;
          color: #334155;
          letter-spacing: 0.01em;
        }

        .input-with-icon {
          position: relative;
          display: flex;
          align-items: center;
        }

        .input-icon {
          position: absolute;
          left: 14px;
          color: #64748B;
          pointer-events: none;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .input-with-icon input {
          width: 100%;
          min-height: 46px;
          padding: 11px 14px 11px 42px;
          border: 1px solid #CBD5E1;
          border-radius: 12px;
          background: #FFFFFF;
          font-size: 14px;
          font-family: inherit;
          color: #0F172A;
          box-sizing: border-box;
          transition: all 0.15s ease;
        }

        .input-with-icon input::placeholder {
          color: #94A3B8;
        }

        .input-with-icon input:focus {
          outline: none;
          border-color: #0284C7;
          background: #FFFFFF;
          box-shadow: 0 0 0 3px rgba(2, 132, 199, 0.22);
        }

        .password-wrap input {
          padding-right: 46px;
        }

        .password-toggle-btn {
          position: absolute;
          right: 2px;
          min-width: 44px;
          min-height: 44px;
          border: none;
          background: transparent;
          color: #64748B;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0;
          border-radius: 10px;
          transition: color 0.15s ease;
        }

        .password-toggle-btn:hover {
          color: #0F2942;
        }

        .password-toggle-btn:focus-visible {
          outline: 2px solid #0284C7;
          outline-offset: -2px;
        }

        .login-submit-btn {
          width: 100%;
          min-height: 48px;
          margin-top: 8px;
          padding: 12px 20px;
          border: none;
          border-radius: 12px;
          background: linear-gradient(135deg, #0F2942 0%, #0284C7 100%);
          color: #FFFFFF;
          font-size: 15px;
          font-weight: 700;
          font-family: inherit;
          cursor: pointer;
          box-shadow: 0 6px 18px rgba(2, 132, 199, 0.28);
          transition: all 0.15s ease;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
        }

        .login-submit-btn:hover:not(:disabled) {
          background: linear-gradient(135deg, #0A1B2E 0%, #0369A1 100%);
          box-shadow: 0 8px 22px rgba(2, 132, 199, 0.35);
          transform: translateY(-1px);
        }

        .login-submit-btn:active:not(:disabled) {
          transform: translateY(0);
        }

        .login-submit-btn:disabled {
          opacity: 0.65;
          cursor: not-allowed;
          box-shadow: none;
        }

        .login-spinner {
          display: inline-flex;
          animation: spin 0.8s linear infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        .login-card-footer {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          margin-top: 24px;
          padding-top: 18px;
          border-top: 1px solid #F1F5F9;
          font-size: 11.5px;
          color: #64748B;
          text-align: center;
        }

        @media (max-width: 480px) {
          .login-card {
            padding: 28px 20px 24px;
            border-radius: 16px;
          }
          .login-heading {
            font-size: 20px;
          }
        }
      `}</style>
    </div>
  );
}
