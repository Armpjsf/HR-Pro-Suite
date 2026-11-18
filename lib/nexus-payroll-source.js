import { validateTmsUrl } from './tms-earnings-mapper.js';
import { isValidPeriod } from './payroll.js';
import { PayrollImportError } from './payroll-tms-import.js';

function configuration() {
  const url = process.env.NEXUS_TMS_URL;
  const key = process.env.NEXUS_TMS_API_KEY;
  const connectionId = process.env.NEXUS_TMS_CONNECTION_ID;
  if (!url || !key || !connectionId) throw new PayrollImportError('ยังไม่ได้ตั้งค่าการเชื่อมต่อ Nexus TMS กรุณาให้ผู้ดูแลตั้งค่า URL, API key และ connection ID', 'TMS_NOT_CONFIGURED', 503);
  const validation = validateTmsUrl(url);
  if (!validation.valid) throw new PayrollImportError('URL ของ Nexus TMS ไม่ถูกต้อง', 'INVALID_TMS_URL', 503);
  return { url: url.replace(/\/$/, ''), key, connectionId };
}

async function call(path, body) {
  const config = configuration();
  let response;
  try {
    response = await fetch(`${config.url}/api/external/v2/driver-earning-lines${path}`, {
      method: body ? 'POST' : 'GET', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: { Authorization: `Bearer ${config.key}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch { throw new PayrollImportError('ติดต่อ Nexus TMS ไม่สำเร็จ กรุณาลองใหม่', 'TMS_UNAVAILABLE', 503); }
  if (!response.ok) throw new PayrollImportError('Nexus TMS ปฏิเสธรายการ กรุณาตรวจสิทธิ์หรือดึงข้อมูลใหม่ก่อนตรวจยอด', 'TMS_SOURCE_CONFLICT', response.status === 409 ? 409 : 503);
  return { data: await response.json(), config };
}

export async function fetchNexusPayrollLines(tenantId, period) {
  if (!isValidPeriod(period)) throw new PayrollImportError('กรุณาระบุงวด YYYY-MM', 'INVALID_PERIOD', 400);
  const { data, config } = await call(`?period=${encodeURIComponent(period)}`);
  if (data.version !== 2 || data.tenantId !== tenantId || data.connectionId !== config.connectionId || data.period !== period || !Array.isArray(data.lines)) {
    throw new PayrollImportError('ข้อมูล TMS ไม่ตรงบริษัท การเชื่อมต่อ หรืองวดที่ร้องขอ', 'TMS_SCOPE_MISMATCH', 409);
  }
  for (const line of data.lines) {
    const date = new Date(line.verified_at);
    const localPeriod = Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit' }).format(date) : '';
    if (!line.earning_line_id || !line.job_id || !line.driver_id || !Number.isSafeInteger(line.revision) || line.revision < 1 ||
        !Number.isSafeInteger(line.amount_minor) || line.amount_minor < 0 || line.currency !== 'THB' ||
        !['hr_payroll', 'tms_paid'].includes(line.payment_owner) || localPeriod !== period) {
      throw new PayrollImportError('ข้อมูลรายเที่ยวไม่ครบหรือไม่ได้ตรวจรับในงวดนี้ กรุณาตรวจใน TMS', 'INVALID_SOURCE_LINE', 409);
    }
  }
  return { lines: data.lines, connectionId: config.connectionId };
}

export async function claimNexusPayrollBatch(tenantId, batch) {
  if (!batch || batch.status !== 'approved') throw new PayrollImportError('ต้องอนุมัติชุดนำเข้าก่อนลงสลิป', 'INVALID_STATE', 409);
  const source = await fetchNexusPayrollLines(tenantId, batch.period);
  if (source.connectionId !== batch.connectionId) throw new PayrollImportError('การเชื่อมต่อไม่ตรงกับชุดนำเข้า', 'TMS_SCOPE_MISMATCH', 409);
  const current = new Map(source.lines.map(line => [line.earning_line_id, line]));
  const payable = batch.lines.filter(line => ['imported_payable', 'imported_revision_delta'].includes(line.disposition));
  for (const line of payable) {
    const fresh = current.get(line.sourceEarningLineId);
    if (!fresh || fresh.revision !== line.sourceRevision || fresh.job_id !== line.jobId || fresh.driver_id !== line.tmsDriverId || fresh.amount_minor !== line.amountMinor || fresh.payment_owner !== 'hr_payroll') {
      throw new PayrollImportError('ค่าเที่ยวเปลี่ยนหลังตรวจยอด กรุณายกเลิกชุดนี้แล้วดึงข้อมูลใหม่', 'TMS_SOURCE_CONFLICT', 409);
    }
  }
  if (payable.length) await call('/claim', { lines: payable.map(line => ({ job_id: line.jobId, driver_id: line.tmsDriverId, revision: line.sourceRevision, amount_minor: line.amountMinor })) });
}
