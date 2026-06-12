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
          { key: 'department_code', label: 'แผนก' },
          { key: 'level', label: 'ระดับ' },
          { key: 'description', label: 'รายละเอียด' },
        ],
        fields: [
          { key: 'title', label: 'ชื่อตำแหน่ง', type: 'text', required: true },
          { key: 'department_code', label: 'รหัสแผนก', type: 'text' },
          { key: 'level', label: 'ระดับ', type: 'text' },
          { key: 'description', label: 'รายละเอียด', type: 'textarea' },
        ],
      }}
    />
  );
}
