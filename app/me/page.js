'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
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
        {tab === 'more' && <MoreTab user={user} router={router} showToast={showToast} />}
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
      setMessages((p) => [...p, { id: Date.now() + 1, role: 'ai', content: d.reply || d.error || 'เกิดข้อผิดพลาด', time }]);
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

  return (
    <>
      {selected && (
        <div className="me-card">
          <div className="me-section-title">💰 สลิปเงินเดือน งวด {selected.period}</div>
          <div className="me-row"><span className="k">เงินเดือน</span><span className="v">{Number(selected.base_salary).toLocaleString()} ฿</span></div>
          <div className="me-row"><span className="k">ค่าล่วงเวลา (OT)</span><span className="v">{Number(selected.ot_pay).toLocaleString()} ฿</span></div>
          <div className="me-row"><span className="k">โบนัส</span><span className="v">{Number(selected.bonus).toLocaleString()} ฿</span></div>
          <div className="me-row"><span className="k">รายการหัก</span><span className="v" style={{ color: '#dc2626' }}>-{Number(selected.deduction).toLocaleString()} ฿</span></div>
          <div className="me-row" style={{ borderTop: '2px solid #e7e9f4' }}>
            <span className="k" style={{ fontWeight: 700 }}>รับสุทธิ</span>
            <span className="me-slip-net">{Number(selected.net).toLocaleString()} ฿</span>
          </div>
        </div>
      )}
      <div className="me-card">
        <div className="me-section-title">📋 สลิปย้อนหลัง</div>
        {slips.length === 0 && <div className="me-empty">ยังไม่มีข้อมูล</div>}
        {slips.map((s) => (
          <div key={s.id} className="me-row" style={{ cursor: 'pointer' }} onClick={() => setSelected(s)}>
            <span className="k">งวด {s.period}</span>
            <span className="v">{Number(s.net).toLocaleString()} ฿</span>
          </div>
        ))}
      </div>
    </>
  );
}

/* ═══════════════════ MORE TAB ═══════════════════ */
function MoreTab({ user, router, showToast }) {
  const [subTab, setSubTab] = useState(null);

  const menus = [
    { id: 'expenses', icon: '🧾', label: 'เบิกค่าใช้จ่าย', desc: 'ยื่นเบิกค่าเดินทาง เบี้ยเลี้ยง ฯลฯ' },
    { id: 'calendar', icon: '📆', label: 'ปฏิทินงาน', desc: 'ดูตารางกะ วันลา วันหยุด' },
    { id: 'attendance', icon: '⏰', label: 'ประวัติเข้า-ออกงาน', desc: 'ดูสถิติ Clock-in/out ย้อนหลัง' },
    { id: 'evaluation', icon: '⭐', label: 'ประเมินเพื่อนร่วมงาน', desc: 'ให้คะแนน + ดูผลประเมิน' },
  ];

  if (subTab === 'expenses') return <ExpensesSection back={() => setSubTab(null)} showToast={showToast} />;
  if (subTab === 'calendar') return <CalendarSection back={() => setSubTab(null)} />;
  if (subTab === 'attendance') return <AttendanceSection back={() => setSubTab(null)} />;
  if (subTab === 'evaluation') return <EvaluationSection back={() => setSubTab(null)} showToast={showToast} />;

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
  if (data) {
    (data.shifts || []).forEach((s) => { shiftMap[s.shift_date] = s; });
    (data.leaves || []).forEach((l) => { for (let d = new Date(l.start_date); d <= new Date(l.end_date); d.setDate(d.getDate() + 1)) leaveMap[d.toISOString().slice(0, 10)] = l; });
    (data.attendance || []).forEach((a) => { attendMap[a.work_date] = a; });
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
            const dow = new Date(y, m - 1, day).getDay();
            return (
              <div key={day} style={{
                padding: '6px 2px', borderRadius: 10, minHeight: 52,
                border: isToday ? '2px solid #6d5ef5' : '1px solid #f1f2f8',
                background: leave ? '#fef3c7' : attend ? '#f0fdf4' : '#fff',
              }}>
                <div style={{ fontWeight: 600, color: dow === 0 || dow === 6 ? '#dc2626' : undefined, fontSize: 13 }}>{day}</div>
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
