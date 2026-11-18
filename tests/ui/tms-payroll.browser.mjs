// Optional browser verification. Every API request is intercepted; no business data is accessed.
// PLAYWRIGHT_MODULE may point to an externally installed Playwright index.mjs.
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, executablePath: process.env.UI_BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const employee = { employeeId: 'EMP-W1', name: 'พนักงานคลังทดสอบ', department: 'คลังสินค้า', status: 'active' };
const sourceLine = { earning_line_id: 'job:J1:driver', job_id: 'J1', revision: 1, driver_id: 'DRV1', driver_name: 'พนักงานคลังทดสอบ', amount_minor: 125000, payment_owner: 'hr_payroll', employment_type: 'employee' };
const batch = { id: 'UI-TEST-BATCH', period: '2026-11', status: 'draft', reconciliation: { sourceTotalMinor: 125000, importedPayableMinor: 125000, unmappedHoldMinor: 0, excludedTmsPaidMinor: 0, excludedSubcontractorMinor: 0, duplicateSkippedMinor: 0 }, lines: [{ sourceEarningLineId: sourceLine.earning_line_id, sourceRevision: 1, jobId: 'J1', tmsDriverId: 'DRV1', hrEmployeeId: 'EMP-W1', amountDecimal: 1250, payableMinor: 125000, disposition: 'imported_payable' }] };
let linked = false;
let generated = false;
let previewMode = 'normal';
let created = false;
const seen = [];
await page.addInitScript(() => localStorage.setItem('hr-user', JSON.stringify({ id: 'UI-HR', name: 'HR ทดสอบ', role: 'admin' })));
await page.route('**/*', async route => {
  const url = new URL(route.request().url());
  if (url.hostname !== 'localhost') return route.abort();
  if (!url.pathname.startsWith('/api/')) return route.continue();
  const request = route.request();
  const body = request.method() === 'POST' ? request.postDataJSON() : null;
  seen.push({ path: url.pathname, body });
  let data = {};
  if (url.pathname === '/api/hr/access') data = { isAdmin: true, role: 'admin', allowed: '__all__' };
  else if (url.pathname === '/api/company/public') data = { displayName: 'HR ทดสอบ' };
  else if (url.pathname === '/api/hr/employees') data = { employees: [employee] };
  else if (url.pathname === '/api/hr/driver-links') { assert.equal(body.hrEmployeeId, 'EMP-W1'); linked = true; data = { success: true }; }
  else if (url.pathname === '/api/hr/payroll/tms-import') {
    if (body) {
      if (body.action === 'fetch_draft') { assert.equal(body.period, '2026-11'); created = true; data = { batch }; }
      else { batch.status = ({ review: 'reviewed', approve: 'approved', post: 'posted', reverse: 'reversed' })[body.action]; data = { batch }; }
    } else if (url.searchParams.has('period')) {
      if (previewMode === 'error') return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'ติดต่อ Nexus TMS ไม่สำเร็จ กรุณาลองใหม่' }) });
      data = { connectionId: 'conn-ui', lines: previewMode === 'empty' ? [] : [sourceLine], links: linked ? [{ tmsDriverId: 'DRV1', hrEmployeeId: 'EMP-W1', active: true }] : [] };
    } else data = { batches: created ? [batch] : [] };
  } else if (url.pathname === '/api/hr/payroll/generate') { generated = true; data = { updated: 1, created: 0, skipped: 0 }; }
  else if (url.pathname === '/api/hr/payroll' || url.pathname === '/api/hr/branches') data = { items: [] };
  else if (url.pathname === '/api/notifications') data = { notifications: [], unreadCount: 0 };
  else if (url.pathname === '/api/push/public-key') data = { configured: false };
  else throw new Error(`Unexpected API request: ${url.pathname}`);
  return route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
});
try {
  await page.goto('http://localhost:3137/hr/payroll');
  const panel = page.getByRole('region', { name: 'ค่าเที่ยวจาก Nexus TMS' });
  await panel.waitFor();
  await panel.getByLabel('งวดค่าเที่ยว').fill('2026-11');
  await panel.getByRole('button', { name: 'ดึงรายเที่ยวเพื่อตรวจสอบ' }).click();
  await panel.getByLabel('พนักงานสำหรับ DRV1').selectOption('EMP-W1');
  await panel.getByRole('button', { name: 'บันทึกการจับคู่' }).click();
  await panel.getByRole('status').filter({ hasText: 'บันทึกการจับคู่แล้ว' }).waitFor();
  await panel.getByRole('button', { name: 'สร้างชุดนำเข้าเพื่อตรวจยอด' }).click();
  await panel.getByRole('button', { name: 'ยืนยันตรวจยอดแล้ว' }).click();
  await panel.getByRole('button', { name: 'อนุมัติค่าเที่ยว' }).click();
  await panel.getByRole('button', { name: 'ลงค่าเที่ยวในสลิป' }).click();
  await page.getByRole('button', { name: 'ลงสลิป', exact: true }).click();
  await panel.getByRole('heading', { name: 'งวด 2026-11 · ลงสลิปแล้ว' }).waitFor();
  await panel.getByRole('button', { name: 'คำนวณเงินเดือนใหม่' }).click();
  await panel.getByRole('status').filter({ hasText: 'คำนวณใหม่แล้ว' }).waitFor();
  assert.ok(generated);
  const desktopPath = path.join(os.tmpdir(), 'hr-tms-payroll-desktop.png');
  await panel.screenshot({ path: desktopPath });
  await page.setViewportSize({ width: 390, height: 844 });
  const mobilePath = path.join(os.tmpdir(), 'hr-tms-payroll-mobile.png');
  await panel.screenshot({ path: mobilePath });
  const dimensions = await panel.evaluate(element => ({ width: element.getBoundingClientRect().width, scroll: element.scrollWidth, client: element.clientWidth }));
  assert.ok(dimensions.width <= 390 && dimensions.scroll <= dimensions.client + 1, 'Panel must fit a phone without horizontal page overflow');
  previewMode = 'error';
  await panel.getByRole('button', { name: 'ดึงรายเที่ยวเพื่อตรวจสอบ' }).click();
  await panel.getByRole('alert').filter({ hasText: 'ติดต่อ Nexus TMS ไม่สำเร็จ' }).waitFor();
  previewMode = 'empty';
  await panel.getByRole('button', { name: 'ดึงรายเที่ยวเพื่อตรวจสอบ' }).click();
  await panel.getByText('ยังไม่มีงานที่ตรวจรับในงวดนี้', { exact: false }).waitFor();
  assert.equal(await panel.getByRole('alert').count(), 0, 'Successful retry clears the previous connection error');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ success: true, actions: seen.filter(item => item.body).map(item => item.body.action || item.path), desktopPath, mobilePath }));
} catch (error) { console.error(JSON.stringify({ url:page.url(), errors, text:(await page.locator('body').innerText()).slice(0,2500), seen })); throw error; } finally { await browser.close(); }
