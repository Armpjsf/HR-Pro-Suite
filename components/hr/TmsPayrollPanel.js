'use client';

import { useEffect, useState } from 'react';
import { authHeaders } from './exportUtils';
import { confirmDialog } from '@/components/ui/ConfirmDialog';
import styles from './TmsPayrollPanel.module.css';

const money = value => Number(value || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const stateLabels = { draft: 'ร่าง', reviewed: 'ตรวจยอดแล้ว', approved: 'อนุมัติแล้ว', posted: 'ลงสลิปแล้ว', reversed: 'ยกเลิกแล้ว' };
const dispositionLabels = { imported_payable: 'นำเข้าได้', imported_revision_delta: 'ส่วนต่างค่าเที่ยว', duplicate_skipped: 'ซ้ำ — ข้าม', excluded_subcontractor: 'ผู้รับเหมาช่วง', excluded_already_paid_in_tms: 'จัดจ่ายใน TMS แล้ว', unmapped_or_inactive_hold: 'พักรอจับคู่/ตรวจพนักงาน', prior_period_adjustment_required: 'พักรอตรวจงวดเดิม' };

async function api(url, body) {
  const response = await fetch(url, { headers: authHeaders(!!body), ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'ดำเนินการไม่สำเร็จ กรุณาลองใหม่');
  return result;
}

export default function TmsPayrollPanel({ onPayrollChange }) {
  const [period, setPeriod] = useState(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }).slice(0, 7));
  const [batches, setBatches] = useState([]);
  const [batch, setBatch] = useState(null);
  const [preview, setPreview] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [mapping, setMapping] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [reason, setReason] = useState('');

  useEffect(() => {
    let live = true;
    Promise.all([api('/api/hr/payroll/tms-import'), api('/api/hr/employees')])
      .then(([imports, staff]) => { if (live) { setBatches(imports.batches || []); setEmployees(staff.employees || []); } })
      .catch(err => { if (live) setError(err.message); });
    return () => { live = false; };
  }, []);

  async function run(task) {
    setBusy(true); setError(''); setMessage('');
    try { await task(); } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  async function refresh() { setBatches((await api('/api/hr/payroll/tms-import')).batches || []); }
  async function action(name) {
    if (name === 'post' && !(await confirmDialog({ title: 'ลงค่าเที่ยวในสลิป?', message: `งวด ${batch.period} รวม ${money(batch.reconciliation.importedPayableMinor / 100)} บาท เมื่อจองรายการแล้วต้องชำระค่าเที่ยวผ่าน HR`, confirmLabel: 'ลงสลิป' }))) return;
    await run(async () => {
      const result = await api('/api/hr/payroll/tms-import', { action: name, batchId: batch.id, reason });
      setBatch(result.batch); await refresh();
      if (name === 'post' || name === 'reverse') { onPayrollChange(); setMessage('คำนวณเงินเดือนใหม่ก่อนตรวจสลิปและยืนยันจ่าย'); }
    });
  }
  const drivers = [...new Map((preview?.lines || []).filter(line => line.payment_owner === 'hr_payroll' && line.employment_type !== 'subcontractor').map(line => [line.driver_id, line])).values()];
  const reconciliation = batch?.reconciliation;
  return <section className={styles.panel} aria-labelledby="tms-payroll-title" aria-busy={busy}>
    <h2 id="tms-payroll-title">ค่าเที่ยวจาก Nexus TMS</h2>
    <p>เงินเดือนงานประจำและค่าเที่ยวอยู่ในสลิปพนักงานคนเดิม ค่าเที่ยวจะแยกจากโบนัส โดยนับตามวันที่ตรวจรับงานใน TMS</p>
    <div className={styles.toolbar}>
      <label>งวดค่าเที่ยว<input type="month" value={period} disabled={busy} onChange={e => { setPeriod(e.target.value); setPreview(null); setBatch(null); }} /></label>
      <button className="hr-btn" disabled={busy || !period} onClick={() => run(async () => { setPreview(await api(`/api/hr/payroll/tms-import?period=${encodeURIComponent(period)}`)); setBatch(null); })}>{busy ? 'กำลังดำเนินการ…' : 'ดึงรายเที่ยวเพื่อตรวจสอบ'}</button>
      <label>ชุดนำเข้าที่บันทึกไว้<select disabled={busy} value={batch?.id || ''} onChange={e => { const id = e.target.value; if (id) run(async () => { setBatch((await api(`/api/hr/payroll/tms-import?batchId=${encodeURIComponent(id)}`)).batch); setPreview(null); }); }}><option value="">เลือกชุดนำเข้า</option>{batches.filter(item => item.period === period).map(item => <option key={item.id} value={item.id}>{stateLabels[item.status]} · {item.id}</option>)}</select></label>
    </div>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {message && <p role="status">{message}</p>}
    {preview && <>
      <p>พบ {preview.lines.length} รายเที่ยว ตรวจจับคู่รหัสคนขับกับพนักงานก่อนสร้างชุดนำเข้า พนักงานยังใช้แผนกและตำแหน่งงานเดิม</p>
      {drivers.length > 0 && <div className={styles.scroll}><table><caption>จับคู่คนขับกับพนักงาน HR</caption><thead><tr><th scope="col">คนขับ TMS</th><th scope="col">พนักงาน HR</th><th scope="col">ยืนยันตัวตน</th></tr></thead><tbody>{drivers.map(driver => {
        const existing = preview.links?.find(link => link.tmsDriverId === driver.driver_id && link.active);
        return <tr key={driver.driver_id}><td>{driver.driver_name || driver.driver_id}<small>{driver.driver_id}</small></td><td><select aria-label={`พนักงานสำหรับ ${driver.driver_id}`} disabled={busy} value={mapping[driver.driver_id] ?? existing?.hrEmployeeId ?? ''} onChange={e => setMapping({ ...mapping, [driver.driver_id]: e.target.value })}><option value="">ยังไม่จับคู่ — พักรายการ</option>{employees.filter(emp => emp.status === 'active').map(emp => <option key={emp.employeeId} value={emp.employeeId}>{emp.employeeId} · {emp.name} {emp.department ? `(${emp.department})` : ''}</option>)}</select></td><td><button className="hr-btn" disabled={busy || !mapping[driver.driver_id]} onClick={() => run(async () => { await api('/api/hr/driver-links', { tmsDriverId: driver.driver_id, hrEmployeeId: mapping[driver.driver_id], connectionId: preview.connectionId, employmentClassification: 'employee', effectiveFrom: `${period}-01` }); setPreview(await api(`/api/hr/payroll/tms-import?period=${period}`)); setMessage('บันทึกการจับคู่แล้ว'); })}>บันทึกการจับคู่</button></td></tr>;
      })}</tbody></table></div>}
      {preview.lines.length > 0 ? <button className="hr-btn hr-btn-primary" disabled={busy} onClick={() => run(async () => { const result = await api('/api/hr/payroll/tms-import', { action: 'fetch_draft', period }); setBatch(result.batch); setPreview(null); await refresh(); })}>สร้างชุดนำเข้าเพื่อตรวจยอด</button> : <p>ยังไม่มีงานที่ตรวจรับในงวดนี้ ตรวจวันที่ตรวจรับใน TMS แล้วดึงข้อมูลใหม่</p>}
    </>}
    {batch && <>
      <h3>งวด {batch.period} · {stateLabels[batch.status]}</h3>
      <p className={styles.reference}>{batch.id}</p>
      <dl className={styles.totals}>{[['ยอดจาก TMS', reconciliation.sourceTotalMinor], ['ลงค่าเที่ยวใน HR', reconciliation.importedPayableMinor], ['พักรอตรวจ', reconciliation.unmappedHoldMinor], ['จัดจ่ายใน TMS แล้ว', reconciliation.excludedTmsPaidMinor], ['ผู้รับเหมาช่วง', reconciliation.excludedSubcontractorMinor], ['ยอดซ้ำ/ฐานรุ่นก่อน', reconciliation.duplicateSkippedMinor]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{money(value / 100)} บาท</dd></div>)}</dl>
      <div className={styles.scroll}><table><caption>รายละเอียดรายเที่ยวและผลตรวจ</caption><thead><tr>{['งาน / รุ่น', 'คนขับ / พนักงาน', 'ยอด TMS', 'ลงสลิป', 'ผลตรวจ'].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{batch.lines.map((line, index) => <tr key={`${line.sourceEarningLineId}-${index}`}><td>{line.jobId}<small>รุ่น {line.sourceRevision}</small></td><td>{line.tmsDriverId}<small>{line.hrEmployeeId || 'ยังไม่จับคู่'}</small></td><td className={styles.number}>{money(line.amountDecimal)}</td><td className={styles.number}>{money(line.payableMinor / 100)}</td><td>{dispositionLabels[line.disposition] || line.disposition}{line.reason && <small>{line.reason}</small>}</td></tr>)}</tbody></table></div>
      <div className={styles.toolbar}>
        {batch.status === 'draft' && <button className="hr-btn hr-btn-primary" disabled={busy} onClick={() => action('review')}>ยืนยันตรวจยอดแล้ว</button>}
        {batch.status === 'reviewed' && <button className="hr-btn hr-btn-primary" disabled={busy} onClick={() => action('approve')}>อนุมัติค่าเที่ยว</button>}
        {batch.status === 'approved' && <button className="hr-btn hr-btn-primary" disabled={busy} onClick={() => action('post')}>ลงค่าเที่ยวในสลิป</button>}
        {batch.status !== 'reversed' && <><label>เหตุผลยกเลิกชุด<input value={reason} disabled={busy} onChange={e => setReason(e.target.value)} placeholder="ระบุเหตุผลเพื่อบันทึกประวัติ" /></label><button className="hr-btn" disabled={busy || !reason.trim()} onClick={() => action('reverse')}>ยกเลิกชุดนำเข้า</button></>}
        {['posted', 'reversed'].includes(batch.status) && <button className="hr-btn" disabled={busy} onClick={() => run(async () => { const result = await api('/api/hr/payroll/generate', { period: batch.period, overwrite: true }); onPayrollChange(); setMessage(`คำนวณใหม่แล้ว ${result.updated} ใบ กรุณาตรวจสลิปก่อนยืนยันจ่าย`); })}>คำนวณเงินเดือนใหม่</button>}
      </div>
      {reconciliation.unmappedHoldMinor > 0 && <p>รายการพักยังไม่ลงสลิป หากแก้การจับคู่แล้วให้ยกเลิกชุดที่ยังไม่จ่ายและสร้างชุดใหม่ รายการที่ลงสลิปแล้วต้องตรวจประวัติการกลับรายการก่อน</p>}
    </>}
  </section>;
}
