'use client';

import { useState } from 'react';
import ResourceTable from '@/components/hr/ResourceTable';
import { authHeaders } from '@/components/hr/exportUtils';
import { confirmDialog } from '@/components/ui/ConfirmDialog';
import { COMPANY } from '@/lib/company';

const baht = (v) => Number(v || 0).toLocaleString('th-TH') + ' ฿';
const num = (v) => Number(v || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function PayrollPage() {
  const [viewSlip, setViewSlip] = useState(null);
  const [showGenModal, setShowGenModal] = useState(false);
  const [genPeriod, setGenPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [genOverwrite, setGenOverwrite] = useState(false);
  const [genLoading, setGenLoading] = useState(false);
  const [genFailures, setGenFailures] = useState([]);

  const [showBatchModal, setShowBatchModal] = useState(false);
  const [batchPeriod, setBatchPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [batchLoading, setBatchLoading] = useState(false);

  const [showTmsModal, setShowTmsModal] = useState(false);
  const [tmsFrom, setTmsFrom] = useState(`${new Date().toISOString().slice(0, 7)}-01`);
  const [tmsTo, setTmsTo] = useState(() => {
    const period = new Date().toISOString().slice(0, 7);
    const [y, m] = period.split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    return `${period}-${String(lastDay).padStart(2, '0')}`;
  });
  const [tmsLoading, setTmsLoading] = useState(false);
  const [tmsResult, setTmsResult] = useState(null);

  const [toast, setToast] = useState(null);
  const [payrollStats, setPayrollStats] = useState({ totalNet: 0, totalTax: 0, totalSso: 0, count: 0, paidCount: 0 });

  function showToast(message, type = 'success') {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  }

  async function fetchTmsEarnings(fromDate = tmsFrom, toDate = tmsTo) {
    setTmsLoading(true);
    try {
      const res = await fetch(`/api/hr/payroll/tms-earnings?from=${encodeURIComponent(fromDate)}&to=${encodeURIComponent(toDate)}`, {
        headers: authHeaders(),
      });
      const d = await res.json();
      setTmsResult(d);
    } catch (err) {
      setTmsResult({
        configured: false,
        error: `เชื่อมต่อกับ API ภายในไม่สำเร็จ: ${err.message}`,
        earnings: [],
      });
    } finally {
      setTmsLoading(false);
    }
  }

  function handleOpenTmsModal() {
    setShowTmsModal(true);
    if (!tmsResult) {
      fetchTmsEarnings(tmsFrom, tmsTo);
    }
  }

  const handleItemsChange = (items) => {
    if (!items || !items.length) {
      setPayrollStats({ totalNet: 0, totalTax: 0, totalSso: 0, count: 0, paidCount: 0 });
      return;
    }
    const totalNet = items.reduce((acc, curr) => acc + (Number(curr.net) || 0), 0);
    const totalTax = items.reduce((acc, curr) => acc + (Number(curr.tax) || 0), 0);
    const totalSso = items.reduce((acc, curr) => acc + (Number(curr.sso) || 0), 0);
    const paidCount = items.filter((x) => x.status === 'paid').length;
    setPayrollStats({ totalNet, totalTax, totalSso, count: items.length, paidCount });
  };

  async function handleGeneratePayroll(e) {
    e.preventDefault();
    setGenFailures([]);
    setGenLoading(true);
    try {
      const res = await fetch('/api/hr/payroll/generate', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({ period: genPeriod, overwrite: genOverwrite }),
      });
      const d = await res.json();
      setGenFailures(d.failed || []);
      if (res.ok) {
        showToast(`คำนวณสลิปงวด ${d.period} สำเร็จ (ใหม่ ${d.created} · อัปเดต ${d.updated} · ข้าม ${d.skipped})`);
        setShowGenModal(false);
        setTimeout(() => window.location.reload(), 1200);
      } else {
        showToast(d.error || 'สร้างไม่สำเร็จ', 'error');
      }
    } catch {
      showToast('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์', 'error');
    } finally {
      setGenLoading(false);
    }
  }

  async function handleConfirmBatchPay(e) {
    e.preventDefault();
    setBatchLoading(true);
    try {
      const res = await fetch('/api/hr/payroll/confirm-pay', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({ period: batchPeriod }),
      });
      const d = await res.json();
      if (res.ok) {
        showToast(`✅ ยืนยันจ่ายงวด ${batchPeriod} สำเร็จ (${d.count} คน | In-App: ${d.inAppSentCount} | LINE: ${d.lineSentCount})`);
        setShowBatchModal(false);
        setTimeout(() => window.location.reload(), 1200);
      } else {
        showToast(d.error || 'ยืนยันการจ่ายไม่สำเร็จ', 'error');
      }
    } catch {
      showToast('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์', 'error');
    } finally {
      setBatchLoading(false);
    }
  }

  async function confirmIndividualPay(row, reload, showToast) {
    const ok = await confirmDialog({
      title: `ยืนยันจ่ายเงินเดือนงวด ${row.period}?`,
      message: `พนักงาน: ${row.employee_id}\nยอดสุทธิ: ${baht(row.net)}\n\nระบบจะออกสลิปเงินเดือนทางการและส่งแจ้งเตือนให้พนักงานทันที`,
      confirmLabel: 'ยืนยันการจ่าย',
    });
    if (!ok) return;
    try {
      const res = await fetch('/api/hr/payroll/confirm-pay', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({ slipId: row.id }),
      });
      const d = await res.json();
      if (res.ok) {
        showToast(`ยืนยันจ่ายเงินเดือนและออกสลิปของ ${row.employee_id} แล้ว`);
        reload();
      } else {
        showToast(d.error || 'ดำเนินการไม่สำเร็จ', 'error');
      }
    } catch {
      showToast('เชื่อมต่อเซิร์ฟเวอร์ล้มเหลว', 'error');
    }
  }

  async function notifyLine(row, reload, showToast) {
    const ok = await confirmDialog({
      title: 'ส่งสลิปเงินเดือนทาง LINE?',
      message: `ต้องการส่งสลิปงวด ${row.period} ของ ${row.employee_id} ให้พนักงานทาง LINE ใช่หรือไม่?`,
      confirmLabel: 'ส่งสลิป',
    });
    if (!ok) return;
    const res = await fetch(`/api/hr/payroll/${row.id}/notify`, {
      method: 'POST',
      headers: authHeaders(true),
    });
    const data = await res.json();
    if (res.ok) { showToast('ส่งสลิปทาง LINE แล้ว'); reload(); }
    else showToast(data.error || 'ส่งไม่สำเร็จ', 'error');
  }

  return (
    <>
      {/* iOS Widget Stats for Payroll */}
      <div className="hr-stat-row" style={{ marginBottom: 16 }}>
        <div className="hr-stat-card">
          <div className="hr-stat-icon" style={{ '--sq': '#34C759' }}>💰</div>
          <div>
            <div className="hr-stat-value">{baht(payrollStats.totalNet)}</div>
            <div className="hr-stat-label">ยอดเงินเดือนสุทธิรวม</div>
          </div>
        </div>
        <div className="hr-stat-card">
          <div className="hr-stat-icon" style={{ '--sq': '#007AFF' }}>📑</div>
          <div>
            <div className="hr-stat-value">{payrollStats.paidCount} / {payrollStats.count} <small style={{ fontSize: 13, fontWeight: 500, color: 'var(--hr-text-3)' }}>คน</small></div>
            <div className="hr-stat-label">จ่ายเงินเดือนสำเร็จแล้ว</div>
          </div>
        </div>
        <div className="hr-stat-card">
          <div className="hr-stat-icon" style={{ '--sq': '#FF9500' }}>🏥</div>
          <div>
            <div className="hr-stat-value">{baht(payrollStats.totalSso)}</div>
            <div className="hr-stat-label">เงินสมทบประกันสังคมรวม</div>
          </div>
        </div>
        <div className="hr-stat-card">
          <div className="hr-stat-icon" style={{ '--sq': '#5856D6' }}>🏛️</div>
          <div>
            <div className="hr-stat-value">{baht(payrollStats.totalTax)}</div>
            <div className="hr-stat-label">ภาษีหัก ณ ที่จ่ายรวม</div>
          </div>
        </div>
      </div>

      <ResourceTable
        config={{
          resource: 'payroll',
        canDelete: false,
          exportName: 'payroll_slips',
          searchPlaceholder: 'ค้นหารหัส/ชื่อพนักงาน/งวด...',
          onItemsChange: handleItemsChange,
          headerExtra: (
            <div className="hr-toolbar" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: 12 }}>
              <button className="hr-btn" onClick={() => setShowGenModal(true)}>
                <span>⚙️</span> คำนวณเงินเดือนอัตโนมัติ
              </button>
              <button
                className="hr-btn hr-btn-primary"
                style={{ background: 'var(--hr-green)', borderColor: 'transparent' }}
                onClick={() => setShowBatchModal(true)}
              >
                <span>💳</span> ยืนยันจ่ายเงินเดือนทั้งงวด (ออกสลิป & แจ้งเตือน Auto)
              </button>
              <button
                className="hr-btn"
                onClick={handleOpenTmsModal}
                style={{ borderColor: '#007aff', color: '#007aff' }}
                title="ดึงยอดค่าเที่ยวคนขับจาก Nexus TMS เพื่อใช้อ้างอิงทำเงินเดือน"
              >
                <span>🔄</span> ดึงยอดค่าเที่ยวจาก Nexus TMS
              </button>
              <button
                className="hr-btn"
                onClick={() => window.open(`/api/hr/payroll/export?period=${batchPeriod}&format=bank`, '_blank')}
                title="ส่งออกไฟล์ CSV สำหรับโอนผ่านธนาคาร"
              >
                <span>🏦</span> Export ธนาคาร (CSV)
              </button>
              <button
                className="hr-btn"
                onClick={() => window.open(`/api/hr/payroll/export?period=${batchPeriod}&format=pnd1`, '_blank')}
                title="ส่งออกไฟล์ยื่น ภ.ง.ด.1"
              >
                <span>📑</span> Export ภ.ง.ด.1
              </button>
              <button
                className="hr-btn"
                onClick={() => window.open(`/api/hr/payroll/export?period=${batchPeriod}&format=sso`, '_blank')}
                title="ส่งออกไฟล์ สปส.1-10"
              >
                <span>🏥</span> Export สปส.1-10
              </button>
            </div>
          ),
          columns: [
            { key: 'id', label: 'SLIP ID', format: (v) => `PR${String(v).padStart(4, '0')}` },
            { key: 'period', label: 'งวด' },
            { key: 'employee_id', label: 'พนักงาน' },
            { key: 'base_salary', label: 'ฐาน', format: baht },
            { key: 'ot_pay', label: 'OT', format: (v) => '+' + baht(v) },
            { key: 'bonus', label: 'โบนัส', format: (v) => '+' + baht(v) },
            { key: 'reimbursements', label: 'คืนค่าใช้จ่าย', format: (v) => '+' + baht(v) },
            { key: 'tax', label: 'ภาษี', format: (v) => '-' + baht(v) },
            { key: 'sso', label: 'ปกส.', format: (v) => '-' + baht(v) },
            { key: 'deduction', label: 'หักอื่นๆ', format: (v) => '-' + baht(v) },
            {
              key: 'net', label: 'สุทธิ',
              format: (v) => <strong style={{ color: 'var(--hr-green)' }}>{baht(v)}</strong>,
            },
            {
              key: 'status', label: 'สถานะ',
              badge: { draft: 'gray', paid: 'green', notified: 'blue' },
              badgeLabels: { draft: 'ร่าง', paid: 'จ่ายแล้ว (ออกสลิปแล้ว)', notified: 'แจ้งสลิปแล้ว' },
            },
          ],
          fields: [
            { key: 'employee_id', label: 'พนักงาน', type: 'employee', required: true },
            {
              key: 'period',
              label: 'งวด (รูปแบบ YYYY-MM เช่น 2026-11)',
              type: 'text',
              required: true,
              default: new Date().toISOString().slice(0, 7),
            },
            { key: 'base_salary', label: 'เงินเดือนฐาน (บาท)', type: 'number', default: 0 },
            { key: 'ot_pay', label: 'ค่าล่วงเวลา OT (บาท)', type: 'number', default: 0 },
            { key: 'bonus', label: 'โบนัส (บาท)', type: 'number', default: 0 },
            { key: 'reimbursements', label: 'คืนค่าใช้จ่าย (บาท)', type: 'number', default: 0 },
            {
              key: 'tax',
              label: 'หักภาษี ณ ที่จ่าย (เลือก % หรือระบุยอดบาท)',
              render: ({ value, set, form }) => (
                <TaxWithholdingField value={value} set={set} form={form} />
              ),
            },
            { key: 'sso', label: 'หักประกันสังคม (บาท)', type: 'number', default: 0 },
            { key: 'deduction', label: 'หักอื่นๆ (บาท)', type: 'number', default: 0 },
            {
              key: 'status', label: 'สถานะ', type: 'select', default: 'draft',
              options: [
                { value: 'draft', label: 'ร่าง' },
                { value: 'paid', label: 'จ่ายแล้ว' },
              ],
            },
          ],
          transformBeforeSave: (form) => ({
            ...form,
            net:
              (Number(form.base_salary) || 0) +
              (Number(form.ot_pay) || 0) +
              (Number(form.bonus) || 0) + (Number(form.reimbursements) || 0) -
              (Number(form.tax) || 0) -
              (Number(form.sso) || 0) -
              (Number(form.deduction) || 0),
          }),
          renderActions: (row, reload, showToast) => (
            <div style={{ display: 'inline-flex', gap: '4px' }}>
              <button
                className="hr-btn hr-btn-icon"
                title="ดูสลิปเงินเดือนฉบับทางการ"
                onClick={() => setViewSlip(row)}
              >
                📄
              </button>
              {row.status === 'draft' && (
                <button
                  className="hr-btn hr-btn-icon"
                  title="ยืนยันจ่ายเงินเดือน (ออกสลิป & แจ้งเตือน Auto)"
                  style={{ color: 'var(--hr-green)', fontWeight: 'bold' }}
                  onClick={() => confirmIndividualPay(row, reload, showToast)}
                >
                  ✅
                </button>
              )}
              <button
                className="hr-btn hr-btn-icon"
                title="แจ้งสลิป LINE"
                onClick={() => notifyLine(row, reload, showToast)}
              >
                🔔
              </button>
            </div>
          ),
        }}
      />

      {/* Modal คำนวณเงินเดือนอัตโนมัติ */}
      {showGenModal && (
        <div className="hr-modal-overlay">
          <div className="hr-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <div className="hr-modal-header">
              <div className="hr-modal-title">⚙️ คำนวณเงินเดือนอัตโนมัติ</div>
              <button className="hr-modal-close" onClick={() => setShowGenModal(false)}>✕</button>
            </div>
            <form onSubmit={handleGeneratePayroll}>
              {genFailures.length > 0 && <div role="alert"><p>รายการต่อไปนี้ยังคำนวณไม่สำเร็จ</p><ul>{genFailures.map((f) => <li key={f.employeeId}>{f.employeeId}: {f.error}</li>)}</ul></div>}
              <div className="hr-field">
                <label>ประจำงวด (เดือน/ปี) *</label>
                <input
                  type="month"
                  className="hr-input"
                  value={genPeriod}
                  onChange={(e) => setGenPeriod(e.target.value)}
                  required
                />
              </div>

              <div style={{ background: '#F8F9FE', padding: 14, borderRadius: 14, margin: '14px 0', border: '1px solid rgba(60,60,67,0.1)', fontSize: 13, lineHeight: 1.6, color: 'var(--hr-text-2)' }}>
                <div>⚡ <b>การคำนวณอัตโนมัติประกอบด้วย:</b></div>
                <div>• ฐานเงินเดือนของพนักงานที่ยังทำงานอยู่</div>
                <div>• รวมยอด OT อนุมัติแล้วของงวด</div>
                <div>• หักเงินสมทบประกันสังคม (SSO) สูงสุด 750 บ.</div>
                <div>• หักภาษี ณ ที่จ่ายตามเกณฑ์ ลย.01</div>
                <div>• หักค่างวดเงินกู้สวัสดิการที่ยังผ่อนชำระ</div>
              </div>

              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, margin: '10px 0', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={genOverwrite}
                  onChange={(e) => setGenOverwrite(e.target.checked)}
                />
                <span>คำนวณทับสลิปเดิมที่เป็นสถานะร่าง (สลิปที่จ่ายแล้วจะถูกปกป้องไว้เสมอ)</span>
              </label>

              <div className="hr-modal-actions" style={{ marginTop: 14 }}>
                <button type="button" className="hr-btn" onClick={() => setShowGenModal(false)}>ยกเลิก</button>
                <button type="submit" className="hr-btn hr-btn-primary" disabled={genLoading}>
                  {genLoading ? '⏳ กำลังประมวลผล...' : 'เริ่มคำนวณสลิป'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal ยืนยันจ่ายเงินเดือนทั้งงวด */}
      {showBatchModal && (
        <div className="hr-modal-overlay">
          <div className="hr-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 500 }}>
            <div className="hr-modal-header">
              <div className="hr-modal-title">💳 ยืนยันจ่ายเงินเดือนทั้งงวด</div>
              <button className="hr-modal-close" onClick={() => setShowBatchModal(false)}>✕</button>
            </div>
            <form onSubmit={handleConfirmBatchPay}>
              <div className="hr-field">
                <label>ประจำงวดที่ต้องการยืนยันจ่าย *</label>
                <input
                  type="month"
                  className="hr-input"
                  value={batchPeriod}
                  onChange={(e) => setBatchPeriod(e.target.value)}
                  required
                />
              </div>

              <div style={{ background: 'rgba(52, 199, 89, 0.08)', padding: 14, borderRadius: 14, margin: '14px 0', border: '1px solid rgba(52, 199, 89, 0.22)', fontSize: 13, lineHeight: 1.6, color: '#15803d' }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>🚀 ดำเนินการอัตโนมัติทันทีหลังยืนยัน:</div>
                <div>1. ปรับสถานะสลิปของทุกคนในงวดเป็น <b>&quot;จ่ายแล้ว&quot;</b></div>
                <div>2. ออกสลิปเงินเดือนฉบับสมบูรณ์ & อัปเดตสะสม 50 ทวิ</div>
                <div>3. ส่งแจ้งเตือนยอดสุทธิเข้ามือถือพนักงาน (In-App)</div>
                <div>4. ส่งข้อความสลิปเงินเดือนผ่าน LINE อัตโนมัติ</div>
              </div>

              <div className="hr-modal-actions" style={{ marginTop: 14 }}>
                <button type="button" className="hr-btn" onClick={() => setShowBatchModal(false)}>ยกเลิก</button>
                <button
                  type="submit"
                  className="hr-btn hr-btn-primary"
                  style={{ backgroundColor: '#16a34a', borderColor: '#16a34a' }}
                  disabled={batchLoading}
                >
                  {batchLoading ? '⏳ กำลังดำเนินการ...' : 'ยืนยันการจ่ายเงินเดือน'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal ดึงยอดค่าเที่ยวจาก Nexus TMS */}
      {showTmsModal && (
        <div className="hr-modal-overlay" onClick={() => setShowTmsModal(false)}>
          <div className="hr-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 840, width: '95%' }}>
            <div className="hr-modal-header">
              <div className="hr-modal-title">🔄 ข้อมูลค่าเที่ยวคนขับจาก Nexus TMS</div>
              <button className="hr-modal-close" onClick={() => setShowTmsModal(false)}>✕</button>
            </div>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 14 }}>
              <div className="hr-field" style={{ margin: 0 }}>
                <label>จากวันที่</label>
                <input
                  type="date"
                  className="hr-input"
                  value={tmsFrom}
                  onChange={(e) => setTmsFrom(e.target.value)}
                />
              </div>
              <div className="hr-field" style={{ margin: 0 }}>
                <label>ถึงวันที่</label>
                <input
                  type="date"
                  className="hr-input"
                  value={tmsTo}
                  onChange={(e) => setTmsTo(e.target.value)}
                />
              </div>
              <button
                type="button"
                className="hr-btn hr-btn-primary"
                disabled={tmsLoading}
                onClick={() => fetchTmsEarnings(tmsFrom, tmsTo)}
                style={{ height: 38 }}
              >
                {tmsLoading ? '⏳ กำลังดึง...' : '🔄 ดึงข้อมูลใหม่'}
              </button>
            </div>

            {tmsResult && !tmsResult.configured && (
              <div style={{ background: '#FEF3C7', border: '1px solid #F59E0B', color: '#92400E', padding: 16, borderRadius: 12, marginBottom: 14 }}>
                <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>⚙️ ยังไม่ได้ตั้งค่าการเชื่อมต่อ Nexus TMS</div>
                <div style={{ fontSize: 13, lineHeight: 1.5 }}>
                  {tmsResult.error || 'ยังไม่ได้ตั้งค่า NEXUS_TMS_URL หรือ NEXUS_TMS_API_KEY ในระบบ'}
                </div>
                <div style={{ fontSize: 12, marginTop: 8, opacity: 0.85 }}>
                  กรุณาตรวจสอบการตั้งค่าตัวแปรสภาพแวดล้อม (Environment Variables) บน Server ให้เรียบร้อย
                </div>
              </div>
            )}

            {tmsResult && tmsResult.configured && tmsResult.error && (
              <div style={{ background: '#FEE2E2', border: '1px solid #EF4444', color: '#991B1B', padding: 14, borderRadius: 10, marginBottom: 14, fontSize: 13 }}>
                ⚠️ {tmsResult.error}
              </div>
            )}

            {tmsResult && tmsResult.configured && (
              <>
                <div className="hr-stat-row" style={{ marginBottom: 14 }}>
                  <div className="hr-stat-card">
                    <div className="hr-stat-icon" style={{ '--sq': '#007AFF' }}>🚛</div>
                    <div>
                      <div className="hr-stat-value">{(tmsResult.earnings || []).length} <small style={{ fontSize: 13 }}>คน</small></div>
                      <div className="hr-stat-label">พนักงานขับรถ</div>
                    </div>
                  </div>
                  <div className="hr-stat-card">
                    <div className="hr-stat-icon" style={{ '--sq': '#34C759' }}>📦</div>
                    <div>
                      <div className="hr-stat-value">
                        {num((tmsResult.earnings || []).reduce((sum, item) => sum + (Number(item.tripCount) || 0), 0))}
                      </div>
                      <div className="hr-stat-label">เที่ยววิ่งรวม</div>
                    </div>
                  </div>
                  <div className="hr-stat-card">
                    <div className="hr-stat-icon" style={{ '--sq': '#FF9500' }}>💵</div>
                    <div>
                      <div className="hr-stat-value">
                        {baht((tmsResult.earnings || []).reduce((sum, item) => sum + (Number(item.driverCost) || 0), 0))}
                      </div>
                      <div className="hr-stat-label">ค่าเที่ยวรวม (Driver Cost)</div>
                    </div>
                  </div>
                </div>

                <div style={{ maxHeight: 360, overflowY: 'auto', border: '1px solid var(--hr-border, #e2e8f0)', borderRadius: 10 }}>
                  <table className="hr-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: 'var(--hr-bg-2, #f8fafc)', textAlign: 'left' }}>
                        <th style={{ padding: '8px 12px' }}>รหัสพนักงาน</th>
                        <th style={{ padding: '8px 12px' }}>ชื่อคนขับ (TMS)</th>
                        <th style={{ padding: '8px 12px' }}>สถานะในระบบ HR</th>
                        <th style={{ padding: '8px 12px', textAlign: 'right' }}>จำนวนเที่ยว</th>
                        <th style={{ padding: '8px 12px', textAlign: 'right' }}>ค่าเที่ยวรวม</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(tmsResult.earnings || []).length === 0 ? (
                        <tr>
                          <td colSpan={5} style={{ textAlign: 'center', padding: 24, color: '#64748b' }}>
                            ไม่พบรายการค่าเที่ยวในช่วงเวลาที่เลือก
                          </td>
                        </tr>
                      ) : (
                        (tmsResult.earnings || []).map((row, idx) => (
                          <tr key={idx} style={{ borderTop: '1px solid var(--hr-border, #e2e8f0)' }}>
                            <td style={{ padding: '8px 12px', fontWeight: 600 }}>{row.employeeId || '-'}</td>
                            <td style={{ padding: '8px 12px' }}>{row.driverName || '-'}</td>
                            <td style={{ padding: '8px 12px' }}>
                              {row.matched ? (
                                <span style={{ color: '#16a34a', fontWeight: 600, fontSize: 12 }}>
                                  ✅ จับคู่แล้ว {row.department ? `(${row.department})` : ''}
                                </span>
                              ) : (
                                <span style={{ color: '#ca8a04', fontSize: 12 }}>
                                  ⚠️ ไม่พบรหัสใน HR
                                </span>
                              )}
                            </td>
                            <td style={{ padding: '8px 12px', textAlign: 'right' }}>{row.tripCount} เที่ยว</td>
                            <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600, color: 'var(--hr-green, #16a34a)' }}>
                              {baht(row.driverCost)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            <div className="hr-modal-actions" style={{ marginTop: 16 }}>
              <button type="button" className="hr-btn" onClick={() => setShowTmsModal(false)}>
                ปิดหน้าต่าง
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Official Pay Slip Modal */}
      {viewSlip && (
        <SlipViewModal slip={viewSlip} onClose={() => setViewSlip(null)} />
      )}

      {toast && <div className={`hr-toast ${toast.type}`}>{toast.message}</div>}
    </>
  );
}

function SlipViewModal({ slip, onClose }) {
  const income = Number(slip.base_salary || 0) + Number(slip.ot_pay || 0) + Number(slip.bonus || 0) + Number(slip.reimbursements || 0);
  const totalDed = Number(slip.tax || 0) + Number(slip.sso || 0) + Number(slip.deduction || 0);

  return (
    <div className="hr-modal-overlay" onClick={onClose}>
      <div className="hr-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
        <div className="hr-modal-header" style={{ paddingBottom: 12, borderBottom: '1px solid var(--hr-border)' }}>
          <div>
            <div className="hr-modal-title">สลิปเงินเดือนงวด {slip.period}</div>
            <div style={{ fontSize: 12, color: 'var(--hr-text-3)', marginTop: 2 }}>{slip.employee_id} · เลขที่เอกสาร PR{String(slip.id).padStart(4, '0')}</div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="hr-btn" onClick={() => window.print()}>🖨️ พิมพ์ / PDF</button>
            <button className="hr-modal-close" onClick={onClose}>✕</button>
          </div>
        </div>

        <div style={{ padding: '16px 0', color: 'var(--hr-text)' }}>
          <div style={{ textAlign: 'center', borderBottom: '2px solid var(--hr-border-solid)', paddingBottom: 14, marginBottom: 16 }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{COMPANY.name}</div>
            <div style={{ fontSize: 11.5, color: 'var(--hr-text-3)', marginTop: 2 }}>{COMPANY.address} · เลขประจำตัวผู้เสียภาษี: {COMPANY.taxId}</div>
            <span className="hr-badge hr-badge-blue" style={{ marginTop: 8, fontSize: 11.5, padding: '4px 12px' }}>
              ใบจ่ายเงินเดือน / PAY SLIP
            </span>
          </div>

          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10,
            background: '#F8F9FE', padding: 14, borderRadius: 14, fontSize: 12.5,
            marginBottom: 16, border: '1px solid rgba(60,60,67,0.08)',
          }}>
            <div><span style={{ color: 'var(--hr-text-3)' }}>รหัสพนักงาน:</span> <strong>{slip.employee_id}</strong></div>
            <div><span style={{ color: 'var(--hr-text-3)' }}>ประจำงวด:</span> <strong>{slip.period}</strong></div>
            <div><span style={{ color: 'var(--hr-text-3)' }}>เลขที่เอกสาร:</span> <strong>PR{String(slip.id).padStart(4, '0')}</strong></div>
            <div>
              <span style={{ color: 'var(--hr-text-3)' }}>สถานะ:</span>{' '}
              <span className={`hr-badge hr-badge-${slip.status === 'paid' ? 'green' : 'gray'}`}>
                {slip.status === 'paid' ? '● จ่ายแล้ว (สมบูรณ์)' : '○ ร่าง (รออนุมัติ)'}
              </span>
            </div>
            {slip.paid_at && (
              <div style={{ gridColumn: 'span 2', color: 'var(--hr-text-3)', fontSize: 12 }}>
                วันที่ยืนยันจ่าย: {new Date(slip.paid_at).toLocaleString('th-TH')}
              </div>
            )}
          </div>

          <table className="hr-table" style={{ marginBottom: 16, border: '1px solid var(--hr-border)', borderRadius: 12, overflow: 'hidden' }}>
            <thead>
              <tr>
                <th>รายการได้ (Earnings)</th>
                <th style={{ textAlign: 'right' }}>จำนวน (บาท)</th>
                <th>รายการหัก (Deductions)</th>
                <th style={{ textAlign: 'right' }}>จำนวน (บาท)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>เงินเดือน / ค่าจ้างฐาน</td>
                <td style={{ textAlign: 'right' }}>{num(slip.base_salary)}</td>
                <td>เงินสมทบประกันสังคม (SSO)</td>
                <td style={{ textAlign: 'right', color: 'var(--hr-red)' }}>{num(slip.sso)}</td>
              </tr>
              <tr>
                <td>ค่าล่วงเวลา (OT)</td>
                <td style={{ textAlign: 'right' }}>{num(slip.ot_pay)}</td>
                <td>ภาษีเงินได้หัก ณ ที่จ่าย (WHT)</td>
                <td style={{ textAlign: 'right', color: 'var(--hr-red)' }}>{num(slip.tax)}</td>
              </tr>
              <tr>
                <td>โบนัส / ค่าตอบแทนพิเศษ</td>
                <td style={{ textAlign: 'right' }}>{num(slip.bonus)}</td>
                <td>หักขาดงาน / ค่าปรับ / อื่นๆ</td>
                <td style={{ textAlign: 'right', color: 'var(--hr-red)' }}>{num(slip.deduction)}</td>
              </tr>
              <tr><td>คืนค่าใช้จ่าย</td><td style={{ textAlign: 'right' }}>{num(slip.reimbursements)}</td><td></td><td></td></tr>
            </tbody>
            <tfoot>
              <tr style={{ background: '#FAFAFC', fontWeight: 700 }}>
                <td>รวมเงินได้ทั้งสิ้น</td>
                <td style={{ textAlign: 'right', color: 'var(--hr-green)' }}>{num(income)}</td>
                <td>รวมเงินหักทั้งสิ้น</td>
                <td style={{ textAlign: 'right', color: 'var(--hr-red)' }}>{num(totalDed)}</td>
              </tr>
            </tfoot>
          </table>

          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            background: 'rgba(52, 199, 89, 0.09)', border: '1px solid rgba(52, 199, 89, 0.25)',
            padding: '14px 18px', borderRadius: 14, marginBottom: 16,
          }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#15803d' }}>ยอดเงินได้สุทธิ (Net Pay)</span>
            <span style={{ fontSize: 22, fontWeight: 800, color: '#15803d', fontVariantNumeric: 'tabular-nums' }}>{num(slip.net)} ฿</span>
          </div>

          <div style={{ fontSize: 11, color: 'var(--hr-text-3)', textAlign: 'center', borderTop: '1px dashed var(--hr-border)', paddingTop: 10 }}>
            เอกสารนี้สร้างจากระบบ HR Pro Suite — ถือเป็นเอกสารรับรองทางบัญชีและการจ่ายเงินเดือนของ {COMPANY.legalName}
          </div>
        </div>
      </div>
    </div>
  );
}

function TaxWithholdingField({ value, set, form }) {
  const [activePct, setActivePct] = useState(null);
  const [customPct, setCustomPct] = useState('');

  // เงินได้รวม = ฐานเงินเดือน + OT + โบนัส
  const grossIncome = (Number(form.base_salary) || 0) + (Number(form.ot_pay) || 0) + (Number(form.bonus) || 0);

  const applyPercent = (pct) => {
    setActivePct(pct);
    setCustomPct('');
    const amt = Math.round(grossIncome * (pct / 100) * 100) / 100;
    set(amt);
  };

  const applyCustom = (val) => {
    setCustomPct(val);
    setActivePct('custom');
    const p = parseFloat(val);
    if (!isNaN(p) && p >= 0) {
      const amt = Math.round(grossIncome * (p / 100) * 100) / 100;
      set(amt);
    }
  };

  return (
    <div style={{ background: '#F8F9FE', padding: '12px', borderRadius: '12px', border: '1px solid rgba(60,60,67,0.1)' }}>
      {/* Quick % buttons */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        {[
          { label: '0% ไม่หัก', pct: 0 },
          { label: '1% ขนส่ง', pct: 1 },
          { label: '3% จ้างทำของ/บริการ', pct: 3 },
          { label: '5% ค่าเช่า', pct: 5 },
        ].map((item) => (
          <button
            key={item.pct}
            type="button"
            className={`hr-tab${activePct === item.pct ? ' active' : ''}`}
            style={{
              padding: '5px 10px',
              fontSize: 12,
              borderRadius: 8,
              cursor: 'pointer',
              border: activePct === item.pct ? '1.5px solid #007AFF' : '1px solid rgba(60,60,67,0.15)',
              background: activePct === item.pct ? '#007AFF' : '#FFFFFF',
              color: activePct === item.pct ? '#FFFFFF' : 'var(--hr-text)',
              fontWeight: 600,
              transition: 'all 0.15s ease',
            }}
            onClick={() => applyPercent(item.pct)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* Input row: Baht amount + Custom % */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <input
            className="hr-input"
            type="number"
            step="any"
            value={value ?? 0}
            onChange={(e) => {
              setActivePct(null);
              set(e.target.value === '' ? '' : Number(e.target.value));
            }}
            placeholder="จำนวนเงินบาทที่หัก"
            style={{ paddingRight: 40 }}
          />
          <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 13, color: '#8E8E93', pointerEvents: 'none' }}>
            บาท
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 100 }}>
          <span style={{ fontSize: 12, color: 'var(--hr-text-3)' }}>หรือ</span>
          <input
            className="hr-input"
            type="number"
            step="0.1"
            placeholder="%"
            value={customPct}
            onChange={(e) => applyCustom(e.target.value)}
            style={{ width: 62, textAlign: 'center', padding: '7px 4px' }}
          />
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--hr-text)' }}>%</span>
        </div>
      </div>

      {/* Realtime calculation summary */}
      <div style={{ marginTop: 8, fontSize: 12, color: '#3C3C43', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 4 }}>
        <span>
          เงินได้รวม (ฐาน + OT + โบนัส): <strong>{grossIncome.toLocaleString()} ฿</strong>
        </span>
        {grossIncome > 0 && Number(value) > 0 && (
          <span style={{ color: '#007AFF', fontWeight: 600 }}>
            หัก {((Number(value) / grossIncome) * 100).toFixed(1)}% = {Number(value).toLocaleString()} ฿
          </span>
        )}
      </div>
    </div>
  );
}
