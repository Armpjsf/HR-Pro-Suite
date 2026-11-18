import jwt from 'jsonwebtoken';
import { supabase } from './supabase.js';

const ENV_SECRET = process.env.JWT_SECRET;
if (process.env.NODE_ENV === 'production' && !ENV_SECRET) {
  throw new Error('FATAL: JWT_SECRET environment variable must be set in production.');
}
const JWT_SECRET = ENV_SECRET || 'hr-ai-chatbot-secret-key-dev-only';
const TOKEN_EXPIRY = '8h';

/**
 * สร้าง JWT token
 */
export function createToken(user) {
  const payload = {
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    employeeId: user.employeeId,
    department: user.department,
    avatar: user.avatar,
    tenantId: user.tenantId || process.env.HR_TENANT_ID?.trim() || 'default-tenant',
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
}

/**
 * ตรวจสอบ JWT token
 */
export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
}

export function createDownloadToken(user, documentId) {
  return jwt.sign(
    {
      id: user.id,
      scope: 'document-download',
      documentId,
      tenantId: user.tenantId || process.env.HR_TENANT_ID?.trim() || 'default-tenant',
    },
    JWT_SECRET,
    { expiresIn: '5m' }
  );
}

export function verifyRequestToken(token, request, fromQuery = false) {
  const payload = verifyToken(token);
  if (!payload) return null;

  const expectedTenant = process.env.HR_TENANT_ID?.trim();
  if (expectedTenant && payload.tenantId && payload.tenantId !== expectedTenant) {
    return null;
  }

  if (payload.scope || fromQuery) {
    const path = new URL(request.url).pathname;
    if (
      payload.scope !== 'document-download' ||
      request.method !== 'GET' ||
      path !== `/api/documents/${encodeURIComponent(payload.documentId)}/download`
    ) {
      return null;
    }
  }
  return payload;
}

/**
 * ดึง user จาก Authorization header หรือ cookie
 */
export function getTokenUser(request) {
  try {
    const queryToken = new URL(request.url).searchParams.get('token');
    if (queryToken) return verifyRequestToken(queryToken, request, true);
  } catch { return null; }

  const authHeader = request.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    return verifyRequestToken(token, request);
  }

  const cookies = request.headers.get('cookie') || '';
  const tokenMatch = cookies.match(/hr-token=([^;]+)/);
  if (tokenMatch) {
    return verifyRequestToken(tokenMatch[1], request);
  }

  return null;
}

// Re-read identity on every protected request so deleted/inactive users and
// role/employee changes take effect without waiting for the JWT to expire.
export async function getUserFromRequest(request) {
  const tokenUser = getTokenUser(request);
  return resolveActiveUser(tokenUser);
}

export async function resolveActiveUser(tokenUser, database = supabase) {
  if (!tokenUser?.id) return null;
  const expectedTenant = process.env.HR_TENANT_ID?.trim();
  if (expectedTenant && tokenUser.tenantId && tokenUser.tenantId !== expectedTenant) {
    return null;
  }
  try {
    const { data, error } = await database.from('users')
      .select('id, username, name, role, employee_id, department, avatar, status')
      .eq('id', tokenUser.id).maybeSingle();
    if (error || !data || data.status !== 'active') return null;
    return {
      id: data.id,
      username: data.username,
      name: data.name,
      role: data.role,
      employeeId: data.employee_id,
      department: data.department,
      avatar: data.avatar,
      tenantId: tokenUser.tenantId || expectedTenant || 'default-tenant',
    };
  } catch {
    return null;
  }
}

/**
 * ตรวจสอบว่า user มีสิทธิ์เข้าถึงหรือไม่
 */
export async function requireAuth(request) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return { error: 'กรุณาเข้าสู่ระบบ', status: 401 };
  }
  return { user };
}

/**
 * ตรวจสอบว่า user มี role ที่กำหนดหรือไม่
 */
export async function requireRole(request, allowedRoles) {
  const { user, error, status } = await requireAuth(request);
  if (error) return { error, status };

  if (!allowedRoles.includes(user.role)) {
    return { error: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้', status: 403 };
  }
  return { user };
}
