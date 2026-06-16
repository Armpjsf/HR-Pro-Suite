// นิยามเมนู HR กลาง — ใช้ร่วมกันทั้ง sidebar, หน้าตั้งค่าสิทธิ์ และการกั้น API
// key = รหัสสิทธิ์ของเมนูนั้น (ใช้ผูกกับ role_permissions)

export const HR_MENUS = [
  { key: 'dashboard', href: '/hr', icon: '📊', label: 'Dashboard' },
  { key: 'chat', href: '/hr/chat', icon: '💬', label: 'แชท AI' },
  { key: 'employees', href: '/hr/employees', icon: '👥', label: 'พนักงาน' },
  { key: 'org', href: '/hr/org', icon: '🗂️', label: 'ผังองค์กร' },
  { key: 'branches', href: '/hr/branches', icon: '🏬', label: 'ตั้งค่าสาขา' },
  { key: 'departments', href: '/hr/departments', icon: '🏢', label: 'แผนก' },
  { key: 'positions', href: '/hr/positions', icon: '💼', label: 'ตำแหน่งงาน' },
  { key: 'time', href: '/hr/time', icon: '🕐', label: 'บันทึกเวลา' },
  { key: 'leave', href: '/hr/leave', icon: '🏖️', label: 'การลา' },
  { key: 'payroll', href: '/hr/payroll', icon: '💰', label: 'เงินเดือน' },
  { key: 'ot', href: '/hr/ot', icon: '⏱️', label: 'ค่าล่วงเวลา (OT)' },
  { key: 'shifts', href: '/hr/shifts', icon: '📅', label: 'จัดกะ' },
  { key: 'holidays', href: '/hr/holidays', icon: '🎌', label: 'วันหยุด' },
  { key: 'recruitment', href: '/hr/recruitment', icon: '📣', label: 'สรรหา' },
  { key: 'applicants', href: '/hr/applicants', icon: '🧑‍💼', label: 'ผู้สมัคร' },
  { key: 'onboarding', href: '/hr/onboarding', icon: '🚀', label: 'ปฐมนิเทศ' },
  { key: 'training', href: '/hr/training', icon: '🎓', label: 'อบรม' },
  { key: 'evaluation', href: '/hr/evaluation', icon: '🎯', label: 'ประเมินผล' },
  { key: 'okr', href: '/hr/okr', icon: '📈', label: 'OKR' },
  { key: 'documents', href: '/hr/documents', icon: '📄', label: 'เอกสาร HR' },
  { key: 'assets', href: '/hr/assets', icon: '📦', label: 'ทรัพย์สิน' },
  { key: 'expenses', href: '/hr/expenses', icon: '🧾', label: 'เบิกค่าใช้จ่าย' },
  { key: 'benefits', href: '/hr/benefits', icon: '🎁', label: 'สวัสดิการ/กู้' },
  { key: 'social-security', href: '/hr/social-security', icon: '🏥', label: 'สิทธิ์ประกันสังคม' },
  { key: 'rooms', href: '/hr/rooms', icon: '🎦', label: 'ห้องประชุม' },
  { key: 'trips', href: '/hr/trips', icon: '✈️', label: 'ทริปบริษัท' },
  { key: 'announcements', href: '/hr/announcements', icon: '📢', label: 'ประกาศ' },
  { key: 'locations', href: '/hr/locations', icon: '📍', label: 'จุดปักหมุด GPS' },
  { key: 'reports', href: '/hr/reports', icon: '📑', label: 'รายงาน' },
  { key: 'leave-types', href: '/hr/leave-types', icon: '🗒️', label: 'ตั้งค่าประเภทการลา' },
  { key: 'shift-patterns', href: '/hr/shift-patterns', icon: '🔄', label: 'ตั้งค่ารูปแบบกะ' },
  { key: 'settings', href: '/hr/settings', icon: '⚙️', label: 'ตั้งค่าเวลาทำงาน' },
  { key: 'users', href: '/hr/users', icon: '🛡️', label: 'ตั้งค่าผู้ใช้งาน', adminOnly: true },
  // เมนูนี้เห็นเฉพาะ admin เสมอ (จัดการสิทธิ์)
  { key: 'permissions', href: '/hr/permissions', icon: '🔐', label: 'ตั้งค่าสิทธิ์ใช้งาน', adminOnly: true },
];

export const ALL_MENU_KEYS = HR_MENUS.map((m) => m.key);

// ผูก resource (ของ /api/hr/[resource]) กับ key เมนู (กรณีชื่อไม่ตรง)
export const RESOURCE_TO_MENU = {
  bookings: 'rooms',
};
