'use client';

import ResourceTable from '@/components/hr/ResourceTable';

const EXPENSE_CATEGORIES = [
  { value: 'travel', label: '🚗 ค่าเดินทาง / ค่าทางด่วน' },
  { value: 'fuel', label: '⛽ ค่าน้ำมันเชื้อเพลิง' },
  { value: 'meal', label: '🍱 ค่าอาหารปฏิบัติงานล่วงเวลา' },
  { value: 'allowance', label: '💵 เบี้ยเลี้ยงปฏิบัติงานนอกสถานที่' },
  { value: 'accommodation', label: '🏨 ค่าที่พัก' },
  { value: 'maintenance', label: '🔧 ค่าซ่อมบำรุงยานพาหนะฉุกเฉิน' },
  { value: 'other', label: '📦 อื่นๆ' },
];

const CAT_MAP = Object.fromEntries(EXPENSE_CATEGORIES.map((c) => [c.value, c.label]));

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
          { key: 'category', label: 'หมวดค่าใช้จ่าย', format: (v) => CAT_MAP[v] || v || '-' },
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
          { key: 'employee_id', label: 'พนักงานผู้ขอเบิก', type: 'employee', required: true },
          { key: 'claim_date', label: 'วันที่เกิดค่าใช้จ่าย', type: 'date', required: true },
          {
            key: 'category', label: 'หมวดหมู่ค่าใช้จ่าย', type: 'select', required: true,
            options: EXPENSE_CATEGORIES,
          },
          { key: 'amount', label: 'จำนวนเงิน (บาท)', type: 'number', required: true },
          { key: 'description', label: 'รายละเอียดและเหตุผลการเบิก', type: 'textarea' },
          {
            key: 'status', label: 'สถานะการพิจารณา', type: 'select', default: 'pending',
            options: [
              { value: 'pending', label: 'รออนุมัติ' },
              { value: 'approved', label: 'อนุมัติ' },
              { value: 'rejected', label: 'ปฏิเสธ' },
              { value: 'paid', label: 'จ่ายเงินเรียบร้อยแล้ว' },
            ],
          },
          { key: 'approved_by', label: 'ผู้อนุมัติ (HR/หัวหน้า)', type: 'employee' },
        ],
      }}
    />
  );
}
