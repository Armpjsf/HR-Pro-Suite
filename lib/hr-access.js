// การกั้นสิทธิ์ระดับเมนูฝั่ง server
import { getUserFromRequest } from './auth.js';
import { supabase } from './supabase.js';
import { ALL_MENU_KEYS, RESOURCE_TO_MENU } from './hr-menus.js';

/**
 * คืนรายการ key เมนูที่ role เข้าได้ ('__all__' = ทุกเมนู)
 * - admin: ทุกเมนูเสมอ
 * - role อื่น: อ่านจากตาราง role_permissions (ถ้าไม่มีในตาราง = ไม่ได้สิทธิ์)
 */
export async function getAllowedMenus(role) {
  if (role === 'admin') return '__all__';
  const { data } = await supabase.from('role_permissions').select('menus').eq('role', role).maybeSingle();
  // back-compat: ถ้ายังไม่ได้ตั้งสิทธิ์ role 'hr' ให้เข้าได้ทุกเมนู (เหมือนพฤติกรรมเดิม)
  if (!data) return role === 'hr' ? '__all__' : [];
  if ((data.menus || []).includes('__all__')) return '__all__';
  return data.menus || [];
}

export function isAllowed(allowed, menuKey) {
  return allowed === '__all__' || (Array.isArray(allowed) && allowed.includes(menuKey));
}

/**
 * กั้น API ตามสิทธิ์เมนู — ใช้แทน requireRole สำหรับ /api/hr/*
 * คืน { user } หรือ { error, status }
 */
export async function requireMenu(request, menuKey) {
  const user = getUserFromRequest(request);
  if (!user) return { error: 'กรุณาเข้าสู่ระบบ', status: 401 };

  // ตรวจสอบ role ล่าสุดจากตาราง users
  let currentRole = user.role;
  if (user.id || user.username) {
    let query = supabase.from('users').select('role, status');
    if (user.id) query = query.eq('id', user.id);
    else query = query.eq('username', user.username);
    const { data: dbUser } = await query.maybeSingle();

    if (dbUser?.status && dbUser.status !== 'active') {
      return { error: 'บัญชีถูกระงับการใช้งาน', status: 403 };
    }
    if (dbUser?.role) {
      currentRole = dbUser.role;
    }
  }

  const allowed = await getAllowedMenus(currentRole);
  if (isAllowed(allowed, menuKey)) return { user: { ...user, role: currentRole } };
  return { error: 'คุณไม่มีสิทธิ์เข้าถึงเมนูนี้', status: 403 };
}

// แปลง resource ของ generic route เป็น key เมนู
export function resourceMenuKey(resource) {
  return RESOURCE_TO_MENU[resource] || resource;
}

// ตรวจว่าเป็น admin หรือมีสิทธิ์อย่างน้อย 1 เมนู (ใช้กั้นการเข้า /hr ทั้งหมด)
export async function canAccessHr(role) {
  if (role === 'admin') return true;
  const allowed = await getAllowedMenus(role);
  return allowed === '__all__' || (Array.isArray(allowed) && allowed.length > 0);
}

export { ALL_MENU_KEYS };
