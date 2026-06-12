'use client';

import ResourceTable from '@/components/hr/ResourceTable';
import { authHeaders } from '@/components/hr/exportUtils';

const baht = (v) => Number(v || 0).toLocaleString('th-TH') + ' ฿';

export default function PayrollPage() {
  async function notifyLine(row, reload, showToast) {
    if (!confirm(`ส่งสลิปงวด ${row.period} ของ ${row.employee_id} ทาง LINE?`)) return;
    const res = await fetch(`/api/hr/payroll/${row.id}/notify`, {
      method: 'POST',
      headers: authHeaders(true),
    });
    const data = await res.json();
    if (res.ok) { showToast('ส่งสลิปทาง LINE แล้ว'); reload(); }
    else showToast(data.error || 'ส่งไม่สำเร็จ', 'error');
  }

  return (
    <ResourceTable
      config={{
        resource: 'payroll',
        exportName: 'payroll_slips',
        searchPlaceholder: 'ค้นหารหัสพนักงาน/งวด...',
        columns: [
          { key: 'id', label: 'SLIP ID', format: (v) => `PR${String(v).padStart(4, '0')}` },
          { key: 'period', label: 'งวด' },
          { key: 'employee_id', label: 'พนักงาน' },
          { key: 'base_salary', label: 'ฐาน', format: baht },
          { key: 'ot_pay', label: 'OT', format: (v) => '+' + baht(v) },
          { key: 'bonus', label: 'โบนัส', format: (v) => '+' + baht(v) },
          { key: 'deduction', label: 'หัก', format: (v) => '-' + baht(v) },
          {
            key: 'net', label: 'สุทธิ',
            format: (v) => <strong>{baht(v)}</strong>,
          },
          {
            key: 'status', label: 'สถานะ',
            badge: { draft: 'gray', paid: 'green', notified: 'blue' },
            badgeLabels: { draft: 'ร่าง', paid: 'จ่ายแล้ว', notified: 'แจ้งสลิปแล้ว' },
          },
        ],
        fields: [
          { key: 'employee_id', label: 'พนักงาน', type: 'employee', required: true },
          { key: 'period', label: 'งวด (เช่น 2569-06)', type: 'text', required: true },
          { key: 'base_salary', label: 'เงินเดือนฐาน (บาท)', type: 'number', default: 0 },
          { key: 'ot_pay', label: 'ค่าล่วงเวลา OT (บาท)', type: 'number', default: 0 },
          { key: 'bonus', label: 'โบนัส (บาท)', type: 'number', default: 0 },
          { key: 'deduction', label: 'รายการหัก (บาท)', type: 'number', default: 0 },
          {
            key: 'status', label: 'สถานะ', type: 'select', default: 'draft',
            options: [
              { value: 'draft', label: 'ร่าง' },
              { value: 'paid', label: 'จ่ายแล้ว' },
            ],
          },
        ],
        // คำนวณ net อัตโนมัติก่อนบันทึก
        transformBeforeSave: (form) => ({
          ...form,
          net:
            (Number(form.base_salary) || 0) +
            (Number(form.ot_pay) || 0) +
            (Number(form.bonus) || 0) -
            (Number(form.deduction) || 0),
        }),
        renderActions: (row, reload, showToast) => (
          <button
            className="hr-btn hr-btn-icon"
            title="แจ้งสลิป LINE"
            onClick={() => notifyLine(row, reload, showToast)}
          >🔔</button>
        ),
      }}
    />
  );
}
