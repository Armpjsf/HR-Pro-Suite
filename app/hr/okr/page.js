'use client';

import ResourceTable from '@/components/hr/ResourceTable';

export default function OkrPage() {
  return (
    <ResourceTable
      config={{
        resource: 'okr',
        exportName: 'okrs',
        searchPlaceholder: 'ค้นหา Objective...',
        columns: [
          { key: 'employee_id', label: 'พนักงาน' },
          { key: 'objective', label: 'Objective' },
          { key: 'key_results', label: 'Key Results' },
          { key: 'period', label: 'รอบ' },
          {
            key: 'progress', label: 'ความคืบหน้า',
            format: (v) => (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div className="hr-progress"><div style={{ width: `${Math.min(100, Number(v) || 0)}%` }} /></div>
                <span style={{ fontSize: 12 }}>{Number(v) || 0}%</span>
              </div>
            ),
          },
          {
            key: 'status', label: 'สถานะ',
            badge: { active: 'blue', done: 'green', cancelled: 'gray' },
            badgeLabels: { active: 'ดำเนินการ', done: 'สำเร็จ', cancelled: 'ยกเลิก' },
          },
        ],
        fields: [
          { key: 'employee_id', label: 'พนักงาน (เว้นว่าง = ระดับองค์กร)', type: 'employee' },
          { key: 'objective', label: 'Objective', type: 'text', required: true },
          { key: 'key_results', label: 'Key Results', type: 'textarea' },
          { key: 'period', label: 'รอบ (เช่น Q1/2569)', type: 'text' },
          { key: 'progress', label: 'ความคืบหน้า (%)', type: 'number', default: 0 },
          {
            key: 'status', label: 'สถานะ', type: 'select', default: 'active',
            options: [
              { value: 'active', label: 'ดำเนินการ' },
              { value: 'done', label: 'สำเร็จ' },
              { value: 'cancelled', label: 'ยกเลิก' },
            ],
          },
        ],
      }}
    />
  );
}
