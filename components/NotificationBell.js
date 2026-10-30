'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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
  const lastKnownIdRef = useRef(null);

  // ตรวจสอบสถานะการแจ้งเตือนเริ่มต้นเมื่อเปิดคอมโพเนนต์
  useEffect(() => {
    async function checkInitialPermission() {
      if (typeof window === 'undefined') return;

      // 1. ตรวจสอบ Native Capacitor
      try {
        const { Capacitor } = await import('@capacitor/core');
        if (Capacitor.isNativePlatform()) {
          const { LocalNotifications } = await import('@capacitor/local-notifications');
          const perm = await LocalNotifications.checkPermissions();
          if (perm.display === 'granted') {
            setPushState('enabled');
            return;
          }
        }
      } catch {}

      // 2. ตรวจสอบ Web Notification Permission
      if ('Notification' in window && Notification.permission === 'granted') {
        setPushState('enabled');
      } else if ('Notification' in window && Notification.permission === 'denied') {
        setPushState('denied');
      }
    }

    checkInitialPermission();
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications', { headers: authHeaders() });
      const data = await res.json();
      const newItems = data.items || [];
      const newUnread = data.unread || 0;
      setItems(newItems);
      setUnread(newUnread);

      // ยิงแจ้งเตือน Local Notification บนมือถือเมื่อมีแจ้งเตือนใหม่เข้ามา
      if (newItems.length > 0) {
        const topItem = newItems[0];
        if (lastKnownIdRef.current && topItem.id > lastKnownIdRef.current && !topItem.read_at) {
          try {
            const { Capacitor } = await import('@capacitor/core');
            if (Capacitor.isNativePlatform()) {
              const { LocalNotifications } = await import('@capacitor/local-notifications');
              await LocalNotifications.schedule({
                notifications: [
                  {
                    id: Math.floor(Math.random() * 100000),
                    title: topItem.title || 'HR Pro Suite',
                    body: topItem.body || '',
                    channelId: 'hr_suite_alerts',
                  },
                ],
              });
            }
          } catch {}
        }
        lastKnownIdRef.current = topItem.id;
      }
    } catch {}
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [load]);

  async function enablePush() {
    // ── 1. กรณีรันบน Native Android (Capacitor App) ──
    try {
      const { Capacitor } = await import('@capacitor/core');
      if (Capacitor.isNativePlatform()) {
        setPushState('requesting');
        const { LocalNotifications } = await import('@capacitor/local-notifications');
        
        // สร้าง Notification Channel สำหรับ Android 8+
        await LocalNotifications.createChannel({
          id: 'hr_suite_alerts',
          name: 'HR Suite Notifications',
          description: 'แจ้งเตือนงานบุคคลและอนุมัติรายการ',
          importance: 5,
          vibration: true,
        }).catch(() => {});

        const perm = await LocalNotifications.requestPermissions();
        if (perm.display === 'granted') {
          setPushState('enabled');
          localStorage.setItem('hr-native-notify-enabled', 'true');
          await LocalNotifications.schedule({
            notifications: [
              {
                id: Math.floor(Math.random() * 100000),
                title: '🔔 เปิดการแจ้งเตือนสำเร็จ',
                body: 'ระบบ HR Pro Suite จะแจ้งเตือนเมื่อมีคำขอหรือข่าวสารใหม่ทันทีค่ะ',
                channelId: 'hr_suite_alerts',
              },
            ],
          });
          return;
        } else {
          setPushState('denied');
          return;
        }
      }
    } catch (e) {
      console.warn('Native push setup skipped:', e);
    }

    // ── 2. กรณีรันบน Browser / Web PWA (Web Push) ──
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
            {pushState === 'enabled' ? '✅ เปิดการแจ้งเตือนแล้ว' : pushState === 'requesting' ? '⏳ กำลังขอสิทธิ์...' : '🔔 เปิดแจ้งเตือนบนเครื่องนี้'}
          </button>
          {pushState === 'not-configured' && <div className="notify-hint">ยังไม่ได้ตั้งค่า VAPID keys บน server</div>}
          {pushState === 'denied' && <div className="notify-hint">⚠️ อุปกรณ์/เบราว์เซอร์ยังไม่อนุญาตแจ้งเตือน (กรุณาเปิดในตั้งค่าระบบ)</div>}
          {pushState === 'unsupported' && <div className="notify-hint">ระบบแจ้งเตือนแบบ In-App พร้อมทำงานปกติ</div>}
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
