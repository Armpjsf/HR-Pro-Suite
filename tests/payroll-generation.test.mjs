import test from 'node:test';
import assert from 'node:assert/strict';
import { selectPayrollRecords } from '../lib/payroll-generation.js';

test('trip-only employee can be recalculated while inactive and empty zero-salary profiles are excluded', () => {
  const records = [
    { employee_id: '2502', salary: 0 },
    { employee_id: 'SALARY', salary: 3500 },
    { employee_id: 'EMPTY', salary: 0 },
    { employee_id: 'INACTIVE', salary: 0 },
  ];
  const users = records.map(r => ({ employee_id: r.employee_id, status: r.employee_id === 'INACTIVE' ? 'inactive' : 'active' }));
  const slips = [{ employee_id: '2502', driving_pay: '600.00' }, { employee_id: 'INACTIVE', driving_pay: 600 }];
  assert.deepEqual(selectPayrollRecords(records, users, slips).map(r => r.employee_id), ['2502', 'SALARY']);
  assert.deepEqual(selectPayrollRecords([], users, slips), []);
});
