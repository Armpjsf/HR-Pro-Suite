import { NextResponse } from 'next/server';
import { requireTenantContext, TenantContextError } from '@/lib/tenantContext';
import { supabase } from '@/lib/supabase';
import { mapTmsEarningsToHr, validateTmsUrl } from '@/lib/tms-earnings-mapper';
import {
  requireModule,
  isOperationAllowedInState,
  EntitlementError,
} from '@/lib/entitlements';

export { mapTmsEarningsToHr };

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

async function getExplicitDriverLinks() {
  try {
    const { data, error } = await supabase
      .from('driver_employee_links')
      .select('tms_driver_id, hr_employee_id, active');
    if (error || !Array.isArray(data)) return [];
    return data;
  } catch {
    return [];
  }
}

export async function GET(request) {
  let tenantCtx;
  try {
    tenantCtx = await requireTenantContext(request, { allowedRoles: ['admin', 'hr'] });
  } catch (err) {
    if (err instanceof TenantContextError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }

  let entitlement;
  try {
    entitlement = await requireModule(tenantCtx, 'hr', 'read');
  } catch (err) {
    if (err instanceof EntitlementError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    throw err;
  }

  if (!entitlement.modules.includes('tms') || !isOperationAllowedInState(entitlement.state, 'integration')) {
    return NextResponse.json(
      {
        configured: false,
        moduleDisabled: true,
        earnings: [],
        autoImportEnabled: false,
      },
      { status: 200 }
    );
  }

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
        autoImportEnabled: false,
      },
      { status: 200 }
    );
  }

  const urlCheck = validateTmsUrl(tmsUrl);
  if (!urlCheck.valid || !urlCheck.url) {
    return NextResponse.json(
      {
        configured: false,
        error: urlCheck.error || 'NEXUS_TMS_URL ไม่ปลอดภัยหรือรูปแบบไม่ถูกต้อง',
        earnings: [],
        autoImportEnabled: false,
      },
      { status: 200 }
    );
  }

  const endpoint = `${urlCheck.url}/api/external/v1/driver-earnings?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;

  let res;
  try {
    res = await fetch(endpoint, {
      headers: {
        Authorization: `Bearer ${tmsKey}`,
        Accept: 'application/json',
      },
      redirect: 'error',
    });
  } catch (fetchErr) {
    return NextResponse.json(
      {
        configured: true,
        error: `เชื่อมต่อกับ Nexus TMS ไม่สำเร็จ: ${fetchErr.message}`,
        earnings: [],
        autoImportEnabled: false,
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
        autoImportEnabled: false,
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
        autoImportEnabled: false,
      },
      { status: 200 }
    );
  }

  const rawList = Array.isArray(tmsData)
    ? tmsData
    : tmsData?.earnings || tmsData?.data || tmsData?.drivers || [];

  const [employees, explicitLinks] = await Promise.all([
    getEmployees(),
    getExplicitDriverLinks(),
  ]);

  const result = mapTmsEarningsToHr(rawList, employees, explicitLinks);

  return NextResponse.json({
    configured: true,
    ...result,
  });
}
