import test from 'node:test';
import assert from 'node:assert/strict';
import { computeWorkDaysByEmployee, isUnpaidLeaveType } from '../lib/payroll-generation.js';

test('daily employee with normal status and clock_in and no leave gets 1 workDay', () => {
  const timeRows = [
    { employee_id: 'D001', work_date: '2026-11-20', status: 'normal', clock_in: '08:00' },
  ];
  const { workDaysMap, absentDaysMap } = computeWorkDaysByEmployee(timeRows, []);
  assert.equal(workDaysMap.get('D001'), 1);
  assert.equal(absentDaysMap.get('D001') || 0, 0);
});

test('daily employee with normal + clock_in and approved half_afternoon paid sick leave gets 0.5 workDays', () => {
  const timeRows = [
    { employee_id: 'D002', work_date: '2026-11-20', status: 'normal', clock_in: '08:00' },
  ];
  const leaveRows = [
    {
      employee_id: 'D002',
      leave_type: 'sick',
      session: 'half_afternoon',
      status: 'approved',
      start_date: '2026-11-20',
      work_dates: ['2026-11-20'],
    },
  ];
  const { workDaysMap, absentDaysMap } = computeWorkDaysByEmployee(timeRows, leaveRows);
  assert.equal(workDaysMap.get('D002'), 0.5);
  assert.equal(absentDaysMap.get('D002') || 0, 0);
});

test('daily employee with late + clock_in and approved half_morning leave gets 0.5 workDays', () => {
  const timeRows = [
    { employee_id: 'D003', work_date: '2026-11-20', status: 'late', clock_in: '13:15' },
  ];
  const leaveRows = [
    {
      employee_id: 'D003',
      leave_type: 'personal',
      session: 'half_morning',
      start_date: '2026-11-20',
    },
  ];
  const { workDaysMap, absentDaysMap } = computeWorkDaysByEmployee(timeRows, leaveRows);
  assert.equal(workDaysMap.get('D003'), 0.5);
  assert.equal(absentDaysMap.get('D003') || 0, 0);
});

test('daily employee with status half_leave and no clock_in gets 0.5 workDays', () => {
  const timeRows = [
    { employee_id: 'D004', work_date: '2026-11-20', status: 'half_leave', clock_in: null },
  ];
  const { workDaysMap, absentDaysMap } = computeWorkDaysByEmployee(timeRows, []);
  assert.equal(workDaysMap.get('D004'), 0.5);
  assert.equal(absentDaysMap.get('D004') || 0, 0);
});

test('daily employee with status leave (full-day leave) gets 0 workDays and 0 absentDays', () => {
  const timeRows = [
    { employee_id: 'D005', work_date: '2026-11-20', status: 'leave', clock_in: null },
  ];
  const { workDaysMap, absentDaysMap } = computeWorkDaysByEmployee(timeRows, []);
  assert.equal(workDaysMap.get('D005') || 0, 0);
  assert.equal(absentDaysMap.get('D005') || 0, 0);
});

test('daily employee with status absent gets 0 workDays and 1 absentDays', () => {
  const timeRows = [
    { employee_id: 'D006', work_date: '2026-11-20', status: 'absent', clock_in: null },
  ];
  const { workDaysMap, absentDaysMap } = computeWorkDaysByEmployee(timeRows, []);
  assert.equal(workDaysMap.get('D006') || 0, 0);
  assert.equal(absentDaysMap.get('D006'), 1);
});

test('duplicate time rows on a half-day leave date are not double-counted and unapproved leaves are ignored', () => {
  const timeRows = [
    { employee_id: 'D007', work_date: '2026-11-20', status: 'normal', clock_in: '08:00' },
    { employee_id: 'D007', work_date: '2026-11-20', status: 'half_leave', clock_in: '08:00' },
    { employee_id: 'D008', work_date: '2026-11-20', status: 'normal', clock_in: '08:00' },
  ];
  const leaveRows = [
    {
      employee_id: 'D007',
      leave_type: 'sick',
      session: 'half_afternoon',
      status: 'approved',
      work_dates: ['2026-11-20'],
    },
    {
      employee_id: 'D008',
      leave_type: 'sick',
      session: 'half_afternoon',
      status: 'pending',
      work_dates: ['2026-11-20'],
    },
  ];
  const { workDaysMap } = computeWorkDaysByEmployee(timeRows, leaveRows);
  assert.equal(workDaysMap.get('D007'), 0.5);
  assert.equal(workDaysMap.get('D008'), 1);
});

test('isUnpaidLeaveType flags paid === false or name containing ไม่รับค่าจ้าง', () => {
  assert.equal(isUnpaidLeaveType({ code: 'lwp', name: 'Leave Without Pay', paid: false }), true);
  assert.equal(isUnpaidLeaveType({ code: 'custom', name: 'ลากิจไม่รับค่าจ้าง', paid: true }), true);
  assert.equal(isUnpaidLeaveType({ code: 'sick', name: 'ลาป่วย', paid: true }), false);
  assert.equal(isUnpaidLeaveType(null), false);
});
