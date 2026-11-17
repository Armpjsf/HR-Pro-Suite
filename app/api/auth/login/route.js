import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { createToken } from '@/lib/auth';
import { findUserByUsername, addAuditEntry } from '@/lib/db';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';

export async function POST(request) {
  try {
    const { username, password } = await request.json();

    if (!username || !password) {
      return NextResponse.json(
        { error: 'กรุณากรอก username และ password' },
        { status: 400 }
      );
    }

    const ip = getClientIp(request);
    const rl = checkRateLimit(`login:${ip}:${String(username || '').toLowerCase()}`, 10, 15 * 60_000);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: `พยายามเข้าสู่ระบบบ่อยเกินไป กรุณารอ ${rl.retryAfterSec} วินาที` },
        { status: 429 }
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

    if (user.status && user.status !== 'active') {
      return NextResponse.json(
        { error: 'บัญชีนี้พ้นสภาพพนักงาน/ถูกระงับ กรุณาติดต่อ HR' },
        { status: 403 }
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
      httpOnly: true,
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
