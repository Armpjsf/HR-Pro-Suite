'use client';

import ResourceTable from '@/components/hr/ResourceTable';

const STATUS = [
  { value: 'applied', label: 'สมัครแล้ว' },
  { value: 'screening', label: 'คัดกรอง' },
  { value: 'interview', label: 'สัมภาษณ์' },
  { value: 'offer', label: 'ยื่นข้อเสนอ' },
  { value: 'hired', label: 'รับเข้าทำงาน' },
  { value: 'rejected', label: 'ไม่ผ่าน' },
];

export default function ApplicantsPage() {
  return (
    <ResourceTable
      config={{
        resource: 'applicants',
        exportName: 'applicants',
        searchPlaceholder: 'ค้นหาชื่อ/ตำแหน่ง...',
        columns: [
          { key: 'name', label: 'ชื่อผู้สมัคร' },
          { key: 'position_applied', label: 'ตำแหน่งที่สมัคร' },
          { key: 'phone', label: 'โทร' },
          { key: 'email', label: 'อีเมล' },
          { key: 'applied_date', label: 'วันที่สมัคร' },
          {
            key: 'status', label: 'สถานะ',
            badge: { applied: 'blue', screening: 'yellow', interview: 'purple', offer: 'yellow', hired: 'green', rejected: 'red' },
            badgeLabels: Object.fromEntries(STATUS.map((s) => [s.value, s.label])),
          },
        ],
        fields: [
          { key: 'name', label: 'ชื่อผู้สมัคร', type: 'text', required: true },
          { key: 'position_applied', label: 'ตำแหน่งที่สมัคร', type: 'text' },
          { key: 'phone', label: 'เบอร์โทร', type: 'text' },
          { key: 'email', label: 'อีเมล', type: 'text' },
          { key: 'applied_date', label: 'วันที่สมัคร', type: 'date' },
          { key: 'status', label: 'สถานะ', type: 'select', default: 'applied', options: STATUS },
          { key: 'note', label: 'หมายเหตุ', type: 'textarea' },
        ],
      }}
    />
  );
}
