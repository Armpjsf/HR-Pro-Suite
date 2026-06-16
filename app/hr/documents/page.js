'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { authHeaders } from '@/components/hr/exportUtils';

const CATEGORIES = [
  { id: 'policies', name: '📋 ระเบียบบริษัท', color: 'purple' },
  { id: 'templates', name: '📝 Template/แบบฟอร์ม', color: 'green' },
  { id: 'contracts', name: '📑 สัญญาจ้าง', color: 'yellow' },
  { id: 'announcements', name: '📢 ประกาศบริษัท', color: 'red' },
  { id: 'employee-data', name: '👥 ข้อมูลพนักงาน', color: 'blue' },
];

const fileIcon = (t) => (t === 'pdf' ? '📕' : t === 'excel' ? '📗' : t === 'docx' ? '📘' : '📄');
const catInfo = (id) => CATEGORIES.find((c) => c.id === id) || { name: id, color: 'gray' };

export default function HrDocumentsPage() {
  const [documents, setDocuments] = useState([]);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [uploadCategory, setUploadCategory] = useState('policies');
  const [uploading, setUploading] = useState(false);
  const [toast, setToast] = useState(null);
  const fileRef = useRef(null);

  const showToast = (message, type = 'success') => { setToast({ message, type }); setTimeout(() => setToast(null), 3000); };

  const load = useCallback(async () => {
    const res = await fetch('/api/documents', { headers: authHeaders() });
    const d = await res.json();
    if (res.ok) setDocuments(d.documents || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const filtered = documents.filter((doc) => {
    if (filter !== 'all' && doc.category !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      return doc.name.toLowerCase().includes(q) || doc.fileName?.toLowerCase().includes(q);
    }
    return true;
  });

  async function upload(files) {
    if (!files?.length) return;
    const file = files[0];
    if (file.size > 10 * 1024 * 1024) { showToast('ไฟล์ใหญ่เกิน 10MB', 'error'); return; }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('category', uploadCategory);
      const res = await fetch('/api/documents', { method: 'POST', headers: authHeaders(), body: fd });
      const d = await res.json();
      if (!res.ok) showToast(d.error || 'อัพโหลดไม่สำเร็จ', 'error');
      else { showToast(d.extracted > 0 ? `อัพโหลดสำเร็จ (AI อ่านได้ ${d.extracted.toLocaleString()} ตัวอักษร)` : 'อัพโหลดสำเร็จ'); load(); }
    } catch { showToast('เชื่อมต่อไม่สำเร็จ', 'error'); }
    finally { if (fileRef.current) fileRef.current.value = ''; setUploading(false); }
  }

  async function remove(id) {
    if (!confirm('ต้องการลบเอกสารนี้?')) return;
    const res = await fetch(`/api/documents/${id}`, { method: 'DELETE', headers: authHeaders() });
    if (res.ok) { setDocuments((p) => p.filter((d) => d.id !== id)); showToast('ลบเอกสารแล้ว'); }
    else showToast('ลบไม่สำเร็จ', 'error');
  }

  function download(doc) {
    const token = localStorage.getItem('hr-token');
    window.open(`/api/documents/${doc.id}/download?token=${encodeURIComponent(token || '')}`, '_blank');
  }

  const aiCount = documents.filter((d) => d.hasContent).length;

  return (
    <div>
      <div className="hr-stat-row">
        <div className="hr-stat-card">
          <div className="hr-stat-icon">📇</div>
          <div><div className="hr-stat-value">{documents.length}</div><div className="hr-stat-label">เอกสารทั้งหมด</div></div>
        </div>
        <div className="hr-stat-card">
          <div className="hr-stat-icon">🤖</div>
          <div><div className="hr-stat-value">{aiCount}</div><div className="hr-stat-label">AI อ่านเนื้อหาได้</div></div>
        </div>
      </div>

      <div className="hr-toolbar">
        <input className="hr-search" placeholder="ค้นหาเอกสาร..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="hr-search" style={{ maxWidth: 220 }} value={uploadCategory} onChange={(e) => setUploadCategory(e.target.value)}>
          {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button className="hr-btn hr-btn-primary" disabled={uploading} onClick={() => fileRef.current?.click()}>
          {uploading ? 'กำลังอัพโหลด...' : '📤 อัพโหลดเอกสาร'}
        </button>
        <input ref={fileRef} type="file" accept=".pdf,.xlsx,.xls,.csv,.docx,.doc,.txt,.md" style={{ display: 'none' }}
          onChange={(e) => upload(e.target.files)} />
      </div>

      <div className="hr-tabs">
        <button className={`hr-tab${filter === 'all' ? ' active' : ''}`} onClick={() => setFilter('all')}>ทั้งหมด</button>
        {CATEGORIES.map((c) => (
          <button key={c.id} className={`hr-tab${filter === c.id ? ' active' : ''}`} onClick={() => setFilter(c.id)}>{c.name}</button>
        ))}
      </div>

      <div className="hr-emp-grid">
        {filtered.map((doc) => (
          <div className="hr-emp-card" key={doc.id}>
            <div className="hr-emp-head">
              <div style={{ fontSize: 30 }}>{fileIcon(doc.type)}</div>
              <div style={{ minWidth: 0 }}>
                <div className="hr-emp-name" style={{ wordBreak: 'break-word' }}>{doc.name}</div>
                <div className="hr-emp-id">{doc.fileName}</div>
              </div>
            </div>
            <div style={{ marginBottom: 8 }}>
              <span className={`hr-badge hr-badge-${catInfo(doc.category).color}`}>{catInfo(doc.category).name}</span>
              {doc.hasContent && <span className="hr-badge hr-badge-green" style={{ marginLeft: 6 }}>🤖 AI อ่านได้</span>}
            </div>
            <div className="hr-emp-row"><span className="k">ขนาด</span><span className="v">{doc.size}</span></div>
            <div className="hr-emp-row"><span className="k">อัพเดท</span><span className="v">{doc.updatedAt}</span></div>
            <div className="hr-emp-actions">
              <button className="hr-btn" style={{ flex: 1 }} onClick={() => download(doc)}>⬇️ ดาวน์โหลด</button>
              <button className="hr-btn hr-btn-icon hr-btn-danger" onClick={() => remove(doc.id)}>🗑️</button>
            </div>
          </div>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="hr-empty">{documents.length === 0 ? 'ยังไม่มีเอกสาร — กด “อัพโหลดเอกสาร” เพื่อเริ่ม' : 'ไม่พบเอกสารที่ค้นหา'}</div>
      )}

      {toast && <div className={`hr-toast ${toast.type === 'error' ? 'error' : ''}`}>{toast.message}</div>}
    </div>
  );
}
