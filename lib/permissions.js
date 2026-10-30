/**
 * ระบบควบคุมสิทธิ์ตาม Role และมาตรฐานการรักษาความปลอดภัยข้อมูลส่วนบุคคล (PDPA)
 */

const PERMISSIONS = {
  admin: {
    documents: '*',           // เข้าถึงเอกสารทุกประเภท
    employee_data: '*',       // ดูข้อมูลพนักงานทุกคน
    templates: '*',           // ดู Template ทั้งหมด
    manage_users: true,       // จัดการ users
    upload_documents: true,   // อัพโหลดเอกสาร
    manage_index: true,       // จัดการ Knowledge Index
    view_audit: true,         // ดู Audit Logs
  },
  hr: {
    documents: '*',
    employee_data: '*',
    templates: '*',
    manage_users: false,
    upload_documents: true,
    manage_index: true,
    view_audit: true,
  },
  manager: {
    documents: ['policies', 'announcements', 'templates'],
    employee_data: 'team',    // ดูข้อมูลทีมในสังกัด
    templates: '*',           // รวมแบบฟอร์มเตือนวินัยสำหรับหัวหน้างาน
    manage_users: false,
    upload_documents: false,
    manage_index: false,
    view_audit: false,
  },
  employee: {
    documents: ['policies', 'announcements', 'templates'],
    employee_data: 'self',    // ดูเฉพาะข้อมูลตัวเองเท่านั้น
    templates: ['basic'],     // เฉพาะแบบฟอร์มทั่วไป (ห้ามเห็นแบบฟอร์มลับ/หนังสือเตือน)
    manage_users: false,
    upload_documents: false,
    manage_index: false,
    view_audit: false,
  },
  partner_driver: {
    documents: ['announcements', 'templates'], // ประกาศความปลอดภัยและแบบฟอร์มวางบิล
    employee_data: 'self',
    templates: ['basic'],
    manage_users: false,
    upload_documents: false,
    manage_index: false,
    view_audit: false,
  },
};

/**
 * ตรวจสอบสิทธิ์เข้าถึงเอกสาร
 */
export function canAccessDocument(userRole, document) {
  const perm = PERMISSIONS[userRole] || PERMISSIONS.employee;

  // Admin/HR สามารถเข้าถึงได้ทั้งหมด
  if (perm.documents === '*') return true;

  if (Array.isArray(perm.documents)) {
    return perm.documents.includes(document.category);
  }

  return false;
}

/**
 * ตรวจสอบสิทธิ์เข้าถึง Template
 */
export function canAccessTemplate(userRole, template) {
  const perm = PERMISSIONS[userRole] || PERMISSIONS.employee;

  if (perm.templates === '*') return true;

  // ตรวจสอบ accessRoles ของตัวเอกสาร
  if (template.accessRoles && Array.isArray(template.accessRoles)) {
    if (!template.accessRoles.includes(userRole)) return false;
  }

  if (Array.isArray(perm.templates)) {
    return perm.templates.includes(template.templateType || 'basic');
  }

  return false;
}

/**
 * ตรวจสอบสิทธิ์ดูข้อมูลส่วนบุคคลของพนักงาน (PDPA Enforcement)
 */
export function canAccessEmployeeData(userRole, requestedEmployeeId, currentEmployeeId) {
  const perm = PERMISSIONS[userRole] || PERMISSIONS.employee;

  if (perm.employee_data === '*') return true;
  if (perm.employee_data === 'self') {
    return requestedEmployeeId === currentEmployeeId;
  }
  if (perm.employee_data === 'team') {
    // ผู้จัดการดูตัวเองได้ หรือถ้าตรงกัน
    return requestedEmployeeId === currentEmployeeId;
  }

  return false;
}

/**
 * ตรวจสอบสิทธิ์ทั่วไป
 */
export function hasPermission(userRole, action) {
  const perm = PERMISSIONS[userRole] || PERMISSIONS.employee;
  return !!perm[action];
}

/**
 * กรองเอกสารตาม Role อย่างรัดกุมก่อนส่งเข้า Context ของ AI
 */
export function filterDocumentsByRole(documents, userRole, employeeId) {
  const effectiveRole = userRole || 'employee';

  return documents.filter((doc) => {
    // 1. ถ้าเอกสารมีระบุ accessRoles ไว้เฉพาะกลุ่ม
    if (doc.accessRoles && Array.isArray(doc.accessRoles)) {
      if (doc.accessRoles.includes(effectiveRole)) {
        return true;
      }
      // กรณีสัญญาจ้าง (contracts): ถ้าเป็นของพนักงานคนนั้นเอง อนุญาตให้ดูได้
      if (doc.category === 'contracts' && doc.employeeId === employeeId) {
        return true;
      }
      return false;
    }

    // 2. ตรวจสอบตาม Category ของ Role
    if (effectiveRole === 'admin' || effectiveRole === 'hr') return true;

    // สำหรับ employee ทั่วไป ห้ามเห็น contracts เด็ดขาด (เว้นแต่เป็นของตัวเอง)
    if (doc.category === 'contracts') {
      return doc.employeeId === employeeId;
    }

    // ตรวจสอบ Template
    if (doc.category === 'templates') {
      return canAccessTemplate(effectiveRole, doc);
    }

    return canAccessDocument(effectiveRole, doc);
  });
}

/**
 * สร้าง System Context ให้ AI ตามสิทธิ์ของผู้ใช้ ป้องกันการละเมิด PDPA
 */
export function getRoleContext(userRole) {
  switch (userRole) {
    case 'admin':
      return 'ผู้ใช้คือ ผู้ดูแลระบบ (Admin) มีสิทธิ์เข้าถึงและตรวจสอบข้อมูลทุกประเภทในระบบ';
    case 'hr':
      return 'ผู้ใช้คือ เจ้าหน้าที่ฝ่ายบุคคล (HR) มีสิทธิ์ดูข้อมูลพนักงานทุกคนเพื่อการบริหารงานบุคคล';
    case 'manager':
      return 'ผู้ใช้คือ หัวหน้างาน/ผู้จัดการ (Manager) ดูข้อมูลระเบียบและลูกทีมในสังกัดได้';
    case 'partner_driver':
      return 'ผู้ใช้คือ ผู้ขับรถร่วมบริการ (Partner Driver) ให้ข้อมูลเฉพาะเรื่องงานวิ่งรถ รอบวางบิล และความปลอดภัย ห้ามเปิดเผยข้อมูลสวัสดิการพนักงานประจำ';
    case 'employee':
    default:
      return 'ผู้ใช้คือ พนักงานทั่วไป (Employee) สำคัญที่สุด: ตอบเฉพาะข้อมูลของตัวผู้ถามเองเท่านั้น ห้ามเปิดเผยข้อมูลส่วนตัว เงินเดือน วันลา หรือบทลงโทษของพนักงานคนอื่นอย่างเด็ดขาดตามกฎหมาย PDPA';
  }
}

export { PERMISSIONS };
