'use client';

import ResourceTable from '@/components/hr/ResourceTable';

export default function BenefitsPage() {
  return (
    <ResourceTable
      config={{
        resource: 'benefits',
        exportName: 'benefits_loans',
        searchPlaceholder: 'ค้นหารหัสพนักงาน/ชื่อรายการ...',
        columns: [
          { key: 'employee_id', label: 'พนักงาน' },
          {
            key: 'type', label: 'ประเภท',
            badge: { benefit: 'green', loan: 'purple' },
            badgeLabels: { benefit: 'สวัสดิการ', loan: 'เงินกู้' },
          },
          { key: 'name', label: 'รายการ' },
          { key: 'amount', label: 'จำนวนเงิน', format: (v) => Number(v || 0).toLocaleString('th-TH') + ' ฿' },
          { key: 'start_date', label: 'เริ่ม' },
          { key: 'end_date', label: 'สิ้นสุด' },
          {
            key: 'status', label: 'สถานะ',
            badge: { active: 'green', closed: 'gray' },
            badgeLabels: { active: 'ใช้งาน', closed: 'ปิดแล้ว' },
          },
        ],
        fields: [
          { key: 'employee_id', label: 'พนักงาน', type: 'employee', required: true },
          {
            key: 'type', label: 'ประเภท', type: 'select', required: true,
            options: [
              { value: 'benefit', label: 'สวัสดิการ' },
              { value: 'loan', label: 'เงินกู้' },
            ],
          },
          { key: 'name', label: 'ชื่อรายการ', type: 'text', required: true },
          { key: 'amount', label: 'จำนวนเงิน (บาท)', type: 'number' },
          { key: 'start_date', label: 'วันที่เริ่ม', type: 'date' },
          { key: 'end_date', label: 'วันที่สิ้นสุด', type: 'date' },
          {
            key: 'status', label: 'สถานะ', type: 'select', default: 'active',
            options: [
              { value: 'active', label: 'ใช้งาน' },
              { value: 'closed', label: 'ปิดแล้ว' },
            ],
          },
          { key: 'note', label: 'หมายเหตุ', type: 'textarea' },
        ],
      }}
    />
  );
}
