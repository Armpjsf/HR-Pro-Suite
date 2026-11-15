import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

async function getEmployees() {
  const { data, error } = await supabase
    .from('users')
    .select('employee_id, name, name_en, role, department, status');

  if (error) {
    throw new Error(`getEmployees failed: ${error.message}`);
  }

  return (data || []).map((u) => ({
    employeeId: u.employee_id,
    name: u.name,
    nameEn: u.name_en || '',
    role: u.role,
    department: u.department || '',
    status: u.status || 'active',
  }));
}

function normalizeName(str) {
  if (!str) return '';
  return String(str).trim().replace(/\s+/g, ' ').toLowerCase();
}

export async function GET(request) {
  const { error, status } = requireRole(request, ['admin', 'hr']);
  if (error) return NextResponse.json({ error }, { status });

  const url = new URL(request.url);
  const from = url.searchParams.get('from') || '';
  const to = url.searchParams.get('to') || '';

  const tmsUrl = process.env.NEXUS_TMS_URL;
  const tmsKey = process.env.NEXUS_TMS_API_KEY;

  if (!tmsUrl || !tmsKey) {
    return NextResponse.json(
      {
        configured: false,
        error: 'ยังไม่ได้ตั้งค่า NEXUS_TMS_URL หรือ NEXUS_TMS_API_KEY ในระบบ',
        earnings: [],
      },
      { status: 200 }
    );
  }

  const endpoint = `${tmsUrl.replace(/\/$/, '')}/api/external/v1/driver-earnings?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;

  let res;
  try {
    res = await fetch(endpoint, {
      headers: {
        Authorization: `Bearer ${tmsKey}`,
        Accept: 'application/json',
      },
    });
  } catch (fetchErr) {
    return NextResponse.json(
      {
        configured: true,
        error: `เชื่อมต่อกับ Nexus TMS ไม่สำเร็จ: ${fetchErr.message}`,
        earnings: [],
      },
      { status: 200 }
    );
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    return NextResponse.json(
      {
        configured: true,
        error: `Nexus TMS ตอบกลับรหัส ${res.status}: ${errText.slice(0, 150)}`,
        earnings: [],
      },
      { status: 200 }
    );
  }

  let tmsData;
  try {
    tmsData = await res.json();
  } catch {
    return NextResponse.json(
      {
        configured: true,
        error: 'ข้อมูลตอบกลับจาก Nexus TMS ไม่ใช่รูปแบบ JSON ที่ถูกต้อง',
        earnings: [],
      },
      { status: 200 }
    );
  }

  const rawList = Array.isArray(tmsData)
    ? tmsData
    : tmsData?.earnings || tmsData?.data || tmsData?.drivers || [];

  const employees = await getEmployees();

  const earnings = rawList.map((item) => {
    const rawName = item.driver_name || item.driverName || item.name || '';
    const normName = normalizeName(rawName);

    const matched = employees.find((e) => {
      const eNorm = normalizeName(e.name);
      return eNorm && (eNorm === normName || eNorm.includes(normName) || normName.includes(eNorm));
    });

    return {
      ...item,
      driverName: rawName,
      employeeId: matched ? matched.employeeId : item.employee_id || item.employeeId || null,
      department: matched?.department || null,
      matched: !!matched,
      tripCount: Number(item.trip_count ?? item.trips ?? item.tripCount ?? 0),
      driverCost: Number(item.driver_cost ?? item.driverCost ?? item.amount ?? item.earnings ?? 0),
    };
  });

  return NextResponse.json({ configured: true, earnings });
}
