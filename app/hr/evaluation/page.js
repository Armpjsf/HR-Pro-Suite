'use client';

import { useEffect, useState } from 'react';
import ResourceTable from '@/components/hr/ResourceTable';
import { authHeaders } from '@/components/hr/exportUtils';

const HR_EVAL_CONFIG = {
  resource: 'evaluation',
  exportName: 'evaluations',
  searchPlaceholder: 'ค้นหารหัสพนักงาน/รอบ...',
  columns: [
    { key: 'employee_id', label: 'พนักงาน' },
    { key: 'period', label: 'รอบประเมิน' },
    { key: 'score', label: 'คะแนน' },
    { key: 'grade', label: 'เกรด' },
    { key: 'evaluator', label: 'ผู้ประเมิน' },
    {
      key: 'status', label: 'สถานะ',
      badge: { draft: 'gray', submitted: 'yellow', final: 'green' },
      badgeLabels: { draft: 'ร่าง', submitted: 'ส่งแล้ว', final: 'สรุปผล' },
    },
  ],
  fields: [
    { key: 'employee_id', label: 'พนักงาน', type: 'employee', required: true },
    { key: 'period', label: 'รอบประเมิน (เช่น 2569-H1)', type: 'text', required: true },
    { key: 'score', label: 'คะแนน', type: 'number' },
    { key: 'grade', label: 'เกรด (A/B/C/D)', type: 'text' },
    { key: 'evaluator', label: 'ผู้ประเมิน', type: 'text' },
    { key: 'comments', label: 'ความเห็น', type: 'textarea' },
    {
      key: 'status', label: 'สถานะ', type: 'select', default: 'draft',
      options: [
        { value: 'draft', label: 'ร่าง' },
        { value: 'submitted', label: 'ส่งแล้ว' },
        { value: 'final', label: 'สรุปผล' },
      ],
    },
  ],
};

function gradeColor(v) {
  if (v == null) return 'gray';
  if (v >= 4.5) return 'green';
  if (v >= 3.5) return 'blue';
  if (v >= 2.5) return 'yellow';
  return 'red';
}

function PeerSummary() {
  const [data, setData] = useState(null);
  const [period, setPeriod] = useState('');

  useEffect(() => {
    const q = period ? `?period=${encodeURIComponent(period)}` : '';
    fetch(`/api/hr/peer-evaluations${q}`, { headers: authHeaders() })
      .then((r) => r.json()).then(setData).catch(() => {});
  }, [period]);

  if (!data) return <div className="hr-empty">กำลังโหลด...</div>;

  return (
    <div>
      <div className="hr-toolbar">
        <select className="hr-search" value={period} onChange={(e) => setPeriod(e.target.value)} style={{ maxWidth: 200 }}>
          <option value="">ทุกรอบ</option>
          {(data.periods || []).map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>
      <div className="hr-table-wrap">
        <table className="hr-table">
          <thead>
            <tr>
              <th>พนักงาน</th><th>แผนก</th>
              {data.criteria.map((c) => <th key={c.key}>{c.label}</th>)}
              <th>เฉลี่ยรวม</th><th>จำนวนผู้ประเมิน</th>
            </tr>
          </thead>
          <tbody>
            {data.summary.map((s) => (
              <tr key={s.targetId}>
                <td>{s.name}</td>
                <td>{s.department || '-'}</td>
                {data.criteria.map((c) => (
                  <td key={c.key}>{s.scores[c.key] != null ? s.scores[c.key] : '-'}</td>
                ))}
                <td><span className={`hr-badge hr-badge-${gradeColor(s.overall)}`}>{s.overall != null ? `${s.overall} / 5` : '-'}</span></td>
                <td>{s.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.summary.length === 0 && <div className="hr-empty">ยังไม่มีผลประเมิน 360°</div>}
      </div>
    </div>
  );
}

export default function EvaluationPage() {
  const [tab, setTab] = useState('hr');
  return (
    <div>
      <div className="hr-tabs">
        <button className={`hr-tab${tab === 'hr' ? ' active' : ''}`} onClick={() => setTab('hr')}>🎯 ประเมินผล (HR)</button>
        <button className={`hr-tab${tab === 'peer' ? ' active' : ''}`} onClick={() => setTab('peer')}>👥 ประเมิน 360° (เพื่อนร่วมงาน)</button>
      </div>
      {tab === 'hr' ? <ResourceTable config={HR_EVAL_CONFIG} /> : <PeerSummary />}
    </div>
  );
}
