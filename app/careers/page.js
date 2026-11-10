'use client';

import { useEffect, useState } from 'react';

export default function CareersPage() {
  const [openings, setOpenings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedJob, setSelectedJob] = useState(null);
  const [form, setForm] = useState({ name: '', phone: '', email: '', note: '' });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    fetch('/api/hr/recruitment')
      .then((r) => r.json())
      .then((d) => {
        const active = (d.items || []).filter((j) => j.status === 'open' || !j.status);
        setOpenings(active);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleApply = async (e) => {
    e.preventDefault();
    if (!selectedJob) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/hr/applicants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          phone: form.phone.trim(),
          email: form.email.trim(),
          position_applied: selectedJob.title,
          opening_id: selectedJob.id,
          status: 'applied',
          applied_date: new Date().toISOString().slice(0, 10),
          note: form.note.trim() || 'สมัครผ่านหน้าเว็บไซต์สาธารณะ /careers',
        }),
      });
      if (res.ok) {
        setSubmitted(true);
      } else {
        alert('เกิดข้อผิดพลาดในการส่งใบสมัคร กรุณาลองใหม่อีกครั้ง');
      }
    } catch {
      alert('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', fontFamily: 'sans-serif', padding: '32px 16px' }}>
      <div style={{ maxWidth: 860, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <div style={{ fontSize: 32, fontWeight: 800, color: '#1e1b4b', marginBottom: 8 }}>
            🚚 ร่วมงานกับ ดีดี เซอร์วิส แอนด์ ทรานสปอร์ต
          </div>
          <div style={{ fontSize: 16, color: '#64748b' }}>
            บริษัท ดีดี เซอร์วิส แอนด์ ทรานสปอร์ต จำกัด — เปิดรับสมัครบุคลากรมืออาชีพ
          </div>
        </div>

        {loading && <div style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>กำลังโหลดตำแหน่งงาน...</div>}

        {!loading && openings.length === 0 && (
          <div style={{ textAlign: 'center', padding: 40, background: '#fff', borderRadius: 16, border: '1px solid #e2e8f0', color: '#64748b' }}>
            ขณะนี้ยังไม่มีตำแหน่งงานที่เปิดรับสมัครเพิ่มเติม กรุณาติดตามประกาศในรอบถัดไป
          </div>
        )}

        <div style={{ display: 'grid', gap: 16 }}>
          {openings.map((job) => (
            <div
              key={job.id}
              style={{
                background: '#fff',
                padding: '20px 24px',
                borderRadius: 16,
                border: '1px solid #e2e8f0',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 12,
              }}
            >
              <div>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', marginBottom: 4 }}>
                  {job.title}
                </div>
                <div style={{ fontSize: 13, color: '#64748b' }}>
                  {job.department_code ? `แผนก: ${job.department_code} · ` : ''}
                  {job.headcount ? `จำนวนรับ: ${job.headcount} อัตรา · ` : ''}
                  ประกาศเมื่อ: {job.posted_date || 'เมื่อเร็วๆ นี้'}
                </div>
                {job.description && (
                  <div style={{ fontSize: 13, color: '#475569', marginTop: 8, whiteSpace: 'pre-line' }}>
                    {job.description}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedJob(job);
                  setSubmitted(false);
                }}
                style={{
                  background: '#6d28d9',
                  color: '#fff',
                  border: 'none',
                  padding: '10px 20px',
                  borderRadius: 10,
                  fontWeight: 600,
                  fontSize: 14,
                  cursor: 'pointer',
                }}
              >
                📝 กรอกใบสมัครทันที
              </button>
            </div>
          ))}
        </div>

        {/* Modal สมัครงาน */}
        {selectedJob && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
            <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 480, padding: 24, boxShadow: '0 20px 25px -5px rgba(0,0,0,0.2)' }}>
              {submitted ? (
                <div style={{ textAlign: 'center', padding: '20px 0' }}>
                  <div style={{ fontSize: 48, marginBottom: 12 }}>🎉</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: '#16a34a', marginBottom: 8 }}>ส่งใบสมัครเรียบร้อยแล้ว</div>
                  <div style={{ fontSize: 14, color: '#64748b', marginBottom: 20 }}>
                    เจ้าหน้าที่ฝ่ายทรัพยากรบุคคลจะติดต่อกลับตามเบอร์โทรศัพท์ที่ระบุไว้ ขอบคุณที่สนใจร่วมงานกับเราค่ะ
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedJob(null)}
                    style={{ background: '#6d28d9', color: '#fff', border: 'none', padding: '10px 24px', borderRadius: 8, fontWeight: 600, cursor: 'pointer' }}
                  >
                    ตกลง
                  </button>
                </div>
              ) : (
                <form onSubmit={handleApply}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                    <div style={{ fontSize: 18, fontWeight: 700, color: '#0f172a' }}>
                      สมัครตำแหน่ง: {selectedJob.title}
                    </div>
                    <button type="button" onClick={() => setSelectedJob(null)} style={{ border: 'none', background: 'none', fontSize: 18, cursor: 'pointer', color: '#94a3b8' }}>✕</button>
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#334155', marginBottom: 4 }}>ชื่อ-นามสกุล *</label>
                    <input
                      style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 14, boxSizing: 'border-box' }}
                      placeholder="เช่น นายสมชาย ใจดี"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      required
                    />
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#334155', marginBottom: 4 }}>เบอร์โทรศัพท์ติดต่อ *</label>
                    <input
                      type="tel"
                      style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 14, boxSizing: 'border-box' }}
                      placeholder="เช่น 0812345678"
                      value={form.phone}
                      onChange={(e) => setForm({ ...form, phone: e.target.value })}
                      required
                    />
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#334155', marginBottom: 4 }}>อีเมล</label>
                    <input
                      type="email"
                      style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 14, boxSizing: 'border-box' }}
                      placeholder="example@email.com"
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                    />
                  </div>
                  <div style={{ marginBottom: 20 }}>
                    <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#334155', marginBottom: 4 }}>ประวัติการทำงานโดยย่อ / ประสบการณ์</label>
                    <textarea
                      rows={3}
                      style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 14, boxSizing: 'border-box' }}
                      placeholder="ระบุประสบการณ์ขับรถ หรือสายงานที่เกี่ยวข้อง..."
                      value={form.note}
                      onChange={(e) => setForm({ ...form, note: e.target.value })}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button
                      type="button"
                      onClick={() => setSelectedJob(null)}
                      style={{ flex: 1, padding: 10, borderRadius: 8, border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer', fontWeight: 600 }}
                    >
                      ยกเลิก
                    </button>
                    <button
                      type="submit"
                      disabled={submitting}
                      style={{ flex: 1, padding: 10, borderRadius: 8, border: 'none', background: '#6d28d9', color: '#fff', cursor: 'pointer', fontWeight: 600 }}
                    >
                      {submitting ? 'กำลังส่งข้อมูล...' : 'ส่งใบสมัคร'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
