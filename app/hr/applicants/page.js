'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import ResourceTable from '@/components/hr/ResourceTable';
import { authHeaders } from '@/components/hr/exportUtils';
import { alertDialog } from '@/components/ui/ConfirmDialog';

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
  const [hireModal, setHireModal] = useState(null);
  const [branches, setBranches] = useState([]);
  const [hireBranchId, setHireBranchId] = useState('');
  const [hireDate, setHireDate] = useState(new Date().toISOString().slice(0, 10));
  const [hireSalary, setHireSalary] = useState('');
  const [hiring, setHiring] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    fetch('/api/hr/interviews/question-sets', { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => setQuestionSets((d.items || []).filter((s) => s.active)))
      .catch(() => {});

    fetch('/api/hr/branches', { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => setBranches(d.items || []))
      .catch(() => {});
  }, []);

  async function handleConfirmHire(e, reload) {
    e.preventDefault();
    if (!hireModal) return;
    setHiring(true);
    try {
      const empRes = await fetch('/api/hr/employees', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({
          name: hireModal.name,
          email: hireModal.email,
          phone: hireModal.phone,
          position: hireModal.position_applied,
          branchId: hireBranchId,
          startDate: hireDate,
          salary: Number(hireSalary) || 0,
        }),
      });
      const empData = await empRes.json();
      if (!empRes.ok) throw new Error(empData.error || 'สร้างพนักงานไม่สำเร็จ');

      await fetch(`/api/hr/applicants/${hireModal.id}`, {
        method: 'PUT',
        headers: authHeaders(true),
        body: JSON.stringify({ status: 'hired' }),
      });

      // สร้าง Onboarding Checklist เริ่มต้นอัตโนมัติให้พนักงานใหม่
      const defaultTasks = [
        'ส่งสำเนาบัตรประชาชนและทะเบียนบ้าน',
        'ส่งหน้าสมุดบัญชีธนาคารสำหรับรับเงินเดือน',
        'รับมอบอุปกรณ์ทำงานและตรวจเช็คสภาพ',
        'แนะนำตัวกับทีมงานและหัวหน้าแผนก',
        'อบรมกฎระเบียบและแนวปฏิบัติความปลอดภัยบริษัท',
      ];
      for (const item of defaultTasks) {
        await fetch('/api/hr/onboarding', {
          method: 'POST',
          headers: authHeaders(true),
          body: JSON.stringify({
            employee_id: empData.employeeId,
            item,
            due_date: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
            done: false,
          }),
        }).catch(() => {});
      }

      showToast(`รับคุณ ${hireModal.name} เข้าทำงานแล้ว (รหัส: ${empData.employeeId}) พร้อมสร้าง Onboarding ให้เรียบร้อย`, 'success');
      setHireModal(null);
      if (reload) reload();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setHiring(false);
    }
  }

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
            { key: 'position_applied', label: 'ตำแหน่งที่สมัคร', type: 'position' },
            { key: 'phone', label: 'เบอร์โทร', type: 'text' },
            { key: 'email', label: 'อีเมล', type: 'text' },
            { key: 'applied_date', label: 'วันที่สมัคร', type: 'date' },
            { key: 'status', label: 'สถานะ', type: 'select', default: 'applied', options: STATUS },
            { key: 'note', label: 'หมายเหตุ', type: 'textarea' },
          ],
          renderActions: (row, reload) => (
            <>
              {(row.status === 'offer' || row.status === 'screening' || row.status === 'interview') && (
                <button
                  className="hr-btn hr-btn-icon"
                  title="รับเข้าทำงาน (สร้างเป็นพนักงานทันที)"
                  onClick={() => {
                    setHireModal(row);
                    setHireBranchId(branches[0]?.id ? String(branches[0].id) : '');
                  }}
                  style={{ marginLeft: 6, color: '#16a34a', fontWeight: 'bold' }}
                >
                  🎉
                </button>
              )}
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

      {hireModal && (
        <div className="hr-modal-overlay">
          <div className="hr-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 500 }}>
            <div className="hr-modal-header">
              <div className="hr-modal-title">🎉 รับผู้สมัครเข้าทำงาน (สร้างพนักงานใหม่)</div>
              <button className="hr-modal-close" onClick={() => setHireModal(null)}>✕</button>
            </div>
            <form onSubmit={(e) => handleConfirmHire(e, () => window.location.reload())}>
              <div style={{ background: '#f0fdf4', padding: 12, borderRadius: 8, marginBottom: 12, border: '1px solid #bbf7d0', fontSize: 13 }}>
                <div>ผู้สมัคร: <b>{hireModal.name}</b></div>
                <div>ตำแหน่งที่สมัคร: <b>{hireModal.position_applied || '-'}</b></div>
                <div>เบอร์โทร: <b>{hireModal.phone || '-'}</b> · อีเมล: <b>{hireModal.email || '-'}</b></div>
              </div>

              <div className="hr-field">
                <label>ประจำสาขา *</label>
                <select className="hr-input" value={hireBranchId} onChange={(e) => setHireBranchId(e.target.value)} required>
                  <option value="">— เลือกสาขา —</option>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div className="hr-field">
                  <label>วันเริ่มงาน *</label>
                  <input className="hr-input" type="date" value={hireDate} onChange={(e) => setHireDate(e.target.value)} required />
                </div>
                <div className="hr-field">
                  <label>เงินเดือนเริ่มต้น (บาท) *</label>
                  <input className="hr-input" type="number" value={hireSalary} onChange={(e) => setHireSalary(e.target.value)} required />
                </div>
              </div>

              <div className="hr-modal-actions" style={{ marginTop: 14 }}>
                <button type="button" className="hr-btn" onClick={() => setHireModal(null)}>ยกเลิก</button>
                <button type="submit" className="hr-btn hr-btn-primary" style={{ backgroundColor: '#16a34a', borderColor: '#16a34a' }} disabled={hiring}>
                  {hiring ? '⏳ กำลังสร้างพนักงาน...' : 'ยืนยันรับเข้าทำงาน'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {toast && <div className={`hr-toast ${toast.type}`}>{toast.message}</div>}

    </>
  );
}

function InterviewModal({ applicant, questionSets, onClose }) {
  const [setsList, setSetsList] = useState(questionSets);
  const [setId, setSetId] = useState('');
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genNotice, setGenNotice] = useState('');
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState('');

  useEffect(() => {
    if (typeof window !== 'undefined') setOrigin(window.location.origin);
  }, []);

  // เลือกชุดคำถามที่ตรงตำแหน่งให้อัตโนมัติ
  useEffect(() => {
    const match = setsList.find((s) => s.position && s.position === applicant.position_applied);
    if (match) setSetId(String(match.id));
    else if (setsList.length) setSetId(String(setsList[0].id));
  }, [setsList, applicant]);

  async function handleGenerateForApplicant() {
    const pos = (applicant.position_applied || '').trim();
    if (!pos) {
      await alertDialog({ title: 'ข้อมูลไม่ครบถ้วน', message: 'ผู้สมัครยังไม่มีการระบุตำแหน่งงาน', type: 'warning' });
      return;
    }
    setGenerating(true);
    setErr('');
    setGenNotice('');
    try {
      const genRes = await fetch('/api/hr/interviews/question-sets/generate', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({ position: pos }),
      });
      const genData = await genRes.json();
      if (!genRes.ok) throw new Error(genData.error || 'AI ไม่สามารถออกแบบคำถามได้');

      const saveRes = await fetch('/api/hr/interviews/question-sets', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify(genData.data),
      });
      const saveData = await saveRes.json();
      if (!saveRes.ok) throw new Error(saveData.error || 'ไม่สามารถบันทึกชุดคำถามได้');

      const newSet = saveData.item;
      setSetsList((prev) => [newSet, ...prev]);
      setSetId(String(newSet.id));
      setGenNotice(`✨ AI ได้ออกแบบชุดคำถามสำหรับตำแหน่ง "${pos}" และเลือกให้อัตโนมัติแล้ว!`);
    } catch (e) {
      setErr(e.message);
    } finally {
      setGenerating(false);
    }
  }

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

  const interviewFullUrl = result?.item?.id
    ? (origin ? `${origin}/interview/${result.item.id}` : `/interview/${result.item.id}`)
    : '';

  const copyLink = (text) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="hr-modal-overlay" onClick={onClose}>
      <div className="hr-modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <div className="hr-modal-header">
          <h3>🎙️ สัมภาษณ์ออนไลน์ด้วย AI (Web Voice)</h3>
          <button className="hr-modal-close" onClick={onClose}>✕</button>
        </div>
        <div style={{ padding: '4px 4px 12px' }}>
          <p style={{ margin: '4px 0' }}><b>ผู้สมัคร:</b> {applicant.name}</p>
          <p style={{ margin: '4px 0' }}><b>ตำแหน่ง:</b> {applicant.position_applied || '-'}</p>
          <p style={{ margin: '4px 0' }}><b>เบอร์โทร:</b> {applicant.phone || '-'}</p>

          {!result ? (
            <>
              <label style={{ display: 'block', marginTop: 10, marginBottom: 4, fontWeight: 600, fontSize: 13 }}>
                ชุดคำถามสัมภาษณ์ (ตามสายงาน)
              </label>
              <select className="hr-input" value={setId} onChange={(e) => setSetId(e.target.value)}>
                <option value="">— ไม่ระบุ (ใช้คำถามมาตรฐาน) —</option>
                {setsList.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}{s.position ? ` (${s.position})` : ''}
                  </option>
                ))}
              </select>

              {applicant.position_applied && (
                <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                  <span style={{ fontSize: 12, color: '#6b7280' }}>
                    {!setsList.some((s) => s.position === applicant.position_applied)
                      ? `⚠️ ยังไม่มีชุดคำถามตรงตำแหน่ง "${applicant.position_applied}"`
                      : `ต้องการให้ AI ร่างชุดคำถามใหม่สำหรับตำแหน่งนี้?`}
                  </span>
                  <button
                    type="button"
                    className="hr-btn"
                    style={{ fontSize: 12, padding: '5px 12px', background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}
                    onClick={handleGenerateForApplicant}
                    disabled={generating}
                  >
                    {generating ? '⏳ AI กำลังออกแบบคำถาม...' : `✨ ให้ AI เจนชุดคำถามสำหรับ "${applicant.position_applied}"`}
                  </button>
                </div>
              )}
              {genNotice && (
                <div style={{ marginTop: 8, padding: 8, background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: 6, fontSize: 12, color: '#6d28d9' }}>
                  {genNotice}
                </div>
              )}

              <div style={{ marginTop: 12, padding: 12, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, fontSize: 13 }}>
                <b>💡 ระบบสัมภาษณ์ฟรี 100% (ไม่ต้องพึ่งค่าโทรศัพท์):</b>
                <div style={{ marginTop: 4, color: '#166534', lineHeight: 1.5 }}>
                  เมื่อกดสร้างรอบสัมภาษณ์ ระบบจะสร้าง <b>“ลิงก์สัมภาษณ์ออนไลน์ AI”</b> ให้คุณนำไปส่งให้ผู้สมัครผ่าน LINE หรือ SMS ผู้สมัครเปิดผ่านมือถือแล้วพูดคุยตอบโต้กับ AI ด้วยเสียงได้ทันที และระบบจะให้คะแนนอัตโนมัติ
                </div>
              </div>
            </>
          ) : (
            <div style={{ marginTop: 12 }}>
              <div style={{ padding: 12, background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8, marginBottom: 12 }}>
                <div style={{ fontWeight: 600, color: '#15803d', marginBottom: 4 }}>
                  ✅ สร้างรอบสัมภาษณ์เรียบร้อยแล้ว!
                </div>
                <div style={{ fontSize: 13, color: '#166534' }}>
                  คัดลอกลิงก์หรือข้อความด้านล่าง ส่งให้ผู้สมัครทาง LINE / SMS ได้เลยครับ
                </div>
              </div>

              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 12, marginBottom: 12 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 4 }}>
                  🔗 ลิงก์สัมภาษณ์สำหรับผู้สมัคร (Web Voice):
                </label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="text"
                    readOnly
                    className="hr-input"
                    style={{ background: '#ffffff', fontSize: 13, color: '#1e293b' }}
                    value={interviewFullUrl}
                  />
                  <button
                    type="button"
                    className="hr-btn hr-btn-primary"
                    style={{ whiteSpace: 'nowrap' }}
                    onClick={() => copyLink(interviewFullUrl)}
                  >
                    {copied ? 'คัดลอกแล้ว ✓' : '📋 คัดลอก'}
                  </button>
                </div>
              </div>

              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 12, marginBottom: 12 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 4 }}>
                  💬 ข้อความสำเร็จรูปสำหรับส่ง LINE / SMS:
                </label>
                <textarea
                  readOnly
                  rows={4}
                  className="hr-input"
                  style={{ background: '#ffffff', fontSize: 12, color: '#334155', resize: 'none' }}
                  value={
                    result.share_message
                      ? result.share_message.replace('[URL]', origin || '')
                      : `เรียนคุณ ${applicant.name} บริษัทขอเชิญท่านเข้ารับการสัมภาษณ์งานเบื้องต้นออนไลน์ (AI Voice Interview)\nตำแหน่ง: ${applicant.position_applied || 'ทั่วไป'}\nคลิกเพื่อเริ่มสัมภาษณ์: ${interviewFullUrl}\n(ใช้เวลาเพียง 3-5 นาที สามารถเปิดผ่านโทรศัพท์มือถือและพูดคุยกับ AI ได้ทันทีครับ)`
                  }
                />
                <button
                  type="button"
                  className="hr-btn"
                  style={{ marginTop: 6, fontSize: 12 }}
                  onClick={() =>
                    copyLink(
                      result.share_message
                        ? result.share_message.replace('[URL]', origin || '')
                        : `เรียนคุณ ${applicant.name} บริษัทขอเชิญท่านเข้ารับการสัมภาษณ์งานเบื้องต้นออนไลน์ (AI Voice Interview)\nตำแหน่ง: ${applicant.position_applied || 'ทั่วไป'}\nคลิกเพื่อเริ่มสัมภาษณ์: ${interviewFullUrl}\n(ใช้เวลาเพียง 3-5 นาที สามารถเปิดผ่านโทรศัพท์มือถือและพูดคุยกับ AI ได้ทันทีครับ)`
                    )
                  }
                >
                  📋 คัดลอกข้อความทั้งหมด
                </button>
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <a
                  href={`/interview/${result.item.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="hr-btn"
                  style={{ flex: 1, textAlign: 'center', textDecoration: 'none', background: '#3b82f6', color: '#fff' }}
                >
                  🚀 เปิดห้องสัมภาษณ์ (ทดสอบ)
                </a>
                <Link
                  href={`/hr/interviews/${result.item.id}`}
                  className="hr-btn"
                  style={{ flex: 1, textAlign: 'center', textDecoration: 'none' }}
                >
                  📄 ดูหน้าผลสัมภาษณ์ (HR)
                </Link>
              </div>
            </div>
          )}

          {err && <p style={{ color: '#c00', marginTop: 10 }}>{err}</p>}
        </div>
        <div className="hr-modal-actions">
          {result ? (
            <button className="hr-btn hr-btn-primary" onClick={onClose}>เสร็จสิ้น</button>
          ) : (
            <>
              <button className="hr-btn" onClick={onClose}>ยกเลิก</button>
              <button
                className="hr-btn hr-btn-primary"
                disabled={saving}
                onClick={submit}
              >
                {saving ? 'กำลังสร้าง...' : 'สร้างห้องสัมภาษณ์ AI'}
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
              <div
                key={s.id}
                style={{ padding: 12, marginBottom: 10, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fafafa' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: st.color, fontWeight: 600 }}>{st.label}</span>
                  <span style={{ color: '#6b7280', fontSize: 12 }}>
                    {new Date(s.created_at).toLocaleString('th-TH')}
                  </span>
                </div>
                {s.score != null && (
                  <div style={{ marginTop: 4 }}>คะแนน: <b>{s.score}</b>{s.max_score ? ` / ${s.max_score}` : ''}</div>
                )}
                {s.summary && <div style={{ marginTop: 4, fontSize: 13, color: '#374151' }}>{s.summary}</div>}

                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <Link
                    href={`/hr/interviews/${s.id}`}
                    className="hr-btn"
                    style={{ fontSize: 12, padding: '4px 8px', textDecoration: 'none' }}
                  >
                    📄 รายละเอียด & คะแนน
                  </Link>
                  <a
                    href={`/interview/${s.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="hr-btn"
                    style={{ fontSize: 12, padding: '4px 8px', textDecoration: 'none', background: '#3b82f6', color: '#fff' }}
                  >
                    🎙️ ห้องสัมภาษณ์ AI
                  </a>
                </div>
              </div>
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
