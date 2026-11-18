const PRIVATE_IPV4_RANGES = [
  /^127\./,
  /^10\./,
  /^0\./,
  /^169\.254\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^100\.(6[4-9]|[7-9]\d|1[0-1]\d|12[0-7])\./,
];

function isPrivateOrBlockedHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return true;
  if (
    host === 'localhost' ||
    host === '::1' ||
    host === '::' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host === 'metadata.google.internal'
  ) {
    return true;
  }
  if (host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')) {
    return true;
  }
  return PRIVATE_IPV4_RANGES.some((re) => re.test(host));
}

export function validateTmsUrl(rawUrl) {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) {
    return { valid: false, error: 'NEXUS_TMS_URL is not configured' };
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, error: 'NEXUS_TMS_URL is malformed' };
  }

  const isLocalHost =
    parsed.hostname === 'localhost' ||
    parsed.hostname === '127.0.0.1' ||
    parsed.hostname === '::1' ||
    parsed.hostname === '[::1]';

  const allowLocalTestUrl =
    process.env.NODE_ENV !== 'production' &&
    process.env.ALLOW_LOCAL_INTEGRATION_URL === 'true';

  if (parsed.protocol !== 'https:') {
    if (allowLocalTestUrl && parsed.protocol === 'http:' && isLocalHost) {
      return { valid: true, url: parsed.toString().replace(/\/+$/, '') };
    }
    return { valid: false, error: 'NEXUS_TMS_URL must use HTTPS' };
  }

  if (isPrivateOrBlockedHost(parsed.hostname)) {
    if (allowLocalTestUrl && isLocalHost) {
      return { valid: true, url: parsed.toString().replace(/\/+$/, '') };
    }
    return { valid: false, error: 'NEXUS_TMS_URL targets a blocked or private host' };
  }

  return { valid: true, url: parsed.toString().replace(/\/+$/, '') };
}

function resolveMonetaryAmount(item) {
  if (item?.amountMinor !== undefined && item?.amountMinor !== null) {
    const minorNum = typeof item.amountMinor === 'string' && item.amountMinor.trim() === ''
      ? NaN
      : Number(item.amountMinor);
    if (!Number.isFinite(minorNum) || minorNum < 0) {
      return { valid: false, amount: null };
    }
    return { valid: true, amount: Math.round(minorNum) / 100 };
  }

  const candidate =
    item?.totalDriverCost ??
    item?.total_driver_cost ??
    item?.driverCost ??
    item?.driver_cost ??
    item?.amount ??
    item?.earnings;

  if (candidate === undefined || candidate === null) {
    return { valid: true, amount: 0 };
  }

  const num = typeof candidate === 'string' && candidate.trim() === ''
    ? NaN
    : Number(candidate);

  if (!Number.isFinite(num) || num < 0) {
    return { valid: false, amount: null };
  }

  return { valid: true, amount: Math.round(num * 100) / 100 };
}

/**
 * Normalizes TMS driver-earnings items (v1 & v2) and enforces strict identity matching.
 * - Never matches empty names or substrings.
 * - Separates subcontractors from employee payroll.
 * - Marks invalid/negative/NaN amounts explicitly instead of silently coercing to 0.
 */
export function mapTmsEarningsToHr(rawList = [], employees = [], explicitLinks = []) {
  const empById = new Map();
  const empByTmsDriverId = new Map();

  for (const emp of employees || []) {
    const empId = String(emp.employeeId || emp.employee_id || '').trim();
    if (empId) empById.set(empId, emp);
    const tmsId = String(emp.tmsDriverId || emp.tms_driver_id || '').trim();
    if (tmsId) empByTmsDriverId.set(tmsId, emp);
  }

  const activeLinkByDriverId = new Map();
  for (const link of explicitLinks || []) {
    if (link.active === false) continue;
    const tmsDriverId = String(link.tmsDriverId || link.tms_driver_id || '').trim();
    const hrEmployeeId = String(link.hrEmployeeId || link.hr_employee_id || '').trim();
    if (tmsDriverId && hrEmployeeId) {
      activeLinkByDriverId.set(tmsDriverId, hrEmployeeId);
    }
  }

  let matchedEmployeeCount = 0;
  let unmappedCount = 0;
  let subcontractorCount = 0;
  let invalidCount = 0;
  let totalMatchedAmount = 0;
  let totalUnmappedAmount = 0;
  let totalSubcontractorAmount = 0;

  const earnings = (rawList || []).map((item) => {
    const driverId = String(item?.Driver_ID || item?.driverId || item?.driver_id || '').trim();
    const rawName = String(item?.Driver_Name || item?.driverName || item?.driver_name || item?.name || '').trim();
    const subId = String(item?.Sub_ID || item?.subId || item?.sub_id || '').trim();
    const isSubcontractor = item?.isSubcontractor === true || Boolean(subId);

    const tripCountNum = Number(item?.trip_count ?? item?.trips ?? item?.tripCount ?? 0);
    const tripCount = Number.isFinite(tripCountNum) && tripCountNum >= 0 ? tripCountNum : 0;

    const money = resolveMonetaryAmount(item);
    const amountValid = money.valid;
    const driverCost = money.amount;

    if (!amountValid) {
      invalidCount++;
    }

    if (isSubcontractor) {
      subcontractorCount++;
      if (amountValid && driverCost !== null) {
        totalSubcontractorAmount = Math.round((totalSubcontractorAmount + driverCost) * 100) / 100;
      }
      return {
        ...item,
        driverId: driverId || null,
        driverName: rawName,
        subId: subId || null,
        isSubcontractor: true,
        employmentType: 'subcontractor',
        employeeId: null,
        department: null,
        matched: false,
        valid: amountValid,
        status: amountValid ? 'excluded_subcontractor' : 'invalid_amount',
        disposition: 'excluded_subcontractor',
        matchWarning: 'รถร่วม/ผู้รับเหมาช่วง (แยกออกจากบัญชีเงินเดือนพนักงาน)',
        tripCount,
        driverCost,
      };
    }

    // Strict ID / explicit link matching only (never empty name or substring matching)
    let matchedEmployee = null;
    const linkedHrId = driverId ? activeLinkByDriverId.get(driverId) : null;
    if (linkedHrId) {
      matchedEmployee = empById.get(linkedHrId) || { employeeId: linkedHrId, department: null };
    }

    if (!matchedEmployee) {
      const explicitEmpId = String(item?.employeeId || item?.employee_id || '').trim();
      if (explicitEmpId && empById.has(explicitEmpId)) {
        matchedEmployee = empById.get(explicitEmpId);
      }
    }

    if (!matchedEmployee && driverId) {
      matchedEmployee = empByTmsDriverId.get(driverId) || empById.get(driverId) || null;
    }

    if (matchedEmployee) {
      if (amountValid) {
        matchedEmployeeCount++;
        if (driverCost !== null) {
          totalMatchedAmount = Math.round((totalMatchedAmount + driverCost) * 100) / 100;
        }
      }
      return {
        ...item,
        driverId: driverId || null,
        driverName: rawName,
        isSubcontractor: false,
        employmentType: 'employee',
        employeeId: matchedEmployee.employeeId || matchedEmployee.employee_id || null,
        department: matchedEmployee.department || null,
        matched: amountValid,
        valid: amountValid,
        status: amountValid ? 'matched' : 'invalid_amount',
        disposition: amountValid ? 'matched_employee' : 'invalid_amount',
        matchWarning: amountValid ? null : 'จำนวนเงินไม่ถูกต้อง (Invalid amount)',
        tripCount,
        driverCost,
      };
    }

    unmappedCount++;
    if (amountValid && driverCost !== null) {
      totalUnmappedAmount = Math.round((totalUnmappedAmount + driverCost) * 100) / 100;
    }

    const matchWarning = !rawName && !driverId
      ? 'ไม่มีรหัสและชื่อคนขับ ต้องตรวจสอบก่อนนำเข้า'
      : 'ไม่พบรหัสพนักงานหรือการผูกบัญชี Driver-Employee (ต้องให้ HR ยืนยัน)';

    return {
      ...item,
      driverId: driverId || null,
      driverName: rawName,
      isSubcontractor: false,
      employmentType: 'employee',
      employeeId: null,
      department: null,
      matched: false,
      valid: amountValid,
      status: amountValid ? 'unmapped_review_required' : 'invalid_amount',
      disposition: amountValid ? 'unmapped_review_required' : 'invalid_amount',
      matchWarning,
      tripCount,
      driverCost,
    };
  });

  return {
    earnings,
    summary: {
      totalRecords: earnings.length,
      matchedEmployeeCount,
      unmappedCount,
      subcontractorCount,
      invalidCount,
      totalMatchedAmount,
      totalUnmappedAmount,
      totalSubcontractorAmount,
    },
    autoImportEnabled: false,
  };
}
