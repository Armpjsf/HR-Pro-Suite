'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';

const CATEGORIES = [
  { id: 'policies', name: '📋 ระเบียบบริษัท', color: 'purple' },
  { id: 'templates', name: '📝 Template/แบบฟอร์ม', color: 'emerald' },
  { id: 'contracts', name: '📑 สัญญาจ้าง', color: 'amber' },
  { id: 'announcements', name: '📢 ประกาศบริษัท', color: 'pink' },
  { id: 'employee-data', name: '👥 ข้อมูลพนักงาน', color: 'blue' },
];

function authHeaders() {
  const token = localStorage.getItem('hr-token');
  return { Authorization: `Bearer ${token}` };
}

export default function DocumentsPage() {
  const [user, setUser] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [filter, setFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showUpload, setShowUpload] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [toast, setToast] = useState(null);
  const [mounted, setMounted] = useState(false);
  const [uploadCategory, setUploadCategory] = useState('policies');
  const fileInputRef = useRef(null);
  const router = useRouter();

  const loadDocuments = useCallback(async () => {
    try {
      const res = await fetch('/api/documents', { headers: authHeaders() });
      const data = await res.json();
      if (res.ok) setDocuments(data.documents || []);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    setMounted(true);
    const storedUser = localStorage.getItem('hr-user');
    if (!storedUser) { router.push('/'); return; }
    const parsed = JSON.parse(storedUser);
    if (parsed.role !== 'admin' && parsed.role !== 'hr') {
      router.push('/chat');
      return;
    }
    setUser(parsed);
    loadDocuments();
  }, [router, loadDocuments]);

  function showToast(message, type = 'success') {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }

  function getFileIcon(type) {
    switch (type) {
      case 'pdf': return '📕';
      case 'excel': return '📗';
      case 'docx': return '📘';
      default: return '📄';
    }
  }

  function getCategoryInfo(categoryId) {
    return CATEGORIES.find(c => c.id === categoryId) || { name: categoryId, color: 'purple' };
  }

  const filteredDocs = documents.filter(doc => {
    if (filter !== 'all' && doc.category !== filter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return doc.name.toLowerCase().includes(q) || doc.fileName?.toLowerCase().includes(q);
    }
    return true;
  });

  function handleUploadClick() {
    fileInputRef.current?.click();
  }

  async function handleFileSelect(files) {
    if (!files?.length) return;

    const file = files[0];
    if (file.size > 10 * 1024 * 1024) {
      showToast('ไฟล์ใหญ่เกิน 10MB', 'error');
      return;
    }

    setUploading(true);
    setUploadProgress(30);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('category', uploadCategory);

      setUploadProgress(60);
      const res = await fetch('/api/documents', {
        method: 'POST',
        headers: authHeaders(),
        body: formData,
      });
      const data = await res.json();
      setUploadProgress(100);

      if (!res.ok) {
        showToast(data.error || 'อัพโหลดไม่สำเร็จ', 'error');
      } else {
        showToast(
          data.extracted > 0
            ? `อัพโหลด "${file.name}" สำเร็จ (อ่านเนื้อหาได้ ${data.extracted.toLocaleString()} ตัวอักษร)`
            : `อัพโหลด "${file.name}" สำเร็จ`
        );
        await loadDocuments();
      }
    } catch {
      showToast('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้', 'error');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
      setTimeout(() => {
        setUploading(false);
        setUploadProgress(0);
        setShowUpload(false);
      }, 500);
    }
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    handleFileSelect(e.dataTransfer.files);
  }

  async function handleDelete(docId) {
    if (!confirm('ต้องการลบเอกสารนี้หรือไม่?')) return;
    try {
      const res = await fetch(`/api/documents/${docId}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'ลบไม่สำเร็จ', 'error');
        return;
      }
      setDocuments(prev => prev.filter(d => d.id !== docId));
      showToast('ลบเอกสารสำเร็จ');
    } catch {
      showToast('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้', 'error');
    }
  }

  function handleView(doc) {
    const token = localStorage.getItem('hr-token');
    window.open(`/api/documents/${doc.id}/download?token=${encodeURIComponent(token || '')}`, '_blank');
  }

  if (!mounted || !user) return null;

  return (
    <div className="admin-layout">
      <header className="admin-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button className="btn btn-secondary btn-sm" onClick={() => router.push('/admin')}>
            ← กลับ
          </button>
          <h2 style={{ fontSize: '18px', fontWeight: 700 }}>📤 จัดการเอกสาร</h2>
        </div>
        <button className="btn btn-primary" onClick={() => setShowUpload(!showUpload)}>
          {showUpload ? '✕ ปิด' : '📤 อัพโหลดเอกสาร'}
        </button>
      </header>

      <div className="admin-content">
        {/* Upload Zone */}
        {showUpload && (
          <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '20px', marginBottom: '24px' }}>
            <div className="input-group" style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', fontWeight: 600 }}>📁 เลือกหมวดหมู่เอกสารก่อนอัพโหลด</label>
              <select
                className="input-field"
                value={uploadCategory}
                onChange={(e) => setUploadCategory(e.target.value)}
                style={{ width: '100%', maxWidth: '300px' }}
              >
                {CATEGORIES.map(cat => (
                  <option key={cat.id} value={cat.id}>{cat.name}</option>
                ))}
              </select>
            </div>

            <div
              className={`upload-zone ${dragOver ? 'drag-over' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={handleUploadClick}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.xlsx,.xls,.csv,.docx,.doc,.txt,.md"
                style={{ display: 'none' }}
                onChange={(e) => handleFileSelect(e.target.files)}
              />

              {uploading ? (
                <>
                  <div className="upload-icon">⏳</div>
                  <h3>กำลังอัพโหลด...</h3>
                  <div className="upload-progress">
                    <div className="progress-bar" style={{ width: `${uploadProgress}%` }} />
                  </div>
                  <p style={{ marginTop: '8px' }}>{uploadProgress}%</p>
                </>
              ) : (
                <>
                  <div className="upload-icon">📁</div>
                  <h3>ลากไฟล์มาวางที่นี่ หรือคลิกเพื่อเลือกไฟล์</h3>
                  <p>รองรับ: PDF, Excel (.xlsx), Word (.docx), Text — สูงสุด 10MB</p>
                </>
              )}
            </div>
          </div>
        )}

        {/* Knowledge Status */}
        <div className="glass-card" style={{ padding: '20px', marginBottom: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
            <div>
              <h3 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '4px' }}>📇 Knowledge Index</h3>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                เอกสารทั้งหมด: {documents.length} ไฟล์ | AI อ่านเนื้อหาได้: {documents.filter(d => d.hasContent).length} ไฟล์
              </p>
            </div>
            <button className="btn btn-secondary btn-sm" onClick={async () => { await loadDocuments(); showToast('รีเฟรชข้อมูลสำเร็จ'); }}>
              🔄 รีเฟรช
            </button>
          </div>
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            type="text"
            className="input-field"
            placeholder="🔍 ค้นหาเอกสาร..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ flex: '1', minWidth: '200px' }}
          />
          <div className="tabs" style={{ borderBottom: 'none', marginBottom: 0 }}>
            <button
              className={`tab ${filter === 'all' ? 'active' : ''}`}
              onClick={() => setFilter('all')}
            >
              ทั้งหมด
            </button>
            {CATEGORIES.slice(0, 4).map(cat => (
              <button
                key={cat.id}
                className={`tab ${filter === cat.id ? 'active' : ''}`}
                onClick={() => setFilter(cat.id)}
              >
                {cat.name}
              </button>
            ))}
          </div>
        </div>

        {/* Document Grid */}
        <div className="doc-grid">
          {filteredDocs.map(doc => (
            <div key={doc.id} className="glass-card doc-card">
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span className="doc-icon">{getFileIcon(doc.type)}</span>
                <div>
                  <div className="doc-name">{doc.name}</div>
                  <div className="doc-meta">{doc.fileName}</div>
                </div>
              </div>
              <div className="doc-meta">
                <span className={`role-badge ${getCategoryInfo(doc.category).color === 'purple' ? 'admin' : getCategoryInfo(doc.category).color === 'emerald' ? 'employee' : 'hr'}`}>
                  {getCategoryInfo(doc.category).name}
                </span>
                {doc.hasContent && (
                  <span className="role-badge hr" style={{ marginLeft: '6px', fontSize: '10px' }}>🤖 AI อ่านได้</span>
                )}
              </div>
              <div className="doc-meta">
                {doc.size} • อัพเดท: {doc.updatedAt}
              </div>
              <div className="doc-actions">
                <button className="btn btn-secondary btn-sm" onClick={() => handleView(doc)}>
                  ⬇️ ดาวน์โหลด
                </button>
                <button className="btn btn-danger btn-sm" onClick={() => handleDelete(doc.id)}>
                  🗑️
                </button>
              </div>
            </div>
          ))}
        </div>

        {filteredDocs.length === 0 && (
          <div style={{ textAlign: 'center', padding: '48px', color: 'var(--text-muted)' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>📭</div>
            <p>{documents.length === 0 ? 'ยังไม่มีเอกสารในระบบ — กดปุ่ม "อัพโหลดเอกสาร" เพื่อเริ่มต้น' : 'ไม่พบเอกสารที่ตรงกับการค้นหา'}</p>
          </div>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div className={`toast ${toast.type}`}>
          {toast.type === 'success' ? '✅' : '❌'} {toast.message}
        </div>
      )}
    </div>
  );
}
