// นิยามเมนู HR กลาง — ใช้ร่วมกันทั้ง sidebar, หน้าตั้งค่าสิทธิ์ และการกั้น API
// key = รหัสสิทธิ์ของเมนูนั้น (ใช้ผูกกับ role_permissions)
// hiddenInSidebar: true คือเมนูย่อยที่ถูกยุบรวมเป็นแท็บในเมนูหลัก เพื่อให้ Sidebar กระชับ ไม่รกสายตา

export const HR_MENUS = [
  // ── ภาพรวม ──
  { key: 'dashboard', href: '/hr', icon: '📊', label: 'Dashboard', group: 'ภาพรวม' },
  { key: 'chat', href: '/hr/chat', icon: '💬', label: 'แชท AI', group: 'ภาพรวม' },
  { key: 'reports', href: '/hr/reports', icon: '📑', label: 'รายงาน', group: 'ภาพรวม' },

  // ── โครงสร้างองค์กร ──
  { key: 'employees', href: '/hr/employees', icon: '👥', label: 'พนักงาน', group: 'โครงสร้างองค์กร' },
  { key: 'org', href: '/hr/org', icon: '🗂️', label: 'ผังองค์กร', group: 'โครงสร้างองค์กร' },
  { key: 'branches', href: '/hr/branches', icon: '🏬', label: 'สาขาและจุด GPS', group: 'โครงสร้างองค์กร' },
  { key: 'locations', href: '/hr/locations', icon: '📍', label: 'จุดปักหมุด GPS', group: 'โครงสร้างองค์กร', hiddenInSidebar: true },
  { key: 'departments', href: '/hr/departments', icon: '🏢', label: 'แผนกและตำแหน่ง', group: 'โครงสร้างองค์กร' },
  { key: 'positions', href: '/hr/positions', icon: '💼', label: 'ตำแหน่งงาน', group: 'โครงสร้างองค์กร', hiddenInSidebar: true },

  // ── เวลาและการลา ──
  { key: 'time', href: '/hr/time', icon: '🕐', label: 'บันทึกเวลา', group: 'เวลาและการลา' },
  { key: 'shifts', href: '/hr/shifts', icon: '📅', label: 'จัดกะและรูปแบบกะ', group: 'เวลาและการลา' },
  { key: 'shift-patterns', href: '/hr/shift-patterns', icon: '🔄', label: 'ตั้งค่ารูปแบบกะ', group: 'เวลาและการลา', hiddenInSidebar: true },
  { key: 'settings', href: '/hr/settings', icon: '⚙️', label: 'ตั้งค่าเวลาทำงาน', group: 'เวลาและการลา', hiddenInSidebar: true },
  { key: 'leave', href: '/hr/leave', icon: '🏖️', label: 'การลาและโควตา', group: 'เวลาและการลา' },
  { key: 'leave-types', href: '/hr/leave-types', icon: '🗒️', label: 'ประเภทการลา', group: 'เวลาและการลา', hiddenInSidebar: true },
  { key: 'holidays', href: '/hr/holidays', icon: '🎌', label: 'วันหยุดประจำปี', group: 'เวลาและการลา' },

  // ── เงินและสวัสดิการ ──
  { key: 'payroll', href: '/hr/payroll', icon: '💰', label: 'เงินเดือน', group: 'เงินและสวัสดิการ' },
  { key: 'ot', href: '/hr/ot', icon: '⏱️', label: 'ค่าล่วงเวลา (OT)', group: 'เงินและสวัสดิการ' },
  { key: 'expenses', href: '/hr/expenses', icon: '🧾', label: 'เบิกค่าใช้จ่าย', group: 'เงินและสวัสดิการ' },
  { key: 'benefits', href: '/hr/benefits', icon: '🎁', label: 'สวัสดิการและกู้ยืม', group: 'เงินและสวัสดิการ' },
  { key: 'social-security', href: '/hr/social-security', icon: '🏥', label: 'ประกันสังคม', group: 'เงินและสวัสดิการ' },

  // ── เอกสารและประกาศ ──
  { key: 'documents', href: '/hr/documents', icon: '📄', label: 'คลังเอกสาร & RAG', group: 'เอกสารและประกาศ' },
  { key: 'document-requests', href: '/hr/document-requests', icon: '🖋️', label: 'คำขอเอกสารรับรอง', group: 'เอกสารและประกาศ' },
  { key: 'document-assets', href: '/hr/document-assets', icon: '🔏', label: 'ลายเซ็นและตราประทับ', group: 'เอกสารและประกาศ', hiddenInSidebar: true },
  { key: 'announcements', href: '/hr/announcements', icon: '📢', label: 'ข่าวสารและประกาศ', group: 'เอกสารและประกาศ' },

  // ── งานสนับสนุนและพัฒนาองค์กร ──
  { key: 'assets', href: '/hr/assets', icon: '📦', label: 'ทรัพย์สินบริษัท', group: 'งานสนับสนุน' },
  { key: 'rooms', href: '/hr/rooms', icon: '🎦', label: 'ห้องประชุม', group: 'งานสนับสนุน' },
  { key: 'recruitment', href: '/hr/recruitment', icon: '🧑‍💼', label: 'สรรหาและผู้สมัคร', group: 'พัฒนาองค์กร' },
  { key: 'applicants', href: '/hr/applicants', icon: '📋', label: 'ผู้สมัคร', group: 'พัฒนาองค์กร', hiddenInSidebar: true },
  { key: 'interviews', href: '/hr/interviews', icon: '🎙️', label: 'AI สัมภาษณ์', group: 'พัฒนาองค์กร', hiddenInSidebar: true },
  { key: 'training', href: '/hr/training', icon: '🎓', label: 'อบรมและทริป', group: 'พัฒนาองค์กร' },
  { key: 'trips', href: '/hr/trips', icon: '✈️', label: 'ทริปบริษัท', group: 'พัฒนาองค์กร', hiddenInSidebar: true },
  { key: 'onboarding', href: '/hr/onboarding', icon: '🚀', label: 'ปฐมนิเทศ', group: 'พัฒนาองค์กร' },
  { key: 'evaluation', href: '/hr/evaluation', icon: '🎯', label: 'ประเมินผลและ OKR', group: 'พัฒนาองค์กร' },
  { key: 'okr', href: '/hr/okr', icon: '📈', label: 'OKR', group: 'พัฒนาองค์กร', hiddenInSidebar: true },

  // ── ผู้ดูแลระบบ ──
  { key: 'import', href: '/hr/import', icon: '📥', label: 'นำเข้าข้อมูล (Excel)', group: 'ผู้ดูแลระบบ' },
  { key: 'users', href: '/hr/users', icon: '🛡️', label: 'ตั้งค่าผู้ใช้งาน & LINE', group: 'ผู้ดูแลระบบ', adminOnly: true },
  { key: 'permissions', href: '/hr/permissions', icon: '🔐', label: 'ตั้งค่าสิทธิ์ใช้งาน', group: 'ผู้ดูแลระบบ', adminOnly: true },
];

export const ALL_MENU_KEYS = HR_MENUS.map((m) => m.key);

// ผูก resource (ของ /api/hr/[resource]) กับ key เมนู (กรณีชื่อไม่ตรง)
export const RESOURCE_TO_MENU = {
  bookings: 'rooms',
};
