'use client';

import { useState, useEffect, useRef } from 'react';
import { AppIcon } from '@/components/ui/Icons';

const SUGGESTIONS = [
  { icon: 'documents', text: 'ขอ Template ใบสมัครงาน' },
  { icon: 'calendar', text: 'วันลาคงเหลือของฉัน' },
  { icon: 'file-text', text: 'ระเบียบการแต่งกาย' },
  { icon: 'gift', text: 'สวัสดิการพนักงานมีอะไรบ้าง' },
  { icon: 'leave', text: 'ขอใบลาพักร้อน' },
  { icon: 'announcements', text: 'ประกาศล่าสุดของบริษัท' },
];

function authHeaders() {
  const token = typeof window !== 'undefined' ? localStorage.getItem('hr-token') : '';
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

function renderFormattedText(text) {
  if (!text) return '';
  const parts = String(text).split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}

export default function HrChatPage() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const endRef = useRef(null);
  const inputRef = useRef(null);

  // โหลดประวัติแชทจาก sessionStorage เมื่อเปิดหน้าเว็บ
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem('hr-web-chat-messages');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setMessages(parsed);
        }
      }
    } catch (e) {
      console.warn('Failed to load chat history:', e);
    }
  }, []);

  // บันทึกประวัติแชทลง sessionStorage ทุกครั้งที่ข้อความเปลี่ยน
  useEffect(() => {
    try {
      if (messages.length > 0) {
        sessionStorage.setItem('hr-web-chat-messages', JSON.stringify(messages));
      }
    } catch (e) {
      console.warn('Failed to save chat history:', e);
    }
  }, [messages]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const clearChat = () => {
    setMessages([]);
    try {
      sessionStorage.removeItem('hr-web-chat-messages');
    } catch {}
  };

  const send = async (text) => {
    if (!text.trim() || loading) return;
    const time = new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
    const outgoing = text.trim();
    const history = messages.slice(-8).map((m) => ({ role: m.role, content: m.content }));
    setMessages((p) => [...p, { id: Date.now(), role: 'user', content: outgoing, time }]);
    setInput('');
    setLoading(true);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ message: outgoing, history }),
      });
      const d = await res.json();
      setMessages((p) => [...p, {
        id: Date.now() + 1,
        role: 'ai',
        content: d.reply || d.error || 'เกิดข้อผิดพลาด',
        documents: d.documents || [],
        source: d.source,
        time,
      }]);
    } catch {
      setMessages((p) => [...p, { id: Date.now() + 1, role: 'ai', content: 'ไม่สามารถเชื่อมต่อได้', time }]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 120px)' }}>
      {/* Header bar when messages exist */}
      {messages.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 8px 8px', borderBottom: '1px solid #E2E8F0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#64748B' }}>
            <AppIcon name="chat" size={15} />
            <span>การสนทนากับพี่ HR</span>
          </div>
          <button onClick={clearChat} className="hr-btn" style={{ fontSize: 12, padding: '4px 10px', background: '#fff', border: '1px solid #E2E8F0', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <AppIcon name="trash" size={13} />
            <span>ล้างแชท</span>
          </button>
        </div>
      )}

      {/* Messages area */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 0' }}>
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px 20px' }}>
            <div style={{ width: 56, height: 56, borderRadius: 16, background: '#E0F2FE', color: '#0284C7', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
              <AppIcon name="bot" size={32} />
            </div>
            <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8, color: '#0F172A' }}>HR AI Assistant</h2>
            <p style={{ color: '#64748B', fontSize: 14, marginBottom: 24 }}>ถามอะไรก็ได้เกี่ยวกับ HR ระเบียบบริษัท หรือขอเอกสาร</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'center' }}>
              {SUGGESTIONS.map((s, i) => (
                <button
                  key={i}
                  onClick={() => send(s.text)}
                  className="hr-btn"
                  style={{ fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }}
                >
                  <AppIcon name={s.icon} size={14} style={{ color: '#0284C7' }} />
                  <span>{s.text}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start', marginBottom: 12, padding: '0 4px' }}>
            {m.role === 'ai' && (
              <div style={{ width: 34, height: 34, borderRadius: '50%', background: '#E0F2FE', color: '#0284C7', display: 'flex', alignItems: 'center', justifyContent: 'center', marginRight: 8, flexShrink: 0 }}>
                <AppIcon name="bot" size={18} />
              </div>
            )}
            <div style={{
              maxWidth: '70%', padding: '12px 16px', borderRadius: 16,
              background: m.role === 'user' ? 'linear-gradient(135deg, #0F2942 0%, #0284C7 100%)' : '#FFFFFF',
              color: m.role === 'user' ? '#FFFFFF' : '#0F172A',
              border: m.role === 'ai' ? '1px solid #E2E8F0' : 'none',
              boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
              fontSize: 14, lineHeight: 1.7, whiteSpace: 'pre-wrap',
            }}>
              {renderFormattedText(m.content)}
              {m.documents?.length > 0 && (
                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {m.documents.map((doc) => (
                    <a key={doc.id} href={`/api/documents/${doc.id}/download?token=${localStorage.getItem('hr-token')}`}
                      target="_blank" rel="noreferrer"
                      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 10, background: 'rgba(2, 132, 199, 0.08)', textDecoration: 'none', color: '#0284C7', fontSize: 13 }}>
                      <AppIcon name="download" size={14} />
                      <span style={{ flex: 1 }}>{doc.name}</span>
                      <span style={{ fontSize: 11, color: '#64748B' }}>{doc.size}</span>
                    </a>
                  ))}
                </div>
              )}
              <div style={{ fontSize: 10, opacity: 0.6, marginTop: 4, textAlign: 'right' }}>{m.time}</div>
            </div>
          </div>
        ))}
        {loading && (
          <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 12, padding: '0 4px' }}>
            <div style={{ width: 34, height: 34, borderRadius: '50%', background: '#E0F2FE', color: '#0284C7', display: 'flex', alignItems: 'center', justifyContent: 'center', marginRight: 8 }}>
              <AppIcon name="bot" size={18} />
            </div>
            <div style={{ padding: '12px 20px', borderRadius: 16, background: '#FFFFFF', border: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', gap: 6, color: '#64748B' }}>
              <AppIcon name="clock" size={16} />
              <span style={{ fontSize: 13 }}>กำลังประมวลผลคำตอบ...</span>
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Input */}
      <div style={{ borderTop: '1px solid #E2E8F0', padding: '12px 0', display: 'flex', gap: 10 }}>
        <input ref={inputRef} className="hr-search" placeholder="พิมพ์คำถามเกี่ยวกับระเบียบ หรือบริการ HR..."
          value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); send(input); } }}
          disabled={loading} style={{ flex: 1, maxWidth: 'none' }} />
        <button className="hr-btn hr-btn-primary" disabled={!input.trim() || loading} onClick={() => send(input)}
          style={{ padding: '10px 20px', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {loading ? (
            <AppIcon name="clock" size={15} />
          ) : (
            <>
              <AppIcon name="send" size={15} />
              <span>ส่ง</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
