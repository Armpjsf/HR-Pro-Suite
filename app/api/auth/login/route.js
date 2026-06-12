import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { createToken } from '@/lib/auth';
import { findUserByUsername, addAuditEntry } from '@/lib/db';

export async function POST(request) {
  try {
    const { username, password } = await request.json();

    if (!username || !password) {
      return NextResponse.json(
        { error: 'กรุณากรอก username และ password' },
        { status: 400 }
      );
    }

    const user = await findUserByUsername(username);
    const valid = user && (await bcrypt.compare(password, user.password || ''));

    if (!valid) {
      return NextResponse.json(
        { error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' },
        { status: 401 }
      );
    }

    const token = createToken(user);

    await addAuditEntry({
      user: user.name,
      action: 'เข้าสู่ระบบ',
      channel: 'PWA',
    });

    const response = NextResponse.json({
      success: true,
      token,
      user: {
        id: user.id,
        name: user.name,
        role: user.role,
        employeeId: user.employeeId,
        department: user.department,
        avatar: user.avatar,
      },
    });

    response.cookies.set('hr-token', token, {
      httpOnly: false, // ให้ JS อ่านได้ (ใช้ตรวจสถานะ login ฝั่ง client)
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 8 * 60 * 60,
      path: '/',
    });

    return response;
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json(
      { error: 'เกิดข้อผิดพลาดในระบบ' },
      { status: 500 }
    );
  }
}
