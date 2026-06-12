import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { requireRole } from '@/lib/auth';
import { getUsers, saveUsers, addAuditEntry } from '@/lib/db';

function sanitize(user) {
  const { password, passwordPlain, ...safe } = user;
  return safe;
}

/**
 * GET /api/users — รายชื่อผู้ใช้ (admin/hr)
 */
export async function GET(request) {
  const { error, status } = requireRole(request, ['admin', 'hr']);
  if (error) return NextResponse.json({ error }, { status });

  const users = await getUsers();
  return NextResponse.json({ users: users.map(sanitize) });
}

/**
 * POST /api/users — เพิ่มผู้ใช้ใหม่ (admin)
 */
export async function POST(request) {
  const { user: admin, error, status } = requireRole(request, ['admin']);
  if (error) return NextResponse.json({ error }, { status });

  try {
    const body = await request.json();
    const { name, username, password, role, department, email, employeeId } = body;

    if (!name || !username || !password) {
      return NextResponse.json(
        { error: 'กรุณากรอกชื่อ, username และรหัสผ่าน' },
        { status: 400 }
      );
    }

    if (password.length < 6) {
      return NextResponse.json(
        { error: 'รหัสผ่านต้องยาวอย่างน้อย 6 ตัวอักษร' },
        { status: 400 }
      );
    }

    if (!['admin', 'hr', 'employee'].includes(role)) {
      return NextResponse.json({ error: 'บทบาทไม่ถูกต้อง' }, { status: 400 });
    }

    const users = await getUsers();

    if (users.some((u) => u.username === username)) {
      return NextResponse.json({ error: 'Username นี้ถูกใช้แล้ว' }, { status: 409 });
    }

    const empId =
      employeeId ||
      `EMP${String(
        users.filter((u) => u.employeeId?.startsWith('EMP')).length + 1
      ).padStart(3, '0')}`;

    if (users.some((u) => u.employeeId === empId)) {
      return NextResponse.json({ error: 'รหัสพนักงานนี้ถูกใช้แล้ว' }, { status: 409 });
    }

    const newUser = {
      id: `user-${Date.now()}`,
      username,
      password: bcrypt.hashSync(password, 10),
      name,
      email: email || '',
      role,
      employeeId: empId,
      department: department || '',
      avatar: role === 'admin' ? '👑' : role === 'hr' ? '👩‍💼' : '👤',
    };

    users.push(newUser);
    await saveUsers(users);
    await addAuditEntry({ user: admin.name, action: `เพิ่มผู้ใช้ "${name}"`, channel: 'PWA' });

    return NextResponse.json({ success: true, user: sanitize(newUser) });
  } catch (err) {
    console.error('Create user error:', err);
    return NextResponse.json({ error: 'เกิดข้อผิดพลาดในระบบ' }, { status: 500 });
  }
}
