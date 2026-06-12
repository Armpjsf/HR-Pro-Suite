import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { requireRole } from '@/lib/auth';
import { getUsers, saveUsers, addAuditEntry } from '@/lib/db';

function sanitize(user) {
  const { password, passwordPlain, ...safe } = user;
  return safe;
}

/**
 * PUT /api/users/[id] — แก้ไขผู้ใช้ (admin)
 */
export async function PUT(request, { params }) {
  const { user: admin, error, status } = requireRole(request, ['admin']);
  if (error) return NextResponse.json({ error }, { status });

  try {
    const { id } = await params;
    const body = await request.json();
    const users = getUsers();
    const index = users.findIndex((u) => u.id === id);

    if (index === -1) {
      return NextResponse.json({ error: 'ไม่พบผู้ใช้' }, { status: 404 });
    }

    const { name, username, password, role, department, email } = body;

    if (username && users.some((u) => u.username === username && u.id !== id)) {
      return NextResponse.json({ error: 'Username นี้ถูกใช้แล้ว' }, { status: 409 });
    }

    if (role && !['admin', 'hr', 'employee'].includes(role)) {
      return NextResponse.json({ error: 'บทบาทไม่ถูกต้อง' }, { status: 400 });
    }

    const updated = { ...users[index] };
    if (name) updated.name = name;
    if (username) updated.username = username;
    if (role) {
      updated.role = role;
      updated.avatar = role === 'admin' ? '👑' : role === 'hr' ? '👩‍💼' : '👤';
    }
    if (department !== undefined) updated.department = department;
    if (email !== undefined) updated.email = email;
    if (password) {
      if (password.length < 6) {
        return NextResponse.json(
          { error: 'รหัสผ่านต้องยาวอย่างน้อย 6 ตัวอักษร' },
          { status: 400 }
        );
      }
      updated.password = bcrypt.hashSync(password, 10);
    }

    users[index] = updated;
    saveUsers(users);
    addAuditEntry({ user: admin.name, action: `แก้ไขผู้ใช้ "${updated.name}"`, channel: 'PWA' });

    return NextResponse.json({ success: true, user: sanitize(updated) });
  } catch (err) {
    console.error('Update user error:', err);
    return NextResponse.json({ error: 'เกิดข้อผิดพลาดในระบบ' }, { status: 500 });
  }
}

/**
 * DELETE /api/users/[id] — ลบผู้ใช้ (admin)
 */
export async function DELETE(request, { params }) {
  const { user: admin, error, status } = requireRole(request, ['admin']);
  if (error) return NextResponse.json({ error }, { status });

  const { id } = await params;

  if (id === admin.id) {
    return NextResponse.json({ error: 'ไม่สามารถลบบัญชีของตัวเองได้' }, { status: 400 });
  }

  const users = getUsers();
  const target = users.find((u) => u.id === id);

  if (!target) {
    return NextResponse.json({ error: 'ไม่พบผู้ใช้' }, { status: 404 });
  }

  saveUsers(users.filter((u) => u.id !== id));
  addAuditEntry({ user: admin.name, action: `ลบผู้ใช้ "${target.name}"`, channel: 'PWA' });

  return NextResponse.json({ success: true });
}
