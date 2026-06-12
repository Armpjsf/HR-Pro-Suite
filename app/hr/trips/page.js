'use client';

import ResourceTable from '@/components/hr/ResourceTable';

export default function TripsPage() {
  return (
    <ResourceTable
      config={{
        resource: 'trips',
        exportName: 'company_trips',
        searchPlaceholder: 'ค้นหาทริป/จุดหมาย...',
        columns: [
          { key: 'title', label: 'ชื่อทริป' },
          { key: 'destination', label: 'จุดหมาย' },
          { key: 'start_date', label: 'เริ่ม' },
          { key: 'end_date', label: 'สิ้นสุด' },
          { key: 'budget', label: 'งบประมาณ', format: (v) => Number(v || 0).toLocaleString('th-TH') + ' ฿' },
          {
            key: 'status', label: 'สถานะ',
            badge: { planned: 'blue', done: 'green', cancelled: 'gray' },
            badgeLabels: { planned: 'วางแผน', done: 'จัดแล้ว', cancelled: 'ยกเลิก' },
          },
        ],
        fields: [
          { key: 'title', label: 'ชื่อทริป', type: 'text', required: true },
          { key: 'destination', label: 'จุดหมาย', type: 'text' },
          { key: 'start_date', label: 'วันที่เริ่ม', type: 'date' },
          { key: 'end_date', label: 'วันที่สิ้นสุด', type: 'date' },
          { key: 'budget', label: 'งบประมาณ (บาท)', type: 'number' },
          { key: 'participants', label: 'ผู้เข้าร่วม', type: 'textarea' },
          {
            key: 'status', label: 'สถานะ', type: 'select', default: 'planned',
            options: [
              { value: 'planned', label: 'วางแผน' },
              { value: 'done', label: 'จัดแล้ว' },
              { value: 'cancelled', label: 'ยกเลิก' },
            ],
          },
        ],
      }}
    />
  );
}
