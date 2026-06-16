'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

const SUGGESTED_QUESTIONS = [
  { icon: '📄', text: 'ขอ Template ใบสมัครงาน' },
  { icon: '📅', text: 'วันลาคงเหลือของฉัน' },
  { icon: '📋', text: 'ระเบียบการแต่งกาย' },
  { icon: '🏥', text: 'สวัสดิการพนักงานมีอะไรบ้าง' },
  { icon: '📝', text: 'ขอใบลาพักร้อน' },
  { icon: '📢', text: 'ประกาศล่าสุดของบริษัท' },
];

const NAV_ITEMS = [
  { icon: '💬', label: 'แชท', id: 'chat' },
  { icon: '📄', label: 'เอกสาร', id: 'documents' },
  { icon: '📅', label: 'วันลา', id: 'leave' },
  { icon: '📋', label: 'ระเบียบ', id: 'policies' },
];

const ADMIN_NAV = [
  { icon: '🏢', label: 'ระบบจัดการ HR (HR Pro)', id: 'hr-suite', href: '/hr' },
  { icon: '⚙️', label: 'แดชบอร์ดผู้ดูแล', id: 'admin', href: '/admin' },
  { icon: '📤', label: 'จัดการเอกสาร AI', id: 'admin-docs', href: '/admin/documents' },
  { icon: '👥', label: 'ตั้งค่าผู้ใช้งาน', id: 'admin-users', href: '/hr/users' },
];

export default function ChatPage() {
  const [user, setUser] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const router = useRouter();

  useEffect(() => {
    setMounted(true);
    const storedUser = localStorage.getItem('hr-user');
    const token = localStorage.getItem('hr-token');
    
    if (!storedUser || !token) {
      router.push('/');
      return;
    }

    try {
      setUser(JSON.parse(storedUser));
    } catch {
      router.push('/');
    }
  }, [router]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function getTimeString() {
    return new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
  }

  async function sendMessage(text) {
    if (!text.trim() || loading) return;

    const userMsg = {
      id: Date.now(),
      role: 'user',
      content: text.trim(),
      time: getTimeString(),
    };

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const token = localStorage.getItem('hr-token');
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ message: text.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 401) {
          handleLogout();
          return;
        }
        throw new Error(data.error || 'เกิดข้อผิดพลาด');
      }

      const aiMsg = {
        id: Date.now() + 1,
        role: 'ai',
        content: data.reply,
        documents: data.documents || [],
        intent: data.intent,
        time: getTimeString(),
      };

      setMessages(prev => [...prev, aiMsg]);
    } catch (err) {
      const errorMsg = {
        id: Date.now() + 1,
        role: 'ai',
        content: '❌ เกิดข้อผิดพลาดในการเชื่อมต่อ กรุณาลองใหม่อีกครั้ง',
        time: getTimeString(),
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    sendMessage(input);
  }

  function handleSuggestionClick(text) {
    sendMessage(text);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  }

  function handleNewChat() {
    setMessages([]);
  }

  function handleLogout() {
    localStorage.removeItem('hr-user');
    localStorage.removeItem('hr-token');
    document.cookie = 'hr-token=; Max-Age=0; path=/';
    router.push('/');
  }

  function getFileIcon(type) {
    switch (type) {
      case 'pdf': return '📕';
      case 'excel': return '📗';
      case 'docx': return '📘';
      default: return '📄';
    }
  }

  function renderMarkdown(text) {
    // Simple markdown rendering
    return text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/\n/g, '<br/>');
  }

  if (!mounted || !user) return null;

  return (
    <div className="chat-layout">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <div className="sidebar-brand">
            <div className="brand-icon">🤖</div>
            <div>
              <h2>HR Assistant</h2>
              <p>AI Chatbot</p>
            </div>
          </div>
        </div>

        <nav className="sidebar-nav">
          <div className="nav-section">
            <div className="nav-section-title">เมนูหลัก</div>
            <button className="nav-item" onClick={handleNewChat}>
              <span className="nav-icon">✨</span>
              แชทใหม่
            </button>
            {NAV_ITEMS.map(item => (
              <button
                key={item.id}
                className={`nav-item ${item.id === 'chat' ? 'active' : ''}`}
                onClick={() => {
                  if (item.id === 'leave') sendMessage('วันลาคงเหลือของฉัน');
                  else if (item.id === 'documents') sendMessage('ขอดูรายการเอกสารทั้งหมด');
                  else if (item.id === 'policies') sendMessage('ระเบียบบริษัทมีอะไรบ้าง');
                  setSidebarOpen(false);
                }}
              >
                <span className="nav-icon">{item.icon}</span>
                {item.label}
              </button>
            ))}
          </div>

          {/* Admin section */}
          {(user.role === 'admin' || user.role === 'hr') && (
            <div className="nav-section">
              <div className="nav-section-title">จัดการระบบ</div>
              {ADMIN_NAV.map(item => (
                <button
                  key={item.id}
                  className="nav-item"
                  onClick={() => router.push(item.href)}
                >
                  <span className="nav-icon">{item.icon}</span>
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </nav>

        {/* User info */}
        <div className="sidebar-user">
          <div className="user-avatar">{user.avatar}</div>
          <div className="user-info">
            <div className="user-name">{user.name}</div>
            <div className="user-role">
              <span className={`role-badge ${user.role}`}>{user.role}</span>
            </div>
          </div>
          <button
            className="btn btn-icon btn-secondary"
            onClick={handleLogout}
            title="ออกจากระบบ"
            style={{ fontSize: '16px' }}
          >
            🚪
          </button>
        </div>
      </aside>

      {/* Main Chat Area */}
      <main className="chat-main">
        <div className="chat-header">
          <button
            className="mobile-menu-btn"
            onClick={() => setSidebarOpen(true)}
          >
            ☰
          </button>
          <span className="status-dot" />
          <h3>HR AI Assistant</h3>
          <span style={{ fontSize: '13px', color: 'var(--text-muted)', marginLeft: 'auto' }}>
            ออนไลน์
          </span>
        </div>

        <div className="chat-messages">
          {messages.length === 0 ? (
            /* Welcome Screen */
            <div className="chat-welcome">
              <div className="welcome-icon">🤖</div>
              <h2>สวัสดีค่ะ คุณ{user.name}!</h2>
              <p>
                ฉันคือ HR Assistant พร้อมช่วยตอบคำถาม ขอเอกสาร หรือตรวจสอบข้อมูลของคุณ ลองถามมาเลยค่ะ
              </p>
              <div className="suggested-questions">
                {SUGGESTED_QUESTIONS.map((q, i) => (
                  <button
                    key={i}
                    className="suggested-q"
                    onClick={() => handleSuggestionClick(q.text)}
                  >
                    <span className="sq-icon">{q.icon}</span>
                    {q.text}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {messages.map((msg) => (
                <div key={msg.id} className={`message ${msg.role === 'user' ? 'user' : 'ai'}`}>
                  <div className="message-avatar">
                    {msg.role === 'user' ? user.avatar : '🤖'}
                  </div>
                  <div>
                    <div
                      className="message-content"
                      dangerouslySetInnerHTML={{
                        __html: renderMarkdown(msg.content),
                      }}
                    />
                    
                    {/* Document attachments */}
                    {msg.documents?.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
                        {msg.documents.map((doc) => (
                          <div
                            key={doc.id}
                            className="file-card"
                            style={{ cursor: 'pointer' }}
                            title="คลิกเพื่อดาวน์โหลด"
                            onClick={() => {
                              const token = localStorage.getItem('hr-token');
                              window.open(`/api/documents/${doc.id}/download?token=${encodeURIComponent(token || '')}`, '_blank');
                            }}
                          >
                            <span className="file-icon">{getFileIcon(doc.type)}</span>
                            <div className="file-info">
                              <div className="file-name">{doc.name}</div>
                              <div className="file-size">{(doc.type || 'file').toUpperCase()} • {doc.size}</div>
                            </div>
                            <span className="file-download">⬇️</span>
                          </div>
                        ))}
                      </div>
                    )}
                    
                    <div className="message-time">{msg.time}</div>
                  </div>
                </div>
              ))}

              {/* Typing indicator */}
              {loading && (
                <div className="message ai">
                  <div className="message-avatar">🤖</div>
                  <div className="message-content">
                    <div className="typing-indicator">
                      <span /><span /><span />
                    </div>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </>
          )}
        </div>

        {/* Chat Input */}
        <div className="chat-input-area">
          <form className="chat-input-wrapper" onSubmit={handleSubmit}>
            <textarea
              ref={inputRef}
              className="chat-input"
              placeholder="พิมพ์คำถามของคุณ... เช่น ขอใบลา, วันลาเหลือกี่วัน"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
              disabled={loading}
            />
            <button
              type="submit"
              className="chat-send-btn"
              disabled={loading || !input.trim()}
            >
              {loading ? '⏳' : '➤'}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
