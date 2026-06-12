'use client';

import ResourceTable from '@/components/hr/ResourceTable';

export default function TrainingPage() {
  return (
    <ResourceTable
      config={{
        resource: 'training',
        exportName: 'trainings',
        searchPlaceholder: 'ค้นหาหลักสูตร...',
        columns: [
          { key: 'title', label: 'หลักสูตร' },
          { key: 'trainer', label: 'วิทยากร' },
          { key: 'train_date', label: 'วันที่อบรม' },
          { key: 'hours', label: 'ชั่วโมง' },
          { key: 'location', label: 'สถานที่' },
          {
            key: 'status', label: 'สถานะ',
            badge: { planned: 'blue', done: 'green', cancelled: 'gray' },
            badgeLabels: { planned: 'วางแผน', done: 'อบรมแล้ว', cancelled: 'ยกเลิก' },
          },
        ],
        fields: [
          { key: 'title', label: 'ชื่อหลักสูตร', type: 'text', required: true },
          { key: 'trainer', label: 'วิทยากร', type: 'text' },
          { key: 'train_date', label: 'วันที่อบรม', type: 'date' },
          { key: 'hours', label: 'จำนวนชั่วโมง', type: 'number' },
          { key: 'location', label: 'สถานที่', type: 'text' },
          { key: 'participants', label: 'ผู้เข้าอบรม', type: 'textarea' },
          {
            key: 'status', label: 'สถานะ', type: 'select', default: 'planned',
            options: [
              { value: 'planned', label: 'วางแผน' },
              { value: 'done', label: 'อบรมแล้ว' },
              { value: 'cancelled', label: 'ยกเลิก' },
            ],
          },
        ],
      }}
    />
  );
}
