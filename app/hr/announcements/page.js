'use client';

import ResourceTable from '@/components/hr/ResourceTable';

export default function AnnouncementsPage() {
  return (
    <ResourceTable
      config={{
        resource: 'announcements',
        exportName: 'announcements',
        searchPlaceholder: 'ค้นหาประกาศ...',
        columns: [
          {
            key: 'pinned', label: '',
            format: (v) => (v ? '📌' : ''),
          },
          { key: 'title', label: 'หัวข้อ' },
          { key: 'category', label: 'หมวด' },
          { key: 'publish_date', label: 'วันที่ประกาศ' },
          { key: 'author', label: 'ผู้ประกาศ' },
        ],
        fields: [
          { key: 'title', label: 'หัวข้อประกาศ', type: 'text', required: true },
          { key: 'body', label: 'เนื้อหา', type: 'textarea' },
          { key: 'category', label: 'หมวด', type: 'text' },
          { key: 'publish_date', label: 'วันที่ประกาศ', type: 'date' },
          { key: 'author', label: 'ผู้ประกาศ', type: 'text' },
          { key: 'pinned', label: 'ปักหมุด', type: 'checkbox' },
        ],
      }}
    />
  );
}
