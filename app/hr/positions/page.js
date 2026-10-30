'use client';

import ResourceTable from '@/components/hr/ResourceTable';

export default function PositionsPage() {
  return (
    <ResourceTable
      config={{
        resource: 'positions',
        exportName: 'positions',
        searchPlaceholder: 'ค้นหาตำแหน่ง...',
        columns: [
          { key: 'title', label: 'ตำแหน่ง' },
          { key: 'department_code', label: 'สังกัดแผนก' },
          {
            key: 'level', label: 'ระดับ',
            badge: { 'บริหาร': 'purple', 'หัวหน้างาน': 'blue', 'ปฏิบัติการ': 'green', 'สัญญาจ้าง/พาร์ทไทม์': 'gray' },
          },
          { key: 'description', label: 'รายละเอียด' },
        ],
        fields: [
          { key: 'title', label: 'ชื่อตำแหน่งงาน', type: 'text', required: true },
          { key: 'department_code', label: 'สังกัดแผนก', type: 'department', required: true },
          {
            key: 'level', label: 'ระดับตำแหน่ง', type: 'select', required: true,
            options: [
              { value: 'บริหาร', label: 'ระดับบริหาร (Management)' },
              { value: 'หัวหน้างาน', label: 'ระดับหัวหน้างาน (Supervisor/Lead)' },
              { value: 'ปฏิบัติการ', label: 'ระดับปฏิบัติการ (Officer/Staff/Driver)' },
              { value: 'สัญญาจ้าง/พาร์ทไทม์', label: 'ระดับสัญญาจ้าง/พาร์ทไทม์ (Contract/Part-time)' },
            ],
          },
          { key: 'description', label: 'รายละเอียดหน้าที่ความรับผิดชอบ', type: 'textarea' },
        ],
      }}
    />
  );
}
