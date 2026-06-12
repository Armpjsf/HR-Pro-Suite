/**
 * ระบบควบคุมสิทธิ์ตาม Role
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
  employee: {
    documents: ['policies', 'announcements'],
    employee_data: 'self',    // ดูเฉพาะข้อมูลตัวเอง
    templates: ['basic'],     // เฉพาะ Template พื้นฐาน
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
  const perm = PERMISSIONS[userRole];
  if (!perm) return false;

  // Admin/HR สามารถเข้าถึงทุกอย่าง
  if (perm.documents === '*') return true;

  // Employee ตรวจสอบ category
  if (Array.isArray(perm.documents)) {
    return perm.documents.includes(document.category);
  }

  return false;
}

/**
 * ตรวจสอบสิทธิ์เข้าถึง Template
 */
export function canAccessTemplate(userRole, template) {
  const perm = PERMISSIONS[userRole];
  if (!perm) return false;

  if (perm.templates === '*') return true;

  if (Array.isArray(perm.templates)) {
    return perm.templates.includes(template.templateType || 'basic');
  }

  return false;
}

/**
 * ตรวจสอบสิทธิ์ดูข้อมูลพนักงาน
 */
export function canAccessEmployeeData(userRole, requestedEmployeeId, currentEmployeeId) {
  const perm = PERMISSIONS[userRole];
  if (!perm) return false;

  if (perm.employee_data === '*') return true;
  if (perm.employee_data === 'self') {
    return requestedEmployeeId === currentEmployeeId;
  }

  return false;
}

/**
 * ตรวจสอบสิทธิ์ทั่วไป
 */
export function hasPermission(userRole, action) {
  const perm = PERMISSIONS[userRole];
  if (!perm) return false;
  return !!perm[action];
}

/**
 * กรองเอกสารตาม role
 */
export function filterDocumentsByRole(documents, userRole, employeeId) {
  return documents.filter((doc) => {
    // ตรวจสอบ accessRoles ของเอกสาร
    if (doc.accessRoles && !doc.accessRoles.includes(userRole)) {
      // ถ้าเป็น contracts ให้ employee ดูเฉพาะของตัวเอง
      if (doc.category === 'contracts' && userRole === 'employee') {
        return doc.employeeId === employeeId;
      }
      return false;
    }

    // ตรวจสอบ template type สำหรับ employee
    if (doc.category === 'templates' && userRole === 'employee') {
      return canAccessTemplate(userRole, doc);
    }

    return canAccessDocument(userRole, doc);
  });
}

/**
 * สร้าง system context สำหรับ AI ตาม role
 */
export function getRoleContext(userRole) {
  switch (userRole) {
    case 'admin':
      return 'ผู้ใช้คือ Admin มีสิทธิ์เข้าถึงข้อมูลทุกประเภท';
    case 'hr':
      return 'ผู้ใช้คือ HR มีสิทธิ์ดูข้อมูลพนักงานทุกคนและจัดการเอกสาร';
    case 'employee':
      return 'ผู้ใช้คือพนักงานทั่วไป ตอบเฉพาะข้อมูลที่เปิดเผยแก่พนักงานทั่วไป ห้ามเปิดเผยข้อมูลเงินเดือนหรือข้อมูลพนักงานคนอื่น';
    default:
      return 'ไม่ทราบสิทธิ์ ตอบเฉพาะข้อมูลทั่วไป';
  }
}

export { PERMISSIONS };
