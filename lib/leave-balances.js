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
  const typeMap = new Map((leaveTypes || []).map((t) => [t.code, t]));
  return Object.fromEntries(
    rows.map((row) => {
      const total = Number(row.total_days) || 0;
      const used = Number(row.used_days) || 0;
      const type = typeMap.get(row.leave_type);
      return [
        row.leave_type,
        {
          code: row.leave_type,
          label: type?.name || DEFAULT_LEAVE_LABELS[row.leave_type] || row.leave_type,
          total,
          used,
          remaining: total - used,
        },
      ];
    })
  );
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
