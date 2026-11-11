'use client';

import { useEffect, useState } from 'react';
import { authHeaders } from '@/components/hr/exportUtils';

const DEFAULT_CONSENT =
  'สวัสดีค่ะ สายนี้เป็นการสัมภาษณ์งานเบื้องต้นด้วยระบบผู้ช่วย AI และมีการบันทึกเสียงเพื่อใช้ประกอบการพิจารณาคัดเลือกเท่านั้น หากคุณยินยอมให้ดำเนินการต่อ กรุณาพูดว่า “ยินยอม” ค่ะ';
const DEFAULT_INTRO =
  'ขอบคุณค่ะ เราจะเริ่มสัมภาษณ์สั้น ๆ ประมาณ 4-5 คำถามนะคะ ตอบตามสะดวกได้เลยค่ะ';

function emptySet() {
  return {
    name: '',
    position: '',
    lang: 'th',
    intro_script: DEFAULT_INTRO,
    consent_script: DEFAULT_CONSENT,
    questions: [{ q: '', weight: 1 }],
    active: true,
  };
}

export default function InterviewsPage() {
  const [sets, setSets] = useState([]);
  const [positions, setPositions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // set object (with id when editing)
  const [toast, setToast] = useState('');

  function load() {
    setLoading(true);
    fetch('/api/hr/interviews/question-sets', { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => setSets(d.items || []))
      .finally(() => setLoading(false));
    fetch('/api/hr/positions', { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => setPositions(d.items || []))
      .catch(() => {});
  }
  useEffect(load, []);

  function showToast(m) {
    setToast(m);
    setTimeout(() => setToast(''), 3000);
  }

  async function save() {
    const isEdit = !!editing.id;
    const url = isEdit
      ? `/api/hr/interviews/question-sets/${editing.id}`
      : '/api/hr/interviews/question-sets';
    const res = await fetch(url, {
      method: isEdit ? 'PUT' : 'POST',
      headers: authHeaders(true),
      body: JSON.stringify(editing),
    });
    const data = await res.json();
    if (!res.ok) return showToast(data.error || 'บันทึกไม่สำเร็จ');
    setEditing(null);
    showToast('บันทึกแล้ว');
    load();
  }

  async function remove(s) {
    if (!confirm(`ลบชุดคำถาม "${s.name}"?`)) return;
    const res = await fetch(`/api/hr/interviews/question-sets/${s.id}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    if (res.ok) { showToast('ลบแล้ว'); load(); }
  }

  return (
    <div className="hr-page">
      <div className="hr-toolbar" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0 }}>🎙️ AI สัมภาษณ์ — ชุดคำถาม</h2>
        <button className="hr-btn hr-btn-primary" onClick={() => setEditing(emptySet())}>+ เพิ่มชุดคำถาม</button>
      </div>

      <div style={{ padding: 12, background: '#eef4ff', border: '1px solid #cddffb', borderRadius: 8, fontSize: 13, marginBottom: 14 }}>
        ตั้งชุดคำถามที่ AI จะใช้โทรสัมภาษณ์ผู้สมัคร — ผูกกับ “ตำแหน่ง” เพื่อให้ระบบเลือกชุดที่ตรงงานให้อัตโนมัติ
        ตอนกดโทรจากหน้า <b>ผู้สมัคร</b>. ระบบโทรอัตโนมัติจริงจะทำงานเมื่อเปิดใช้เฟสถัดไป (Twilio)
      </div>

      {loading ? (
        <div className="hr-empty">กำลังโหลด...</div>
      ) : sets.length === 0 ? (
        <div className="hr-empty">ยังไม่มีชุดคำถาม</div>
      ) : (
        <div className="hr-table-wrap">
          <table className="hr-table">
            <thead>
              <tr>
                <th>ชื่อชุด</th><th>ตำแหน่ง</th><th>ภาษา</th><th>จำนวนคำถาม</th><th>สถานะ</th><th></th>
              </tr>
            </thead>
            <tbody>
              {sets.map((s) => (
                <tr key={s.id}>
                  <td>{s.name}</td>
                  <td>{s.position || '— ทุกตำแหน่ง —'}</td>
                  <td>{s.lang === 'en' ? 'อังกฤษ' : 'ไทย'}</td>
                  <td>{(s.questions || []).length}</td>
                  <td>{s.active ? '✅ ใช้งาน' : '⛔ ปิด'}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="hr-btn hr-btn-icon" title="แก้ไข" onClick={() => setEditing({ ...s, questions: s.questions?.length ? s.questions : [{ q: '', weight: 1 }] })}>✏️</button>
                    <button className="hr-btn hr-btn-icon hr-btn-danger" title="ลบ" onClick={() => remove(s)} style={{ marginLeft: 6 }}>🗑️</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <SetEditor
          value={editing}
          positions={positions}
          onChange={setEditing}
          onSave={save}
          onClose={() => setEditing(null)}
        />
      )}

      {toast && <div className="hr-toast">{toast}</div>}
    </div>
  );
}

function SetEditor({ value, positions = [], onChange, onSave, onClose }) {
  const [generating, setGenerating] = useState(false);
  const [genErr, setGenErr] = useState('');

  const set = (patch) => onChange({ ...value, ...patch });
  const questions = value.questions || [];

  async function handleGenerateAI() {
    const targetPos = (value.position || value.name || '').trim();
    if (!targetPos) {
      alert('กรุณาเลือกตำแหน่ง หรือพิมพ์ชื่อตำแหน่งในช่องชื่อชุดก่อนกดให้ AI ออกแบบคำถามครับ');
      return;
    }
    setGenerating(true);
    setGenErr('');
    try {
      const res = await fetch('/api/hr/interviews/question-sets/generate', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({ position: targetPos }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'ไม่สามารถสร้างคำถามได้');
      if (d.data) {
        onChange({
          ...value,
          name: d.data.name || value.name,
          position: d.data.position || value.position,
          intro_script: d.data.intro_script || value.intro_script,
          consent_script: d.data.consent_script || value.consent_script,
          questions: d.data.questions || value.questions,
        });
      }
    } catch (e) {
      setGenErr(e.message);
    } finally {
      setGenerating(false);
    }
  }

  function setQ(i, patch) {
    const next = questions.map((q, idx) => (idx === i ? { ...q, ...patch } : q));
    set({ questions: next });
  }
  function addQ() { set({ questions: [...questions, { q: '', weight: 1 }] }); }
  function removeQ(i) { set({ questions: questions.filter((_, idx) => idx !== i) }); }

  return (
    <div className="hr-modal-overlay" onClick={onClose}>
      <div className="hr-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640, width: '92%' }}>
        <div className="hr-modal-header">
          <div className="hr-modal-title">{value.id ? 'แก้ไขชุดคำถาม' : 'เพิ่มชุดคำถาม'}</div>
          <button className="hr-modal-close" onClick={onClose}>✕</button>
        </div>

        <div style={{ maxHeight: '72vh', overflowY: 'auto', paddingRight: 4 }}>
          {/* แบนเนอร์ผู้ช่วย AI ออกแบบคำถาม */}
          <div style={{ background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: 8, padding: 12, marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <span style={{ fontWeight: 600, color: '#6d28d9', fontSize: 13 }}>✨ AI ช่วยออกแบบชุดคำถามตามตำแหน่ง</span>
                <div style={{ fontSize: 12, color: '#7c3aed', marginTop: 2 }}>
                  เลือกตำแหน่งงานด้านล่าง แล้วกดปุ่มนี้เพื่อให้ AI ร่างคำถามและกำหนดน้ำหนักให้อัตโนมัติ
                </div>
              </div>
              <button
                type="button"
                className="hr-btn"
                style={{ background: '#7c3aed', color: '#fff', border: 'none', fontSize: 13, padding: '7px 14px', borderRadius: 6, cursor: 'pointer' }}
                onClick={handleGenerateAI}
                disabled={generating}
              >
                {generating ? '⏳ AI กำลังออกแบบคำถาม...' : '✨ ออกแบบชุดคำถามด้วย AI'}
              </button>
            </div>
            {genErr && <div style={{ color: '#dc2626', fontSize: 12, marginTop: 6 }}>⚠️ {genErr}</div>}
          </div>

          <div className="hr-field">
            <label>ชื่อชุด *</label>
            <input className="hr-input" value={value.name} onChange={(e) => set({ name: e.target.value })} placeholder="เช่น คัดกรองพนักงานขับรถ" />
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <div className="hr-field" style={{ flex: 1 }}>
              <label>ตำแหน่ง (ว่าง = ทุกตำแหน่ง)</label>
              <select className="hr-input" value={value.position || ''} onChange={(e) => set({ position: e.target.value })}>
                <option value="">— ทุกตำแหน่ง —</option>
                {positions.map((p) => (
                  <option key={p.id || p.title} value={p.title}>{p.title} {p.level ? `(${p.level})` : ''}</option>
                ))}
                {value.position && !positions.some((p) => p.title === value.position) && (
                  <option value={value.position}>{value.position} (เดิม)</option>
                )}
              </select>
            </div>
            <div className="hr-field" style={{ width: 140 }}>
              <label>ภาษา</label>
              <select className="hr-input" value={value.lang} onChange={(e) => set({ lang: e.target.value })}>
                <option value="th">ไทย</option>
                <option value="en">อังกฤษ</option>
              </select>
            </div>
          </div>

          <div className="hr-field">
            <label>ข้อความขอความยินยอม (PDPA) — AI พูดต้นสาย</label>
            <textarea className="hr-input" rows={3} value={value.consent_script || ''} onChange={(e) => set({ consent_script: e.target.value })} />
          </div>
          <div className="hr-field">
            <label>ประโยคเปิดหลังยินยอม</label>
            <textarea className="hr-input" rows={2} value={value.intro_script || ''} onChange={(e) => set({ intro_script: e.target.value })} />
          </div>

          <div className="hr-field">
            <label>คำถามสัมภาษณ์ (น้ำหนัก = ความสำคัญตอนให้คะแนน)</label>
            {questions.map((q, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'flex-start' }}>
                <span style={{ paddingTop: 8, color: '#6b7280', width: 18 }}>{i + 1}.</span>
                <textarea
                  className="hr-input"
                  rows={2}
                  style={{ flex: 1 }}
                  value={q.q}
                  onChange={(e) => setQ(i, { q: e.target.value })}
                  placeholder="เช่น เริ่มงานได้เร็วที่สุดเมื่อไหร่คะ"
                />
                <input
                  className="hr-input"
                  type="number"
                  min={1}
                  style={{ width: 64 }}
                  value={q.weight}
                  onChange={(e) => setQ(i, { weight: Number(e.target.value) || 1 })}
                  title="น้ำหนัก"
                />
                <button className="hr-btn hr-btn-icon hr-btn-danger" onClick={() => removeQ(i)} title="ลบคำถาม">✕</button>
              </div>
            ))}
            <button className="hr-btn" onClick={addQ}>+ เพิ่มคำถาม</button>
          </div>

          <div className="hr-field">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={value.active} onChange={(e) => set({ active: e.target.checked })} />
              เปิดใช้งานชุดนี้
            </label>
          </div>
        </div>

        <div className="hr-modal-actions">
          <button className="hr-btn" onClick={onClose}>ยกเลิก</button>
          <button className="hr-btn hr-btn-primary" onClick={onSave} disabled={!value.name?.trim()}>บันทึก</button>
        </div>
      </div>
    </div>
  );
}
