'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { authHeaders } from '@/components/hr/exportUtils';

const SESSION_STATUS = {
  queued: { label: 'เข้าคิว รอโทร', color: '#6b7280' },
  calling: { label: 'กำลังต่อสาย', color: '#2563eb' },
  in_progress: { label: 'กำลังสัมภาษณ์', color: '#7c3aed' },
  completed: { label: 'เสร็จสมบูรณ์', color: '#059669' },
  no_consent: { label: 'ผู้สมัครไม่ยินยอม', color: '#c026d3' },
  no_answer: { label: 'ไม่รับสาย', color: '#d97706' },
  failed: { label: 'ผิดพลาด', color: '#dc2626' },
};

export default function InterviewDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let timer;
    const fetchOnce = () =>
      fetch(`/api/hr/interviews/${id}`, { headers: authHeaders() })
        .then((r) => r.json())
        .then((d) => {
          if (d.error) { setErr(d.error); return; }
          setData(d);
          // ระหว่างสายยังไม่จบ → รีเฟรชทุก 3 วิ เพื่อเห็นบทสนทนาเรียลไทม์
          const live = ['queued', 'calling', 'in_progress'].includes(d.session?.status);
          if (live) timer = setTimeout(fetchOnce, 3000);
        })
        .catch(() => setErr('โหลดข้อมูลไม่สำเร็จ'));
    fetchOnce();
    return () => clearTimeout(timer);
  }, [id]);

  const [scoring, setScoring] = useState(false);
  async function scoreNow() {
    setScoring(true);
    try {
      const res = await fetch(`/api/hr/interviews/${id}/score`, { method: 'POST', headers: authHeaders() });
      const d = await res.json();
      if (!res.ok) { alert(d.error || 'ประเมินไม่สำเร็จ'); return; }
      const fresh = await fetch(`/api/hr/interviews/${id}`, { headers: authHeaders() }).then((r) => r.json());
      setData(fresh);
    } finally {
      setScoring(false);
    }
  }

  async function remove() {
    if (!confirm('ลบรอบสัมภาษณ์นี้?')) return;
    const res = await fetch(`/api/hr/interviews/${id}`, { method: 'DELETE', headers: authHeaders() });
    if (res.ok) router.push('/hr/applicants');
  }

  if (err) return <div className="hr-page"><div className="hr-empty">{err}</div></div>;
  if (!data) return <div className="hr-page"><div className="hr-empty">กำลังโหลด...</div></div>;

  const { session, turns, applicant, questionSet } = data;
  const st = SESSION_STATUS[session.status] || { label: session.status, color: '#6b7280' };

  return (
    <div className="hr-page">
      <div className="hr-toolbar" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0 }}>🎙️ ผลสัมภาษณ์ AI</h2>
        <div>
          <Link href="/hr/applicants" className="hr-btn">← กลับหน้าผู้สมัคร</Link>
          {turns.length > 0 && (
            <button className="hr-btn hr-btn-primary" onClick={scoreNow} disabled={scoring} style={{ marginLeft: 8 }}>
              {scoring ? 'กำลังประเมิน...' : (session.score != null ? '🧮 ประเมินใหม่' : '🧮 ให้คะแนน')}
            </button>
          )}
          <button className="hr-btn hr-btn-danger" onClick={remove} style={{ marginLeft: 8 }}>ลบ</button>
        </div>
      </div>

      <div className="hr-card" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20 }}>
          <Info label="ผู้สมัคร" value={applicant?.name || '-'} />
          <Info label="ตำแหน่ง" value={applicant?.position_applied || '-'} />
          <Info label="เบอร์ที่โทร" value={session.phone || '-'} />
          <Info label="ชุดคำถาม" value={questionSet?.name || '— ไม่ระบุ —'} />
          <Info label="สถานะ" value={<span style={{ color: st.color, fontWeight: 700 }}>{st.label}</span>} />
          {session.score != null && (
            <Info label="คะแนน" value={<b>{session.score}{session.max_score ? ` / ${session.max_score}` : ''}</b>} />
          )}
          {session.recommendation && (
            <Info label="ผลเบื้องต้น (AI)" value={
              { pass: '✅ ผ่านเกณฑ์', borderline: '⚠️ ก้ำกึ่ง', reject: '❌ ต่ำกว่าเกณฑ์' }[session.recommendation]
              || session.recommendation
            } />
          )}
          <Info label="สร้างเมื่อ" value={new Date(session.created_at).toLocaleString('th-TH')} />
          {session.duration_sec != null && <Info label="ความยาวสาย" value={`${session.duration_sec} วินาที`} />}
        </div>
        {session.summary && (
          <div style={{ marginTop: 14, padding: 12, background: '#f8fafc', borderRadius: 8, border: '1px solid #e5e7eb' }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>สรุปผล (AI)</div>
            <div style={{ whiteSpace: 'pre-wrap', color: '#374151' }}>{session.summary}</div>
          </div>
        )}
      </div>

      <h3 style={{ margin: '6px 0 10px' }}>บทสนทนา</h3>
      {turns.length === 0 ? (
        <div className="hr-empty">
          {session.status === 'queued'
            ? 'ยังไม่ได้เริ่มสัมภาษณ์ — บทสนทนาจะปรากฏเมื่อ AI โทรจริง (เฟสถัดไป)'
            : 'ไม่มีบทสนทนา'}
        </div>
      ) : (
        <div style={{ maxWidth: 720 }}>
          {turns.map((t) => (
            <div
              key={t.id}
              style={{
                display: 'flex',
                justifyContent: t.role === 'ai' ? 'flex-start' : 'flex-end',
                marginBottom: 10,
              }}
            >
              <div
                style={{
                  maxWidth: '78%',
                  padding: '8px 12px',
                  borderRadius: 12,
                  background: t.role === 'ai' ? '#eef2ff' : '#e8f7ee',
                  border: `1px solid ${t.role === 'ai' ? '#c7d2fe' : '#b7e4c7'}`,
                }}
              >
                <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 2 }}>
                  {t.role === 'ai' ? '🤖 AI' : '🧑 ผู้สมัคร'}
                </div>
                <div style={{ whiteSpace: 'pre-wrap' }}>{t.text}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Info({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: '#6b7280' }}>{label}</div>
      <div style={{ fontSize: 15 }}>{value}</div>
    </div>
  );
}
