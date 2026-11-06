'use client';

import { useEffect, useState } from 'react';
import ResourceTable from '@/components/hr/ResourceTable';
import { authHeaders } from '@/components/hr/exportUtils';

const baht = (v) => Number(v || 0).toLocaleString('th-TH') + ' ฿';

export default function SocialSecurityPage() {
  const [payroll, setPayroll] = useState([]);

  useEffect(() => {
    fetch('/api/hr/payroll', { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => setPayroll(d.items || []))
      .catch(() => {});
  }, []);

  // สรุปยอดประกันสังคม สปส.1-10 รายงวดจากสลิปเงินเดือนจริง
  const ssoByPeriod = {};
  for (const p of payroll) {
    if (!ssoByPeriod[p.period]) {
      ssoByPeriod[p.period] = { empSso: 0, count: 0 };
    }
    const ssoAmt = Number(p.sso) || 0;
    if (ssoAmt > 0) {
      ssoByPeriod[p.period].empSso += ssoAmt;
      ssoByPeriod[p.period].count += 1;
    }
  }
  const periods = Object.entries(ssoByPeriod).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 4);

  return (
    <ResourceTable
      config={{
        resource: 'social-security',
        exportName: 'social_security',
        searchPlaceholder: 'ค้นหารหัส/ชื่อพนักงาน/เลข ปกส. ...',
        headerExtra: periods.length > 0 && (
          <div className="hr-card" style={{ marginBottom: 14, background: '#f8fafc', border: '1px solid #e2e8f0' }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#1e293b', marginBottom: 10 }}>
              🏥 สรุปยอดนำส่งเงินสมทบประกันสังคม (แบบ สปส.1-10) จากสลิปเงินเดือนอัตโนมัติ
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
              {periods.map(([period, info]) => (
                <div key={period} style={{ background: '#fff', border: '1px solid #cbd5e1', borderRadius: 8, padding: '10px 14px', fontSize: 13 }}>
                  <div style={{ fontWeight: 700, color: '#334155', marginBottom: 4 }}>ประจำงวด {period} ({info.count} คน)</div>
                  <div style={{ color: '#475569' }}>• ผู้ประกันตน (5%): <b>{baht(info.empSso)}</b></div>
                  <div style={{ color: '#475569' }}>• นายจ้างสมทบ (5%): <b>{baht(info.empSso)}</b></div>
                  <div style={{ color: '#047857', fontWeight: 700, marginTop: 4, borderTop: '1px dashed #e2e8f0', paddingTop: 4 }}>
                    รวมนำส่ง สปส. (10%): {baht(info.empSso * 2)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ),
        columns: [
          { key: 'employee_id', label: 'พนักงาน' },
          { key: 'sso_number', label: 'เลขประกันสังคม' },
          { key: 'hospital', label: 'โรงพยาบาล' },
          { key: 'registered_date', label: 'วันที่ขึ้นทะเบียน' },
          { key: 'monthly_contribution', label: 'เงินสมทบ/เดือน', format: (v) => Number(v || 0).toLocaleString('th-TH') + ' ฿' },
          {
            key: 'status', label: 'สถานะ',
            badge: { active: 'green', inactive: 'gray' },
            badgeLabels: { active: 'ใช้สิทธิ์', inactive: 'สิ้นสุด' },
          },
        ],
        fields: [
          { key: 'employee_id', label: 'พนักงาน', type: 'employee', required: true },
          { key: 'sso_number', label: 'เลขประกันสังคม (13 หลัก)', type: 'text' },
          { key: 'hospital', label: 'โรงพยาบาลตามสิทธิ์', type: 'text' },
          { key: 'registered_date', label: 'วันที่ขึ้นทะเบียน', type: 'date' },
          { key: 'monthly_contribution', label: 'เงินสมทบต่อเดือน (บาท)', type: 'number', default: 750 },
          {
            key: 'status', label: 'สถานะ', type: 'select', default: 'active',
            options: [
              { value: 'active', label: 'ใช้สิทธิ์' },
              { value: 'inactive', label: 'สิ้นสุด' },
            ],
          },
        ],
      }}
    />
  );
}
