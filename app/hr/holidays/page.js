'use client';

import ResourceTable from '@/components/hr/ResourceTable';

export default function HolidaysPage() {
  return (
    <ResourceTable
      config={{
        resource: 'holidays',
        exportName: 'holidays',
        searchPlaceholder: 'ค้นหาชื่อวันหยุด...',
        columns: [
          { key: 'holiday_date', label: 'วันที่' },
          { key: 'name', label: 'ชื่อวันหยุด' },
          { key: 'branch_id', label: 'สาขา', branchLookup: true },
          { key: 'note', label: 'หมายเหตุ' },
        ],
        fields: [
          { key: 'holiday_date', label: 'วันที่', type: 'date', required: true },
          { key: 'name', label: 'ชื่อวันหยุด', type: 'text', required: true },
          { key: 'branch_id', label: 'สาขา (เว้นว่าง = ทุกสาขา)', type: 'branch' },
          { key: 'note', label: 'หมายเหตุ', type: 'text' },
        ],
      }}
    />
  );
}
