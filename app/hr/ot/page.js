'use client';

import { useEffect, useState } from 'react';
import ResourceTable from '@/components/hr/ResourceTable';
import { authHeaders } from '@/components/hr/exportUtils';

export default function OtPage() {
  const [employees, setEmployees] = useState([]);

  useEffect(() => {
    fetch('/api/hr/employees', { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => setEmployees(d.employees || []))
      .catch(() => {});
  }, []);

  const salaryMap = new Map(employees.map((e) => [e.employeeId, { salary: Number(e.salary) || 0, type: e.employmentType }]));

  return (
    <ResourceTable
      config={{
        resource: 'ot',
        exportName: 'ot_records',
        searchPlaceholder: 'ค้นหารหัส/ชื่อพนักงาน/วันที่...',
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
          { key: 'amount', label: 'จำนวนเงิน (บาท) — เว้นว่างเพื่อคำนวณอัตโนมัติจากฐานเงินเดือน', type: 'number' },
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
        transformBeforeSave: (form) => {
          let amt = Number(form.amount) || 0;
          if (!amt && form.employee_id && form.hours) {
            const empInfo = salaryMap.get(form.employee_id);
            const rawSal = empInfo?.salary || 0;
            const dailyWage = empInfo?.type === 'daily' && rawSal <= 3000 ? rawSal : rawSal / 30;
            const hourlyRate = dailyWage / 8;
            amt = Math.round(hourlyRate * Number(form.hours || 0) * Number(form.rate || 1.5));
          }
          return { ...form, amount: amt };
        },
        renderActions: (row, reload, showToast) =>
          row.status === 'pending' ? (
            <div style={{ display: 'inline-flex', gap: 4, marginLeft: 4 }}>
              <button
                className="hr-btn hr-btn-icon hr-btn-success"
                title="อนุมัติ OT"
                onClick={async () => {
                  try {
                    const res = await fetch(`/api/hr/ot/${row.id}`, {
                      method: 'PUT',
                      headers: authHeaders(true),
                      body: JSON.stringify({ status: 'approved' }),
                    });
                    if (res.ok) {
                      showToast('อนุมัติ OT แล้ว');
                      reload();
                    } else {
                      showToast('ดำเนินการไม่สำเร็จ', 'error');
                    }
                  } catch {
                    showToast('เชื่อมต่อล้มเหลว', 'error');
                  }
                }}
              >
                ✓
              </button>
              <button
                className="hr-btn hr-btn-icon hr-btn-danger"
                title="ปฏิเสธ OT"
                onClick={async () => {
                  try {
                    const res = await fetch(`/api/hr/ot/${row.id}`, {
                      method: 'PUT',
                      headers: authHeaders(true),
                      body: JSON.stringify({ status: 'rejected' }),
                    });
                    if (res.ok) {
                      showToast('ปฏิเสธ OT แล้ว');
                      reload();
                    } else {
                      showToast('ดำเนินการไม่สำเร็จ', 'error');
                    }
                  } catch {
                    showToast('เชื่อมต่อล้มเหลว', 'error');
                  }
                }}
              >
                ✗
              </button>
            </div>
          ) : null,
      }}
    />
  );
}
