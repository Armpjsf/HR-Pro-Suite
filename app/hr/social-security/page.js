'use client';

import ResourceTable from '@/components/hr/ResourceTable';

export default function SocialSecurityPage() {
  return (
    <ResourceTable
      config={{
        resource: 'social-security',
        exportName: 'social_security',
        searchPlaceholder: 'ค้นหารหัสพนักงาน/เลข ปกส. ...',
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
          { key: 'sso_number', label: 'เลขประกันสังคม', type: 'text' },
          { key: 'hospital', label: 'โรงพยาบาลตามสิทธิ์', type: 'text' },
          { key: 'registered_date', label: 'วันที่ขึ้นทะเบียน', type: 'date' },
          { key: 'monthly_contribution', label: 'เงินสมทบต่อเดือน (บาท)', type: 'number' },
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
