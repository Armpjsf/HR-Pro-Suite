export const DEFAULT_LEAVE_LABELS = {
  annual: 'ลาพักร้อน',
  sick: 'ลาป่วย',
  personal: 'ลากิจ',
};

export function currentLeaveYear() {
  return Number(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }).slice(0, 4));
}

export function legacyLeaveRows(employeeId, record = {}, year = currentLeaveYear()) {
  return [
    {
      employee_id: employeeId,
      leave_type: 'annual',
      year,
      total_days: Number(record.leave_annual_total) || 0,
      used_days: Number(record.leave_annual_used) || 0,
    },
    {
      employee_id: employeeId,
      leave_type: 'sick',
      year,
      total_days: Number(record.leave_sick_total) || 0,
      used_days: Number(record.leave_sick_used) || 0,
    },
    {
      employee_id: employeeId,
      leave_type: 'personal',
      year,
      total_days: Number(record.leave_personal_total) || 0,
      used_days: Number(record.leave_personal_used) || 0,
    },
  ].filter((row) => row.total_days !== 0 || row.used_days !== 0);
}

export function formatLeaveBalanceMap(rows = [], leaveTypes = []) {
  const rowMap = new Map((rows || []).map((r) => [r.leave_type, r]));
  const typeList = (leaveTypes && leaveTypes.length > 0) ? leaveTypes : [
    { code: 'annual', name: 'ลาพักร้อน', days_per_year: 6 },
    { code: 'sick', name: 'ลาป่วย', days_per_year: 30 },
    { code: 'personal', name: 'ลากิจ', days_per_year: 6 },
  ];

  const result = {};
  for (const t of typeList) {
    const row = rowMap.get(t.code);
    const total = row ? (Number(row.total_days) || 0) : (Number(t.days_per_year) || 0);
    const used = row ? (Number(row.used_days) || 0) : 0;
    result[t.code] = {
      code: t.code,
      label: t.name || DEFAULT_LEAVE_LABELS[t.code] || t.code,
      total,
      used,
      remaining: Math.max(0, total - used),
    };
  }

  for (const r of rows || []) {
    if (!result[r.leave_type]) {
      const total = Number(r.total_days) || 0;
      const used = Number(r.used_days) || 0;
      result[r.leave_type] = {
        code: r.leave_type,
        label: DEFAULT_LEAVE_LABELS[r.leave_type] || r.leave_type,
        total,
        used,
        remaining: Math.max(0, total - used),
      };
    }
  }

  return result;
}

export function legacyTotalsFromBalanceRows(rows = []) {
  const byType = new Map(rows.map((row) => [row.leave_type, row]));
  const value = (type, field) => Number(byType.get(type)?.[field]) || 0;
  return {
    leave_annual_total: value('annual', 'total_days'),
    leave_annual_used: value('annual', 'used_days'),
    leave_sick_total: value('sick', 'total_days'),
    leave_sick_used: value('sick', 'used_days'),
    leave_personal_total: value('personal', 'total_days'),
    leave_personal_used: value('personal', 'used_days'),
  };
}
