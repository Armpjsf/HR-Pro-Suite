import test from 'node:test';
import assert from 'node:assert/strict';

import { effectiveStatus, enrichHalfDayLeaves } from '../lib/work-calendar.js';

test('enrichHalfDayLeaves transforms normal record with half_afternoon leave', () => {
  const timeRows = [
    {
      id: 1,
      employee_id: 'EMP001',
      work_date: '2026-11-20',
      clock_in: '08:00',
      clock_out: '12:00',
      status: 'normal',
      note: '',
    },
  ];
  const halfLeaves = [
    {
      employee_id: 'EMP001',
      leave_type: 'sick',
      session: 'half_afternoon',
      start_date: '2026-11-20',
      end_date: '2026-11-20',
      work_dates: ['2026-11-20'],
    },
  ];

  const result = enrichHalfDayLeaves(timeRows, halfLeaves);
  assert.equal(result[0].status, 'half_leave');
  assert.equal(result[0].note, 'ลาครึ่งบ่าย (sick)');
});

test('enrichHalfDayLeaves preserves existing note on normal record with half_morning leave', () => {
  const timeRows = [
    {
      id: 2,
      employee_id: 'EMP002',
      work_date: '2026-11-20',
      clock_in: '13:00',
      clock_out: '17:00',
      status: 'normal',
      note: 'ออกหน้างาน',
    },
  ];
  const halfLeaves = [
    {
      employee_id: 'EMP002',
      leave_type: 'personal',
      session: 'half_morning',
      start_date: '2026-11-20',
      end_date: '2026-11-20',
    },
  ];

  const result = enrichHalfDayLeaves(timeRows, halfLeaves);
  assert.equal(result[0].status, 'half_leave');
  assert.ok(result[0].note.includes('ลาครึ่งเช้า (personal)'));
  assert.ok(result[0].note.includes('ออกหน้างาน'));
  assert.equal(result[0].note, 'ลาครึ่งเช้า (personal) · ออกหน้างาน');
});

test('enrichHalfDayLeaves prepends มาสาย for late record with half_afternoon leave', () => {
  const timeRows = [
    {
      id: 3,
      employee_id: 'EMP003',
      work_date: '2026-11-20',
      clock_in: '08:30',
      clock_out: '12:00',
      status: 'late',
      note: null,
    },
  ];
  const halfLeaves = [
    {
      employee_id: 'EMP003',
      leave_type: 'annual',
      session: 'half_afternoon',
      start_date: '2026-11-20',
      end_date: '2026-11-20',
      work_dates: ['2026-11-20'],
    },
  ];

  const result = enrichHalfDayLeaves(timeRows, halfLeaves);
  assert.equal(result[0].status, 'half_leave');
  assert.ok(result[0].note.includes('มาสาย'));
  assert.ok(result[0].note.includes('ลาครึ่งบ่าย (annual)'));
  assert.equal(result[0].note, 'มาสาย · ลาครึ่งบ่าย (annual)');
});

test('enrichHalfDayLeaves leaves absent and full leave records unchanged', () => {
  const timeRows = [
    {
      id: 4,
      employee_id: 'EMP004',
      work_date: '2026-11-20',
      clock_in: null,
      clock_out: null,
      status: 'absent',
      note: 'ขาดงาน',
    },
    {
      id: 5,
      employee_id: 'EMP005',
      work_date: '2026-11-20',
      clock_in: null,
      clock_out: null,
      status: 'leave',
      note: 'ลา (sick)',
    },
  ];
  const halfLeaves = [
    {
      employee_id: 'EMP004',
      leave_type: 'sick',
      session: 'half_morning',
      start_date: '2026-11-20',
      end_date: '2026-11-20',
      work_dates: ['2026-11-20'],
    },
    {
      employee_id: 'EMP005',
      leave_type: 'sick',
      session: 'half_afternoon',
      start_date: '2026-11-20',
      end_date: '2026-11-20',
      work_dates: ['2026-11-20'],
    },
  ];

  const result = enrichHalfDayLeaves(timeRows, halfLeaves);
  assert.deepEqual(result[0], timeRows[0]);
  assert.deepEqual(result[1], timeRows[1]);
});

test('effectiveStatus preserves half_leave status', () => {
  const ws = { standard_in: '08:00', late_grace_min: 15 };
  assert.equal(effectiveStatus({ status: 'half_leave', clock_in: '08:30' }, ws), 'half_leave');
  assert.equal(effectiveStatus({ status: 'half_leave', clock_in: null }, ws), 'half_leave');
});
