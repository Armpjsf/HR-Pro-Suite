'use client';

import { useState } from 'react';
import ResourceTable from '@/components/hr/ResourceTable';
import { authHeaders } from '@/components/hr/exportUtils';

const baht = (v) => Number(v || 0).toLocaleString('th-TH') + ' ฿';
const num = (v) => Number(v || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const COMPANY = {
  name: 'บริษัท ดีดี เซอร์วิส แอนด์ ทรานสปอร์ต จำกัด',
  legalName: 'DD SERVICE & TRANSPORT CO., LTD.',
  address: 'เลขที่ 88/8 หมู่ 5 ต.คลองหนึ่ง อ.คลองหลวง จ.ปทุมธานี 12120',
  taxId: '0105560012345',
};

export default function PayrollPage() {
  const [viewSlip, setViewSlip] = useState(null);
  const [showGenModal, setShowGenModal] = useState(false);
  const [genPeriod, setGenPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [genOverwrite, setGenOverwrite] = useState(false);
  const [genLoading, setGenLoading] = useState(false);

  const [showBatchModal, setShowBatchModal] = useState(false);
  const [batchPeriod, setBatchPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [batchLoading, setBatchLoading] = useState(false);
  const [toast, setToast] = useState(null);

  function showToast(message, type = 'success') {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  }

  async function handleGeneratePayroll(e) {
    e.preventDefault();
    setGenLoading(true);
    try {
      const res = await fetch('/api/hr/payroll/generate', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({ period: genPeriod, overwrite: genOverwrite }),
      });
      const d = await res.json();
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
    if (!confirm(`ยืนยันจ่ายเงินเดือนงวด ${row.period} ของพนักงาน ${row.employee_id}?
ยอดสุทธิ: ${baht(row.net)}

ระบบจะออกสลิปเงินเดือนทางการและส่งแจ้งเตือนให้พนักงานทันที`)) return;
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
    if (!confirm(`ส่งสลิปงวด ${row.period} ของ ${row.employee_id} ทาง LINE?`)) return;
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
      <ResourceTable
        config={{
          resource: 'payroll',
          exportName: 'payroll_slips',
          searchPlaceholder: 'ค้นหารหัส/ชื่อพนักงาน/งวด...',
          headerExtra: (
            <div className="hr-toolbar" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button className="hr-btn hr-btn-secondary" onClick={() => setShowGenModal(true)}>
                ⚙️ คำนวณเงินเดือนอัตโนมัติ (ปกส./ภาษี)
              </button>
              <button
                className="hr-btn hr-btn-primary"
                style={{ backgroundColor: '#16a34a', borderColor: '#16a34a', color: '#fff', fontWeight: 600 }}
                onClick={() => setShowBatchModal(true)}
              >
                💳 ยืนยันจ่ายเงินเดือนทั้งงวด (ออกสลิป & แจ้งเตือน Auto)
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
            { key: 'tax', label: 'ภาษี', format: (v) => '-' + baht(v) },
            { key: 'sso', label: 'ปกส.', format: (v) => '-' + baht(v) },
            { key: 'deduction', label: 'หักอื่นๆ', format: (v) => '-' + baht(v) },
            {
              key: 'net', label: 'สุทธิ',
              format: (v) => <strong style={{ color: '#16a34a' }}>{baht(v)}</strong>,
            },
            {
              key: 'status', label: 'สถานะ',
              badge: { draft: 'gray', paid: 'green', notified: 'blue' },
              badgeLabels: { draft: 'ร่าง', paid: 'จ่ายแล้ว (ออกสลิปแล้ว)', notified: 'แจ้งสลิปแล้ว' },
            },
          ],
          fields: [
            { key: 'employee_id', label: 'พนักงาน', type: 'employee', required: true },
            { key: 'period', label: 'งวด (เช่น 2026-10)', type: 'text', required: true },
            { key: 'base_salary', label: 'เงินเดือนฐาน (บาท)', type: 'number', default: 0 },
            { key: 'ot_pay', label: 'ค่าล่วงเวลา OT (บาท)', type: 'number', default: 0 },
            { key: 'bonus', label: 'โบนัส (บาท)', type: 'number', default: 0 },
            { key: 'tax', label: 'หักภาษี ณ ที่จ่าย (บาท)', type: 'number', default: 0 },
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
              (Number(form.bonus) || 0) -
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
              {row.status !== 'paid' && (
                <button
                  className="hr-btn hr-btn-icon"
                  title="ยืนยันจ่ายเงินเดือน (ออกสลิป & แจ้งเตือน Auto)"
                  style={{ color: '#16a34a', fontWeight: 'bold' }}
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

              <div style={{ background: '#f8fafc', padding: 12, borderRadius: 8, margin: '12px 0', border: '1px solid #e2e8f0', fontSize: 13, lineHeight: 1.6, color: '#475569' }}>
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

              <div style={{ background: '#ecfdf5', padding: 14, borderRadius: 8, margin: '14px 0', border: '1px solid #a7f3d0', fontSize: 13, lineHeight: 1.6, color: '#065f46' }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>🚀 ดำเนินการอัตโนมัติทันทีหลังยืนยัน:</div>
                <div>1. ปรับสถานะสลิปของทุกคนในงวดเป็น <b>"จ่ายแล้ว"</b></div>
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

      {/* Official Pay Slip Modal */}
      {viewSlip && (
        <SlipViewModal slip={viewSlip} onClose={() => setViewSlip(null)} />
      )}

      {toast && <div className={`hr-toast ${toast.type}`}>{toast.message}</div>}
    </>
  );
}

function SlipViewModal({ slip, onClose }) {
  const income = Number(slip.base_salary || 0) + Number(slip.ot_pay || 0) + Number(slip.bonus || 0);
  const totalDed = Number(slip.tax || 0) + Number(slip.sso || 0) + Number(slip.deduction || 0);

  return (
    <div style={{
      position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000, padding: '16px', backdropFilter: 'blur(3px)',
    }}>
      <div style={{
        backgroundColor: '#fff', borderRadius: '12px', width: '100%', maxWidth: '640px',
        maxHeight: '92vh', overflowY: 'auto', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.3)',
      }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '14px 20px', borderBottom: '1px solid #e5e7eb', backgroundColor: '#f9fafb',
          borderTopLeftRadius: '12px', borderTopRightRadius: '12px',
        }}>
          <div style={{ fontWeight: 600, fontSize: '15px', color: '#111827' }}>
            สลิปเงินเดือนงวด {slip.period} — {slip.employee_id}
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => window.print()}
              style={{
                backgroundColor: '#7c3aed', color: '#fff', border: 'none',
                padding: '6px 14px', borderRadius: '6px', fontSize: '13px',
                cursor: 'pointer', fontWeight: 500,
              }}
            >
              🖨️ พิมพ์ / PDF
            </button>
            <button
              onClick={onClose}
              style={{
                backgroundColor: '#e5e7eb', color: '#374151', border: 'none',
                padding: '6px 12px', borderRadius: '6px', fontSize: '13px',
                cursor: 'pointer', fontWeight: 500,
              }}
            >
              ✕ ปิด
            </button>
          </div>
        </div>

        <div style={{ padding: '24px', fontFamily: 'inherit', color: '#1f2937' }}>
          <div style={{ textAlign: 'center', borderBottom: '2px solid #374151', paddingBottom: '12px', marginBottom: '16px' }}>
            <div style={{ fontSize: '16px', fontWeight: 'bold' }}>{COMPANY.name}</div>
            <div style={{ fontSize: '11px', color: '#6b7280' }}>{COMPANY.address} · เลขประจำตัวผู้เสียภาษี: {COMPANY.taxId}</div>
            <div style={{
              display: 'inline-block', backgroundColor: '#7c3aed', color: '#fff',
              padding: '3px 12px', borderRadius: '4px', fontSize: '12px', fontWeight: 'bold',
              marginTop: '8px', letterSpacing: '0.5px',
            }}>
              ใบจ่ายเงินเดือน / PAY SLIP
            </div>
          </div>

          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px',
            backgroundColor: '#f9fafb', padding: '12px', borderRadius: '8px', fontSize: '12px',
            marginBottom: '16px', border: '1px solid #e5e7eb',
          }}>
            <div><strong>รหัสพนักงาน:</strong> {slip.employee_id}</div>
            <div><strong>ประจำงวด:</strong> {slip.period}</div>
            <div><strong>เลขที่เอกสาร:</strong> PR{String(slip.id).padStart(4, '0')}</div>
            <div>
              <strong>สถานะ:</strong>{' '}
              <span style={{
                color: slip.status === 'paid' ? '#16a34a' : '#9ca3af',
                fontWeight: 'bold',
              }}>
                {slip.status === 'paid' ? '● จ่ายเรียบร้อยแล้ว' : '○ ร่าง (รออนุมัติจ่าย)'}
              </span>
            </div>
            {slip.paid_at && (
              <div style={{ gridColumn: 'span 2' }}>
                <strong>วันที่ยืนยันจ่าย:</strong> {new Date(slip.paid_at).toLocaleString('th-TH')}
              </div>
            )}
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px', marginBottom: '16px' }}>
            <thead>
              <tr style={{ backgroundColor: '#f3f4f6', borderBottom: '2px solid #e5e7eb' }}>
                <th style={{ textAlign: 'left', padding: '8px 10px', color: '#374151' }}>รายการได้ (Earnings)</th>
                <th style={{ textAlign: 'right', padding: '8px 10px', color: '#374151' }}>จำนวนเงิน (บาท)</th>
                <th style={{ textAlign: 'left', padding: '8px 10px', color: '#374151' }}>รายการหัก (Deductions)</th>
                <th style={{ textAlign: 'right', padding: '8px 10px', color: '#374151' }}>จำนวนเงิน (บาท)</th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={{ padding: '8px 10px' }}>เงินเดือน / ค่าจ้างฐาน</td>
                <td style={{ textAlign: 'right', padding: '8px 10px' }}>{num(slip.base_salary)}</td>
                <td style={{ padding: '8px 10px' }}>เงินสมทบประกันสังคม (SSO)</td>
                <td style={{ textAlign: 'right', padding: '8px 10px', color: '#dc2626' }}>{num(slip.sso)}</td>
              </tr>
              <tr style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={{ padding: '8px 10px' }}>ค่าล่วงเวลา (OT)</td>
                <td style={{ textAlign: 'right', padding: '8px 10px' }}>{num(slip.ot_pay)}</td>
                <td style={{ padding: '8px 10px' }}>ภาษีเงินได้หัก ณ ที่จ่าย (WHT)</td>
                <td style={{ textAlign: 'right', padding: '8px 10px', color: '#dc2626' }}>{num(slip.tax)}</td>
              </tr>
              <tr style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={{ padding: '8px 10px' }}>โบนัส / ค่าตอบแทนพิเศษ</td>
                <td style={{ textAlign: 'right', padding: '8px 10px' }}>{num(slip.bonus)}</td>
                <td style={{ padding: '8px 10px' }}>หักขาดงาน / ค่าปรับ / อื่นๆ</td>
                <td style={{ textAlign: 'right', padding: '8px 10px', color: '#dc2626' }}>{num(slip.deduction)}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr style={{ backgroundColor: '#f9fafb', fontWeight: 'bold', borderTop: '2px solid #e5e7eb' }}>
                <td style={{ padding: '8px 10px' }}>รวมเงินได้ทั้งสิ้น</td>
                <td style={{ textAlign: 'right', padding: '8px 10px', color: '#16a34a' }}>{num(income)}</td>
                <td style={{ padding: '8px 10px' }}>รวมเงินหักทั้งสิ้น</td>
                <td style={{ textAlign: 'right', padding: '8px 10px', color: '#dc2626' }}>{num(totalDed)}</td>
              </tr>
            </tfoot>
          </table>

          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            backgroundColor: '#ecfdf5', border: '1px solid #a7f3d0',
            padding: '14px 18px', borderRadius: '8px', marginBottom: '16px',
          }}>
            <span style={{ fontSize: '14px', fontWeight: 'bold', color: '#065f46' }}>ยอดเงินได้สุทธิ (Net Pay)</span>
            <span style={{ fontSize: '20px', fontWeight: 'bold', color: '#047857' }}>{num(slip.net)} ฿</span>
          </div>

          <div style={{ fontSize: '11px', color: '#6b7280', textAlign: 'center', marginTop: '16px', borderTop: '1px dashed #e5e7eb', paddingTop: '10px' }}>
            เอกสารนี้สร้างจากระบบ HR Pro Suite — ถือเป็นเอกสารรับรองทางบัญชีและการจ่ายเงินเดือนของ {COMPANY.legalName}
          </div>
        </div>
      </div>
    </div>
  );
}
