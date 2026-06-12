'use client';

import ResourceTable from '@/components/hr/ResourceTable';

export default function TimePage() {
  return (
    <ResourceTable
      config={{
        resource: 'time',
        exportName: 'time_records',
        searchPlaceholder: 'ค้นหารหัสพนักงาน...',
        columns: [
          { key: 'employee_id', label: 'พนักงาน' },
          { key: 'work_date', label: 'วันที่' },
          { key: 'clock_in', label: 'เข้า' },
          { key: 'clock_out', label: 'ออก' },
          {
            key: 'status', label: 'สถานะ',
            badge: { normal: 'green', late: 'yellow', absent: 'red', leave: 'blue' },
            badgeLabels: { normal: 'ปกติ', late: 'สาย', absent: 'ขาด', leave: 'ลา' },
          },
          { key: 'note', label: 'หมายเหตุ' },
        ],
        fields: [
          { key: 'employee_id', label: 'พนักงาน', type: 'employee', required: true },
          { key: 'work_date', label: 'วันที่', type: 'date', required: true },
          { key: 'clock_in', label: 'เวลาเข้า', type: 'time' },
          { key: 'clock_out', label: 'เวลาออก', type: 'time' },
          {
            key: 'status', label: 'สถานะ', type: 'select', default: 'normal',
            options: [
              { value: 'normal', label: 'ปกติ' },
              { value: 'late', label: 'สาย' },
              { value: 'absent', label: 'ขาด' },
              { value: 'leave', label: 'ลา' },
            ],
          },
          { key: 'note', label: 'หมายเหตุ', type: 'text' },
        ],
      }}
    />
  );
}
