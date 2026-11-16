'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { authHeaders } from '@/components/hr/exportUtils';

const DOWS = [
  { v: '1', l: 'จันทร์' }, { v: '2', l: 'อังคาร' }, { v: '3', l: 'พุธ' },
  { v: '4', l: 'พฤหัส' }, { v: '5', l: 'ศุกร์' }, { v: '6', l: 'เสาร์' }, { v: '0', l: 'อาทิตย์' },
];

export default function SettingsPage() {
  const [s, setS] = useState(null);
  const [assets, setAssets] = useState([]);
  const [saving, setSaving] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    fetch('/api/hr/settings', { headers: authHeaders() })
      .then((r) => r.json()).then((d) => setS(d.settings)).catch(() => {});
    fetch('/api/hr/document-assets', { headers: authHeaders() })
      .then((r) => r.json()).then((d) => setAssets(d.items || [])).catch(() => {});
  }, []);

  if (!s) return <div className="hr-empty">กำลังโหลด...</div>;

  const days = (s.work_days || '').split(',').filter(Boolean);
  const toggleDay = (v) => {
    const set = new Set(days);
    set.has(v) ? set.delete(v) : set.add(v);
    setS((p) => ({ ...p, work_days: [...set].join(',') }));
  };

  const save = async () => {
    setSaving(true);
    const res = await fetch('/api/hr/settings', { method: 'PUT', headers: authHeaders(true), body: JSON.stringify(s) });
    setSaving(false);
    setToast(res.ok ? 'บันทึกแล้ว' : 'บันทึกไม่สำเร็จ');
    setTimeout(() => setToast(null), 2500);
  };

  const handleBackup = async () => {
    setBackingUp(true);
    try {
      const res = await fetch('/api/hr/backup', { headers: authHeaders() });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setToast(err.error || 'ดาวน์โหลดไฟล์สำรองข้อมูลไม่สำเร็จ');
        setTimeout(() => setToast(null), 3000);
        return;
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const disposition = res.headers.get('Content-Disposition') || '';
      const match = disposition.match(/filename="?([^"]+)"?/);
      const filename = match ? match[1] : `hr-backup-${new Date().toISOString().split('T')[0]}.json`;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      setToast('ดาวน์โหลดไฟล์สำรองข้อมูลสำเร็จ');
      setTimeout(() => setToast(null), 3000);
    } catch {
      setToast('เกิดข้อผิดพลาดในการดาวน์โหลดไฟล์สำรองข้อมูล');
      setTimeout(() => setToast(null), 3000);
    } finally {
      setBackingUp(false);
    }
  };

  const signatures = assets.filter((a) => a.asset_type === 'signature' && a.active !== false);
  const stamps = assets.filter((a) => a.asset_type === 'company_stamp' && a.active !== false);

  const selectedSig = signatures.find((a) => a.id === Number(s.tax_cert_signature_asset_id));
  const selectedStamp = stamps.find((a) => a.id === Number(s.tax_cert_stamp_asset_id));
  const token = typeof window !== 'undefined' ? (localStorage.getItem('hr-token') || '') : '';

  return (
    <div style={{ maxWidth: 680 }}>
      <div className="hr-card">
        <h3 className="hr-section-title">⏰ ตั้งค่าเวลาทำงาน</h3>
        <div className="hr-field"><label>เวลาเข้างานมาตรฐาน</label>
          <input className="hr-input" type="time" value={s.standard_in?.slice(0, 5) || ''} onChange={(e) => setS((p) => ({ ...p, standard_in: e.target.value }))} /></div>
        <div className="hr-field"><label>เวลาเลิกงานมาตรฐาน</label>
          <input className="hr-input" type="time" value={s.standard_out?.slice(0, 5) || ''} onChange={(e) => setS((p) => ({ ...p, standard_out: e.target.value }))} /></div>
        <div className="hr-field"><label>ผ่อนผันการมาสาย (นาที)</label>
          <input className="hr-input" type="number" value={s.late_grace_min} onChange={(e) => setS((p) => ({ ...p, late_grace_min: Number(e.target.value) }))} /></div>
        <div className="hr-field">
          <label>วันทำงาน</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {DOWS.map((d) => (
              <button key={d.v} type="button" onClick={() => toggleDay(d.v)}
                className={`hr-tab${days.includes(d.v) ? ' active' : ''}`} style={{ padding: '6px 12px' }}>{d.l}</button>
            ))}
          </div>
        </div>
        <button className="hr-btn hr-btn-primary" disabled={saving} onClick={save} style={{ marginTop: 8 }}>
          {saving ? 'กำลังบันทึก...' : '💾 บันทึก'}
        </button>
      </div>

      <div className="hr-card">
        <p style={{ fontSize: 13, color: '#5b6478', margin: 0 }}>
          ระบบใช้ค่านี้ตัดสินสถานะ “สาย” ตอนพนักงานลงเวลาเข้างาน (เข้าหลังเวลามาตรฐาน + ผ่อนผัน = สาย)
          หากแต่ละสาขามีเวลาทำงานหรือวันทำงานไม่เหมือนกัน ให้ตั้งที่หน้า <Link href="/hr/branches">ตั้งค่าสาขา</Link>
        </p>
      </div>

      {/* 🧾 ตั้งค่าเอกสาร 50 ทวิ (ลายเซ็นผู้จ่าย & ตราปั๊ม) */}
      <div className="hr-card" style={{ marginTop: 16 }}>
        <h3 className="hr-section-title">🧾 ตั้งค่าเอกสาร 50 ทวิ (ลายเซ็นผู้จ่าย & ตราปั๊ม)</h3>
        <p style={{ fontSize: 13, color: '#5b6478', marginTop: 4, marginBottom: 14, lineHeight: 1.6 }}>
          เลือกภาพลายเซ็นผู้มีอำนาจลงนามและตราประทับบริษัทที่จะแสดงบนแบบฟอร์มหนังสือรับรองการหักภาษี ณ ที่จ่าย (50 ทวิ) เมื่อพนักงานเปิดหรือพิมพ์เอกสาร
        </p>

        <div className="hr-field">
          <label>ลายเซ็นผู้จ่ายเงิน</label>
          <select
            className="hr-input"
            value={s.tax_cert_signature_asset_id || ''}
            onChange={(e) => setS((p) => ({ ...p, tax_cert_signature_asset_id: e.target.value ? Number(e.target.value) : null }))}
          >
            <option value="">ไม่ใส่ (เว้นว่าง)</option>
            {signatures.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name || a.signer_name ? `${a.name || 'ลายเซ็น'}${a.signer_name ? ` (${a.signer_name})` : ''}` : `ลายเซ็น #${a.id}`}
              </option>
            ))}
          </select>
          {selectedSig?.image_url && (
            <div style={{ marginTop: 8, padding: 8, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, display: 'inline-flex', alignItems: 'center', gap: 10 }}>
              <img
                src={`/api/assets/image?file=${encodeURIComponent(selectedSig.image_url)}&token=${encodeURIComponent(token)}`}
                alt="Signature preview"
                style={{ maxHeight: 44, maxWidth: 160, objectFit: 'contain' }}
              />
              <span style={{ fontSize: 12, color: '#64748b' }}>{selectedSig.signer_name || selectedSig.name}</span>
            </div>
          )}
        </div>

        <div className="hr-field" style={{ marginTop: 12 }}>
          <label>ตราปั๊มบริษัท</label>
          <select
            className="hr-input"
            value={s.tax_cert_stamp_asset_id || ''}
            onChange={(e) => setS((p) => ({ ...p, tax_cert_stamp_asset_id: e.target.value ? Number(e.target.value) : null }))}
          >
            <option value="">ไม่ใส่ (เว้นว่าง)</option>
            {stamps.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name || `ตราปั๊ม #${a.id}`}
              </option>
            ))}
          </select>
          {selectedStamp?.image_url && (
            <div style={{ marginTop: 8, padding: 8, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, display: 'inline-flex', alignItems: 'center', gap: 10 }}>
              <img
                src={`/api/assets/image?file=${encodeURIComponent(selectedStamp.image_url)}&token=${encodeURIComponent(token)}`}
                alt="Stamp preview"
                style={{ maxHeight: 44, maxWidth: 160, objectFit: 'contain' }}
              />
              <span style={{ fontSize: 12, color: '#64748b' }}>{selectedStamp.name}</span>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14 }}>
          <button className="hr-btn hr-btn-primary" disabled={saving} onClick={save}>
            {saving ? 'กำลังบันทึก...' : '💾 บันทึก'}
          </button>
          <Link href="/hr/document-assets" style={{ fontSize: 13, color: 'var(--hr-primary, #3b82f6)', textDecoration: 'none' }}>
            จัดการรูปภาพลายเซ็น / ตราปั๊ม →
          </Link>
        </div>
      </div>

      {/* สำรองข้อมูลระบบ (Backup) */}
      <div className="hr-card" style={{ marginTop: 16 }}>
        <h3 className="hr-section-title">📦 สำรองข้อมูลระบบ (Backup)</h3>
        <p style={{ fontSize: 13, color: '#5b6478', marginTop: 4, marginBottom: 14, lineHeight: 1.6 }}>
          ดาวน์โหลดไฟล์สำรองข้อมูลของระบบ HR ทั้งหมด (ข้อมูลพนักงาน, ข้อมูลเงินเดือน, การลา, เอกสาร, ประกาศ, ประวัติ audit logs) ในรูปแบบ JSON เพื่อความปลอดภัยและการกู้คืนข้อมูล
        </p>
        <button
          type="button"
          className="hr-btn"
          disabled={backingUp}
          onClick={handleBackup}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '9px 16px', fontWeight: 600 }}
        >
          <span>{backingUp ? '⏳' : '📥'}</span>
          <span>{backingUp ? 'กำลังเตรียมไฟล์สำรอง...' : 'ดาวน์โหลดไฟล์สำรองข้อมูล (.json)'}</span>
        </button>
      </div>

      {toast && <div className="hr-toast">{toast}</div>}
    </div>
  );
}
