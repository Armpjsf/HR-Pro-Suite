'use client';

import ResourceTable from '@/components/hr/ResourceTable';

export default function OnboardingPage() {
  return (
    <ResourceTable
      config={{
        resource: 'onboarding',
        exportName: 'onboarding',
        searchPlaceholder: 'ค้นหารหัสพนักงาน/รายการ...',
        columns: [
          { key: 'employee_id', label: 'พนักงานใหม่' },
          { key: 'item', label: 'รายการ' },
          { key: 'due_date', label: 'กำหนดเสร็จ' },
          { key: 'assigned_to', label: 'ผู้รับผิดชอบ' },
          {
            key: 'done', label: 'สถานะ',
            format: (v) => (
              <span className={`hr-badge hr-badge-${v ? 'green' : 'yellow'}`}>{v ? 'เสร็จแล้ว' : 'รอดำเนินการ'}</span>
            ),
          },
        ],
        fields: [
          { key: 'employee_id', label: 'พนักงานใหม่', type: 'employee', required: true },
          { key: 'item', label: 'รายการที่ต้องทำ', type: 'text', required: true },
          { key: 'due_date', label: 'กำหนดเสร็จ', type: 'date' },
          { key: 'assigned_to', label: 'ผู้รับผิดชอบ', type: 'text' },
          { key: 'done', label: 'เสร็จแล้ว', type: 'checkbox' },
        ],
      }}
    />
  );
}
