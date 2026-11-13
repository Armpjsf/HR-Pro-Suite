'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { authHeaders } from '@/components/hr/exportUtils';
import { confirmDialog } from '@/components/ui/ConfirmDialog';

const CATEGORIES = [
  { id: 'policies', name: '📋 ระเบียบบริษัท', color: 'purple' },
  { id: 'templates', name: '📝 Template/แบบฟอร์ม', color: 'green' },
  { id: 'contracts', name: '📑 สัญญาจ้าง', color: 'yellow' },
  { id: 'announcements', name: '📢 ประกาศบริษัท', color: 'red' },
  { id: 'employee-data', name: '👥 ข้อมูลพนักงาน', color: 'blue' },
  { id: 'driver-manuals', name: '🎬 คู่มือ & คลิปอบรม', color: 'blue' },
];

const fileIcon = (t) => (t === 'pdf' ? '📕' : t === 'excel' ? '📗' : t === 'docx' ? '📘' : t === 'video' ? '🎬' : '📄');
const catInfo = (id) => CATEGORIES.find((c) => c.id === id) || { name: id, color: 'gray' };
const audienceBadge = (doc) => {
  const roles = Array.isArray(doc.accessRoles) ? doc.accessRoles : [];
  const hasEmp = roles.includes('employee');
  const hasPartner = roles.includes('partner_driver');
  if (hasEmp && !hasPartner && doc.category === 'driver-manuals') return { label: '🏢 พนักงานบริษัทดีดี', color: 'blue' };
  if (!hasEmp && hasPartner) return { label: '🚚 พนักงานขับรถร่วม', color: 'yellow' };
  if (hasEmp && hasPartner && doc.category === 'driver-manuals') return { label: '👥 ทั้งบริษัทและรถร่วม', color: 'purple' };
  return null;
};

export default function HrDocumentsPage() {
  const [documents, setDocuments] = useState([]);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [uploadCategory, setUploadCategory] = useState('policies');
  const [uploading, setUploading] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [toast, setToast] = useState(null);
  const [showVideoModal, setShowVideoModal] = useState(false);
  const [savingVideo, setSavingVideo] = useState(false);
  const [videoForm, setVideoForm] = useState({ name: '', videoUrl: '', targetGroup: 'all', description: '' });
  const fileRef = useRef(null);

  useEffect(() => {
    try { setIsAdmin(JSON.parse(localStorage.getItem('hr-user') || '{}').role === 'admin'); } catch {}
  }, []);

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
    const ok = await confirmDialog({
      title: 'ยืนยันการลบเอกสาร?',
      message: 'คุณต้องการลบเอกสารนี้ใช่หรือไม่ การดำเนินการนี้ไม่สามารถเรียกคืนได้',
      confirmLabel: 'ลบเอกสาร',
      destructive: true,
    });
    if (!ok) return;
    const res = await fetch(`/api/documents/${id}`, { method: 'DELETE', headers: authHeaders() });
    if (res.ok) { setDocuments((p) => p.filter((d) => d.id !== id)); showToast('ลบเอกสารแล้ว'); }
    else showToast('ลบไม่สำเร็จ', 'error');
  }

  async function reindex() {
    const ok = await confirmDialog({
      title: 'สร้างดัชนี AI (RAG) ใหม่ทั้งหมด?',
      message: 'ใช้หลังเปลี่ยน LLM provider หรือเมื่อ AI ค้นเอกสารไม่เจอ — ระบบจะสแกนและจัดทำดัชนีใหม่ทั้งหมด ซึ่งอาจใช้เวลาหลายนาที ต้องการดำเนินการต่อหรือไม่?',
      confirmLabel: 'เริ่มสร้างดัชนีใหม่',
    });
    if (!ok) return;
    setReindexing(true);
    try {
      const res = await fetch('/api/documents/reindex', { method: 'POST', headers: authHeaders() });
      const d = await res.json();
      if (!res.ok) { showToast(d.error || 'สร้างดัชนีไม่สำเร็จ', 'error'); return; }
      const failed = (d.results || []).filter((r) => r.error);
      showToast(
        `สร้างดัชนีแล้ว ${d.totalChunks} ชิ้น จาก ${(d.results || []).length} เอกสาร` +
        (failed.length ? ` (ล้มเหลว ${failed.length}: ${failed[0].error})` : ''),
        failed.length ? 'error' : 'success',
      );
      load();
    } catch { showToast('เกิดข้อผิดพลาดระหว่างสร้างดัชนี', 'error'); }
    finally { setReindexing(false); }
  }

  async function saveVideoLink(e) {
    e.preventDefault();
    if (!videoForm.name.trim() || !videoForm.videoUrl.trim()) {
      showToast('กรุณากรอกชื่อคลิปและลิงก์วิดีโอ', 'error');
      return;
    }
    setSavingVideo(true);
    try {
      const res = await fetch('/api/documents', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: videoForm.name.trim(),
          videoUrl: videoForm.videoUrl.trim(),
          targetGroup: videoForm.targetGroup,
          description: videoForm.description.trim(),
          category: 'driver-manuals',
        }),
      });
      const d = await res.json();
      if (!res.ok) {
        showToast(d.error || 'บันทึกคลิปไม่สำเร็จ', 'error');
      } else {
        showToast(`เพิ่มคลิป "${videoForm.name.trim()}" และสร้างดัชนี AI แล้ว`);
        setShowVideoModal(false);
        setVideoForm({ name: '', videoUrl: '', targetGroup: 'all', description: '' });
        load();
      }
    } catch {
      showToast('เชื่อมต่อไม่สำเร็จ', 'error');
    } finally {
      setSavingVideo(false);
    }
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
        <button className="hr-btn" onClick={() => setShowVideoModal(true)}>
          🎬 เพิ่มคลิปวิดีโอ (Drive/YouTube)
        </button>
        {isAdmin && (
          <button className="hr-btn" disabled={reindexing} onClick={reindex}>
            {reindexing ? '⏳ กำลังสร้างดัชนี...' : '📇 Re-index ดัชนี AI'}
          </button>
        )}
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
        {filtered.map((doc) => {
          const aud = audienceBadge(doc);
          return (
            <div className="hr-emp-card" key={doc.id}>
              <div className="hr-emp-head">
                <div style={{ fontSize: 30 }}>{fileIcon(doc.type)}</div>
                <div style={{ minWidth: 0 }}>
                  <div className="hr-emp-name" style={{ wordBreak: 'break-word' }}>{doc.name}</div>
                  <div className="hr-emp-id" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.fileName}</div>
                </div>
              </div>
              <div style={{ marginBottom: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                <span className={`hr-badge hr-badge-${catInfo(doc.category).color}`}>{catInfo(doc.category).name}</span>
                {aud && <span className={`hr-badge hr-badge-${aud.color}`}>{aud.label}</span>}
                {doc.hasContent && <span className="hr-badge hr-badge-green">🤖 AI อ่านได้</span>}
              </div>
              <div className="hr-emp-row"><span className="k">{doc.type === 'video' ? 'แหล่งที่มา' : 'ขนาด'}</span><span className="v">{doc.size}</span></div>
              <div className="hr-emp-row"><span className="k">อัพเดท</span><span className="v">{doc.updatedAt}</span></div>
              <div className="hr-emp-actions">
                <button className="hr-btn" style={{ flex: 1 }} onClick={() => download(doc)}>
                  {doc.type === 'video' ? '▶ เปิดดูวิดีโอ' : '⬇️ ดาวน์โหลด'}
                </button>
                <button className="hr-btn hr-btn-icon hr-btn-danger" onClick={() => remove(doc.id)}>🗑️</button>
              </div>
            </div>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div className="hr-empty">{documents.length === 0 ? 'ยังไม่มีเอกสาร — กด “อัพโหลดเอกสาร” เพื่อเริ่ม' : 'ไม่พบเอกสารที่ค้นหา'}</div>
      )}

      {showVideoModal && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16,
          }}
          onClick={() => setShowVideoModal(false)}
        >
          <div
            className="hr-emp-card"
            style={{ width: '100%', maxWidth: 520, background: '#fff', padding: 24, boxShadow: '0 20px 50px rgba(0,0,0,0.2)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 14px', fontSize: 18, fontWeight: 700 }}>🎬 เพิ่มคลิปวิดีโอคู่มือ (Google Drive / YouTube)</h3>
            <form onSubmit={saveVideoLink} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>ชื่อคลิปคู่มือ *</label>
                <input
                  className="hr-search"
                  style={{ width: '100%', maxWidth: 'none' }}
                  placeholder="เช่น คู่มือการรับ-ส่งงานในแอป (สำหรับพนักงานขับรถร่วม)"
                  value={videoForm.name}
                  onChange={(e) => setVideoForm((p) => ({ ...p, name: e.target.value }))}
                  required
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>กลุ่มผู้มีสิทธิ์ดู *</label>
                <select
                  className="hr-search"
                  style={{ width: '100%', maxWidth: 'none' }}
                  value={videoForm.targetGroup}
                  onChange={(e) => setVideoForm((p) => ({ ...p, targetGroup: e.target.value }))}
                >
                  <option value="all">👥 ดูได้ทั้งหมด (พนักงานบริษัทดีดี + พนักงานขับรถร่วม)</option>
                  <option value="company">🏢 เฉพาะพนักงานบริษัทดีดี (Employee)</option>
                  <option value="partner">🚚 เฉพาะพนักงานขับรถร่วม (Partner Driver)</option>
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>ลิงก์ Google Drive หรือ YouTube *</label>
                <input
                  className="hr-search"
                  style={{ width: '100%', maxWidth: 'none' }}
                  placeholder="https://drive.google.com/file/d/.../view"
                  value={videoForm.videoUrl}
                  onChange={(e) => setVideoForm((p) => ({ ...p, videoUrl: e.target.value }))}
                  required
                />
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
                  แนะนำ: ตั้งค่าแชร์ไฟล์ใน Google Drive เป็น &quot;ทุกคนที่มีลิงก์ (Anyone with the link)&quot; เพื่อไม่ให้พนักงานติดสิทธิ์ขอเข้าถึง
                </div>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>คำอธิบายเนื้อหาในคลิป (สำหรับให้ AI ค้นหา)</label>
                <textarea
                  className="hr-search"
                  style={{ width: '100%', maxWidth: 'none', minHeight: 90, paddingTop: 8, paddingBottom: 8 }}
                  placeholder="สรุปขั้นตอนสำคัญที่สอนในคลิป เช่น วิธีล็อกอิน การกดรับงาน ถ่ายรูปสินค้า ส่งงาน เซ็นรับ และแจ้งปัญหา..."
                  value={videoForm.description}
                  onChange={(e) => setVideoForm((p) => ({ ...p, description: e.target.value }))}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 6 }}>
                <button type="button" className="hr-btn" onClick={() => setShowVideoModal(false)}>ยกเลิก</button>
                <button type="submit" className="hr-btn hr-btn-primary" disabled={savingVideo}>
                  {savingVideo ? 'กำลังบันทึก...' : '💾 บันทึกคลิป & สร้างดัชนี AI'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {toast && <div className={`hr-toast ${toast.type === 'error' ? 'error' : ''}`}>{toast.message}</div>}
    </div>
  );
}
