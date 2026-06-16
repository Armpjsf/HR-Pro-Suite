'use client';

import ResourceTable from '@/components/hr/ResourceTable';

export default function BranchesPage() {
  return (
    <ResourceTable
      config={{
        resource: 'branches',
        exportName: 'branches',
        searchPlaceholder: 'ค้นหารหัส/ชื่อสาขา...',
        columns: [
          { key: 'code', label: 'รหัส' },
          { key: 'name', label: 'ชื่อสาขา' },
          { key: 'province', label: 'จังหวัด' },
          { key: 'phone', label: 'โทร' },
          { key: 'address', label: 'ที่อยู่' },
        ],
        fields: [
          { key: 'code', label: 'รหัสสาขา', type: 'text', required: true },
          { key: 'name', label: 'ชื่อสาขา', type: 'text', required: true },
          { key: 'province', label: 'จังหวัด', type: 'text' },
          { key: 'phone', label: 'เบอร์โทร', type: 'text' },
          { key: 'address', label: 'ที่อยู่', type: 'textarea' },
        ],
      }}
    />
  );
}
