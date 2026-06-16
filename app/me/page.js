'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { COMPANY } from '@/lib/company';
import './me.css';

/* ─── Constants ─── */
const LEAVE_LABELS = { annual: 'พักร้อน', sick: 'ลาป่วย', personal: 'ลากิจ' };
const LEAVE_ICONS = { annual: '🏖️', sick: '🏥', personal: '📋' };
const EXPENSE_CATS = [
  { value: 'travel', label: 'ค่าเดินทาง' },
  { value: 'meal', label: 'ค่าอาหาร' },
  { value: 'allowance', label: 'เบี้ยเลี้ยง' },
  { value: 'accommodation', label: 'ค่าที่พัก' },
  { value: 'other', label: 'อื่นๆ' },
];
const STATUS_BADGE = {
  pending: { cls: 'me-badge-yellow', label: 'รออนุมัติ' },
  approved: { cls: 'me-badge-green', label: 'อนุมัติ' },
  rejected: { cls: 'me-badge-red', label: 'ไม่อนุมัติ' },
  paid: { cls: 'me-badge-blue', label: 'จ่ายแล้ว' },
  draft: { cls: 'me-badge-gray', label: 'แบบร่าง' },
  submitted: { cls: 'me-badge-green', label: 'ส่งแล้ว' },
};

function authHeaders() {
  const token = typeof window !== 'undefined' ? localStorage.getItem('hr-token') : '';
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

/* ═══════════════════════════════════════════════════════════════ */
export default function EmployeePage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [tab, setTab] = useState('home');
  const [data, setData] = useState(null);
  const [toast, setToast] = useState(null);

  /* ─── Auth ─── */
  useEffect(() => {
    const stored = localStorage.getItem('hr-user');
    const token = localStorage.getItem('hr-token');
    if (!stored || !token) { router.push('/'); return; }
    try { setUser(JSON.parse(stored)); } catch { router.push('/'); }
  }, [router]);

  /* ─── Load initial data ─── */
  useEffect(() => {
    if (!user) return;
    fetch('/api/me', { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => { if (d.profile) setData(d); })
      .catch(() => {});
  }, [user]);

  const showToast = useCallback((msg, isError) => {
    setToast({ msg, isError });
    setTimeout(() => setToast(null), 3000);
  }, []);

  if (!user || !data) return <div className="me-root"><div className="me-empty">กำลังโหลด...</div></div>;

  return (
    <div className="me-root">
      {/* ── Header ── */}
      <div className="me-header">
        <div className="me-avatar">{data.profile.avatar || '👤'}</div>
        <div>
          <div className="me-name">สวัสดี คุณ{data.profile.name}</div>
          <div className="me-sub">{data.profile.department} · {data.profile.position}</div>
        </div>
      </div>

      {/* ── Tab content ── */}
      <div className="me-content">
        {tab === 'home' && <HomeTab data={data} setData={setData} showToast={showToast} />}
        {tab === 'leave' && <LeaveTab data={data} setData={setData} showToast={showToast} />}
        {tab === 'chat' && <ChatTab user={user} />}
        {tab === 'payslip' && <PayslipTab data={data} />}
        {tab === 'more' && <MoreTab user={user} router={router} showToast={showToast} data={data} />}
      </div>

      {/* ── Bottom Tab Bar ── */}
      <div className="me-tabbar">
        {[
          { id: 'home', icon: '🏠', label: 'หน้าแรก' },
          { id: 'leave', icon: '📅', label: 'ลางาน' },
          { id: 'chat', icon: '💬', label: 'แชท' },
          { id: 'payslip', icon: '💰', label: 'สลิป' },
          { id: 'more', icon: '≡', label: 'เพิ่มเติม' },
        ].map((t) => (
          <button key={t.id} className={`me-tab${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>
            <span className="ico">{t.icon}</span>{t.label}
          </button>
        ))}
      </div>

      {toast && <div className={`me-toast${toast.isError ? ' error' : ''}`}>{toast.msg}</div>}
    </div>
  );
}

/* ═══════════════════ HOME TAB ═══════════════════ */
function HomeTab({ data, setData, showToast }) {
  const [clockLoading, setClockLoading] = useState(false);
  const [clockStatus, setClockStatus] = useState(data.todayClock);
  const [clockType, setClockType] = useState('office');

  const handleClock = async (action) => {
    setClockLoading(true);
    try {
      let lat = null, lng = null;
      if (clockType === 'office' || clockType === 'offsite') {
        const pos = await new Promise((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000 })
        );
        lat = pos.coords.latitude;
        lng = pos.coords.longitude;
      }

      const res = await fetch('/api/me/clock', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ action, latitude: lat, longitude: lng, check_type: clockType }),
      });
      const d = await res.json();
      if (!res.ok) { showToast(d.error || 'เกิดข้อผิดพลาด', true); return; }
      setClockStatus(d.record);
      showToast(d.message);
    } catch (err) {
      showToast(err.code === 1 ? 'กรุณาอนุญาตการเข้าถึง GPS' : 'เกิดข้อผิดพลาด', true);
    } finally {
      setClockLoading(false);
    }
  };

  const clockedIn = !!clockStatus?.clock_in;
  const clockedOut = !!clockStatus?.clock_out;

  return (
    <>
      {/* Clock in/out */}
      <div className="me-card">
        <div className="me-section-title">⏰ ลงเวลาทำงาน</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          {['office', 'offsite', 'wfh'].map((t) => (
            <button key={t} className={`me-badge ${clockType === t ? 'me-badge-purple' : 'me-badge-gray'}`}
              style={{ cursor: 'pointer', border: 'none', padding: '6px 14px', fontSize: 13 }}
              onClick={() => setClockType(t)}>
              {t === 'office' ? '🏢 ออฟฟิศ' : t === 'offsite' ? '📍 นอกสถานที่' : '🏠 WFH'}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="me-btn" style={{ flex: 1, background: clockedIn ? '#d1d5db' : undefined }}
            disabled={clockLoading || clockedIn} onClick={() => handleClock('in')}>
            {clockLoading ? '⏳' : '🟢'} เข้างาน
          </button>
          <button className="me-btn" style={{ flex: 1, background: !clockedIn || clockedOut ? '#d1d5db' : 'linear-gradient(135deg,#ef4444,#f87171)' }}
            disabled={clockLoading || !clockedIn || clockedOut} onClick={() => handleClock('out')}>
            {clockLoading ? '⏳' : '🔴'} ออกงาน
          </button>
        </div>
        {clockedIn && (
          <div style={{ marginTop: 10, fontSize: 13, color: '#5b6478' }}>
            ✅ เข้างาน {clockStatus.clock_in?.slice(0, 5)} {clockStatus.location_name && `(${clockStatus.location_name})`}
            {clockedOut && <> · ออกงาน {clockStatus.clock_out?.slice(0, 5)}</>}
          </div>
        )}
      </div>

      {/* Leave balance */}
      <div className="me-leave-grid">
        {Object.entries(data.leaveBalance || {}).map(([key, val]) => (
          <div key={key} className="me-leave-card">
            <div className="me-leave-icon">{LEAVE_ICONS[key]}</div>
            <div className="me-leave-remain">{val.remaining}</div>
            <div className="me-leave-label">{LEAVE_LABELS[key]}</div>
          </div>
        ))}
      </div>

      {/* Announcements */}
      <div className="me-card" style={{ marginTop: 14 }}>
        <div className="me-section-title">📢 ประกาศล่าสุด</div>
        {(data.announcements || []).length === 0 && <div className="me-empty">ไม่มีประกาศ</div>}
        {(data.announcements || []).slice(0, 5).map((a) => (
          <div key={a.id} className="me-row">
            <span className="k">{a.pinned ? '📌 ' : ''}{a.title}</span>
            <span className="v" style={{ fontSize: 12 }}>{a.publish_date || ''}</span>
          </div>
        ))}
      </div>
    </>
  );
}

/* ═══════════════════ LEAVE TAB ═══════════════════ */
function LeaveTab({ data, setData, showToast }) {
  const [form, setForm] = useState({ leave_type: 'annual', start_date: '', end_date: '', days: 1, reason: '' });
  const [loading, setLoading] = useState(false);
  const [leaves, setLeaves] = useState(data.leaves || []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch('/api/me/leave', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(form),
      });
      const d = await res.json();
      if (!res.ok) { showToast(d.error, true); return; }
      showToast('ยื่นใบลาเรียบร้อย');
      setLeaves((prev) => [d.item, ...prev]);
      setForm({ leave_type: 'annual', start_date: '', end_date: '', days: 1, reason: '' });
    } catch { showToast('เกิดข้อผิดพลาด', true); }
    finally { setLoading(false); }
  };

  return (
    <>
      {/* Balance */}
      <div className="me-leave-grid" style={{ marginTop: 0, padding: 0 }}>
        {Object.entries(data.leaveBalance || {}).map(([key, val]) => (
          <div key={key} className="me-leave-card">
            <div className="me-leave-icon">{LEAVE_ICONS[key]}</div>
            <div className="me-leave-remain">{val.remaining}<span style={{ fontSize: 11, fontWeight: 400, color: '#9aa1b5' }}>/{val.total}</span></div>
            <div className="me-leave-label">{LEAVE_LABELS[key]}</div>
          </div>
        ))}
      </div>

      {/* Form */}
      <div className="me-card" style={{ marginTop: 14 }}>
        <div className="me-section-title">📝 ยื่นใบลา</div>
        <form onSubmit={handleSubmit}>
          <div className="me-field">
            <label>ประเภทการลา</label>
            <select value={form.leave_type} onChange={(e) => setForm({ ...form, leave_type: e.target.value })}>
              <option value="annual">ลาพักร้อน</option>
              <option value="sick">ลาป่วย</option>
              <option value="personal">ลากิจ</option>
            </select>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <div className="me-field" style={{ flex: 1 }}>
              <label>วันที่เริ่ม</label>
              <input type="date" className="me-input" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} required />
            </div>
            <div className="me-field" style={{ flex: 1 }}>
              <label>วันที่สิ้นสุด</label>
              <input type="date" className="me-input" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} required />
            </div>
          </div>
          <div className="me-field">
            <label>จำนวนวัน</label>
            <input type="number" className="me-input" min="0.5" step="0.5" value={form.days} onChange={(e) => setForm({ ...form, days: e.target.value })} required />
          </div>
          <div className="me-field">
            <label>เหตุผล</label>
            <textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="ระบุเหตุผล (ถ้ามี)" />
          </div>
          <button className="me-btn" disabled={loading}>{loading ? '⏳ กำลังส่ง...' : '📅 ยื่นใบลา'}</button>
        </form>
      </div>

      {/* History */}
      <div className="me-card">
        <div className="me-section-title">📋 ประวัติการลา</div>
        {leaves.length === 0 && <div className="me-empty">ยังไม่มีรายการ</div>}
        {leaves.map((l) => {
          const badge = STATUS_BADGE[l.status] || STATUS_BADGE.pending;
          return (
            <div key={l.id} className="me-row">
              <span className="k">{LEAVE_LABELS[l.leave_type] || l.leave_type} {l.days} วัน · {l.start_date}</span>
              <span className={`me-badge ${badge.cls}`}>{badge.label}</span>
            </div>
          );
        })}
      </div>
    </>
  );
}

/* ═══════════════════ CHAT TAB ═══════════════════ */
function ChatTab({ user }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const endRef = useRef(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const SUGGESTIONS = [
    { icon: '📅', text: 'วันลาคงเหลือของฉัน' },
    { icon: '📋', text: 'ระเบียบบริษัท' },
    { icon: '🏥', text: 'สวัสดิการพนักงาน' },
    { icon: '📝', text: 'ขอใบลาพักร้อน' },
  ];

  const send = async (text) => {
    if (!text.trim() || loading) return;
    const time = new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
    setMessages((p) => [...p, { id: Date.now(), role: 'user', content: text.trim(), time }]);
    setInput('');
    setLoading(true);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ message: text.trim() }),
      });
      const d = await res.json();
      setMessages((p) => [...p, { id: Date.now() + 1, role: 'ai', content: d.reply || d.error || 'เกิดข้อผิดพลาด', documents: d.documents || [], time }]);
    } catch {
      setMessages((p) => [...p, { id: Date.now() + 1, role: 'ai', content: '❌ ไม่สามารถเชื่อมต่อได้', time }]);
    } finally { setLoading(false); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 'calc(100vh - 200px)' }}>
      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 12 }}>
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', padding: '30px 0' }}>
            <div style={{ fontSize: 40, marginBottom: 10 }}>🤖</div>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>HR AI Assistant</div>
            <div style={{ fontSize: 13, color: '#9aa1b5', marginBottom: 18 }}>ถามอะไรก็ได้เกี่ยวกับ HR ครับ</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
              {SUGGESTIONS.map((s, i) => (
                <button key={i} onClick={() => send(s.text)}
                  style={{ padding: '8px 14px', borderRadius: 12, border: '1px solid #e7e9f4', background: '#fff', cursor: 'pointer', fontSize: 13 }}>
                  {s.icon} {s.text}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start', marginBottom: 10 }}>
            <div style={{
              maxWidth: '85%', padding: '10px 14px', borderRadius: 16,
              background: m.role === 'user' ? 'linear-gradient(135deg,#6d5ef5,#8b7cf8)' : '#f6f7fc',
              color: m.role === 'user' ? '#fff' : '#1d2433', fontSize: 14, lineHeight: 1.6,
              whiteSpace: 'pre-wrap',
            }}>
              {m.content}
              {m.documents?.length > 0 && (
                <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {m.documents.map((doc) => (
                    <button
                      key={doc.id}
                      onClick={() => {
                        const token = localStorage.getItem('hr-token');
                        window.open(`/api/documents/${doc.id}/download?token=${encodeURIComponent(token || '')}`, '_blank');
                      }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px',
                        borderRadius: 12, border: '1px solid #e7e9f4', background: '#fff',
                        cursor: 'pointer', fontSize: 13, color: '#1d2433', textAlign: 'left',
                      }}
                    >
                      <span>⬇️</span>
                      <span style={{ flex: 1 }}>{doc.name}</span>
                    </button>
                  ))}
                </div>
              )}
              <div style={{ fontSize: 10, opacity: 0.6, marginTop: 4, textAlign: 'right' }}>{m.time}</div>
            </div>
          </div>
        ))}
        {loading && (
          <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 10 }}>
            <div style={{ padding: '10px 18px', borderRadius: 16, background: '#f6f7fc', fontSize: 20 }}>
              <span className="me-typing">⏳</span>
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>
      <div style={{ display: 'flex', gap: 8, position: 'sticky', bottom: 76, background: '#f4f5fb', paddingTop: 8 }}>
        <input className="me-input" placeholder="พิมพ์คำถาม..." value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); send(input); } }}
          disabled={loading} style={{ flex: 1 }} />
        <button className="me-btn" style={{ width: 48, padding: 0 }} disabled={!input.trim() || loading}
          onClick={() => send(input)}>➤</button>
      </div>
    </div>
  );
}

/* ═══════════════════ PAYSLIP TAB ═══════════════════ */
function PayslipTab({ data }) {
  const slips = data.payslips || [];
  const [selected, setSelected] = useState(slips[0] || null);
  const [showDoc, setShowDoc] = useState(false);

  const num = (v) => Number(v || 0).toLocaleString();

  return (
    <>
      {selected && (
        <div className="me-card">
          <div className="me-section-title">💰 สลิปเงินเดือน งวด {selected.period}</div>
          <div className="me-row"><span className="k">เงินเดือน</span><span className="v">{num(selected.base_salary)} ฿</span></div>
          <div className="me-row"><span className="k">ค่าล่วงเวลา (OT)</span><span className="v">{num(selected.ot_pay)} ฿</span></div>
          <div className="me-row"><span className="k">โบนัส</span><span className="v">{num(selected.bonus)} ฿</span></div>
          <div className="me-row"><span className="k">หักภาษี ณ ที่จ่าย</span><span className="v" style={{ color: '#dc2626' }}>-{num(selected.tax)} ฿</span></div>
          <div className="me-row"><span className="k">หักประกันสังคม</span><span className="v" style={{ color: '#dc2626' }}>-{num(selected.sso)} ฿</span></div>
          <div className="me-row"><span className="k">หักอื่นๆ</span><span className="v" style={{ color: '#dc2626' }}>-{num(selected.deduction)} ฿</span></div>
          <div className="me-row" style={{ borderTop: '2px solid #e7e9f4' }}>
            <span className="k" style={{ fontWeight: 700 }}>รับสุทธิ</span>
            <span className="me-slip-net">{num(selected.net)} ฿</span>
          </div>
          <button className="me-btn" style={{ marginTop: 12 }} onClick={() => setShowDoc(true)}>🖨️ ดู/พิมพ์สลิป (PDF)</button>
        </div>
      )}
      <div className="me-card">
        <div className="me-section-title">📋 สลิปย้อนหลัง</div>
        {slips.length === 0 && <div className="me-empty">ยังไม่มีข้อมูล</div>}
        {slips.map((s) => (
          <div key={s.id} className="me-row" style={{ cursor: 'pointer' }} onClick={() => setSelected(s)}>
            <span className="k">งวด {s.period}</span>
            <span className="v">{num(s.net)} ฿</span>
          </div>
        ))}
      </div>

      {showDoc && selected && (
        <SlipDocument slip={selected} profile={data.profile} onClose={() => setShowDoc(false)} />
      )}
    </>
  );
}

/* ─── เอกสารสลิปเงินเดือน (พิมพ์ได้) ─── */
function SlipDocument({ slip, profile, onClose }) {
  const num = (v) => Number(v || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (
    <div className="me-doc-overlay">
      <div className="me-doc-actions">
        <button className="me-badge me-badge-gray" style={{ border: 'none', padding: '8px 14px', cursor: 'pointer' }} onClick={onClose}>← ปิด</button>
        <button className="me-badge me-badge-purple" style={{ border: 'none', padding: '8px 14px', cursor: 'pointer' }} onClick={() => window.print()}>🖨️ พิมพ์ / บันทึก PDF</button>
      </div>
      <div className="me-doc-print">
        <div className="me-doc">
          <div className="me-doc-head">
            <div className="me-doc-co">{COMPANY.name}</div>
            <div className="me-doc-addr">{COMPANY.address}</div>
            <div className="me-doc-title">สลิปเงินเดือน (Pay Slip) งวด {slip.period}</div>
          </div>
          <table className="me-doc-meta">
            <tbody>
              <tr><td>ชื่อพนักงาน</td><td>{profile.name}</td><td>รหัส</td><td>{profile.employeeId}</td></tr>
              <tr><td>ตำแหน่ง</td><td>{profile.position || '-'}</td><td>แผนก</td><td>{profile.department || '-'}</td></tr>
              <tr><td>ธนาคาร</td><td>{profile.bankName || '-'}</td><td>เลขบัญชี</td><td>{profile.bankAccount || '-'}</td></tr>
            </tbody>
          </table>
          <table className="me-doc-table">
            <thead><tr><th>รายได้</th><th className="r">จำนวน (บาท)</th><th>รายการหัก</th><th className="r">จำนวน (บาท)</th></tr></thead>
            <tbody>
              <tr><td>เงินเดือน</td><td className="r">{num(slip.base_salary)}</td><td>ภาษี ณ ที่จ่าย</td><td className="r">{num(slip.tax)}</td></tr>
              <tr><td>ค่าล่วงเวลา (OT)</td><td className="r">{num(slip.ot_pay)}</td><td>ประกันสังคม</td><td className="r">{num(slip.sso)}</td></tr>
              <tr><td>โบนัส</td><td className="r">{num(slip.bonus)}</td><td>หักอื่นๆ</td><td className="r">{num(slip.deduction)}</td></tr>
            </tbody>
            <tfoot>
              <tr>
                <td>รวมรายได้</td><td className="r">{num(Number(slip.base_salary) + Number(slip.ot_pay) + Number(slip.bonus))}</td>
                <td>รวมหัก</td><td className="r">{num(Number(slip.tax) + Number(slip.sso) + Number(slip.deduction))}</td>
              </tr>
            </tfoot>
          </table>
          <div className="me-doc-net">เงินได้สุทธิ: {num(slip.net)} บาท</div>
          <div className="me-doc-sign">
            <div>ลงชื่อ ......................................... พนักงาน</div>
            <div>ลงชื่อ ......................................... ฝ่ายบุคคล</div>
          </div>
          <div className="me-doc-foot">เอกสารนี้ออกโดยระบบ HR — ใช้ประกอบการอ้างอิงรายได้</div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════ MORE TAB ═══════════════════ */
function MoreTab({ user, router, showToast, data }) {
  const [subTab, setSubTab] = useState(null);

  const menus = [
    { id: 'expenses', icon: '🧾', label: 'เบิกค่าใช้จ่าย', desc: 'ยื่นเบิกค่าเดินทาง เบี้ยเลี้ยง ฯลฯ' },
    { id: 'calendar', icon: '📆', label: 'ปฏิทินงาน', desc: 'ดูตารางกะ วันลา วันหยุด' },
    { id: 'attendance', icon: '⏰', label: 'ประวัติเข้า-ออกงาน', desc: 'ดูสถิติ Clock-in/out ย้อนหลัง' },
    { id: 'evaluation', icon: '⭐', label: 'ประเมินเพื่อนร่วมงาน', desc: 'ให้คะแนน + ดูผลประเมิน' },
    { id: 'assets', icon: '📦', label: 'ทรัพย์สิน/อุปกรณ์', desc: 'ดูอุปกรณ์ + ขอเบิก/คืน/เปลี่ยน' },
    { id: 'taxcert', icon: '🧾', label: 'หนังสือรับรองหักภาษี (50 ทวิ)', desc: 'สรุปรายได้-ภาษีทั้งปี พิมพ์ได้' },
    { id: 'allowance', icon: '📝', label: 'แบบลดหย่อนภาษี (ลย.01)', desc: 'กรอกค่าลดหย่อนส่งให้ HR' },
    ...(data?.isManager ? [{ id: 'teamleave', icon: '✅', label: 'อนุมัติการลาทีม', desc: 'อนุมัติใบลาของลูกทีม (หัวหน้า)' }] : []),
  ];

  if (subTab === 'expenses') return <ExpensesSection back={() => setSubTab(null)} showToast={showToast} />;
  if (subTab === 'calendar') return <CalendarSection back={() => setSubTab(null)} />;
  if (subTab === 'attendance') return <AttendanceSection back={() => setSubTab(null)} />;
  if (subTab === 'evaluation') return <EvaluationSection back={() => setSubTab(null)} showToast={showToast} />;
  if (subTab === 'taxcert') return <TaxCertSection back={() => setSubTab(null)} profile={data?.profile} />;
  if (subTab === 'allowance') return <AllowanceSection back={() => setSubTab(null)} showToast={showToast} />;
  if (subTab === 'teamleave') return <TeamLeaveSection back={() => setSubTab(null)} showToast={showToast} />;
  if (subTab === 'assets') return <AssetsSection back={() => setSubTab(null)} showToast={showToast} />;

  return (
    <>
      <div className="me-card">
        <div className="me-section-title">📱 เมนูเพิ่มเติม</div>
        {menus.map((m) => (
          <div key={m.id} className="me-row" style={{ cursor: 'pointer', padding: '14px 0' }} onClick={() => setSubTab(m.id)}>
            <span className="k"><span style={{ fontSize: 18, marginRight: 8 }}>{m.icon}</span>{m.label}</span>
            <span className="v" style={{ fontSize: 18, color: '#9aa1b5' }}>›</span>
          </div>
        ))}
      </div>
      <div className="me-card">
        <div className="me-section-title">👤 ข้อมูลส่วนตัว</div>
        <div className="me-row"><span className="k">ชื่อ</span><span className="v">{user.name}</span></div>
        <div className="me-row"><span className="k">Role</span><span className="v">{user.role}</span></div>
        <div className="me-row"><span className="k">รหัสพนักงาน</span><span className="v">{user.employeeId}</span></div>
      </div>
      <button className="me-btn" style={{ background: '#ef4444', marginTop: 10 }} onClick={() => {
        localStorage.removeItem('hr-token');
        localStorage.removeItem('hr-user');
        document.cookie = 'hr-token=; path=/; max-age=0';
        router.push('/');
      }}>🚪 ออกจากระบบ</button>
    </>
  );
}

/* ─── Expenses Sub-section ─── */
function ExpensesSection({ back, showToast }) {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState({ category: 'travel', amount: '', description: '', claim_date: new Date().toISOString().slice(0, 10) });
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch('/api/me/expenses', { headers: authHeaders() })
      .then((r) => r.json()).then((d) => { setItems(d.items || []); setLoaded(true); }).catch(() => setLoaded(true));
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch('/api/me/expenses', { method: 'POST', headers: authHeaders(), body: JSON.stringify(form) });
      const d = await res.json();
      if (!res.ok) { showToast(d.error, true); return; }
      showToast('ยื่นเบิกค่าใช้จ่ายเรียบร้อย');
      setItems((p) => [d.item, ...p]);
      setForm({ category: 'travel', amount: '', description: '', claim_date: new Date().toISOString().slice(0, 10) });
    } catch { showToast('เกิดข้อผิดพลาด', true); }
    finally { setLoading(false); }
  };

  return (
    <>
      <button className="me-badge me-badge-gray" style={{ cursor: 'pointer', border: 'none', marginBottom: 12, padding: '6px 14px' }} onClick={back}>← กลับ</button>
      <div className="me-card">
        <div className="me-section-title">🧾 ยื่นเบิกค่าใช้จ่าย</div>
        <form onSubmit={handleSubmit}>
          <div className="me-field">
            <label>หมวดหมู่</label>
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {EXPENSE_CATS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
          <div className="me-field">
            <label>จำนวนเงิน (บาท)</label>
            <input type="number" className="me-input" min="1" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
          </div>
          <div className="me-field">
            <label>วันที่</label>
            <input type="date" className="me-input" value={form.claim_date} onChange={(e) => setForm({ ...form, claim_date: e.target.value })} required />
          </div>
          <div className="me-field">
            <label>รายละเอียด</label>
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="ระบุรายละเอียด" />
          </div>
          <button className="me-btn" disabled={loading}>{loading ? '⏳ กำลังส่ง...' : '🧾 ยื่นเบิก'}</button>
        </form>
      </div>
      <div className="me-card">
        <div className="me-section-title">📋 รายการเบิกย้อนหลัง</div>
        {!loaded && <div className="me-empty">กำลังโหลด...</div>}
        {loaded && items.length === 0 && <div className="me-empty">ยังไม่มีรายการ</div>}
        {items.map((item) => {
          const badge = STATUS_BADGE[item.status] || STATUS_BADGE.pending;
          const catLabel = EXPENSE_CATS.find((c) => c.value === item.category)?.label || item.category;
          return (
            <div key={item.id} className="me-row">
              <span className="k">{catLabel} · {Number(item.amount).toLocaleString()} ฿</span>
              <span className={`me-badge ${badge.cls}`}>{badge.label}</span>
            </div>
          );
        })}
      </div>
    </>
  );
}

/* ─── Calendar Sub-section ─── */
function CalendarSection({ back }) {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [data, setData] = useState(null);

  useEffect(() => {
    fetch(`/api/me/calendar?month=${month}`, { headers: authHeaders() })
      .then((r) => r.json()).then(setData).catch(() => {});
  }, [month]);

  const [y, m] = month.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const firstDow = new Date(y, m - 1, 1).getDay();
  const DOWS = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];

  const shiftMap = {};
  const leaveMap = {};
  const attendMap = {};
  const holidayMap = {};
  if (data) {
    (data.shifts || []).forEach((s) => { shiftMap[s.shift_date] = s; });
    (data.leaves || []).forEach((l) => { for (let d = new Date(l.start_date); d <= new Date(l.end_date); d.setDate(d.getDate() + 1)) leaveMap[d.toISOString().slice(0, 10)] = l; });
    (data.attendance || []).forEach((a) => { attendMap[a.work_date] = a; });
    (data.holidays || []).forEach((h) => { holidayMap[h.holiday_date] = h; });
  }

  const changeMonth = (delta) => {
    const d = new Date(y, m - 1 + delta, 1);
    setMonth(d.toISOString().slice(0, 7));
  };

  return (
    <>
      <button className="me-badge me-badge-gray" style={{ cursor: 'pointer', border: 'none', marginBottom: 12, padding: '6px 14px' }} onClick={back}>← กลับ</button>
      <div className="me-card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <button className="me-badge me-badge-gray" style={{ cursor: 'pointer', border: 'none' }} onClick={() => changeMonth(-1)}>◀</button>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{new Date(y, m - 1).toLocaleDateString('th-TH', { month: 'long', year: 'numeric' })}</div>
          <button className="me-badge me-badge-gray" style={{ cursor: 'pointer', border: 'none' }} onClick={() => changeMonth(1)}>▶</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, textAlign: 'center', fontSize: 12 }}>
          {DOWS.map((d, i) => <div key={d} style={{ fontWeight: 600, color: i === 0 || i === 6 ? '#dc2626' : '#9aa1b5', padding: 4 }}>{d}</div>)}
          {Array.from({ length: firstDow }, (_, i) => <div key={`e${i}`} />)}
          {Array.from({ length: daysInMonth }, (_, i) => {
            const day = i + 1;
            const dateStr = `${month}-${String(day).padStart(2, '0')}`;
            const isToday = dateStr === new Date().toISOString().slice(0, 10);
            const shift = shiftMap[dateStr];
            const leave = leaveMap[dateStr];
            const attend = attendMap[dateStr];
            const holiday = holidayMap[dateStr];
            const dow = new Date(y, m - 1, day).getDay();
            return (
              <div key={day} style={{
                padding: '6px 2px', borderRadius: 10, minHeight: 52,
                border: isToday ? '2px solid #6d5ef5' : '1px solid #f1f2f8',
                background: holiday ? '#fee2e2' : leave ? '#fef3c7' : attend ? '#f0fdf4' : '#fff',
              }}>
                <div style={{ fontWeight: 600, color: holiday || dow === 0 || dow === 6 ? '#dc2626' : undefined, fontSize: 13 }}>{day}</div>
                {holiday && <div style={{ fontSize: 8.5, color: '#dc2626', lineHeight: 1.1 }} title={holiday.name}>🎌{holiday.name.length > 6 ? holiday.name.slice(0, 6) + '…' : holiday.name}</div>}
                {attend && <div style={{ fontSize: 9, color: '#16a34a' }}>✅{attend.clock_in?.slice(0, 5)}</div>}
                {leave && <div style={{ fontSize: 9, color: '#b45309' }}>🏖️{LEAVE_LABELS[leave.leave_type]?.[0] || 'ลา'}</div>}
                {shift && <div style={{ fontSize: 9, color: '#6d28d9' }}>{shift.shift_type === 'morning' ? '🌅เช้า' : shift.shift_type === 'afternoon' ? '🌇บ่าย' : shift.shift_type === 'night' ? '🌙ดึก' : '⬜หยุด'}</div>}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

/* ─── Attendance Sub-section ─── */
function AttendanceSection({ back }) {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [data, setData] = useState(null);

  useEffect(() => {
    fetch(`/api/me/attendance?month=${month}`, { headers: authHeaders() })
      .then((r) => r.json()).then(setData).catch(() => {});
  }, [month]);

  const [y, m] = month.split('-').map(Number);
  const changeMonth = (delta) => {
    const d = new Date(y, m - 1 + delta, 1);
    setMonth(d.toISOString().slice(0, 7));
  };

  const CHECK_TYPE_LABEL = { office: '🏢 ออฟฟิศ', offsite: '📍 นอกสถานที่', wfh: '🏠 WFH' };

  return (
    <>
      <button className="me-badge me-badge-gray" style={{ cursor: 'pointer', border: 'none', marginBottom: 12, padding: '6px 14px' }} onClick={back}>← กลับ</button>

      {data?.stats && (
        <div className="me-leave-grid" style={{ marginTop: 0, padding: 0, gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 14 }}>
          <div className="me-leave-card"><div className="me-leave-remain" style={{ color: '#16a34a' }}>{data.stats.onTime}</div><div className="me-leave-label">ปกติ</div></div>
          <div className="me-leave-card"><div className="me-leave-remain" style={{ color: '#d97706' }}>{data.stats.late}</div><div className="me-leave-label">สาย</div></div>
          <div className="me-leave-card"><div className="me-leave-remain" style={{ color: '#dc2626' }}>{data.stats.absent}</div><div className="me-leave-label">ขาด</div></div>
        </div>
      )}

      <div className="me-card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <button className="me-badge me-badge-gray" style={{ cursor: 'pointer', border: 'none' }} onClick={() => changeMonth(-1)}>◀</button>
          <div style={{ fontWeight: 700 }}>{new Date(y, m - 1).toLocaleDateString('th-TH', { month: 'long', year: 'numeric' })}</div>
          <button className="me-badge me-badge-gray" style={{ cursor: 'pointer', border: 'none' }} onClick={() => changeMonth(1)}>▶</button>
        </div>
        {!data && <div className="me-empty">กำลังโหลด...</div>}
        {data?.records?.length === 0 && <div className="me-empty">ไม่มีข้อมูลเดือนนี้</div>}
        {(data?.records || []).map((r) => (
          <div key={r.id} className="me-row" style={{ flexWrap: 'wrap' }}>
            <span className="k" style={{ minWidth: 80 }}>{r.work_date?.slice(5)}</span>
            <span style={{ fontSize: 12 }}>{CHECK_TYPE_LABEL[r.check_type] || '🏢'}</span>
            <span className="v">
              {r.clock_in ? `🟢${r.clock_in.slice(0, 5)}` : '—'}
              {' → '}
              {r.clock_out ? `🔴${r.clock_out.slice(0, 5)}` : '—'}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

/* ─── Evaluation Sub-section ─── */
function EvaluationSection({ back, showToast }) {
  const [data, setData] = useState(null);
  const [viewTab, setViewTab] = useState('give'); // give | received

  useEffect(() => {
    fetch('/api/me/evaluations', { headers: authHeaders() })
      .then((r) => r.json()).then(setData).catch(() => {});
  }, []);

  return (
    <>
      <button className="me-badge me-badge-gray" style={{ cursor: 'pointer', border: 'none', marginBottom: 12, padding: '6px 14px' }} onClick={back}>← กลับ</button>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button className={`me-badge ${viewTab === 'give' ? 'me-badge-purple' : 'me-badge-gray'}`}
          style={{ cursor: 'pointer', border: 'none', padding: '8px 16px' }} onClick={() => setViewTab('give')}>
          ⭐ ฉันประเมิน
        </button>
        <button className={`me-badge ${viewTab === 'received' ? 'me-badge-purple' : 'me-badge-gray'}`}
          style={{ cursor: 'pointer', border: 'none', padding: '8px 16px' }} onClick={() => setViewTab('received')}>
          📊 ผลประเมินฉัน
        </button>
      </div>

      {!data && <div className="me-empty">กำลังโหลด...</div>}

      {viewTab === 'give' && data && (
        <div className="me-card">
          <div className="me-section-title">⭐ รายการที่ฉันประเมิน</div>
          {(data.myEvaluations || []).length === 0 && <div className="me-empty">ยังไม่มีรายการ</div>}
          {(data.myEvaluations || []).map((e) => {
            const badge = STATUS_BADGE[e.status] || STATUS_BADGE.draft;
            return (
              <div key={e.id} className="me-row">
                <span className="k">ประเมิน {e.target_id} · รอบ {e.period}</span>
                <span className={`me-badge ${badge.cls}`}>{badge.label}</span>
              </div>
            );
          })}
        </div>
      )}

      {viewTab === 'received' && data && (
        <div className="me-card">
          <div className="me-section-title">📊 คะแนนเฉลี่ยที่ฉันได้รับ</div>
          {!data.avgScores && <div className="me-empty">ยังไม่มีผลประเมิน</div>}
          {data.avgScores && (data.criteria || []).map((c) => (
            <div key={c.key} className="me-row">
              <span className="k">{c.label}</span>
              <span className="v">{data.avgScores[c.key] != null ? `${data.avgScores[c.key]} / 5` : '—'}</span>
            </div>
          ))}
          <div style={{ marginTop: 12, fontSize: 12, color: '#9aa1b5' }}>
            จากผู้ประเมิน {data.receivedEvaluations?.length || 0} คน
          </div>
        </div>
      )}
    </>
  );
}

/* ─── 50 ทวิ (หนังสือรับรองหักภาษี ณ ที่จ่าย) ─── */
function TaxCertSection({ back, profile }) {
  const thisYearBE = new Date().getFullYear() + 543;
  const [year, setYear] = useState(thisYearBE);
  const [data, setData] = useState(null);
  const [showDoc, setShowDoc] = useState(false);

  useEffect(() => {
    fetch(`/api/me/tax-cert?year=${year}`, { headers: authHeaders() })
      .then((r) => r.json()).then(setData).catch(() => {});
  }, [year]);

  const num = (v) => Number(v || 0).toLocaleString();

  return (
    <>
      <button className="me-badge me-badge-gray" style={{ cursor: 'pointer', border: 'none', marginBottom: 12, padding: '6px 14px' }} onClick={back}>← กลับ</button>
      <div className="me-card">
        <div className="me-section-title">🧾 หนังสือรับรองหักภาษี ณ ที่จ่าย (50 ทวิ)</div>
        <div className="me-field">
          <label>ปีภาษี (พ.ศ.)</label>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {[thisYearBE, thisYearBE - 1, thisYearBE - 2].map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        {data && (
          <>
            <div className="me-row"><span className="k">เงินได้รวมทั้งปี</span><span className="v">{num(data.totalIncome)} ฿</span></div>
            <div className="me-row"><span className="k">ภาษีหัก ณ ที่จ่ายรวม</span><span className="v">{num(data.totalTax)} ฿</span></div>
            <div className="me-row"><span className="k">ประกันสังคมรวม</span><span className="v">{num(data.totalSso)} ฿</span></div>
            <div className="me-row"><span className="k">จำนวนงวด</span><span className="v">{data.months} งวด</span></div>
            {data.months > 0
              ? <button className="me-btn" style={{ marginTop: 12 }} onClick={() => setShowDoc(true)}>🖨️ ดู/พิมพ์ 50 ทวิ (PDF)</button>
              : <div className="me-empty">ยังไม่มีข้อมูลเงินเดือนในปีนี้</div>}
          </>
        )}
      </div>
      {showDoc && data && <TaxCertDocument cert={data} profile={profile} onClose={() => setShowDoc(false)} />}
    </>
  );
}

function TaxCertDocument({ cert, profile, onClose }) {
  const num = (v) => Number(v || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (
    <div className="me-doc-overlay">
      <div className="me-doc-actions">
        <button className="me-badge me-badge-gray" style={{ border: 'none', padding: '8px 14px', cursor: 'pointer' }} onClick={onClose}>← ปิด</button>
        <button className="me-badge me-badge-purple" style={{ border: 'none', padding: '8px 14px', cursor: 'pointer' }} onClick={() => window.print()}>🖨️ พิมพ์ / บันทึก PDF</button>
      </div>
      <div className="me-doc-print">
        <div className="me-doc">
          <div className="me-doc-head">
            <div className="me-doc-co">{COMPANY.name}</div>
            <div className="me-doc-addr">{COMPANY.address}</div>
            <div className="me-doc-title">หนังสือรับรองการหักภาษี ณ ที่จ่าย (ตามมาตรา 50 ทวิ) — ปีภาษี {cert.year}</div>
          </div>
          <table className="me-doc-meta">
            <tbody>
              <tr><td>ผู้มีเงินได้</td><td>{profile?.name || '-'}</td><td>รหัสพนักงาน</td><td>{profile?.employeeId || '-'}</td></tr>
              <tr><td>เลขประจำตัวผู้เสียภาษี</td><td>{profile?.taxId || '-'}</td><td>เลขบัตรประชาชน</td><td>{profile?.nationalId || '-'}</td></tr>
            </tbody>
          </table>
          <table className="me-doc-table">
            <thead><tr><th>รายการ</th><th className="r">จำนวนเงิน (บาท)</th></tr></thead>
            <tbody>
              <tr><td>เงินได้พึงประเมินทั้งปี (เงินเดือน + OT + โบนัส)</td><td className="r">{num(cert.totalIncome)}</td></tr>
              <tr><td>ภาษีที่หักและนำส่ง</td><td className="r">{num(cert.totalTax)}</td></tr>
              <tr><td>เงินสมทบประกันสังคม</td><td className="r">{num(cert.totalSso)}</td></tr>
            </tbody>
          </table>
          <div className="me-doc-sign">
            <div>ลงชื่อ ......................................... ผู้จ่ายเงิน</div>
            <div>วันที่ ......./......./.........</div>
          </div>
          <div className="me-doc-foot">ออกให้เพื่อเป็นหลักฐานในการยื่นแบบแสดงรายการภาษีเงินได้บุคคลธรรมดา</div>
        </div>
      </div>
    </div>
  );
}

/* ─── แบบลดหย่อนภาษี (ลย.01) ─── */
const ALLOWANCE_FIELDS = [
  { key: 'spouse', label: 'คู่สมรสไม่มีเงินได้ (60,000)' },
  { key: 'children', label: 'จำนวนบุตร (คนละ 30,000)' },
  { key: 'parents', label: 'บิดามารดา (คนละ 30,000)' },
  { key: 'life_insurance', label: 'เบี้ยประกันชีวิต (บาท)' },
  { key: 'health_insurance', label: 'เบี้ยประกันสุขภาพ (บาท)' },
  { key: 'provident_fund', label: 'กองทุนสำรองเลี้ยงชีพ (บาท)' },
  { key: 'donation', label: 'เงินบริจาค (บาท)' },
  { key: 'mortgage', label: 'ดอกเบี้ยกู้ซื้อบ้าน (บาท)' },
];

function AllowanceSection({ back, showToast }) {
  const thisYearBE = new Date().getFullYear() + 543;
  const [year, setYear] = useState(thisYearBE);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`/api/me/allowances?year=${year}`, { headers: authHeaders() })
      .then((r) => r.json()).then((d) => setForm(d.allowance?.data || {})).catch(() => {});
  }, [year]);

  const save = async () => {
    setSaving(true);
    const res = await fetch('/api/me/allowances', {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ year, data: form }),
    });
    setSaving(false);
    if (res.ok) showToast('บันทึกแบบลดหย่อนแล้ว ส่งให้ HR เรียบร้อย');
    else showToast('บันทึกไม่สำเร็จ', true);
  };

  return (
    <>
      <button className="me-badge me-badge-gray" style={{ cursor: 'pointer', border: 'none', marginBottom: 12, padding: '6px 14px' }} onClick={back}>← กลับ</button>
      <div className="me-card">
        <div className="me-section-title">📝 แบบแจ้งรายการลดหย่อนภาษี (ลย.01)</div>
        <div className="me-field">
          <label>ปีภาษี (พ.ศ.)</label>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {[thisYearBE, thisYearBE + 1].map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        {ALLOWANCE_FIELDS.map((f) => (
          <div className="me-field" key={f.key}>
            <label>{f.label}</label>
            <input className="me-input" type="number" value={form[f.key] ?? ''}
              onChange={(e) => setForm((p) => ({ ...p, [f.key]: e.target.value === '' ? '' : Number(e.target.value) }))} />
          </div>
        ))}
        <button className="me-btn" disabled={saving} onClick={save}>{saving ? 'กำลังบันทึก...' : '💾 บันทึกส่งให้ HR'}</button>
      </div>
    </>
  );
}

/* ─── อนุมัติการลาทีม (สำหรับหัวหน้า) ─── */
function TeamLeaveSection({ back, showToast }) {
  const [items, setItems] = useState([]);
  const [loaded, setLoaded] = useState(false);

  const load = () => fetch('/api/me/team-leave', { headers: authHeaders() })
    .then((r) => r.json()).then((d) => { setItems(d.items || []); setLoaded(true); }).catch(() => setLoaded(true));

  useEffect(() => { load(); }, []);

  const act = async (id, action) => {
    const res = await fetch('/api/me/team-leave', {
      method: 'POST', headers: authHeaders(), body: JSON.stringify({ id, action }),
    });
    const d = await res.json();
    if (res.ok) { showToast(action === 'approve' ? 'อนุมัติแล้ว (ส่งต่อ HR)' : 'ปฏิเสธแล้ว'); load(); }
    else showToast(d.error || 'ไม่สำเร็จ', true);
  };

  const LB = { annual: 'พักร้อน', sick: 'ลาป่วย', personal: 'ลากิจ' };

  return (
    <>
      <button className="me-badge me-badge-gray" style={{ cursor: 'pointer', border: 'none', marginBottom: 12, padding: '6px 14px' }} onClick={back}>← กลับ</button>
      <div className="me-card">
        <div className="me-section-title">✅ อนุมัติการลาของลูกทีม</div>
        {loaded && items.length === 0 && <div className="me-empty">ไม่มีใบลา</div>}
        {items.map((l) => (
          <div key={l.id} style={{ borderTop: '1px solid #f1f2f8', padding: '10px 0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontWeight: 600 }}>{l.employeeName}</span>
              <span className={`me-badge ${l.manager_status === 'pending' ? 'me-badge-yellow' : l.manager_status === 'approved' ? 'me-badge-green' : 'me-badge-red'}`}>
                {l.manager_status === 'pending' ? 'รออนุมัติ' : l.manager_status === 'approved' ? 'อนุมัติแล้ว' : 'ปฏิเสธ'}
              </span>
            </div>
            <div style={{ fontSize: 13, color: '#5b6478', margin: '4px 0' }}>
              {LB[l.leave_type] || l.leave_type} · {l.days} วัน · {l.start_date} ถึง {l.end_date}
            </div>
            {l.reason && <div style={{ fontSize: 12.5, color: '#9aa1b5' }}>เหตุผล: {l.reason}</div>}
            {l.manager_status === 'pending' && (
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button className="me-btn" style={{ flex: 1, background: 'linear-gradient(135deg,#16a34a,#22c55e)' }} onClick={() => act(l.id, 'approve')}>✓ อนุมัติ</button>
                <button className="me-btn" style={{ flex: 1, background: 'linear-gradient(135deg,#ef4444,#f87171)' }} onClick={() => act(l.id, 'reject')}>✗ ปฏิเสธ</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

/* ─── ทรัพย์สิน/อุปกรณ์ (พนักงาน: ดู + ขอเบิก/คืน/เปลี่ยน) ─── */
const ASSET_STATUS = { available: { c: 'me-badge-green', l: 'ว่าง' }, assigned: { c: 'me-badge-blue', l: 'มีคนใช้' }, repair: { c: 'me-badge-yellow', l: 'ส่งซ่อม' }, retired: { c: 'me-badge-gray', l: 'ปลดระวาง' } };
const ASSET_REQ_TYPE = { borrow: 'ขอเบิก', return: 'ขอคืน', replace: 'ขอเปลี่ยน' };

function assetImg(file) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('hr-token') : '';
  return `/api/assets/image?file=${encodeURIComponent(file)}&token=${encodeURIComponent(token || '')}`;
}

function AssetsSection({ back, showToast }) {
  const [data, setData] = useState(null);
  const [modal, setModal] = useState(null); // { asset, type }
  const [targetBranch, setTargetBranch] = useState('');
  const [reason, setReason] = useState('');

  const load = () => fetch('/api/me/assets', { headers: authHeaders() }).then((r) => r.json()).then(setData).catch(() => {});
  useEffect(() => { load(); }, []);

  const openReq = (asset, type) => { setModal({ asset, type }); setTargetBranch(''); setReason(''); };

  const submit = async () => {
    const res = await fetch('/api/me/assets', {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ asset_id: modal.asset.id, type: modal.type, target_branch_id: targetBranch || null, reason }),
    });
    const d = await res.json();
    if (res.ok) { showToast('ส่งคำขอแล้ว รอ HR อนุมัติ'); setModal(null); load(); }
    else showToast(d.error || 'ส่งไม่สำเร็จ', true);
  };

  if (!data) return <div className="me-empty">กำลังโหลด...</div>;

  return (
    <>
      <button className="me-badge me-badge-gray" style={{ cursor: 'pointer', border: 'none', marginBottom: 12, padding: '6px 14px' }} onClick={back}>← กลับ</button>

      {data.myRequests.length > 0 && (
        <div className="me-card">
          <div className="me-section-title">📨 คำขอของฉัน</div>
          {data.myRequests.map((r) => (
            <div key={r.id} className="me-row">
              <span className="k">{ASSET_REQ_TYPE[r.type]} · #{r.asset_id}</span>
              <span className={`me-badge ${STATUS_BADGE[r.status]?.cls || 'me-badge-yellow'}`}>{STATUS_BADGE[r.status]?.label || r.status}</span>
            </div>
          ))}
        </div>
      )}

      <div className="me-card">
        <div className="me-section-title">📦 ทรัพย์สิน/อุปกรณ์</div>
        {data.assets.length === 0 && <div className="me-empty">ยังไม่มีทรัพย์สิน</div>}
        {data.assets.map((a) => (
          <div key={a.id} style={{ borderTop: '1px solid #f1f2f8', padding: '10px 0', display: 'flex', gap: 12 }}>
            {a.imageUrl
              ? <img src={assetImg(a.imageUrl)} alt="" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 10 }} />
              : <div style={{ width: 56, height: 56, borderRadius: 10, background: '#f1f2f8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26 }}>📦</div>}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontWeight: 600 }}>{a.name}</span>
                <span className={`me-badge ${ASSET_STATUS[a.status]?.c || 'me-badge-gray'}`}>{ASSET_STATUS[a.status]?.l || a.status}</span>
              </div>
              <div style={{ fontSize: 12, color: '#9aa1b5' }}>{a.code} · {a.category || '-'} · 🏬 {a.branchName}</div>
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                {a.status === 'available' && !a.isMine &&
                  <button className="me-btn" style={{ padding: '7px 12px', width: 'auto', fontSize: 13 }} onClick={() => openReq(a, 'borrow')}>เบิก</button>}
                {a.isMine && <>
                  <button className="me-btn" style={{ padding: '7px 12px', width: 'auto', fontSize: 13, background: 'linear-gradient(135deg,#16a34a,#22c55e)' }} onClick={() => openReq(a, 'return')}>คืน</button>
                  <button className="me-btn" style={{ padding: '7px 12px', width: 'auto', fontSize: 13, background: 'linear-gradient(135deg,#f59e0b,#fbbf24)' }} onClick={() => openReq(a, 'replace')}>ขอเปลี่ยน</button>
                </>}
              </div>
            </div>
          </div>
        ))}
      </div>

      {modal && (
        <div className="me-doc-overlay" style={{ background: 'rgba(29,36,51,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setModal(null)}>
          <div className="me-card" style={{ maxWidth: 360, width: '100%' }} onClick={(e) => e.stopPropagation()}>
            <div className="me-section-title">{ASSET_REQ_TYPE[modal.type]} · {modal.asset.name}</div>
            {modal.type !== 'return' && (
              <div className="me-field">
                <label>จัดส่งไปสาขา</label>
                <select value={targetBranch} onChange={(e) => setTargetBranch(e.target.value)}>
                  <option value="">— เลือกสาขา —</option>
                  {data.branches.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
                </select>
              </div>
            )}
            <div className="me-field"><label>เหตุผล/รายละเอียด</label><textarea value={reason} onChange={(e) => setReason(e.target.value)} /></div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="me-btn" style={{ background: '#9aa1b5' }} onClick={() => setModal(null)}>ยกเลิก</button>
              <button className="me-btn" onClick={submit}>ส่งคำขอ</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
