'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

function authHeaders(json = false) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('hr-token') : '';
  return {
    Authorization: `Bearer ${token}`,
    ...(json ? { 'Content-Type': 'application/json' } : {}),
  };
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

export default function NotificationBell({ compact = false }) {
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [pushState, setPushState] = useState('idle');

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications', { headers: authHeaders() });
      const data = await res.json();
      setItems(data.items || []);
      setUnread(data.unread || 0);
    } catch {}
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 60000);
    return () => clearInterval(id);
  }, [load]);

  async function enablePush() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      setPushState('unsupported');
      return;
    }
    setPushState('requesting');
    try {
      const keyRes = await fetch('/api/push/public-key');
      const { publicKey, enabled } = await keyRes.json();
      if (!enabled || !publicKey) {
        setPushState('not-configured');
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setPushState('denied');
        return;
      }
      const registration = await navigator.serviceWorker.register('/sw.js');
      const ready = await navigator.serviceWorker.ready;
      const existing = await ready.pushManager.getSubscription();
      const subscription = existing || await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({ subscription }),
      });
      setPushState('enabled');
    } catch {
      setPushState('error');
    }
  }

  async function markRead(id) {
    await fetch('/api/notifications', {
      method: 'PATCH',
      headers: authHeaders(true),
      body: JSON.stringify(id ? { id } : {}),
    }).catch(() => {});
    await load();
  }

  const buttonClass = compact ? 'notify-btn compact' : 'notify-btn';

  return (
    <div className="notify-wrap">
      <button className={buttonClass} onClick={() => setOpen((v) => !v)} title="แจ้งเตือน">
        🔔
        {unread > 0 && <span className="notify-count">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="notify-panel">
          <div className="notify-head">
            <strong>แจ้งเตือน</strong>
            {unread > 0 && <button onClick={() => markRead()}>อ่านทั้งหมด</button>}
          </div>
          <button className="notify-enable" onClick={enablePush}>
            {pushState === 'enabled' ? 'เปิด Push แล้ว' : 'เปิดแจ้งเตือนบนเครื่องนี้'}
          </button>
          {pushState === 'not-configured' && <div className="notify-hint">ยังไม่ได้ตั้งค่า VAPID keys บน server</div>}
          {pushState === 'denied' && <div className="notify-hint">เบราว์เซอร์ไม่อนุญาตแจ้งเตือน</div>}
          <div className="notify-list">
            {items.length === 0 && <div className="notify-empty">ยังไม่มีแจ้งเตือน</div>}
            {items.map((item) => (
              <Link key={item.id} className={`notify-item${item.read_at ? '' : ' unread'}`} href={item.url || '#'} onClick={() => markRead(item.id)}>
                <span>{item.title}</span>
                <small>{item.body}</small>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
