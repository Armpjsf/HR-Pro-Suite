'use client';

import { useEffect, useState } from 'react';
import ResourceTable from '@/components/hr/ResourceTable';
import { authHeaders } from '@/components/hr/exportUtils';

const LEAVE_LABELS = { annual: 'ลาพักร้อน', sick: 'ลาป่วย', personal: 'ลากิจ' };

export default function LeavePage() {
  const [leaveTypes, setLeaveTypes] = useState([]);

  useEffect(() => {
    fetch('/api/hr/leave-types', { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => setLeaveTypes(d.items || []))
      .catch(() => {});
  }, []);

  const labels = {
    ...LEAVE_LABELS,
    ...Object.fromEntries(leaveTypes.map((t) => [t.code, t.name])),
  };

  async function act(row, action, reload, showToast) {
    const res = await fetch(`/api/hr/leave/${row.id}/approve`, {
      method: 'POST',
      headers: authHeaders(true),
      body: JSON.stringify({ action }),
    });
    const data = await res.json();
    if (res.ok) {
      showToast(action === 'approve' ? 'อนุมัติใบลาแล้ว (อัพเดทวันลาคงเหลืออัตโนมัติ)' : 'ปฏิเสธใบลาแล้ว');
      reload();
    } else {
      showToast(data.error || 'ดำเนินการไม่สำเร็จ', 'error');
    }
  }

  return (
    <ResourceTable
      config={{
        resource: 'leave',
        exportName: 'leave_requests',
        searchPlaceholder: 'ค้นหารหัสพนักงาน/สถานะ...',
        columns: [
          { key: 'employee_id', label: 'พนักงาน' },
          {
            key: 'leave_type', label: 'ประเภท',
            badge: { annual: 'blue', sick: 'red', personal: 'yellow' },
            badgeLabels: labels,
          },
          { key: 'start_date', label: 'ตั้งแต่' },
          { key: 'end_date', label: 'ถึง' },
          { key: 'days', label: 'จำนวนวัน' },
          { key: 'reason', label: 'เหตุผล' },
          {
            key: 'manager_status', label: 'หัวหน้า',
            badge: { pending: 'yellow', approved: 'green', rejected: 'red' },
            badgeLabels: { pending: 'รอหัวหน้า', approved: 'หัวหน้าอนุมัติ', rejected: 'หัวหน้าปฏิเสธ' },
          },
          {
            key: 'status', label: 'สถานะ (HR)',
            badge: { pending: 'yellow', approved: 'green', rejected: 'red' },
            badgeLabels: { pending: 'รออนุมัติ', approved: 'อนุมัติแล้ว', rejected: 'ปฏิเสธ' },
          },
          { key: 'approved_by', label: 'ผู้อนุมัติ' },
        ],
        fields: [
          { key: 'employee_id', label: 'พนักงาน', type: 'employee', required: true },
          {
            key: 'leave_type', label: 'ประเภทการลา', type: 'select', required: true,
            options: Object.entries(labels).map(([value, label]) => ({ value, label })),
          },
          { key: 'start_date', label: 'วันที่เริ่มลา', type: 'date', required: true },
          { key: 'end_date', label: 'ถึงวันที่', type: 'date', required: true },
          { key: 'days', label: 'จำนวนวัน', type: 'number', required: true },
          { key: 'reason', label: 'เหตุผล', type: 'textarea' },
        ],
        renderActions: (row, reload, showToast) =>
          row.status === 'pending' ? (
            <>
              <button
                className="hr-btn hr-btn-icon hr-btn-success"
                title="อนุมัติ"
                onClick={() => act(row, 'approve', reload, showToast)}
              >✓</button>
              <button
                className="hr-btn hr-btn-icon hr-btn-danger"
                title="ปฏิเสธ"
                onClick={() => act(row, 'reject', reload, showToast)}
                style={{ marginLeft: 6 }}
              >✗</button>
            </>
          ) : null,
      }}
    />
  );
}
