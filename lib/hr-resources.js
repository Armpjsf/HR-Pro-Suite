// RESOURCES whitelist for the generic /api/hr/[resource] routes.
// key = URL segment. columns = writable whitelist (snake_case).
// Phase 1: ทุก resource เปิดให้เฉพาะ admin/hr (employee self-service เป็น phase 2 —
// ค่อยขยาย readRoles/writeRoles รายตัวภายหลัง)

const HR_ROLES = ['admin', 'hr'];

function res(table, { searchCols, columns, required = [], orderBy } = {}) {
  return {
    table,
    readRoles: HR_ROLES,
    writeRoles: HR_ROLES,
    searchCols: searchCols || [],
    columns: columns || [],
    required,
    orderBy: orderBy || { col: 'created_at', asc: false },
  };
}

export const RESOURCES = {
  branches: res('branches', {
    searchCols: ['code', 'name', 'province'],
    columns: ['code', 'name', 'address', 'province', 'phone', 'standard_in', 'standard_out', 'late_grace_min', 'work_days', 'calendar_note'],
    required: ['code', 'name'],
    orderBy: { col: 'code', asc: true },
  }),
  holidays: res('holidays', {
    searchCols: ['name'],
    columns: ['holiday_date', 'name', 'branch_id', 'note'],
    required: ['holiday_date', 'name'],
    orderBy: { col: 'holiday_date', asc: true },
  }),
  departments: res('departments', {
    searchCols: ['code', 'name'],
    columns: ['code', 'name', 'description'],
    required: ['code', 'name'],
  }),
  'leave-types': res('leave_types', {
    searchCols: ['code', 'name'],
    columns: ['code', 'name', 'days_per_year', 'paid', 'deduct_balance', 'note'],
    required: ['code', 'name'],
    orderBy: { col: 'code', asc: true },
  }),
  'shift-patterns': res('shift_patterns', {
    searchCols: ['name', 'shift_type'],
    columns: ['name', 'shift_type', 'start_time', 'end_time', 'branch_id'],
    required: ['name', 'shift_type'],
    orderBy: { col: 'name', asc: true },
  }),
  positions: res('positions', {
    searchCols: ['title', 'department_code'],
    columns: ['title', 'department_code', 'level', 'description'],
    required: ['title'],
  }),
  time: res('time_records', {
    searchCols: ['employee_id', 'status'],
    columns: ['employee_id', 'work_date', 'clock_in', 'clock_out', 'status', 'note'],
    required: ['employee_id', 'work_date'],
    orderBy: { col: 'work_date', asc: false },
  }),
  leave: res('leave_requests', {
    searchCols: ['employee_id', 'leave_type', 'status'],
    columns: ['employee_id', 'leave_type', 'start_date', 'end_date', 'days', 'reason', 'status'],
    required: ['employee_id', 'leave_type', 'start_date', 'end_date', 'days'],
  }),
  payroll: res('payroll_slips', {
    searchCols: ['employee_id', 'period', 'status'],
    columns: ['employee_id', 'period', 'base_salary', 'ot_pay', 'bonus', 'tax', 'sso', 'deduction', 'net', 'status'],
    required: ['employee_id', 'period'],
  }),
  ot: res('ot_records', {
    searchCols: ['employee_id', 'status'],
    columns: ['employee_id', 'ot_date', 'hours', 'rate', 'amount', 'status', 'note'],
    required: ['employee_id', 'ot_date', 'hours'],
    orderBy: { col: 'ot_date', asc: false },
  }),
  shifts: res('shifts', {
    searchCols: ['employee_id', 'shift_type'],
    columns: ['employee_id', 'shift_date', 'shift_type', 'start_time', 'end_time', 'note'],
    required: ['employee_id', 'shift_date', 'shift_type'],
    orderBy: { col: 'shift_date', asc: true },
  }),
  recruitment: res('job_openings', {
    searchCols: ['title', 'department_code', 'status'],
    columns: ['title', 'department_code', 'headcount', 'status', 'description', 'posted_date'],
    required: ['title'],
  }),
  applicants: res('applicants', {
    searchCols: ['name', 'position_applied', 'status'],
    columns: ['name', 'email', 'phone', 'position_applied', 'opening_id', 'status', 'applied_date', 'note'],
    required: ['name'],
  }),
  onboarding: res('onboarding_checklists', {
    searchCols: ['employee_id', 'item'],
    columns: ['employee_id', 'item', 'due_date', 'done', 'assigned_to'],
    required: ['employee_id', 'item'],
  }),
  training: res('trainings', {
    searchCols: ['title', 'trainer', 'status'],
    columns: ['title', 'trainer', 'train_date', 'hours', 'location', 'participants', 'status'],
    required: ['title'],
  }),
  evaluation: res('evaluations', {
    searchCols: ['employee_id', 'period', 'grade'],
    columns: ['employee_id', 'period', 'score', 'grade', 'evaluator', 'comments', 'status'],
    required: ['employee_id', 'period'],
  }),
  okr: res('okrs', {
    searchCols: ['employee_id', 'objective', 'status'],
    columns: ['employee_id', 'objective', 'key_results', 'period', 'progress', 'status'],
    required: ['objective'],
  }),
  assets: res('assets', {
    searchCols: ['code', 'name', 'assigned_to', 'status'],
    columns: ['code', 'name', 'category', 'assigned_to', 'assigned_date', 'status', 'note', 'image_url', 'branch_id'],
    required: ['code', 'name'],
  }),
  expenses: res('expense_claims', {
    searchCols: ['employee_id', 'category', 'status'],
    columns: ['employee_id', 'claim_date', 'category', 'amount', 'description', 'status', 'approved_by'],
    required: ['employee_id', 'amount'],
  }),
  benefits: res('benefits_loans', {
    searchCols: ['employee_id', 'name', 'type', 'status'],
    columns: ['employee_id', 'type', 'name', 'amount', 'start_date', 'end_date', 'status', 'note'],
    required: ['employee_id', 'type', 'name'],
  }),
  'social-security': res('social_security', {
    searchCols: ['employee_id', 'sso_number', 'hospital'],
    columns: ['employee_id', 'sso_number', 'hospital', 'registered_date', 'monthly_contribution', 'status'],
    required: ['employee_id'],
  }),
  rooms: res('meeting_rooms', {
    searchCols: ['name', 'status'],
    columns: ['name', 'capacity', 'equipment', 'status'],
    required: ['name'],
  }),
  bookings: res('room_bookings', {
    searchCols: ['title', 'employee_id', 'status'],
    columns: ['room_id', 'employee_id', 'title', 'book_date', 'start_time', 'end_time', 'status'],
    required: ['room_id', 'book_date', 'start_time', 'end_time'],
    orderBy: { col: 'book_date', asc: false },
  }),
  trips: res('company_trips', {
    searchCols: ['title', 'destination', 'status'],
    columns: ['title', 'destination', 'start_date', 'end_date', 'budget', 'participants', 'status'],
    required: ['title'],
  }),
  announcements: res('announcements', {
    searchCols: ['title', 'category', 'author'],
    columns: ['title', 'body', 'category', 'publish_date', 'pinned', 'author'],
    required: ['title'],
  }),
  'document-assets': res('document_assets', {
    searchCols: ['name', 'signer_name', 'signer_title'],
    columns: ['asset_type', 'name', 'signer_name', 'signer_title', 'image_url', 'active', 'note'],
    required: ['asset_type', 'name'],
  }),
  'document-requests': res('document_requests', {
    searchCols: ['employee_id', 'document_type', 'status', 'purpose'],
    columns: ['employee_id', 'document_type', 'purpose', 'status', 'review_note', 'signature_asset_id', 'stamp_asset_id', 'logo_asset_id', 'approved_by', 'approved_at'],
    required: ['employee_id', 'document_type'],
  }),
};
