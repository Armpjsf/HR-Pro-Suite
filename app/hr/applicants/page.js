'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import ResourceTable from '@/components/hr/ResourceTable';
import { authHeaders } from '@/components/hr/exportUtils';

const STATUS = [
  { value: 'applied', label: 'สมัครแล้ว' },
  { value: 'screening', label: 'คัดกรอง' },
  { value: 'interview', label: 'สัมภาษณ์' },
  { value: 'offer', label: 'ยื่นข้อเสนอ' },
  { value: 'hired', label: 'รับเข้าทำงาน' },
  { value: 'rejected', label: 'ไม่ผ่าน' },
];

export default function ApplicantsPage() {
  const [questionSets, setQuestionSets] = useState([]);
  const [interviewFor, setInterviewFor] = useState(null); // applicant row
  const [sessionsFor, setSessionsFor] = useState(null); // applicant row

  useEffect(() => {
    fetch('/api/hr/interviews/question-sets', { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => setQuestionSets((d.items || []).filter((s) => s.active)))
      .catch(() => {});
  }, []);

  return (
    <>
      <ResourceTable
        config={{
          resource: 'applicants',
          exportName: 'applicants',
          searchPlaceholder: 'ค้นหาชื่อ/ตำแหน่ง...',
          columns: [
            { key: 'name', label: 'ชื่อผู้สมัคร' },
            { key: 'position_applied', label: 'ตำแหน่งที่สมัคร' },
            { key: 'phone', label: 'โทร' },
            { key: 'email', label: 'อีเมล' },
            { key: 'applied_date', label: 'วันที่สมัคร' },
            { key: 'interview_score', label: 'คะแนนสัมภาษณ์' },
            {
              key: 'status', label: 'สถานะ',
              badge: { applied: 'blue', screening: 'yellow', interview: 'purple', offer: 'yellow', hired: 'green', rejected: 'red' },
              badgeLabels: Object.fromEntries(STATUS.map((s) => [s.value, s.label])),
            },
          ],
          fields: [
            { key: 'name', label: 'ชื่อผู้สมัคร', type: 'text', required: true },
            { key: 'position_applied', label: 'ตำแหน่งที่สมัคร', type: 'text' },
            { key: 'phone', label: 'เบอร์โทร', type: 'text' },
            { key: 'email', label: 'อีเมล', type: 'text' },
            { key: 'applied_date', label: 'วันที่สมัคร', type: 'date' },
            { key: 'status', label: 'สถานะ', type: 'select', default: 'applied', options: STATUS },
            { key: 'note', label: 'หมายเหตุ', type: 'textarea' },
          ],
          renderActions: (row) => (
            <>
              <button
                className="hr-btn hr-btn-icon"
                title="โทรสัมภาษณ์ด้วย AI"
                onClick={() => setInterviewFor(row)}
                style={{ marginLeft: 6 }}
              >
                🎙️
              </button>
              <button
                className="hr-btn hr-btn-icon"
                title="ผลสัมภาษณ์"
                onClick={() => setSessionsFor(row)}
                style={{ marginLeft: 6 }}
              >
                📄
              </button>
            </>
          ),
        }}
      />

      {interviewFor && (
        <InterviewModal
          applicant={interviewFor}
          questionSets={questionSets}
          onClose={() => setInterviewFor(null)}
        />
      )}

      {sessionsFor && (
        <SessionsModal applicant={sessionsFor} onClose={() => setSessionsFor(null)} />
      )}
    </>
  );
}

function InterviewModal({ applicant, questionSets, onClose }) {
  const [setId, setSetId] = useState('');
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');

  // เลือกชุดคำถามที่ตรงตำแหน่งให้อัตโนมัติ
  useEffect(() => {
    const match = questionSets.find((s) => s.position && s.position === applicant.position_applied);
    if (match) setSetId(String(match.id));
    else if (questionSets.length) setSetId(String(questionSets[0].id));
  }, [questionSets, applicant]);

  async function submit() {
    setSaving(true);
    setErr('');
    try {
      const res = await fetch('/api/hr/interviews', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({ applicant_id: applicant.id, question_set_id: setId || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'เกิดข้อผิดพลาด');
      setResult(data);
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="hr-modal-overlay" onClick={onClose}>
      <div className="hr-modal" onClick={(e) => e.stopPropagation()}>
        <div className="hr-modal-header">
          <h3>🎙️ โทรสัมภาษณ์ด้วย AI</h3>
          <button className="hr-modal-close" onClick={onClose}>✕</button>
        </div>
        <div style={{ padding: '4px 4px 12px' }}>
          <p style={{ margin: '4px 0' }}><b>ผู้สมัคร:</b> {applicant.name}</p>
          <p style={{ margin: '4px 0' }}><b>ตำแหน่ง:</b> {applicant.position_applied || '-'}</p>
          <p style={{ margin: '4px 0' }}><b>เบอร์โทร:</b> {applicant.phone || <span style={{ color: '#c00' }}>ยังไม่มีเบอร์</span>}</p>

          <label style={{ display: 'block', marginTop: 10, marginBottom: 4, fontWeight: 600, fontSize: 13 }}>ชุดคำถามสัมภาษณ์</label>
          <select className="hr-input" value={setId} onChange={(e) => setSetId(e.target.value)}>
            <option value="">— ไม่ระบุ (ใช้คำถามมาตรฐาน) —</option>
            {questionSets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}{s.position ? ` (${s.position})` : ''}
              </option>
            ))}
          </select>

          {!result && (
            <div style={{ marginTop: 12, padding: 10, background: '#fff7e6', border: '1px solid #ffe0a3', borderRadius: 8, fontSize: 13 }}>
              ℹ️ ระบบจะสร้างรอบสัมภาษณ์และเลื่อนสถานะผู้สมัครเป็น “สัมภาษณ์”
              หากตั้งค่า Twilio แล้ว จะ <b>โทรออกอัตโนมัติทันที</b> (AI จะแจ้งขอความยินยอมบันทึกเสียงก่อนเริ่ม)
            </div>
          )}

          {err && <p style={{ color: '#c00', marginTop: 10 }}>{err}</p>}

          {result && (
            <div style={{ marginTop: 12, padding: 10, background: '#e8f7ee', border: '1px solid #b7e4c7', borderRadius: 8, fontSize: 13 }}>
              ✅ {result.notice || 'สร้างรอบสัมภาษณ์แล้ว'}
            </div>
          )}
        </div>
        <div className="hr-modal-actions">
          {result ? (
            <button className="hr-btn hr-btn-primary" onClick={onClose}>เสร็จสิ้น</button>
          ) : (
            <>
              <button className="hr-btn" onClick={onClose}>ยกเลิก</button>
              <button
                className="hr-btn hr-btn-primary"
                disabled={saving || !applicant.phone}
                onClick={submit}
              >
                {saving ? 'กำลังสร้าง...' : 'สร้างรอบสัมภาษณ์'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const SESSION_STATUS = {
  queued: { label: 'เข้าคิว', color: '#6b7280' },
  calling: { label: 'กำลังต่อสาย', color: '#2563eb' },
  in_progress: { label: 'กำลังสัมภาษณ์', color: '#7c3aed' },
  completed: { label: 'เสร็จสมบูรณ์', color: '#059669' },
  no_consent: { label: 'ไม่ยินยอม', color: '#c026d3' },
  no_answer: { label: 'ไม่รับสาย', color: '#d97706' },
  failed: { label: 'ผิดพลาด', color: '#dc2626' },
};

function SessionsModal({ applicant, onClose }) {
  const [sessions, setSessions] = useState(null);

  useEffect(() => {
    fetch(`/api/hr/interviews?applicant_id=${applicant.id}`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => setSessions(d.items || []))
      .catch(() => setSessions([]));
  }, [applicant]);

  return (
    <div className="hr-modal-overlay" onClick={onClose}>
      <div className="hr-modal" onClick={(e) => e.stopPropagation()}>
        <div className="hr-modal-header">
          <h3>📄 ผลสัมภาษณ์ — {applicant.name}</h3>
          <button className="hr-modal-close" onClick={onClose}>✕</button>
        </div>
        <div style={{ padding: '4px 4px 12px', minWidth: 320 }}>
          {sessions === null && <p>กำลังโหลด...</p>}
          {sessions && sessions.length === 0 && <p style={{ color: '#6b7280' }}>ยังไม่มีรอบสัมภาษณ์</p>}
          {sessions && sessions.map((s) => {
            const st = SESSION_STATUS[s.status] || { label: s.status, color: '#6b7280' };
            return (
              <Link
                key={s.id}
                href={`/hr/interviews/${s.id}`}
                style={{ display: 'block', padding: 10, marginBottom: 8, border: '1px solid #e5e7eb', borderRadius: 8, textDecoration: 'none', color: 'inherit' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: st.color, fontWeight: 600 }}>{st.label}</span>
                  <span style={{ color: '#6b7280', fontSize: 12 }}>
                    {new Date(s.created_at).toLocaleString('th-TH')}
                  </span>
                </div>
                {s.score != null && (
                  <div style={{ marginTop: 4 }}>คะแนน: <b>{s.score}</b>{s.max_score ? ` / ${s.max_score}` : ''}</div>
                )}
                {s.summary && <div style={{ marginTop: 4, fontSize: 13, color: '#374151' }}>{s.summary}</div>}
              </Link>
            );
          })}
        </div>
        <div className="hr-modal-actions">
          <button className="hr-btn hr-btn-primary" onClick={onClose}>ปิด</button>
        </div>
      </div>
    </div>
  );
}
