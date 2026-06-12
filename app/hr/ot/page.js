'use client';

import ResourceTable from '@/components/hr/ResourceTable';

export default function OtPage() {
  return (
    <ResourceTable
      config={{
        resource: 'ot',
        exportName: 'ot_records',
        searchPlaceholder: 'ค้นหารหัสพนักงาน...',
        columns: [
          { key: 'employee_id', label: 'พนักงาน' },
          { key: 'ot_date', label: 'วันที่' },
          { key: 'hours', label: 'ชั่วโมง' },
          { key: 'rate', label: 'เรท' },
          { key: 'amount', label: 'จำนวนเงิน', format: (v) => Number(v || 0).toLocaleString('th-TH') + ' ฿' },
          {
            key: 'status', label: 'สถานะ',
            badge: { pending: 'yellow', approved: 'green', rejected: 'red', paid: 'purple' },
            badgeLabels: { pending: 'รออนุมัติ', approved: 'อนุมัติ', rejected: 'ปฏิเสธ', paid: 'จ่ายแล้ว' },
          },
          { key: 'note', label: 'หมายเหตุ' },
        ],
        fields: [
          { key: 'employee_id', label: 'พนักงาน', type: 'employee', required: true },
          { key: 'ot_date', label: 'วันที่', type: 'date', required: true },
          { key: 'hours', label: 'จำนวนชั่วโมง', type: 'number', required: true },
          { key: 'rate', label: 'เรท (เท่า)', type: 'number', default: 1.5 },
          { key: 'amount', label: 'จำนวนเงิน (บาท)', type: 'number' },
          {
            key: 'status', label: 'สถานะ', type: 'select', default: 'pending',
            options: [
              { value: 'pending', label: 'รออนุมัติ' },
              { value: 'approved', label: 'อนุมัติ' },
              { value: 'rejected', label: 'ปฏิเสธ' },
              { value: 'paid', label: 'จ่ายแล้ว' },
            ],
          },
          { key: 'note', label: 'หมายเหตุ', type: 'text' },
        ],
      }}
    />
  );
}
