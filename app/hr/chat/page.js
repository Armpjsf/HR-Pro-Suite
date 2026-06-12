'use client';

import { useState, useEffect, useRef } from 'react';

const SUGGESTIONS = [
  { icon: '📄', text: 'ขอ Template ใบสมัครงาน' },
  { icon: '📅', text: 'วันลาคงเหลือของฉัน' },
  { icon: '📋', text: 'ระเบียบการแต่งกาย' },
  { icon: '🏥', text: 'สวัสดิการพนักงานมีอะไรบ้าง' },
  { icon: '📝', text: 'ขอใบลาพักร้อน' },
  { icon: '📢', text: 'ประกาศล่าสุดของบริษัท' },
];

function authHeaders() {
  const token = typeof window !== 'undefined' ? localStorage.getItem('hr-token') : '';
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

export default function HrChatPage() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const endRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

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
      setMessages((p) => [...p, {
        id: Date.now() + 1,
        role: 'ai',
        content: d.reply || d.error || 'เกิดข้อผิดพลาด',
        documents: d.documents || [],
        time,
      }]);
    } catch {
      setMessages((p) => [...p, { id: Date.now() + 1, role: 'ai', content: '❌ ไม่สามารถเชื่อมต่อได้', time }]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 120px)' }}>
      {/* Messages area */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 0' }}>
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px 20px' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>🤖</div>
            <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>HR AI Assistant</h2>
            <p style={{ color: '#9aa1b5', fontSize: 14, marginBottom: 24 }}>ถามอะไรก็ได้เกี่ยวกับ HR ระเบียบบริษัท หรือขอเอกสาร</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'center' }}>
              {SUGGESTIONS.map((s, i) => (
                <button key={i} onClick={() => send(s.text)} className="hr-btn" style={{ fontSize: 13 }}>
                  {s.icon} {s.text}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start', marginBottom: 12, padding: '0 4px' }}>
            {m.role === 'ai' && <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#f1f0fe', display: 'flex', alignItems: 'center', justifyContent: 'center', marginRight: 8, flexShrink: 0, fontSize: 18 }}>🤖</div>}
            <div style={{
              maxWidth: '70%', padding: '12px 16px', borderRadius: 16,
              background: m.role === 'user' ? 'linear-gradient(135deg,#6d5ef5,#8b7cf8)' : '#fff',
              color: m.role === 'user' ? '#fff' : '#1d2433',
              border: m.role === 'ai' ? '1px solid #e7e9f4' : 'none',
              boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
              fontSize: 14, lineHeight: 1.7, whiteSpace: 'pre-wrap',
            }}>
              {m.content}
              {m.documents?.length > 0 && (
                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {m.documents.map((doc) => (
                    <a key={doc.id} href={`/api/documents/${doc.id}/download?token=${localStorage.getItem('hr-token')}`}
                      target="_blank" rel="noreferrer"
                      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 10, background: 'rgba(109,94,245,0.08)', textDecoration: 'none', color: '#6d5ef5', fontSize: 13 }}>
                      📎 {doc.name} <span style={{ fontSize: 11, color: '#9aa1b5' }}>{doc.size}</span>
                    </a>
                  ))}
                </div>
              )}
              <div style={{ fontSize: 10, opacity: 0.5, marginTop: 4, textAlign: 'right' }}>{m.time}</div>
            </div>
          </div>
        ))}
        {loading && (
          <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 12, padding: '0 4px' }}>
            <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#f1f0fe', display: 'flex', alignItems: 'center', justifyContent: 'center', marginRight: 8, fontSize: 18 }}>🤖</div>
            <div style={{ padding: '12px 20px', borderRadius: 16, background: '#fff', border: '1px solid #e7e9f4' }}>
              <span style={{ fontSize: 16, animation: 'pulse 1.5s infinite' }}>⏳</span>
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Input */}
      <div style={{ borderTop: '1px solid #e7e9f4', padding: '12px 0', display: 'flex', gap: 10 }}>
        <input ref={inputRef} className="hr-search" placeholder="พิมพ์คำถาม..."
          value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); send(input); } }}
          disabled={loading} style={{ flex: 1, maxWidth: 'none' }} />
        <button className="hr-btn hr-btn-primary" disabled={!input.trim() || loading} onClick={() => send(input)}
          style={{ padding: '10px 20px' }}>
          {loading ? '⏳' : '➤ ส่ง'}
        </button>
      </div>
    </div>
  );
}
