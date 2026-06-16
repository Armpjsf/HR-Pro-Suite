'use client';

import ResourceTable from '@/components/hr/ResourceTable';

const SHIFT_LABELS = { morning: 'เช้า', afternoon: 'บ่าย', night: 'ดึก', off: 'หยุด' };

export default function ShiftPatternsPage() {
  return (
    <ResourceTable
      config={{
        resource: 'shift-patterns',
        exportName: 'shift_patterns',
        searchPlaceholder: 'ค้นหารูปแบบกะ...',
        columns: [
          { key: 'name', label: 'ชื่อรูปแบบ' },
          {
            key: 'shift_type', label: 'ประเภท',
            badge: { morning: 'blue', afternoon: 'yellow', night: 'purple', off: 'gray' },
            badgeLabels: SHIFT_LABELS,
          },
          { key: 'start_time', label: 'เริ่ม' },
          { key: 'end_time', label: 'ถึง' },
        ],
        fields: [
          { key: 'name', label: 'ชื่อรูปแบบกะ (เช่น กะเช้า)', type: 'text', required: true },
          {
            key: 'shift_type', label: 'ประเภท', type: 'select', required: true,
            options: Object.entries(SHIFT_LABELS).map(([value, label]) => ({ value, label })),
          },
          { key: 'start_time', label: 'เวลาเริ่ม', type: 'time' },
          { key: 'end_time', label: 'เวลาสิ้นสุด', type: 'time' },
        ],
      }}
    />
  );
}
