'use client';

import ResourceTable from '@/components/hr/ResourceTable';

export default function EvaluationPage() {
  return (
    <ResourceTable
      config={{
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
      }}
    />
  );
}
