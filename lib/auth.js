import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'hr-ai-chatbot-secret-key-dev-only';
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

/**
 * ดึง user จาก Authorization header หรือ cookie
 */
export function getUserFromRequest(request) {
  // Try Authorization header first
  const authHeader = request.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    return verifyToken(token);
  }

  // Try cookie
  const cookies = request.headers.get('cookie') || '';
  const tokenMatch = cookies.match(/hr-token=([^;]+)/);
  if (tokenMatch) {
    return verifyToken(tokenMatch[1]);
  }

  // Try query string (สำหรับลิงก์ดาวน์โหลด)
  try {
    const url = new URL(request.url);
    const queryToken = url.searchParams.get('token');
    if (queryToken) {
      return verifyToken(queryToken);
    }
  } catch {}

  return null;
}

/**
 * ตรวจสอบว่า user มีสิทธิ์เข้าถึงหรือไม่
 */
export function requireAuth(request) {
  const user = getUserFromRequest(request);
  if (!user) {
    return { error: 'กรุณาเข้าสู่ระบบ', status: 401 };
  }
  return { user };
}

/**
 * ตรวจสอบว่า user มี role ที่กำหนดหรือไม่
 */
export function requireRole(request, allowedRoles) {
  const { user, error, status } = requireAuth(request);
  if (error) return { error, status };
  
  if (!allowedRoles.includes(user.role)) {
    return { error: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้', status: 403 };
  }
  return { user };
}
