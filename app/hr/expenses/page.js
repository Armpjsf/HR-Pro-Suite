'use client';

import ResourceTable from '@/components/hr/ResourceTable';

export default function ExpensesPage() {
  return (
    <ResourceTable
      config={{
        resource: 'expenses',
        exportName: 'expense_claims',
        searchPlaceholder: 'ค้นหารหัสพนักงาน/หมวด...',
        columns: [
          { key: 'employee_id', label: 'พนักงาน' },
          { key: 'claim_date', label: 'วันที่เบิก' },
          { key: 'category', label: 'หมวด' },
          { key: 'amount', label: 'จำนวนเงิน', format: (v) => Number(v || 0).toLocaleString('th-TH') + ' ฿' },
          { key: 'description', label: 'รายละเอียด' },
          {
            key: 'status', label: 'สถานะ',
            badge: { pending: 'yellow', approved: 'green', rejected: 'red', paid: 'purple' },
            badgeLabels: { pending: 'รออนุมัติ', approved: 'อนุมัติ', rejected: 'ปฏิเสธ', paid: 'จ่ายแล้ว' },
          },
          { key: 'approved_by', label: 'ผู้อนุมัติ' },
        ],
        fields: [
          { key: 'employee_id', label: 'พนักงาน', type: 'employee', required: true },
          { key: 'claim_date', label: 'วันที่เบิก', type: 'date' },
          { key: 'category', label: 'หมวด (เดินทาง/ที่พัก/น้ำมัน ฯลฯ)', type: 'text' },
          { key: 'amount', label: 'จำนวนเงิน (บาท)', type: 'number', required: true },
          { key: 'description', label: 'รายละเอียด', type: 'textarea' },
          {
            key: 'status', label: 'สถานะ', type: 'select', default: 'pending',
            options: [
              { value: 'pending', label: 'รออนุมัติ' },
              { value: 'approved', label: 'อนุมัติ' },
              { value: 'rejected', label: 'ปฏิเสธ' },
              { value: 'paid', label: 'จ่ายแล้ว' },
            ],
          },
          { key: 'approved_by', label: 'ผู้อนุมัติ', type: 'text' },
        ],
      }}
    />
  );
}
