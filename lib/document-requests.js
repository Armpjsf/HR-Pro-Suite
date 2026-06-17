export const DOCUMENT_TYPES = {
  salary_certificate: 'หนังสือรับรองเงินเดือน',
  employment_certificate: 'หนังสือรับรองการทำงาน',
};

export const DOCUMENT_TYPE_KEYS = Object.keys(DOCUMENT_TYPES);

export function isDocumentType(value) {
  return DOCUMENT_TYPE_KEYS.includes(value);
}

export function collectAssetIds(rows = []) {
  return [...new Set(rows.flatMap((r) => [r.signature_asset_id, r.stamp_asset_id, r.logo_asset_id]).filter(Boolean))];
}

export function attachDocumentRequestLookups(rows = [], { assets = [], users = [], records = [], latestSlips = [] } = {}) {
  const assetMap = new Map((assets || []).map((a) => [Number(a.id), a]));
  const userMap = new Map((users || []).map((u) => [u.employee_id, u]));
  const recordMap = new Map((records || []).map((r) => [r.employee_id, r]));
  const slipMap = new Map((latestSlips || []).map((s) => [s.employee_id, s]));

  return (rows || []).map((row) => {
    const employee = userMap.get(row.employee_id) || {};
    const record = recordMap.get(row.employee_id) || {};
    const latestSlip = slipMap.get(row.employee_id) || null;
    return {
      ...row,
      documentLabel: DOCUMENT_TYPES[row.document_type] || row.document_type,
      employeeName: employee.name || row.employee_id,
      employeeDepartment: employee.department || '',
      employeeBranchId: employee.branch_id ?? null,
      employeeAvatar: employee.avatar || '',
      employeeProfile: {
        employeeId: row.employee_id,
        name: employee.name || row.employee_id,
        department: employee.department || '',
        position: record.position || '',
        startDate: record.start_date || '',
        salary: Number(record.salary) || Number(latestSlip?.base_salary) || 0,
        nationalId: record.national_id || '',
        taxId: record.tax_id || '',
      },
      latestPayslip: latestSlip,
      signatureAsset: row.signature_asset_id ? assetMap.get(Number(row.signature_asset_id)) || null : null,
      stampAsset: row.stamp_asset_id ? assetMap.get(Number(row.stamp_asset_id)) || null : null,
      logoAsset: row.logo_asset_id ? assetMap.get(Number(row.logo_asset_id)) || null : null,
    };
  });
}
