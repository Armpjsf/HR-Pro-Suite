'use client';

import { useState, useEffect, useRef } from 'react';
import { AppIcon } from '@/components/ui/Icons';

function authHeaders() {
  const token = typeof window !== 'undefined' ? localStorage.getItem('hr-token') : '';
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

export function renderChatMarkdown(text) {
  if (!text) return '';
  const parts = String(text).split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}

const SUGGESTIONS = [
  { icon: 'calendar', text: 'วันลาคงเหลือของฉัน' },
  { icon: 'file-text', text: 'ระเบียบบริษัท' },
  { icon: 'benefits', text: 'สวัสดิการพนักงาน' },
  { icon: 'leave', text: 'ขอใบลาพักร้อน' },
  { icon: 'megaphone', text: 'ประกาศล่าสุดของบริษัท' },
  { icon: 'user', text: 'ติดต่อ HR' },
];

export default function ChatTab({ user }) {
  const [messages, setMessages] = useState(() => {
    if (typeof window === 'undefined') return [];
    try {
      const saved = sessionStorage.getItem('hr-me-chat-messages');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return [];
  });
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const endRef = useRef(null);
  const seqRef = useRef(1);

  // บันทึกประวัติแชทลง sessionStorage ทุกครั้งที่ข้อความเปลี่ยน
  useEffect(() => {
    try {
      if (messages.length > 0) {
        sessionStorage.setItem('hr-me-chat-messages', JSON.stringify(messages));
      }
    } catch (e) {
      console.warn('Failed to save chat history:', e);
    }
  }, [messages]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const clearChat = () => {
    setMessages([]);
    try {
      sessionStorage.removeItem('hr-me-chat-messages');
    } catch {}
  };

  const send = async (text) => {
    if (!text.trim() || loading) return;
    const time = new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
    seqRef.current += 1;
    const userMsg = { id: `u-${seqRef.current}`, role: 'user', content: text.trim(), time };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput('');
    setLoading(true);
    try {
      const history = messages.map((m) => ({
        role: m.role === 'ai' ? 'assistant' : 'user',
        content: m.content,
      }));
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ message: text.trim(), history }),
      });
      const d = await res.json();
      seqRef.current += 1;
      setMessages((p) => [
        ...p,
        {
          id: `a-${seqRef.current}`,
          role: 'ai',
          content: d.reply || d.error || 'เกิดข้อผิดพลาดในการประมวลผล',
          documents: d.documents || [],
          time,
        },
      ]);
    } catch {
      seqRef.current += 1;
      setMessages((p) => [
        ...p,
        { id: `e-${seqRef.current}`, role: 'ai', content: 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ในขณะนี้', time },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 'calc(100vh - 200px)' }}>
      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 12 }}>
        {messages.length > 0 && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10, padding: '0 4px' }}>
            <button
              onClick={clearChat}
              style={{
                border: 'none',
                background: 'transparent',
                color: '#64748B',
                fontSize: 12,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
              }}
            >
              <AppIcon name="refresh" size={13} /> ล้างประวัติแชท
            </button>
          </div>
        )}

        {messages.length === 0 && (
          <div style={{ textAlign: 'center', padding: '36px 8px' }}>
            <div
              style={{
                width: 60,
                height: 60,
                borderRadius: '50%',
                background: 'rgba(2, 132, 199, 0.1)',
                color: '#0284C7',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 12,
              }}
            >
              <AppIcon name="chat" size={30} />
            </div>
            <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 6, color: '#0F172A' }}>
              HR AI Assistant
            </div>
            <div style={{ fontSize: 13, color: '#64748B', marginBottom: 20 }}>
              สอบถามข้อมูลวันลา สวัสดิการ ระเบียบบริษัท หรือการทำงานได้ทันที
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
              {SUGGESTIONS.map((s, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => send(s.text)}
                  style={{
                    padding: '9px 14px',
                    borderRadius: 14,
                    border: '1px solid #E2E8F0',
                    background: '#FFFFFF',
                    cursor: 'pointer',
                    fontSize: 13,
                    color: '#0F172A',
                    fontWeight: 500,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)',
                  }}
                >
                  <AppIcon name={s.icon} size={15} />
                  <span>{s.text}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => (
          <div
            key={m.id}
            style={{
              display: 'flex',
              justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start',
              marginBottom: 12,
            }}
          >
            <div
              style={{
                maxWidth: '85%',
                padding: '11px 15px',
                borderRadius: 18,
                background:
                  m.role === 'user'
                    ? 'linear-gradient(135deg, #0F2942 0%, #0284C7 100%)'
                    : '#FFFFFF',
                color: m.role === 'user' ? '#FFFFFF' : '#0F172A',
                border: m.role === 'user' ? 'none' : '1px solid #E2E8F0',
                fontSize: 14,
                lineHeight: 1.6,
                whiteSpace: 'pre-wrap',
                boxShadow: '0 2px 8px rgba(15, 23, 42, 0.04)',
              }}
            >
              {renderChatMarkdown(m.content)}
              {m.documents?.length > 0 && (
                <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {m.documents.map((doc) => (
                    <button
                      key={doc.id}
                      type="button"
                      onClick={() => {
                        const token = localStorage.getItem('hr-token');
                        window.open(
                          `/api/documents/${doc.id}/download?token=${encodeURIComponent(token || '')}`,
                          '_blank'
                        );
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '9px 12px',
                        borderRadius: 12,
                        border: '1px solid #E2E8F0',
                        background: '#F8FAFC',
                        cursor: 'pointer',
                        fontSize: 13,
                        color: '#0F172A',
                        textAlign: 'left',
                      }}
                    >
                      <AppIcon name="download" size={16} />
                      <span style={{ flex: 1, fontWeight: 500 }}>{doc.name}</span>
                    </button>
                  ))}
                </div>
              )}
              <div
                style={{
                  fontSize: 10.5,
                  opacity: m.role === 'user' ? 0.8 : 0.6,
                  marginTop: 5,
                  textAlign: 'right',
                }}
              >
                {m.time}
              </div>
            </div>
          </div>
        ))}

        {loading && (
          <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 12 }}>
            <div
              style={{
                padding: '10px 16px',
                borderRadius: 16,
                background: '#FFFFFF',
                border: '1px solid #E2E8F0',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 13,
                color: '#64748B',
              }}
            >
              <AppIcon name="clock" size={16} /> กำลังประมวลผลคำตอบ...
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div
        style={{
          display: 'flex',
          gap: 8,
          position: 'sticky',
          bottom: 76,
          background: 'rgba(248, 250, 252, 0.96)',
          backdropFilter: 'blur(8px)',
          paddingTop: 8,
        }}
      >
        <input
          className="me-input"
          placeholder="พิมพ์คำถามเกี่ยวกับงาน วันลา หรือบริษัท..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              send(input);
            }
          }}
          disabled={loading}
          style={{ flex: 1 }}
        />
        <button
          className="me-btn"
          style={{ width: 48, minHeight: 44, padding: 0 }}
          disabled={!input.trim() || loading}
          onClick={() => send(input)}
          aria-label="ส่งข้อความ"
        >
          <AppIcon name="send" size={18} />
        </button>
      </div>
    </div>
  );
}
