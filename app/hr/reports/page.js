'use client';

import { useEffect, useState } from 'react';
import { printPDF, authHeaders } from '@/components/hr/exportUtils';

const baht = (v) => Number(v || 0).toLocaleString('th-TH') + ' ฿';

export default function ReportsPage() {
  const [employees, setEmployees] = useState([]);
  const [payroll, setPayroll] = useState([]);
  const [expenses, setExpenses] = useState([]);

  useEffect(() => {
    const headers = authHeaders();
    fetch('/api/hr/employees', { headers }).then((r) => r.json()).then((d) => setEmployees(d.employees || [])).catch(() => {});
    fetch('/api/hr/payroll', { headers }).then((r) => r.json()).then((d) => setPayroll(d.items || [])).catch(() => {});
    fetch('/api/hr/expenses', { headers }).then((r) => r.json()).then((d) => setExpenses(d.items || [])).catch(() => {});
  }, []);

  // จำนวนพนักงานต่อแผนก
  const byDept = {};
  for (const e of employees) {
    const key = e.department || '(ไม่ระบุแผนก)';
    byDept[key] = (byDept[key] || 0) + 1;
  }

  // รวมการใช้วันลา
  const leaveTotals = employees.reduce(
    (acc, e) => {
      acc.annualUsed += e.leaveAnnualUsed; acc.annualTotal += e.leaveAnnualTotal;
      acc.sickUsed += e.leaveSickUsed; acc.sickTotal += e.leaveSickTotal;
      acc.personalUsed += e.leavePersonalUsed; acc.personalTotal += e.leavePersonalTotal;
      return acc;
    },
    { annualUsed: 0, annualTotal: 0, sickUsed: 0, sickTotal: 0, personalUsed: 0, personalTotal: 0 }
  );

  // เงินเดือนรวมรายงวด
  const byPeriod = {};
  for (const p of payroll) {
    byPeriod[p.period] = (byPeriod[p.period] || 0) + (Number(p.net) || 0);
  }

  // เบิกค่าใช้จ่ายตามสถานะ
  const expenseByStatus = {};
  for (const ex of expenses) {
    expenseByStatus[ex.status] = (expenseByStatus[ex.status] || 0) + (Number(ex.amount) || 0);
  }
  const EXPENSE_LABELS = { pending: 'รออนุมัติ', approved: 'อนุมัติแล้ว', rejected: 'ปฏิเสธ', paid: 'จ่ายแล้ว' };

  return (
    <div>
      <div className="hr-toolbar">
        <button className="hr-btn" onClick={printPDF}>📑 พิมพ์รายงาน (PDF)</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
        <div className="hr-card">
          <h3 className="hr-section-title">🏢 จำนวนพนักงานต่อแผนก</h3>
          {Object.entries(byDept).map(([dept, count]) => (
            <div key={dept} className="hr-emp-row">
              <span className="k">{dept}</span>
              <span className="v">{count} คน</span>
            </div>
          ))}
          <div className="hr-emp-row" style={{ fontWeight: 700 }}>
            <span className="k">รวม</span><span className="v">{employees.length} คน</span>
          </div>
        </div>

        <div className="hr-card">
          <h3 className="hr-section-title">🏖️ การใช้วันลา (รวมทั้งบริษัท)</h3>
          <div className="hr-emp-row"><span className="k">ลาพักร้อน</span><span className="v">{leaveTotals.annualUsed} / {leaveTotals.annualTotal} วัน</span></div>
          <div className="hr-emp-row"><span className="k">ลาป่วย</span><span className="v">{leaveTotals.sickUsed} / {leaveTotals.sickTotal} วัน</span></div>
          <div className="hr-emp-row"><span className="k">ลากิจ</span><span className="v">{leaveTotals.personalUsed} / {leaveTotals.personalTotal} วัน</span></div>
        </div>

        <div className="hr-card">
          <h3 className="hr-section-title">💰 เงินเดือนรวมรายงวด</h3>
          {Object.keys(byPeriod).length === 0 && <div className="hr-empty">ยังไม่มีข้อมูลเงินเดือน</div>}
          {Object.entries(byPeriod).sort((a, b) => b[0].localeCompare(a[0])).map(([period, total]) => (
            <div key={period} className="hr-emp-row">
              <span className="k">งวด {period}</span>
              <span className="v">{baht(total)}</span>
            </div>
          ))}
        </div>

        <div className="hr-card">
          <h3 className="hr-section-title">🧾 เบิกค่าใช้จ่ายตามสถานะ</h3>
          {Object.keys(expenseByStatus).length === 0 && <div className="hr-empty">ยังไม่มีข้อมูลเบิกจ่าย</div>}
          {Object.entries(expenseByStatus).map(([st, total]) => (
            <div key={st} className="hr-emp-row">
              <span className="k">{EXPENSE_LABELS[st] || st}</span>
              <span className="v">{baht(total)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
