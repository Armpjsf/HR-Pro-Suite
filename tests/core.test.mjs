import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calcSso,
  progressiveTax,
  calcMonthlyTax,
  deductionBreakdown,
} from '../lib/payroll.js';
import { filterDocumentsByRole } from '../lib/permissions.js';
import { checkRateLimit } from '../lib/rate-limit.js';

test('calcSso calculates SSO deduction using current contribution cap', () => {
  assert.equal(calcSso(0), 0);
  assert.equal(calcSso(10000), 500);
  assert.equal(calcSso(15000), 750);
  assert.equal(calcSso(30000, '2026-11'), 875);
});

test('progressiveTax calculates stepped income tax', () => {
  assert.equal(progressiveTax(0), 0);
  assert.equal(progressiveTax(150000), 0);
  assert.equal(progressiveTax(300000), 7500); // 150,000 * 5%
  assert.equal(progressiveTax(500000), 27500); // 7,500 + 200,000 * 10%
});

test('calcMonthlyTax computes approximate monthly withholding tax', () => {
  // Low income under tax threshold
  const zeroTax = calcMonthlyTax({ monthlySalary: 15000, ssoMonthly: 750 });
  assert.equal(zeroTax, 0);

  // 50,000/mo -> 600,000 annual. Net: 600k - (100k + 60k + 9k) = 431k
  // Tax = 7,500 + 131k * 10% = 20,600 / 12 = 1717
  const higherTax = calcMonthlyTax({ monthlySalary: 50000, ssoMonthly: 750 });
  assert.equal(higherTax, 1717);
});

test('deductionBreakdown returns formatted breakdown list', () => {
  const breakdown = deductionBreakdown(600000, 9000, {
    children: 2,
    life_insurance: 50000,
  });

  const labels = breakdown.map((item) => item.label);
  assert.ok(labels.includes('ค่าใช้จ่าย'));
  assert.ok(labels.includes('ค่าลดหย่อนส่วนตัวของผู้มีเงินได้'));
  assert.ok(labels.some((l) => l.includes('ค่าลดหย่อนบุตร')));
  assert.ok(labels.includes('เบี้ยประกันชีวิต'));
  assert.ok(labels.includes('เงินสะสมกองทุนประกันสังคม'));

  const expenseItem = breakdown.find((item) => item.label === 'ค่าใช้จ่าย');
  assert.equal(expenseItem.amount, 100000); // capped at 100,000
});

test('filterDocumentsByRole enforces role-based and accessRoles filtering', () => {
  const driverOnlyDoc = {
    id: 'doc-driver',
    category: 'driver-manuals',
    accessRoles: ['partner_driver'],
  };
  const policyDoc = {
    id: 'doc-policy',
    category: 'policies',
  };
  const contractDoc = {
    id: 'doc-contract',
    category: 'contracts',
    employeeId: 'EMP001',
  };

  const docs = [driverOnlyDoc, policyDoc, contractDoc];

  // Employee should NOT see partner_driver specific doc, CAN see policies, CAN see own contract
  const empDocs = filterDocumentsByRole(docs, 'employee', 'EMP001');
  assert.equal(empDocs.some((d) => d.id === 'doc-driver'), false);
  assert.equal(empDocs.some((d) => d.id === 'doc-policy'), true);
  assert.equal(empDocs.some((d) => d.id === 'doc-contract'), true);

  // Employee with different ID should NOT see another employee's contract
  const otherEmpDocs = filterDocumentsByRole(docs, 'employee', 'EMP002');
  assert.equal(otherEmpDocs.some((d) => d.id === 'doc-contract'), false);

  // Partner driver CAN see driver manual with accessRoles, but CANNOT see general policies
  const driverDocs = filterDocumentsByRole(docs, 'partner_driver', 'DRV001');
  assert.equal(driverDocs.some((d) => d.id === 'doc-driver'), true);
  assert.equal(driverDocs.some((d) => d.id === 'doc-policy'), false);
  assert.equal(driverDocs.some((d) => d.id === 'doc-contract'), false);
});

test('checkRateLimit allows requests up to limit and blocks on limit + 1', () => {
  const testKey = `test-rl-${Date.now()}-${Math.random()}`;
  const limit = 3;
  const windowMs = 5000;

  // 1st request
  const r1 = checkRateLimit(testKey, limit, windowMs);
  assert.equal(r1.allowed, true);
  assert.equal(r1.remaining, 2);

  // 2nd request
  const r2 = checkRateLimit(testKey, limit, windowMs);
  assert.equal(r2.allowed, true);
  assert.equal(r2.remaining, 1);

  // 3rd request (hits limit)
  const r3 = checkRateLimit(testKey, limit, windowMs);
  assert.equal(r3.allowed, true);
  assert.equal(r3.remaining, 0);

  // 4th request (limit + 1, must be blocked)
  const r4 = checkRateLimit(testKey, limit, windowMs);
  assert.equal(r4.allowed, false);
  assert.equal(r4.remaining, 0);
  assert.ok(r4.retryAfterSec > 0);
});
