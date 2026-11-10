'use client';

import { useEffect, useState } from 'react';
import { printPDF, authHeaders } from '@/components/hr/exportUtils';

const baht = (v) => Number(v || 0).toLocaleString('th-TH') + ' ฿';

export default function ReportsPage() {
  const [employees, setEmployees] = useState([]);
  const [leaveTypes, setLeaveTypes] = useState([]);
  const [payroll, setPayroll] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [activeBranch, setActiveBranch] = useState(
    typeof window !== 'undefined' ? localStorage.getItem('hr-active-branch') || 'all' : 'all'
  );

  useEffect(() => {
    const handleBranch = (e) => setActiveBranch(e.detail || 'all');
    window.addEventListener('hr-branch-change', handleBranch);
    return () => window.removeEventListener('hr-branch-change', handleBranch);
  }, []);

  useEffect(() => {
    const headers = authHeaders();
    fetch('/api/hr/employees', { headers }).then((r) => r.json()).then((d) => {
      setEmployees(d.employees || []);
      setLeaveTypes(d.leaveTypes || []);
    }).catch(() => {});
    fetch('/api/hr/payroll', { headers }).then((r) => r.json()).then((d) => setPayroll(d.items || [])).catch(() => {});
    fetch('/api/hr/expenses', { headers }).then((r) => r.json()).then((d) => setExpenses(d.items || [])).catch(() => {});
  }, []);

  // กรองตามสาขาที่เลือก
  const filteredEmployees = activeBranch !== 'all'
    ? employees.filter((e) => String(e.branchId || '') === String(activeBranch))
    : employees;
  const branchEmpSet = new Set(filteredEmployees.map((e) => e.employeeId));
  const inBranch = (empId) => activeBranch === 'all' || branchEmpSet.has(empId);

  const filteredPayroll = payroll.filter((p) => inBranch(p.employee_id));
  const filteredExpenses = expenses.filter((ex) => inBranch(ex.employee_id));

  // 1. จำนวนพนักงานต่อแผนก
  const byDept = {};
  for (const e of filteredEmployees) {
    const key = e.department || '(ไม่ระบุแผนก)';
    byDept[key] = (byDept[key] || 0) + 1;
  }

  // 2. รวมการใช้วันลาจากตาราง employee_leave_balances จริง
  const leaveTypeNameMap = new Map(leaveTypes.map((lt) => [lt.code, lt.name]));
  const leaveByCode = {};
  for (const e of filteredEmployees) {
    for (const row of e.leaveBalances || []) {
      const code = row.leave_type;
      if (!leaveByCode[code]) {
        leaveByCode[code] = {
          label: leaveTypeNameMap.get(code) || (code === 'annual' ? 'ลาพักร้อน' : code === 'sick' ? 'ลาป่วย' : code === 'personal' ? 'ลากิจ' : code),
          used: 0,
          total: 0,
        };
      }
      leaveByCode[code].used += Number(row.used_days) || 0;
      leaveByCode[code].total += Number(row.total_days) || 0;
    }
  }

  // 3. สรุปเงินเดือนสุทธิ, ภ.ง.ด.1 (ภาษี), และ สปส.1-10 (ประกันสังคม) รายงวด (เฉพาะงวดที่จ่ายแล้ว status === 'paid')
  const byPeriod = {};
  for (const p of filteredPayroll) {
    if (p.status !== 'paid') continue;
    if (!byPeriod[p.period]) {
      byPeriod[p.period] = { net: 0, tax: 0, ssoEmp: 0, count: 0 };
    }
    byPeriod[p.period].net += Number(p.net) || 0;
    byPeriod[p.period].tax += Number(p.tax) || 0;
    byPeriod[p.period].ssoEmp += Number(p.sso) || 0;
    byPeriod[p.period].count += 1;
  }

  // 4. เบิกค่าใช้จ่ายตามสถานะ
  const expenseByStatus = {};
  for (const ex of filteredExpenses) {
    expenseByStatus[ex.status] = (expenseByStatus[ex.status] || 0) + (Number(ex.amount) || 0);
  }
  const EXPENSE_LABELS = { pending: 'รออนุมัติ', approved: 'อนุมัติแล้ว', rejected: 'ปฏิเสธ', paid: 'จ่ายแล้ว' };
  const branchSuffix = activeBranch !== 'all' ? ' (เฉพาะสาขาที่เลือก)' : '';

  return (
    <div>
      <div className="hr-toolbar">
        <button className="hr-btn" onClick={printPDF}>📑 พิมพ์รายงาน (PDF)</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
        <div className="hr-card">
          <h3 className="hr-section-title">🏢 จำนวนพนักงานต่อแผนก{branchSuffix}</h3>
          {Object.entries(byDept).map(([dept, count]) => (
            <div key={dept} className="hr-emp-row">
              <span className="k">{dept}</span>
              <span className="v">{count} คน</span>
            </div>
          ))}
          <div className="hr-emp-row" style={{ fontWeight: 700 }}>
            <span className="k">รวมทั้งหมด</span><span className="v">{filteredEmployees.length} คน</span>
          </div>
        </div>

        <div className="hr-card">
          <h3 className="hr-section-title">🏖️ การใช้วันลาสะสม{branchSuffix}</h3>
          {Object.keys(leaveByCode).length === 0 && <div className="hr-empty">ยังไม่มีข้อมูลโควตาวันลา</div>}
          {Object.entries(leaveByCode).map(([code, info]) => (
            <div key={code} className="hr-emp-row">
              <span className="k">{info.label}</span>
              <span className="v">ใช้ไป {info.used} / โควตารวม {info.total} วัน</span>
            </div>
          ))}
        </div>

        <div className="hr-card">
          <h3 className="hr-section-title">💰 เงินเดือนสุทธิรวมรายงวด{branchSuffix}</h3>
          {Object.keys(byPeriod).length === 0 && <div className="hr-empty">ยังไม่มีข้อมูลเงินเดือน</div>}
          {Object.entries(byPeriod).sort((a, b) => b[0].localeCompare(a[0])).map(([period, d]) => (
            <div key={period} className="hr-emp-row">
              <span className="k">งวด {period} ({d.count} คน)</span>
              <span className="v" style={{ fontWeight: 700, color: '#16a34a' }}>{baht(d.net)}</span>
            </div>
          ))}
        </div>

        <div className="hr-card">
          <h3 className="hr-section-title">🏛️ สรุปภาษี ภ.ง.ด.1 & ประกันสังคม สปส.1-10{branchSuffix}</h3>
          {Object.keys(byPeriod).length === 0 && <div className="hr-empty">ยังไม่มีข้อมูลนำส่ง</div>}
          {Object.entries(byPeriod).sort((a, b) => b[0].localeCompare(a[0])).map(([period, d]) => (
            <div key={period} style={{ borderBottom: '1px solid #f1f5f9', padding: '8px 0', fontSize: 13 }}>
              <div style={{ fontWeight: 700, color: '#1e293b', marginBottom: 4 }}>ประจำงวด {period}</div>
              <div className="hr-emp-row">
                <span className="k">• ภาษีหัก ณ ที่จ่าย (ภ.ง.ด.1)</span>
                <span className="v">{baht(d.tax)}</span>
              </div>
              <div className="hr-emp-row">
                <span className="k">• ปกส. พนักงาน 5% + นายจ้าง 5% (สปส.1-10)</span>
                <span className="v">{baht(d.ssoEmp * 2)} <small style={{ color: '#64748b' }}>({baht(d.ssoEmp)} x 2)</small></span>
              </div>
            </div>
          ))}
        </div>

        <div className="hr-card">
          <h3 className="hr-section-title">🧾 เบิกค่าใช้จ่ายตามสถานะ{branchSuffix}</h3>
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
