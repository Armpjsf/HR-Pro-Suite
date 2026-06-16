'use client';

import { useEffect, useState } from 'react';
import { authHeaders } from '@/components/hr/exportUtils';

function Node({ node, level }) {
  return (
    <div style={{ marginLeft: level === 0 ? 0 : 24, marginTop: 8 }}>
      <div className="hr-card" style={{ padding: '10px 14px', display: 'inline-block', minWidth: 220, borderLeft: '3px solid #6d5ef5' }}>
        <div style={{ fontWeight: 700 }}>{node.name}</div>
        <div style={{ fontSize: 12, color: '#5b6478' }}>
          {node.position || '-'}{node.department ? ` · ${node.department}` : ''}
        </div>
        <div style={{ fontSize: 11, color: '#9aa1b5' }}>{node.employeeId}</div>
      </div>
      {node.children.length > 0 && (
        <div style={{ borderLeft: '1px dashed #cbd0dd', marginLeft: 12, paddingLeft: 6 }}>
          {node.children.map((c) => <Node key={c.employeeId} node={c} level={level + 1} />)}
        </div>
      )}
    </div>
  );
}

export default function OrgPage() {
  const [roots, setRoots] = useState(null);

  useEffect(() => {
    fetch('/api/hr/org', { headers: authHeaders() })
      .then((r) => r.json()).then((d) => setRoots(d.roots || [])).catch(() => {});
  }, []);

  if (!roots) return <div className="hr-empty">กำลังโหลด...</div>;

  return (
    <div>
      <div className="hr-toolbar">
        <button className="hr-btn" onClick={() => window.print()}>📑 พิมพ์ผังองค์กร</button>
      </div>
      {roots.length === 0 && <div className="hr-empty">ยังไม่มีข้อมูล — กำหนดหัวหน้าให้พนักงานในหน้า “พนักงาน”</div>}
      {roots.map((r) => <Node key={r.employeeId} node={r} level={0} />)}
    </div>
  );
}
