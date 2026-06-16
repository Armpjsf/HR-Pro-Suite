'use client';

import ResourceTable from '@/components/hr/ResourceTable';

export default function LeaveTypesPage() {
  return (
    <ResourceTable
      config={{
        resource: 'leave-types',
        exportName: 'leave_types',
        searchPlaceholder: 'ค้นหาประเภทการลา...',
        columns: [
          { key: 'code', label: 'รหัส' },
          { key: 'name', label: 'ประเภทการลา' },
          { key: 'days_per_year', label: 'สิทธิ์/ปี (วัน)' },
          { key: 'paid', label: 'ได้รับค่าจ้าง', format: (v) => (v ? '✅' : '❌') },
          { key: 'deduct_balance', label: 'ตัดยอดอัตโนมัติ', format: (v) => (v ? '✅' : '—') },
          { key: 'note', label: 'หมายเหตุ' },
        ],
        fields: [
          { key: 'code', label: 'รหัส (เช่น annual, maternity)', type: 'text', required: true },
          { key: 'name', label: 'ชื่อประเภทการลา', type: 'text', required: true },
          { key: 'days_per_year', label: 'สิทธิ์ต่อปี (วัน, เว้นว่าง = ตามกฎหมาย)', type: 'number' },
          {
            key: 'paid', label: 'ได้รับค่าจ้าง', type: 'select', default: true,
            options: [{ value: true, label: 'ได้รับค่าจ้าง' }, { value: false, label: 'ไม่ได้รับค่าจ้าง' }],
          },
          {
            key: 'deduct_balance', label: 'ตัดยอดโควต้าอัตโนมัติ', type: 'select', default: false,
            options: [{ value: true, label: 'ตัดยอด (annual/sick/personal)' }, { value: false, label: 'ไม่ตัดยอด' }],
          },
          { key: 'note', label: 'หมายเหตุ', type: 'text' },
        ],
      }}
    />
  );
}
