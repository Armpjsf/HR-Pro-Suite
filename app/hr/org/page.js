'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { authHeaders } from '@/components/hr/exportUtils';

function OrgNode({ node, level = 0 }) {
  return (
    <div className="hr-org-node-wrap" style={{ marginLeft: level === 0 ? 0 : 28 }}>
      <div className="hr-org-card">
        <div className="hr-org-name">{node.name}</div>
        <div className="hr-org-title">{node.orgTitle || '-'}</div>
        <div className="hr-org-meta">
          {node.orgDepartment || '-'} · {node.employeeId}
        </div>
      </div>
      {node.children?.length > 0 && (
        <div className="hr-org-children">
          {node.children.map((child) => <OrgNode key={child.employeeId} node={child} level={level + 1} />)}
        </div>
      )}
    </div>
  );
}

export default function OrgPage() {
  const [roots, setRoots] = useState([]);
  const [nodes, setNodes] = useState([]);
  const [view, setView] = useState('chart');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/hr/org', { headers: authHeaders() });
    const data = await res.json();
    if (res.ok) {
      setRoots(data.roots || []);
      setNodes(data.nodes || []);
    } else {
      showToast(data.error || 'โหลดผังองค์กรไม่สำเร็จ', 'error');
    }
    setLoading(false);
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  const employees = useMemo(
    () => [...nodes].sort((a, b) => a.name.localeCompare(b.name, 'th')),
    [nodes]
  );

  const rootCount = roots.length;
  const visibleCount = nodes.filter((node) => node.isVisible).length;

  function updateNode(employeeId, key, value) {
    setNodes((prev) => prev.map((node) => node.employeeId === employeeId ? { ...node, [key]: value } : node));
  }

  async function save() {
    setSaving(true);
    const res = await fetch('/api/hr/org', {
      method: 'PUT',
      headers: authHeaders(true),
      body: JSON.stringify({ nodes }),
    });
    const data = await res.json();
    setSaving(false);
    if (res.ok) {
      showToast('บันทึกผังองค์กรแล้ว');
      load();
    } else {
      showToast(data.error || 'บันทึกไม่สำเร็จ', 'error');
    }
  }

  if (loading) return <div className="hr-empty">กำลังโหลด...</div>;

  return (
    <div>
      <div className="hr-stat-row">
        <div className="hr-stat-card">
          <div className="hr-stat-icon">🗂️</div>
          <div><div className="hr-stat-value">{visibleCount}</div><div className="hr-stat-label">คนที่แสดงในผัง</div></div>
        </div>
        <div className="hr-stat-card">
          <div className="hr-stat-icon">🏁</div>
          <div><div className="hr-stat-value">{rootCount}</div><div className="hr-stat-label">ตำแหน่งบนสุด</div></div>
        </div>
      </div>

      <div className="hr-toolbar">
        <button className={`hr-tab${view === 'chart' ? ' active' : ''}`} onClick={() => setView('chart')}>ผังองค์กร</button>
        <button className={`hr-tab${view === 'settings' ? ' active' : ''}`} onClick={() => setView('settings')}>ตั้งค่าผังจริง</button>
        <button className="hr-btn" onClick={() => window.print()}>พิมพ์ผังองค์กร</button>
        {view === 'settings' && (
          <button className="hr-btn hr-btn-primary" disabled={saving} onClick={save}>
            {saving ? 'กำลังบันทึก...' : 'บันทึกผัง'}
          </button>
        )}
      </div>

      {view === 'chart' ? (
        <div className="hr-org-canvas">
          {roots.length === 0 && <div className="hr-empty">ยังไม่มีข้อมูลผังองค์กร เปิดแท็บ “ตั้งค่าผังจริง” เพื่อกำหนดโครงสร้าง</div>}
          {roots.map((root) => <OrgNode key={root.employeeId} node={root} />)}
        </div>
      ) : (
        <div className="hr-table-wrap">
          <table className="hr-table">
            <thead>
              <tr>
                <th>แสดง</th>
                <th>พนักงาน</th>
                <th>ตำแหน่งในผัง</th>
                <th>หน่วยงานในผัง</th>
                <th>อยู่ใต้</th>
                <th>ลำดับ</th>
              </tr>
            </thead>
            <tbody>
              {nodes.map((node) => (
                <tr key={node.employeeId}>
                  <td>
                    <input
                      type="checkbox"
                      checked={!!node.isVisible}
                      onChange={(e) => updateNode(node.employeeId, 'isVisible', e.target.checked)}
                    />
                  </td>
                  <td>
                    <div style={{ fontWeight: 700 }}>{node.name}</div>
                    <div style={{ fontSize: 12, color: '#9aa1b5' }}>{node.employeeId}</div>
                  </td>
                  <td>
                    <input
                      className="hr-input"
                      value={node.orgTitle || ''}
                      placeholder={node.defaultPosition || 'ตำแหน่ง'}
                      onChange={(e) => updateNode(node.employeeId, 'orgTitle', e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      className="hr-input"
                      value={node.orgDepartment || ''}
                      placeholder={node.defaultDepartment || 'หน่วยงาน'}
                      onChange={(e) => updateNode(node.employeeId, 'orgDepartment', e.target.value)}
                    />
                  </td>
                  <td>
                    <select
                      value={node.parentEmployeeId || ''}
                      onChange={(e) => updateNode(node.employeeId, 'parentEmployeeId', e.target.value || null)}
                    >
                      <option value="">บนสุดของผัง</option>
                      {employees
                        .filter((emp) => emp.employeeId !== node.employeeId)
                        .map((emp) => <option key={emp.employeeId} value={emp.employeeId}>{emp.name} · {emp.employeeId}</option>)}
                    </select>
                  </td>
                  <td>
                    <input
                      className="hr-input"
                      type="number"
                      value={node.sortOrder}
                      onChange={(e) => updateNode(node.employeeId, 'sortOrder', e.target.value === '' ? 0 : Number(e.target.value))}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {nodes.length === 0 && <div className="hr-empty">ยังไม่มีพนักงานในระบบ</div>}
        </div>
      )}

      {toast && <div className={`hr-toast ${toast.type}`}>{toast.message}</div>}
    </div>
  );
}
