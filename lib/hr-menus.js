// นิยามเมนู HR กลาง — ใช้ร่วมกันทั้ง sidebar, หน้าตั้งค่าสิทธิ์ และการกั้น API
// key = รหัสสิทธิ์ของเมนูนั้น (ใช้ผูกกับ role_permissions)

export const HR_MENUS = [
  { key: 'dashboard', href: '/hr', icon: '📊', label: 'Dashboard', group: 'ภาพรวม' },
  { key: 'chat', href: '/hr/chat', icon: '💬', label: 'แชท AI', group: 'ภาพรวม' },
  { key: 'reports', href: '/hr/reports', icon: '📑', label: 'รายงาน', group: 'ภาพรวม' },
  { key: 'employees', href: '/hr/employees', icon: '👥', label: 'พนักงาน', group: 'โครงสร้างองค์กร' },
  { key: 'org', href: '/hr/org', icon: '🗂️', label: 'ผังองค์กร', group: 'โครงสร้างองค์กร' },
  { key: 'branches', href: '/hr/branches', icon: '🏬', label: 'ตั้งค่าสาขา', group: 'โครงสร้างองค์กร' },
  { key: 'departments', href: '/hr/departments', icon: '🏢', label: 'แผนก', group: 'โครงสร้างองค์กร' },
  { key: 'positions', href: '/hr/positions', icon: '💼', label: 'ตำแหน่งงาน', group: 'โครงสร้างองค์กร' },
  { key: 'time', href: '/hr/time', icon: '🕐', label: 'บันทึกเวลา', group: 'เวลาและการลา' },
  { key: 'shifts', href: '/hr/shifts', icon: '📅', label: 'จัดกะ', group: 'เวลาและการลา' },
  { key: 'shift-patterns', href: '/hr/shift-patterns', icon: '🔄', label: 'ตั้งค่ารูปแบบกะ', group: 'เวลาและการลา' },
  { key: 'settings', href: '/hr/settings', icon: '⚙️', label: 'ตั้งค่าเวลาทำงาน', group: 'เวลาและการลา' },
  { key: 'locations', href: '/hr/locations', icon: '📍', label: 'จุดปักหมุด GPS', group: 'เวลาและการลา' },
  { key: 'holidays', href: '/hr/holidays', icon: '🎌', label: 'วันหยุด', group: 'เวลาและการลา' },
  { key: 'leave', href: '/hr/leave', icon: '🏖️', label: 'การลา', group: 'เวลาและการลา' },
  { key: 'leave-types', href: '/hr/leave-types', icon: '🗒️', label: 'ตั้งค่าประเภทการลา', group: 'เวลาและการลา' },
  { key: 'payroll', href: '/hr/payroll', icon: '💰', label: 'เงินเดือน', group: 'เงินและสวัสดิการ' },
  { key: 'ot', href: '/hr/ot', icon: '⏱️', label: 'ค่าล่วงเวลา (OT)', group: 'เงินและสวัสดิการ' },
  { key: 'expenses', href: '/hr/expenses', icon: '🧾', label: 'เบิกค่าใช้จ่าย', group: 'เงินและสวัสดิการ' },
  { key: 'benefits', href: '/hr/benefits', icon: '🎁', label: 'สวัสดิการ/กู้', group: 'เงินและสวัสดิการ' },
  { key: 'social-security', href: '/hr/social-security', icon: '🏥', label: 'สิทธิ์ประกันสังคม', group: 'เงินและสวัสดิการ' },
  { key: 'documents', href: '/hr/documents', icon: '📄', label: 'เอกสาร HR', group: 'เอกสารและประกาศ' },
  { key: 'document-requests', href: '/hr/document-requests', icon: '📄', label: 'คำขอเอกสาร', group: 'เอกสารและประกาศ' },
  { key: 'document-assets', href: '/hr/document-assets', icon: '🖋️', label: 'ลายเซ็น/ตราบริษัท', group: 'เอกสารและประกาศ' },
  { key: 'announcements', href: '/hr/announcements', icon: '📢', label: 'ประกาศ', group: 'เอกสารและประกาศ' },
  { key: 'assets', href: '/hr/assets', icon: '📦', label: 'ทรัพย์สิน', group: 'งานสนับสนุน' },
  { key: 'rooms', href: '/hr/rooms', icon: '🎦', label: 'ห้องประชุม', group: 'งานสนับสนุน' },
  { key: 'trips', href: '/hr/trips', icon: '✈️', label: 'ทริปบริษัท', group: 'งานสนับสนุน' },
  { key: 'recruitment', href: '/hr/recruitment', icon: '📣', label: 'สรรหา', group: 'พัฒนาองค์กร' },
  { key: 'applicants', href: '/hr/applicants', icon: '🧑‍💼', label: 'ผู้สมัคร', group: 'พัฒนาองค์กร' },
  { key: 'onboarding', href: '/hr/onboarding', icon: '🚀', label: 'ปฐมนิเทศ', group: 'พัฒนาองค์กร' },
  { key: 'training', href: '/hr/training', icon: '🎓', label: 'อบรม', group: 'พัฒนาองค์กร' },
  { key: 'evaluation', href: '/hr/evaluation', icon: '🎯', label: 'ประเมินผล', group: 'พัฒนาองค์กร' },
  { key: 'okr', href: '/hr/okr', icon: '📈', label: 'OKR', group: 'พัฒนาองค์กร' },
  { key: 'import', href: '/hr/import', icon: '📥', label: 'นำเข้าข้อมูล (Excel)', group: 'ผู้ดูแลระบบ' },
  { key: 'users', href: '/hr/users', icon: '🛡️', label: 'ตั้งค่าผู้ใช้งาน', group: 'ผู้ดูแลระบบ', adminOnly: true },
  // เมนูนี้เห็นเฉพาะ admin เสมอ (จัดการสิทธิ์)
  { key: 'permissions', href: '/hr/permissions', icon: '🔐', label: 'ตั้งค่าสิทธิ์ใช้งาน', group: 'ผู้ดูแลระบบ', adminOnly: true },
];

export const ALL_MENU_KEYS = HR_MENUS.map((m) => m.key);

// ผูก resource (ของ /api/hr/[resource]) กับ key เมนู (กรณีชื่อไม่ตรง)
export const RESOURCE_TO_MENU = {
  bookings: 'rooms',
};
