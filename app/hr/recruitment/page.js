'use client';

import ResourceTable from '@/components/hr/ResourceTable';

export default function RecruitmentPage() {
  return (
    <ResourceTable
      config={{
        resource: 'recruitment',
        exportName: 'job_openings',
        searchPlaceholder: 'ค้นหาตำแหน่งที่เปิดรับ...',
        columns: [
          { key: 'title', label: 'ตำแหน่งที่เปิดรับ' },
          { key: 'department_code', label: 'แผนก' },
          { key: 'headcount', label: 'อัตรา' },
          { key: 'posted_date', label: 'วันที่ประกาศ' },
          {
            key: 'status', label: 'สถานะ',
            badge: { open: 'green', closed: 'gray' },
            badgeLabels: { open: 'เปิดรับ', closed: 'ปิดรับ' },
          },
        ],
        fields: [
          { key: 'title', label: 'ตำแหน่งที่เปิดรับ', type: 'text', required: true },
          { key: 'department_code', label: 'รหัสแผนก', type: 'text' },
          { key: 'headcount', label: 'จำนวนอัตรา', type: 'number', default: 1 },
          { key: 'posted_date', label: 'วันที่ประกาศ', type: 'date' },
          {
            key: 'status', label: 'สถานะ', type: 'select', default: 'open',
            options: [
              { value: 'open', label: 'เปิดรับ' },
              { value: 'closed', label: 'ปิดรับ' },
            ],
          },
          { key: 'description', label: 'รายละเอียดงาน', type: 'textarea' },
        ],
      }}
    />
  );
}
