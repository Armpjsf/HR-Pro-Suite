'use client';

import ResourceTable from '@/components/hr/ResourceTable';

export default function DepartmentsPage() {
  return (
    <ResourceTable
      config={{
        resource: 'departments',
        exportName: 'departments',
        searchPlaceholder: 'ค้นหารหัส/ชื่อแผนก...',
        columns: [
          { key: 'code', label: 'รหัส' },
          { key: 'name', label: 'ชื่อแผนก' },
          { key: 'description', label: 'รายละเอียด' },
        ],
        fields: [
          { key: 'code', label: 'รหัสแผนก', type: 'text', required: true },
          { key: 'name', label: 'ชื่อแผนก', type: 'text', required: true },
          { key: 'description', label: 'รายละเอียด', type: 'textarea' },
        ],
      }}
    />
  );
}
