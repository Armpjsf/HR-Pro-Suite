'use client';

import ResourceTable from '@/components/hr/ResourceTable';

export default function AssetsPage() {
  return (
    <ResourceTable
      config={{
        resource: 'assets',
        exportName: 'assets',
        searchPlaceholder: 'ค้นหารหัส/ชื่อทรัพย์สิน...',
        columns: [
          { key: 'code', label: 'รหัส' },
          { key: 'name', label: 'ทรัพย์สิน' },
          { key: 'category', label: 'หมวด' },
          { key: 'assigned_to', label: 'มอบให้' },
          { key: 'assigned_date', label: 'วันที่มอบ' },
          {
            key: 'status', label: 'สถานะ',
            badge: { available: 'green', assigned: 'blue', repair: 'yellow', retired: 'gray' },
            badgeLabels: { available: 'ว่าง', assigned: 'มอบแล้ว', repair: 'ซ่อม', retired: 'ปลดระวาง' },
          },
        ],
        fields: [
          { key: 'code', label: 'รหัสทรัพย์สิน', type: 'text', required: true },
          { key: 'name', label: 'ชื่อทรัพย์สิน', type: 'text', required: true },
          { key: 'category', label: 'หมวด (รถ/โทรศัพท์/อุปกรณ์ ฯลฯ)', type: 'text' },
          { key: 'assigned_to', label: 'มอบให้พนักงาน', type: 'employee' },
          { key: 'assigned_date', label: 'วันที่มอบ', type: 'date' },
          {
            key: 'status', label: 'สถานะ', type: 'select', default: 'available',
            options: [
              { value: 'available', label: 'ว่าง' },
              { value: 'assigned', label: 'มอบแล้ว' },
              { value: 'repair', label: 'ส่งซ่อม' },
              { value: 'retired', label: 'ปลดระวาง' },
            ],
          },
          { key: 'note', label: 'หมายเหตุ', type: 'textarea' },
        ],
      }}
    />
  );
}
