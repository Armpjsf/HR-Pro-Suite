'use client';

import ResourceTable from '@/components/hr/ResourceTable';

export default function BranchesPage() {
  return (
    <ResourceTable
      config={{
        resource: 'branches',
        exportName: 'branches',
        searchPlaceholder: 'ค้นหารหัส/ชื่อสาขา...',
        headerExtra: (
          <div className="hr-card" style={{ marginBottom: 14 }}>
            <div className="hr-section-title">🏬 ตั้งค่าสาขา</div>
            <div style={{ color: '#5b6478', fontSize: 13, lineHeight: 1.6 }}>
              ใช้สร้างสาขาที่ระบบอื่นอ้างอิง เช่น พนักงาน, รูปแบบกะ, วันหยุด, จุดปักหมุด GPS และเวลาทำงานเฉพาะสาขา
            </div>
          </div>
        ),
        columns: [
          { key: 'code', label: 'รหัส' },
          { key: 'name', label: 'ชื่อสาขา' },
          { key: 'province', label: 'จังหวัด' },
          { key: 'phone', label: 'โทร' },
          { key: 'work_days', label: 'วันทำงาน' },
          { key: 'standard_in', label: 'เข้างาน' },
          { key: 'standard_out', label: 'เลิกงาน' },
          { key: 'address', label: 'ที่อยู่' },
        ],
        fields: [
          { key: 'code', label: 'รหัสสาขา', type: 'text', required: true },
          { key: 'name', label: 'ชื่อสาขา', type: 'text', required: true },
          { key: 'province', label: 'จังหวัด', type: 'text' },
          { key: 'phone', label: 'เบอร์โทร', type: 'text' },
          { key: 'address', label: 'ที่อยู่', type: 'textarea' },
          { key: 'standard_in', label: 'เวลาเข้างานของสาขา (เว้นว่าง = ใช้ค่ากลาง)', type: 'time' },
          { key: 'standard_out', label: 'เวลาเลิกงานของสาขา (เว้นว่าง = ใช้ค่ากลาง)', type: 'time' },
          { key: 'late_grace_min', label: 'ผ่อนผันมาสายของสาขา/นาที (เว้นว่าง = ใช้ค่ากลาง)', type: 'number' },
          { key: 'work_days', label: 'วันทำงานของสาขา เช่น 1,2,3,4,5 (เว้นว่าง = ใช้ค่ากลาง)', type: 'text' },
          { key: 'calendar_note', label: 'หมายเหตุปฏิทิน/ลูกค้าที่สาขาดูแล', type: 'textarea' },
        ],
      }}
    />
  );
}
