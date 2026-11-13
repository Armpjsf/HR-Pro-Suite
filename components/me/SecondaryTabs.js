'use client';

import { useState, useEffect, useCallback } from 'react';
import { COMPANY } from '@/lib/company';
import { deductionBreakdown as slipDeductionBreakdown } from '@/lib/payroll';
import { AppIcon } from '@/components/ui/Icons';

/* ─── Shared Helpers & Constants ─── */
export function authHeaders() {
  const token = typeof window !== 'undefined' ? localStorage.getItem('hr-token') : '';
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

export function storedImage(file) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('hr-token') : '';
  return `/api/assets/image?file=${encodeURIComponent(file)}&token=${encodeURIComponent(token || '')}`;
}

export function assetImg(file) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('hr-token') : '';
  return `/api/assets/image?file=${encodeURIComponent(file)}&token=${encodeURIComponent(token || '')}`;
}

const THAI_MONTHS_FULL = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
];

export function periodThai(p) {
  if (!p) return '-';
  const [y, m] = p.split('-').map(Number);
  return `${THAI_MONTHS_FULL[m - 1] || ''} ${y + 543}`;
}

export function thaiDate(value) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });
}

export function thaiDateShort(value) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' });
}

const THAI_DIGITS_TEXT = ['', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
const THAI_POSITIONS_TEXT = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'];

export function thaiNumberText(value) {
  const number = Math.floor(Math.abs(Number(value) || 0));
  if (number === 0) return 'ศูนย์';
  if (number >= 1000000) {
    const million = Math.floor(number / 1000000);
    const rest = number % 1000000;
    return `${thaiNumberText(million)}ล้าน${rest ? thaiNumberText(rest) : ''}`;
  }
  const parts = String(number).split('');
  let text = '';
  for (let i = 0; i < parts.length; i += 1) {
    const digit = Number(parts[i]);
    if (!digit) continue;
    const pos = parts.length - i - 1;
    if (pos === 1 && digit === 1) text += 'สิบ';
    else if (pos === 1 && digit === 2) text += 'ยี่สิบ';
    else if (pos === 0 && digit === 1 && parts.length > 1) text += 'เอ็ด';
    else text += `${THAI_DIGITS_TEXT[digit]}${THAI_POSITIONS_TEXT[pos] || ''}`;
  }
  return text;
}

export function thaiBahtText(value) {
  const amount = Number(value) || 0;
  const baht = Math.floor(amount);
  const satang = Math.round((amount - baht) * 100);
  return satang > 0
    ? `${thaiNumberText(baht)}บาท${thaiNumberText(satang)}สตางค์`
    : `${thaiNumberText(baht)}บาทถ้วน`;
}

export const STATUS_BADGE = {
  pending: { cls: 'me-badge-yellow', label: 'รออนุมัติ' },
  approved: { cls: 'me-badge-green', label: 'อนุมัติ' },
  rejected: { cls: 'me-badge-red', label: 'ไม่อนุมัติ' },
  paid: { cls: 'me-badge-blue', label: 'จ่ายแล้ว' },
  draft: { cls: 'me-badge-gray', label: 'แบบร่าง' },
  submitted: { cls: 'me-badge-green', label: 'ส่งแล้ว' },
};

export const CERTIFICATE_TYPES = {
  salary_certificate: 'หนังสือรับรองเงินเดือน',
  employment_certificate: 'หนังสือรับรองการทำงาน',
};

export const EXPENSE_CATS = [
  { value: 'travel', label: 'ค่าเดินทาง / ทางด่วน' },
  { value: 'fuel', label: 'ค่าน้ำมันเชื้อเพลิง' },
  { value: 'meal', label: 'ค่าอาหาร' },
  { value: 'allowance', label: 'เบี้ยเลี้ยง' },
  { value: 'accommodation', label: 'ค่าที่พัก' },
  { value: 'maintenance', label: 'ค่าซ่อมบำรุงรถ' },
  { value: 'other', label: 'อื่นๆ' },
];

/* ═══════════════════ PAYSLIP TAB ═══════════════════ */
export function PayslipTab({ data }) {
  const slips = data?.payslips || [];
  const [selected, setSelected] = useState(slips[0] || null);
  const [showDoc, setShowDoc] = useState(false);
  const [allowanceData, setAllowanceData] = useState({});

  const num = (v) => Number(v || 0).toLocaleString();

  async function openSlip(s) {
    setSelected(s);
    const year = Number(s.period.slice(0, 4)) + 543;
    if (allowanceData[year] === undefined) {
      try {
        const r = await fetch(`/api/me/allowances?year=${year}`, { headers: authHeaders() });
        const d = await r.json();
        setAllowanceData((p) => ({ ...p, [year]: d.allowance?.data || {} }));
      } catch {
        setAllowanceData((p) => ({ ...p, [year]: {} }));
      }
    }
    setShowDoc(true);
  }

  function computeYtd(slip) {
    const yr = slip.period.slice(0, 4);
    const upTo = slips.filter((s) => s.period.slice(0, 4) === yr && s.period <= slip.period);
    const sum = (k) => upTo.reduce((a, s) => a + (Number(s[k]) || 0), 0);
    return {
      income: sum('base_salary') + sum('ot_pay') + sum('bonus'),
      tax: sum('tax'),
      sso: sum('sso'),
    };
  }

  return (
    <>
      {selected && (
        <div className="me-card">
          <div className="me-section-title">
            <AppIcon name="payroll" size={18} /> สลิปเงินเดือน งวด {selected.period}
          </div>
          <div className="me-row">
            <span className="k">เงินเดือน</span>
            <span className="v">{num(selected.base_salary)} ฿</span>
          </div>
          <div className="me-row">
            <span className="k">ค่าล่วงเวลา (OT)</span>
            <span className="v">{num(selected.ot_pay)} ฿</span>
          </div>
          <div className="me-row">
            <span className="k">โบนัส</span>
            <span className="v">{num(selected.bonus)} ฿</span>
          </div>
          <div className="me-row">
            <span className="k">หักภาษี ณ ที่จ่าย</span>
            <span className="v" style={{ color: '#DC2626' }}>-{num(selected.tax)} ฿</span>
          </div>
          <div className="me-row">
            <span className="k">หักประกันสังคม</span>
            <span className="v" style={{ color: '#DC2626' }}>-{num(selected.sso)} ฿</span>
          </div>
          <div className="me-row">
            <span className="k">หักอื่นๆ</span>
            <span className="v" style={{ color: '#DC2626' }}>-{num(selected.deduction)} ฿</span>
          </div>
          <div className="me-row" style={{ borderTop: '2px solid #E2E8F0' }}>
            <span className="k" style={{ fontWeight: 700 }}>รับสุทธิ</span>
            <span className="me-slip-net">{num(selected.net)} ฿</span>
          </div>
          <button className="me-btn" style={{ marginTop: 14 }} onClick={() => openSlip(selected)}>
            <AppIcon name="printer" size={17} /> ดู / บันทึกสลิป PDF
          </button>
        </div>
      )}

      <div className="me-card">
        <div className="me-section-title">
          <AppIcon name="file-text" size={18} /> สลิปย้อนหลัง
        </div>
        {slips.length === 0 && <div className="me-empty">ยังไม่มีสลิปเงินเดือนที่ปล่อยแล้ว</div>}
        {slips.map((s) => (
          <div key={s.id} className="me-row" style={{ cursor: 'pointer' }} onClick={() => openSlip(s)}>
            <span className="k">งวด {periodThai(s.period)}</span>
            <span className="v" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {num(s.net)} ฿ <AppIcon name="chevron-right" size={14} />
            </span>
          </div>
        ))}
      </div>

      {showDoc && selected && (() => {
        const year = Number(selected.period.slice(0, 4)) + 543;
        const a = allowanceData[year] || {};
        const ytd = computeYtd(selected);
        const deductions = slipDeductionBreakdown(ytd.income, ytd.sso, a);
        return (
          <SlipDocument
            slip={selected}
            profile={data?.profile}
            ytd={ytd}
            deductions={deductions}
            onClose={() => setShowDoc(false)}
          />
        );
      })()}
    </>
  );
}

export function SlipDocument({ slip, profile, ytd, deductions, onClose }) {
  const num = (v) => Number(v || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const income = Number(slip.base_salary) + Number(slip.ot_pay) + Number(slip.bonus);
  const totalDed = Number(slip.tax) + Number(slip.sso) + Number(slip.deduction);

  return (
    <div className="me-doc-overlay">
      <div className="me-doc-actions">
        <button
          className="me-badge me-badge-gray"
          style={{ border: 'none', padding: '8px 16px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}
          onClick={onClose}
        >
          <AppIcon name="chevron-left" size={14} /> ปิด
        </button>
        <button
          className="me-badge me-badge-blue"
          style={{ border: 'none', padding: '8px 16px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}
          onClick={() => window.print()}
        >
          <AppIcon name="printer" size={15} /> พิมพ์ / บันทึก PDF
        </button>
      </div>
      <div className="me-doc-print">
        <div className="me-doc">
          <div className="me-doc-head" style={{ position: 'relative' }}>
            <div style={{ position: 'absolute', right: 0, top: 0, fontSize: 10, color: '#DC2626', fontWeight: 700 }}>
              STRICTLY CONFIDENTIAL
            </div>
            <div className="me-doc-title" style={{ marginTop: 0, fontSize: 16 }}>สลิปเงินเดือน</div>
            <div className="me-doc-co" style={{ marginTop: 6 }}>{COMPANY.name}</div>
            <div className="me-doc-addr">{COMPANY.address}</div>
            <div className="me-doc-addr">Tax ID: {COMPANY.taxId}</div>
          </div>

          <table className="me-doc-meta">
            <tbody>
              <tr>
                <td>ชื่อ-สกุล</td><td>{profile?.name} ({profile?.employeeId})</td>
                <td>ประจำงวด</td><td>{periodThai(slip.period)}</td>
              </tr>
              <tr>
                <td>ตำแหน่ง</td><td>{profile?.position || '-'}</td>
                <td>ฝ่าย/แผนก</td><td>{profile?.department || '-'}</td>
              </tr>
              <tr>
                <td>วันที่เริ่มงาน</td><td>{profile?.startDate || '-'}</td>
                <td>เลขที่บัญชี</td><td>{profile?.bankAccount || '-'}</td>
              </tr>
            </tbody>
          </table>

          <table className="me-doc-table">
            <thead>
              <tr><th>เงินได้</th><th className="r">จำนวน</th><th>เงินหัก</th><th className="r">จำนวน</th></tr>
            </thead>
            <tbody>
              <tr><td>เงินเดือน / ค่าจ้าง</td><td className="r">{num(slip.base_salary)}</td><td>ประกันสังคม</td><td className="r">{num(slip.sso)}</td></tr>
              <tr><td>ค่าล่วงเวลา (OT)</td><td className="r">{num(slip.ot_pay)}</td><td>ภาษี ณ ที่จ่าย</td><td className="r">{num(slip.tax)}</td></tr>
              <tr><td>โบนัส</td><td className="r">{num(slip.bonus)}</td><td>หักอื่นๆ</td><td className="r">{num(slip.deduction)}</td></tr>
            </tbody>
            <tfoot>
              <tr><td>รวมเงินได้</td><td className="r">{num(income)}</td><td>รวมเงินหัก</td><td className="r">{num(totalDed)}</td></tr>
            </tfoot>
          </table>

          <div className="me-doc-net">เงินสุทธิ: {num(slip.net)} บาท</div>

          {ytd && (
            <>
              <div style={{ fontWeight: 700, fontSize: 12.5, margin: '6px 0 4px' }}>เงินสะสมตั้งแต่ต้นปี</div>
              <table className="me-doc-table">
                <tbody>
                  <tr><td>เงินได้คำนวณภาษี</td><td className="r">{num(ytd.income)}</td></tr>
                  <tr><td>ภาษี</td><td className="r">{num(ytd.tax)}</td></tr>
                  <tr><td>ประกันสังคม</td><td className="r">{num(ytd.sso)}</td></tr>
                </tbody>
              </table>
            </>
          )}

          {deductions && deductions.length > 0 && (
            <>
              <div style={{ fontWeight: 700, fontSize: 12.5, margin: '6px 0 4px' }}>รายการลดหย่อนภาษี</div>
              <table className="me-doc-table">
                <tbody>
                  {deductions.map((d, i) => (
                    <tr key={i}><td>{d.label}</td><td className="r">{num(d.amount)}</td></tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          <div className="me-doc-sign">
            <div>ลงชื่อ ......................................... พนักงาน</div>
            <div>ลงชื่อ ......................................... ฝ่ายบุคคล</div>
          </div>
          <div className="me-doc-foot">{COMPANY.legalName} — เอกสารลับเฉพาะบุคคล</div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════ EXPENSES SUB-SECTION ═══════════════════ */
export function ExpensesSection({ back, showToast }) {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState({
    category: 'travel',
    amount: '',
    description: '',
    claim_date: new Date().toISOString().slice(0, 10),
    receiptUrl: '',
  });
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch('/api/me/expenses', { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => {
        setItems(d.items || []);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const token = typeof window !== 'undefined' ? localStorage.getItem('hr-token') : '';
      const res = await fetch('/api/me/upload', {
        method: 'POST',
        headers: token ? { Authorization: 'Bearer ' + token } : {},
        body: fd,
      });
      const d = await res.json();
      if (!res.ok) {
        showToast(d.error || 'อัปโหลดไม่สำเร็จ', true);
        return;
      }
      setForm((prev) => ({ ...prev, receiptUrl: d.fileUrl }));
      showToast('แนบใบเสร็จเรียบร้อย');
    } catch {
      showToast('อัปโหลดไฟล์ล้มเหลว', true);
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch('/api/me/expenses', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(form),
      });
      const d = await res.json();
      if (!res.ok) {
        showToast(d.error, true);
        return;
      }
      showToast('ยื่นเบิกค่าใช้จ่ายเรียบร้อย');
      setItems((p) => [d.item, ...p]);
      setForm({
        category: 'travel',
        amount: '',
        description: '',
        claim_date: new Date().toISOString().slice(0, 10),
        receiptUrl: '',
      });
    } catch {
      showToast('เกิดข้อผิดพลาด', true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        className="me-badge me-badge-gray"
        style={{ cursor: 'pointer', border: 'none', marginBottom: 12, padding: '7px 14px', display: 'inline-flex', alignItems: 'center', gap: 6 }}
        onClick={back}
      >
        <AppIcon name="chevron-left" size={14} /> กลับ
      </button>
      <div className="me-card">
        <div className="me-section-title">
          <AppIcon name="receipt" size={18} /> ยื่นเบิกค่าเที่ยว / ค่าใช้จ่ายปฏิบัติงาน
        </div>
        <form onSubmit={handleSubmit}>
          <div className="me-field">
            <label>หมวดหมู่การเบิกจ่าย</label>
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {EXPENSE_CATS.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>
          <div className="me-field">
            <label>จำนวนเงิน (บาท)</label>
            <input
              type="number"
              className="me-input"
              min="1"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              placeholder="0.00"
              required
            />
          </div>
          <div className="me-field">
            <label>วันที่เกิดรายการ</label>
            <input
              type="date"
              className="me-input"
              value={form.claim_date}
              onChange={(e) => setForm({ ...form, claim_date: e.target.value })}
              required
            />
          </div>
          <div className="me-field">
            <label>รายละเอียด</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="ระบุรายละเอียด เช่น ทะเบียนรถ / สายการขนส่ง / เลขที่บิล"
            />
          </div>
          <div className="me-field">
            <label>แนบใบเสร็จ / บิลค่าน้ำมัน (JPG, PNG, PDF)</label>
            <input
              type="file"
              accept="image/*,.pdf"
              className="me-input"
              onChange={handleFileChange}
              disabled={uploading}
            />
            {uploading && (
              <div style={{ fontSize: 12, color: '#0284C7', marginTop: 4, display: 'flex', alignItems: 'center', gap: 5 }}>
                <AppIcon name="clock" size={13} /> กำลังอัปโหลดใบเสร็จ...
              </div>
            )}
            {form.receiptUrl && !uploading && (
              <div style={{ fontSize: 12, color: '#16A34A', marginTop: 4, display: 'flex', alignItems: 'center', gap: 5 }}>
                <AppIcon name="check-circle" size={13} /> แนบไฟล์สำเร็จ พร้อมส่งเบิก
              </div>
            )}
          </div>
          <button className="me-btn" disabled={loading || uploading}>
            {loading ? 'กำลังส่งคำขอ...' : 'ยื่นขอเบิกจ่าย'}
          </button>
        </form>
      </div>

      <div className="me-card">
        <div className="me-section-title">
          <AppIcon name="file-text" size={18} /> รายการเบิกย้อนหลัง
        </div>
        {!loaded && <div className="me-empty">กำลังโหลด...</div>}
        {loaded && items.length === 0 && <div className="me-empty">ยังไม่มีรายการเบิกจ่าย</div>}
        {items.map((item) => {
          const badge = STATUS_BADGE[item.status] || STATUS_BADGE.pending;
          const catLabel = EXPENSE_CATS.find((c) => c.value === item.category)?.label || item.category;
          const rawDesc = String(item.description || '');
          const receiptMatch = rawDesc.match(/\[RECEIPT:([^\]]+)\]/);
          const receiptFile = receiptMatch ? receiptMatch[1].trim() : null;
          const cleanDesc = rawDesc.replace(/\[RECEIPT:[^\]]+\]/g, '').trim();

          return (
            <div key={item.id} className="me-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="k" style={{ fontWeight: 600 }}>{catLabel} · {Number(item.amount).toLocaleString()} ฿</span>
                <span className={'me-badge ' + badge.cls}>{badge.label}</span>
              </div>
              {(cleanDesc || receiptFile) && (
                <div style={{ fontSize: 12, color: '#64748B', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>{cleanDesc || item.claim_date}</span>
                  {receiptFile && (
                    <a
                      href={assetImg(receiptFile)}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: '#0284C7', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                    >
                      <AppIcon name="receipt" size={13} /> ดูใบเสร็จ
                    </a>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
export const ExpensesTab = ExpensesSection;

/* ═══════════════════ OT SUB-SECTION ═══════════════════ */
export function OtSection({ back, showToast }) {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState({ ot_date: new Date().toISOString().slice(0, 10), hours: '', note: '' });
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch('/api/me/ot', { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => {
        setItems(d.items || []);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch('/api/me/ot', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(form),
      });
      const d = await res.json();
      if (!res.ok) {
        showToast(d.error, true);
        return;
      }
      showToast('ยื่นขอ OT เรียบร้อย');
      setItems((p) => [d.item, ...p]);
      setForm({ ot_date: new Date().toISOString().slice(0, 10), hours: '', note: '' });
    } catch {
      showToast('เกิดข้อผิดพลาด', true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        className="me-badge me-badge-gray"
        style={{ cursor: 'pointer', border: 'none', marginBottom: 12, padding: '7px 14px', display: 'inline-flex', alignItems: 'center', gap: 6 }}
        onClick={back}
      >
        <AppIcon name="chevron-left" size={14} /> กลับ
      </button>
      <div className="me-card">
        <div className="me-section-title">
          <AppIcon name="ot" size={18} /> ยื่นขอค่าล่วงเวลา (OT)
        </div>
        <form onSubmit={handleSubmit}>
          <div className="me-field">
            <label>วันที่ทำ OT</label>
            <input
              type="date"
              className="me-input"
              value={form.ot_date}
              onChange={(e) => setForm({ ...form, ot_date: e.target.value })}
              required
            />
          </div>
          <div className="me-field">
            <label>จำนวนชั่วโมง</label>
            <input
              type="number"
              className="me-input"
              min="0.5"
              max="12"
              step="0.5"
              value={form.hours}
              onChange={(e) => setForm({ ...form, hours: e.target.value })}
              placeholder="เช่น 2.0"
              required
            />
          </div>
          <div className="me-field">
            <label>รายละเอียดงานล่วงเวลา</label>
            <textarea
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              placeholder="ระบุงานที่ทำ เช่น ส่งสินค้ารอบค่ำ หรือจัดเรียงคลังสินค้า"
            />
          </div>
          <button className="me-btn" disabled={loading}>
            {loading ? 'กำลังส่งคำขอ...' : 'ยื่นขอ OT'}
          </button>
        </form>
      </div>

      <div className="me-card">
        <div className="me-section-title">
          <AppIcon name="file-text" size={18} /> รายการ OT ย้อนหลัง
        </div>
        {!loaded && <div className="me-empty">กำลังโหลด...</div>}
        {loaded && items.length === 0 && <div className="me-empty">ยังไม่มีรายการ OT</div>}
        {items.map((item) => {
          const badge = STATUS_BADGE[item.status] || STATUS_BADGE.pending;
          return (
            <div key={item.id} className="me-row">
              <span className="k">
                {item.ot_date} · {Number(item.hours)} ชม. · {Number(item.amount || 0).toLocaleString()} ฿
              </span>
              <span className={`me-badge ${badge.cls}`}>{badge.label}</span>
            </div>
          );
        })}
      </div>
    </>
  );
}
export const OtTab = OtSection;

/* ═══════════════════ ROOMS SUB-SECTION ═══════════════════ */
export function RoomsSection({ back, showToast }) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [data, setData] = useState(null);
  const [form, setForm] = useState({ room_id: '', start_time: '09:00', end_time: '10:00', title: '' });
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    fetch(`/api/me/rooms?date=${date}`, { headers: authHeaders() })
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
  }, [date]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch('/api/me/rooms', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ ...form, book_date: date }),
      });
      const d = await res.json();
      if (!res.ok) {
        showToast(d.error, true);
        return;
      }
      showToast('จองห้องประชุมเรียบร้อย');
      setForm({ room_id: '', start_time: '09:00', end_time: '10:00', title: '' });
      load();
    } catch {
      showToast('เกิดข้อผิดพลาด', true);
    } finally {
      setLoading(false);
    }
  };

  const rooms = data?.rooms || [];
  const bookings = data?.bookings || [];

  return (
    <>
      <button
        className="me-badge me-badge-gray"
        style={{ cursor: 'pointer', border: 'none', marginBottom: 12, padding: '7px 14px', display: 'inline-flex', alignItems: 'center', gap: 6 }}
        onClick={back}
      >
        <AppIcon name="chevron-left" size={14} /> กลับ
      </button>
      <div className="me-card">
        <div className="me-section-title">
          <AppIcon name="rooms" size={18} /> จองห้องประชุม / พื้นที่อบรม
        </div>
        <form onSubmit={handleSubmit}>
          <div className="me-field">
            <label>วันที่</label>
            <input type="date" className="me-input" value={date} onChange={(e) => setDate(e.target.value)} required />
          </div>
          <div className="me-field">
            <label>ห้องประชุม</label>
            <select value={form.room_id} onChange={(e) => setForm({ ...form, room_id: e.target.value })} required>
              <option value="">— เลือกห้อง —</option>
              {rooms.map((r) => (
                <option key={r.id} value={r.id} disabled={r.status !== 'available'}>
                  {r.name} (จุ {r.capacity} คน){r.status !== 'available' ? ' — ปิดจอง' : ''}
                </option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <div className="me-field" style={{ flex: 1 }}>
              <label>เวลาเริ่ม</label>
              <input type="time" className="me-input" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} required />
            </div>
            <div className="me-field" style={{ flex: 1 }}>
              <label>เวลาสิ้นสุด</label>
              <input type="time" className="me-input" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} required />
            </div>
          </div>
          <div className="me-field">
            <label>หัวข้อการประชุม</label>
            <input
              type="text"
              className="me-input"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="เช่น ประชุมสรุปงานประจำวัน"
            />
          </div>
          <button className="me-btn" disabled={loading}>
            {loading ? 'กำลังบันทึก...' : 'ยืนยันการจองห้อง'}
          </button>
        </form>
      </div>

      <div className="me-card">
        <div className="me-section-title">
          <AppIcon name="calendar" size={18} /> ตารางจองวันที่เลือก
        </div>
        {bookings.length === 0 && <div className="me-empty">ยังไม่มีการจองในวันนี้</div>}
        {bookings.map((b) => {
          const room = rooms.find((r) => r.id === b.room_id);
          return (
            <div key={b.id} className="me-row">
              <span className="k">{room?.name || `ห้อง #${b.room_id}`} · {(b.start_time || '').slice(0, 5)}-{(b.end_time || '').slice(0, 5)}</span>
              <span className="v">{b.title || '-'}</span>
            </div>
          );
        })}
      </div>

      <div className="me-card">
        <div className="me-section-title">
          <AppIcon name="check-circle" size={18} /> การจองของฉัน
        </div>
        {(data?.myBookings || []).length === 0 && <div className="me-empty">ยังไม่มีการจอง</div>}
        {(data?.myBookings || []).map((b) => (
          <div key={b.id} className="me-row">
            <span className="k">{b.book_date} · {(b.start_time || '').slice(0, 5)}-{(b.end_time || '').slice(0, 5)}</span>
            <span className="v">{b.title || '-'}</span>
          </div>
        ))}
      </div>
    </>
  );
}
export const RoomsTab = RoomsSection;

/* ═══════════════════ WORKPLACE (อบรม / ทริป / OKR) ═══════════════════ */
export function WorkplaceSection({ back, showToast }) {
  const [data, setData] = useState(null);
  const [editingOkr, setEditingOkr] = useState(null);
  const [newProg, setNewProg] = useState(0);
  const [savingOkr, setSavingOkr] = useState(false);

  const loadData = () => {
    fetch('/api/me/workplace', { headers: authHeaders() })
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleUpdateOkr = async (okrId) => {
    setSavingOkr(true);
    try {
      const res = await fetch('/api/me/workplace', {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ okrId, progress: newProg }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'อัปเดตไม่สำเร็จ');
      if (showToast) showToast('อัปเดตความคืบหน้า OKR เรียบร้อย');
      setEditingOkr(null);
      loadData();
    } catch (err) {
      if (showToast) showToast(err.message, true);
    } finally {
      setSavingOkr(false);
    }
  };

  const TRAIN_STATUS = { planned: 'กำหนดการ', done: 'จบแล้ว' };

  return (
    <>
      <button
        className="me-badge me-badge-gray"
        style={{ cursor: 'pointer', border: 'none', marginBottom: 12, padding: '7px 14px', display: 'inline-flex', alignItems: 'center', gap: 6 }}
        onClick={back}
      >
        <AppIcon name="chevron-left" size={14} /> กลับ
      </button>

      <div className="me-card">
        <div className="me-section-title">
          <AppIcon name="graduation-cap" size={18} /> ตารางอบรมและพัฒนาทักษะ
        </div>
        {!data && <div className="me-empty">กำลังโหลด...</div>}
        {data && (data.trainings || []).length === 0 && <div className="me-empty">ยังไม่มีการอบรม</div>}
        {(data?.trainings || []).map((t) => (
          <div key={t.id} className="me-row">
            <span className="k">{t.title}{t.train_date ? ` · ${t.train_date}` : ''}</span>
            <span className={`me-badge ${t.status === 'done' ? 'me-badge-gray' : 'me-badge-green'}`}>
              {TRAIN_STATUS[t.status] || t.status}
            </span>
          </div>
        ))}
      </div>

      <div className="me-card">
        <div className="me-section-title">
          <AppIcon name="trips" size={18} /> ทริปบริษัทและการเดินทาง
        </div>
        {data && (data.trips || []).length === 0 && <div className="me-empty">ยังไม่มีทริป</div>}
        {(data?.trips || []).map((t) => (
          <div key={t.id} className="me-row">
            <span className="k">{t.title}{t.destination ? ` · ${t.destination}` : ''}</span>
            <span className="v">{t.start_date || ''}</span>
          </div>
        ))}
      </div>

      <div className="me-card">
        <div className="me-section-title">
          <AppIcon name="trending-up" size={18} /> OKR และเป้าหมายการทำงาน
        </div>
        {data && (data.okrs || []).length === 0 && <div className="me-empty">ยังไม่มี OKR ที่ผูกกับคุณ</div>}
        {(data?.okrs || []).map((o) => (
          <div key={o.id} style={{ padding: '12px 0', borderBottom: '1px solid #F1F5F9' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{o.objective}</div>
              <button
                type="button"
                className="me-badge me-badge-blue"
                style={{ cursor: 'pointer', border: 'none', padding: '4px 10px', fontSize: 11.5 }}
                onClick={() => {
                  setEditingOkr(o.id);
                  setNewProg(Number(o.progress) || 0);
                }}
              >
                ปรับ %
              </button>
            </div>
            {o.key_results && <div style={{ fontSize: 13, color: '#64748B', marginTop: 4 }}>{o.key_results}</div>}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
              <div style={{ flex: 1, height: 8, background: '#F1F5F9', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{ width: `${Math.min(100, Number(o.progress) || 0)}%`, height: '100%', background: '#0284C7' }} />
              </div>
              <span style={{ fontSize: 12, fontWeight: 700, minWidth: 36, textAlign: 'right' }}>{Number(o.progress) || 0}%</span>
            </div>
            {editingOkr === o.id && (
              <div style={{ marginTop: 10, padding: 10, background: '#F8FAFC', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={newProg}
                  onChange={(e) => setNewProg(Number(e.target.value))}
                  style={{ flex: 1 }}
                />
                <span style={{ fontSize: 13, fontWeight: 700, minWidth: 40 }}>{newProg}%</span>
                <button
                  type="button"
                  className="me-btn-primary"
                  style={{ padding: '4px 12px', fontSize: 12 }}
                  disabled={savingOkr}
                  onClick={() => handleUpdateOkr(o.id)}
                >
                  {savingOkr ? '...' : 'บันทึก'}
                </button>
                <button
                  type="button"
                  className="me-badge me-badge-gray"
                  style={{ cursor: 'pointer', border: 'none', padding: '4px 10px', fontSize: 12 }}
                  onClick={() => setEditingOkr(null)}
                >
                  ยกเลิก
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
export const WorkplaceTab = WorkplaceSection;
export const TrainingTab = WorkplaceSection;

/* ═══════════════════ CALENDAR SUB-SECTION ═══════════════════ */
export function CalendarSection({ back }) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const currentMonthStr = todayStr.slice(0, 7);
  const [month, setMonth] = useState(currentMonthStr);
  const [selectedDate, setSelectedDate] = useState(todayStr);
  const [data, setData] = useState(null);
  const [touchStartX, setTouchStartX] = useState(null);

  useEffect(() => {
    fetch(`/api/me/calendar?month=${month}`, { headers: authHeaders() })
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
  }, [month]);

  const [y, m] = month.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const firstDow = new Date(y, m - 1, 1).getDay();
  const DOWS = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
  const workDays = new Set((data?.workSettings?.work_days || '1,2,3,4,5').split(',').filter(Boolean).map(Number));

  const shiftMap = {};
  const leaveMap = {};
  const attendMap = {};
  const holidayMap = {};
  const leaveTypeNameMap = {};

  if (data) {
    (data.leaveTypes || []).forEach((t) => { leaveTypeNameMap[t.code] = t.name; });
    (data.shifts || []).forEach((s) => { shiftMap[s.shift_date] = s; });
    (data.attendance || []).forEach((a) => { attendMap[a.work_date] = a; });
    (data.holidays || []).forEach((h) => { holidayMap[h.holiday_date] = h; });
    (data.leaves || []).forEach((l) => {
      if (!l.start_date || !l.end_date) return;
      const start = new Date(l.start_date + 'T00:00:00');
      const end = new Date(l.end_date + 'T00:00:00');
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        leaveMap[ds] = l;
      }
    });
  }

  const changeMonth = (delta) => {
    const d = new Date(y, m - 1 + delta, 1);
    const targetY = d.getFullYear();
    const targetM = String(d.getMonth() + 1).padStart(2, '0');
    const newMonth = `${targetY}-${targetM}`;
    setMonth(newMonth);
    if (newMonth === currentMonthStr) {
      setSelectedDate(todayStr);
    } else {
      setSelectedDate(`${newMonth}-01`);
    }
  };

  const handleTouchStart = (e) => {
    setTouchStartX(e.touches[0].clientX);
  };

  const handleTouchEnd = (e) => {
    if (touchStartX === null) return;
    const diff = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(diff) > 45) {
      if (diff > 0) changeMonth(-1);
      else changeMonth(1);
    }
    setTouchStartX(null);
  };

  const selHoliday = holidayMap[selectedDate];
  const selLeave = leaveMap[selectedDate];
  const selAttend = attendMap[selectedDate];
  const selShift = shiftMap[selectedDate];
  const selDateObj = selectedDate ? new Date(selectedDate + 'T00:00:00') : new Date();
  const selDow = selDateObj.getDay();
  const selIsWeeklyOff = !workDays.has(selDow);
  const isSelectedToday = selectedDate === todayStr;
  const isSelectedFuture = selectedDate > todayStr;
  const isSelectedPast = selectedDate < todayStr;

  const thaiDateFormatted = selDateObj.toLocaleDateString('th-TH', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const getLeaveName = (type) => leaveTypeNameMap[type] || type || 'ลา';

  return (
    <>
      <button
        className="me-badge me-badge-gray"
        style={{ cursor: 'pointer', border: 'none', marginBottom: 12, padding: '7px 14px', display: 'inline-flex', alignItems: 'center', gap: 6 }}
        onClick={back}
      >
        <AppIcon name="chevron-left" size={14} /> กลับ
      </button>

      {/* Calendar Grid Card */}
      <div className="me-card" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd} style={{ userSelect: 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <button
            type="button"
            className="me-header-btn"
            style={{ width: 40, height: 40, minWidth: 40, minHeight: 40 }}
            onClick={() => changeMonth(-1)}
            aria-label="เดือนก่อนหน้า"
          >
            <AppIcon name="chevron-left" size={16} />
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ fontWeight: 800, fontSize: 16, color: '#0F172A' }}>
              {new Date(y, m - 1).toLocaleDateString('th-TH', { month: 'long', year: 'numeric' })}
            </div>
            {month !== currentMonthStr && (
              <button
                type="button"
                onClick={() => {
                  setMonth(currentMonthStr);
                  setSelectedDate(todayStr);
                }}
                style={{
                  border: 'none',
                  background: '#F1F5F9',
                  color: '#0284C7',
                  fontSize: 11.5,
                  fontWeight: 700,
                  padding: '3px 10px',
                  borderRadius: 8,
                  cursor: 'pointer',
                }}
              >
                วันนี้
              </button>
            )}
          </div>
          <button
            type="button"
            className="me-header-btn"
            style={{ width: 40, height: 40, minWidth: 40, minHeight: 40 }}
            onClick={() => changeMonth(1)}
            aria-label="เดือนถัดไป"
          >
            <AppIcon name="chevron-right" size={16} />
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, textAlign: 'center', fontSize: 12 }}>
          {DOWS.map((d, i) => (
            <div key={d} style={{ fontWeight: 700, color: !workDays.has(i) ? '#DC2626' : '#64748B', padding: 4 }}>
              {d}
            </div>
          ))}

          {Array.from({ length: firstDow }, (_, i) => (
            <div key={`e${i}`} />
          ))}

          {Array.from({ length: daysInMonth }, (_, i) => {
            const day = i + 1;
            const dateStr = `${month}-${String(day).padStart(2, '0')}`;
            const isToday = dateStr === todayStr;
            const isSelected = dateStr === selectedDate;
            const shift = shiftMap[dateStr];
            const leave = leaveMap[dateStr];
            const attend = attendMap[dateStr];
            const holiday = holidayMap[dateStr];
            const dow = new Date(y, m - 1, day).getDay();
            const weeklyOff = !workDays.has(dow);

            return (
              <button
                key={day}
                type="button"
                onClick={() => setSelectedDate(dateStr)}
                style={{
                  padding: '6px 2px 4px',
                  borderRadius: 12,
                  minHeight: 56,
                  border: isSelected
                    ? '2px solid #0284C7'
                    : isToday
                    ? '2px solid #0F2942'
                    : '1px solid #F1F5F9',
                  background: isSelected
                    ? '#F0F9FF'
                    : holiday
                    ? '#FEF2F2'
                    : leave
                    ? '#FEF3C7'
                    : attend
                    ? '#F0FDF4'
                    : '#FFFFFF',
                  cursor: 'pointer',
                  textAlign: 'center',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'flex-start',
                  boxShadow: isSelected ? '0 2px 8px rgba(2, 132, 199, 0.2)' : 'none',
                }}
              >
                <div
                  style={{
                    fontWeight: isSelected || isToday ? 800 : 600,
                    fontSize: 13,
                    width: 24,
                    height: 24,
                    lineHeight: '24px',
                    borderRadius: '50%',
                    background: isSelected ? '#0284C7' : 'transparent',
                    color: isSelected ? '#FFFFFF' : holiday || weeklyOff ? '#DC2626' : '#0F172A',
                  }}
                >
                  {day}
                </div>

                <div style={{ display: 'flex', gap: 2, marginTop: 2, alignItems: 'center', justifyContent: 'center' }}>
                  {holiday && <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#DC2626' }} />}
                  {attend && <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#16A34A' }} />}
                  {leave && <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#D97706' }} />}
                  {shift && <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#0284C7' }} />}
                </div>

                {holiday ? (
                  <div style={{ fontSize: 8.5, color: '#DC2626', lineHeight: 1.1, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>
                    {holiday.name.slice(0, 4)}
                  </div>
                ) : attend ? (
                  <div style={{ fontSize: 8.5, color: '#16A34A', fontWeight: 600, marginTop: 2 }}>
                    {attend.clock_in?.slice(0, 5)}
                  </div>
                ) : leave ? (
                  <div style={{ fontSize: 8.5, color: '#B45309', fontWeight: 600, marginTop: 2 }}>
                    {getLeaveName(leave.leave_type).slice(0, 3)}
                  </div>
                ) : shift ? (
                  <div style={{ fontSize: 8.5, color: '#0369A1', marginTop: 2 }}>
                    {shift.shift_type === 'morning' ? 'กะเช้า' : shift.shift_type === 'afternoon' ? 'กะบ่าย' : 'กะดึก'}
                  </div>
                ) : null}
              </button>
            );
          })}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: 12, marginTop: 14, paddingTop: 10, borderTop: '1px solid #F1F5F9', fontSize: 11.5, color: '#64748B' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#16A34A' }} /> เข้างานแล้ว
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#DC2626' }} /> วันหยุด
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#D97706' }} /> วันลา
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#0284C7' }} /> ตารางกะ
          </span>
        </div>
      </div>

      {/* Selected Date Detail Card */}
      <div className="me-card" style={{ marginTop: 12 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12, gap: 8 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: '#0F172A', letterSpacing: '-0.01em' }}>
              {thaiDateFormatted}
            </div>
            <div style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>
              {selectedDate} · {isSelectedToday ? 'วันนี้' : isSelectedFuture ? 'วันข้างหน้า' : 'วันที่ผ่านมา'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {isSelectedToday && <span className="me-badge me-badge-navy">วันนี้</span>}
            {selHoliday ? (
              <span className="me-badge me-badge-red">วันหยุด</span>
            ) : selIsWeeklyOff ? (
              <span className="me-badge me-badge-gray">วันหยุดสัปดาห์</span>
            ) : (
              <span className="me-badge me-badge-blue">วันทำงาน</span>
            )}
          </div>
        </div>

        {selHoliday && (
          <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 12, padding: '12px 14px', marginBottom: 10 }}>
            <div style={{ fontWeight: 700, color: '#DC2626', fontSize: 13.5 }}>วันหยุด: {selHoliday.name}</div>
            {selHoliday.note && <div style={{ fontSize: 12, color: '#991B1B', marginTop: 4 }}>{selHoliday.note}</div>}
          </div>
        )}

        {selAttend && (
          <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 12, padding: '12px 14px', marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ fontWeight: 700, fontSize: 13.5, color: '#166534' }}>บันทึกการลงเวลา</div>
              <span className={`me-badge ${selAttend.status === 'late' ? 'me-badge-yellow' : 'me-badge-green'}`}>
                {selAttend.status === 'late' ? 'มาสาย' : 'ตรงเวลา'}
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div style={{ background: '#FFFFFF', padding: '9px 12px', borderRadius: 10, border: '1px solid #DCFCE7' }}>
                <div style={{ fontSize: 11, color: '#64748B' }}>เช็คอิน</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: '#15803D' }}>{selAttend.clock_in ? selAttend.clock_in.slice(0, 5) : '-'} น.</div>
              </div>
              <div style={{ background: '#FFFFFF', padding: '9px 12px', borderRadius: 10, border: '1px solid #DCFCE7' }}>
                <div style={{ fontSize: 11, color: '#64748B' }}>เช็คเอาท์</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: selAttend.clock_out ? '#15803D' : '#94A3B8' }}>{selAttend.clock_out ? `${selAttend.clock_out.slice(0, 5)} น.` : '—'}</div>
              </div>
            </div>
          </div>
        )}

        {selLeave && (
          <div style={{ background: '#FEFCE8', border: '1px solid #FEF08A', borderRadius: 12, padding: '12px 14px', marginBottom: 10 }}>
            <div style={{ fontWeight: 700, fontSize: 13.5, color: '#854D0E', marginBottom: 4 }}>
              การลา: {getLeaveName(selLeave.leave_type)} ({selLeave.days} วัน)
            </div>
            <div style={{ fontSize: 12.5, color: '#713F12' }}>{selLeave.reason || 'ไม่มีรายละเอียดเพิ่มเติม'}</div>
          </div>
        )}

        {selShift && (
          <div style={{ background: '#F0F9FF', border: '1px solid #BAE6FD', borderRadius: 12, padding: '12px 14px', marginBottom: 10 }}>
            <div style={{ fontWeight: 700, fontSize: 13.5, color: '#0369A1' }}>
              ตารางกะ: {selShift.shift_type} ({selShift.start_time?.slice(0, 5)} - {selShift.end_time?.slice(0, 5)} น.)
            </div>
            {selShift.note && <div style={{ fontSize: 12, color: '#0284C7', marginTop: 4 }}>{selShift.note}</div>}
          </div>
        )}

        {!selHoliday && !selIsWeeklyOff && !selAttend && !selLeave && !selShift && (
          <div style={{ background: '#F8FAFC', border: '1px dashed #CBD5E1', borderRadius: 12, padding: '14px', textAlign: 'center', color: '#64748B', fontSize: 13 }}>
            วันทำงานปกติ — ไม่มีรายการพิเศษในวันนี้
          </div>
        )}
      </div>
    </>
  );
}
export const CalendarTab = CalendarSection;

/* ═══════════════════ ATTENDANCE HISTORY SUB-SECTION ═══════════════════ */
export function AttendanceSection({ back }) {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [data, setData] = useState(null);

  useEffect(() => {
    fetch(`/api/me/attendance?month=${month}`, { headers: authHeaders() })
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
  }, [month]);

  const [y, m] = month.split('-').map(Number);
  const changeMonth = (delta) => {
    const d = new Date(y, m - 1 + delta, 1);
    const targetY = d.getFullYear();
    const targetM = String(d.getMonth() + 1).padStart(2, '0');
    setMonth(`${targetY}-${targetM}`);
  };

  const currentMonthStr = new Date().toISOString().slice(0, 7);
  const CHECK_TYPE_LABEL = { office: 'ออฟฟิศ', offsite: 'นอกสถานที่', wfh: 'WFH' };

  return (
    <>
      <button
        className="me-badge me-badge-gray"
        style={{ cursor: 'pointer', border: 'none', marginBottom: 12, padding: '7px 14px', display: 'inline-flex', alignItems: 'center', gap: 6 }}
        onClick={back}
      >
        <AppIcon name="chevron-left" size={14} /> กลับ
      </button>

      {data?.stats && (
        <div className="me-leave-grid" style={{ marginTop: 0, padding: 0, gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 14 }}>
          <div className="me-leave-card">
            <div className="me-leave-remain" style={{ color: '#16A34A' }}>{data.stats.onTime}</div>
            <div className="me-leave-label">ปกติ</div>
          </div>
          <div className="me-leave-card">
            <div className="me-leave-remain" style={{ color: '#D97706' }}>{data.stats.late}</div>
            <div className="me-leave-label">สาย</div>
          </div>
          <div className="me-leave-card">
            <div className="me-leave-remain" style={{ color: '#DC2626' }}>{data.stats.absent}</div>
            <div className="me-leave-label">ขาด</div>
          </div>
        </div>
      )}

      <div className="me-card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <button
            type="button"
            className="me-header-btn"
            style={{ width: 40, height: 40, minWidth: 40, minHeight: 40 }}
            onClick={() => changeMonth(-1)}
            aria-label="เดือนก่อนหน้า"
          >
            <AppIcon name="chevron-left" size={16} />
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ fontWeight: 800, fontSize: 16, color: '#0F172A' }}>
              {new Date(y, m - 1).toLocaleDateString('th-TH', { month: 'long', year: 'numeric' })}
            </div>
            {month !== currentMonthStr && (
              <button
                type="button"
                onClick={() => setMonth(currentMonthStr)}
                style={{
                  border: 'none',
                  background: '#F1F5F9',
                  color: '#0284C7',
                  fontSize: 11.5,
                  fontWeight: 700,
                  padding: '3px 10px',
                  borderRadius: 8,
                  cursor: 'pointer',
                }}
              >
                วันนี้
              </button>
            )}
          </div>
          <button
            type="button"
            className="me-header-btn"
            style={{ width: 40, height: 40, minWidth: 40, minHeight: 40 }}
            onClick={() => changeMonth(1)}
            aria-label="เดือนถัดไป"
          >
            <AppIcon name="chevron-right" size={16} />
          </button>
        </div>

        {!data && <div className="me-empty">กำลังโหลด...</div>}
        {data?.records?.length === 0 && <div className="me-empty">ไม่มีข้อมูลเดือนนี้</div>}
        {(data?.records || []).map((r) => (
          <div key={r.id} className="me-row" style={{ flexWrap: 'wrap' }}>
            <span className="k" style={{ minWidth: 80 }}>{r.work_date?.slice(5)}</span>
            <span style={{ fontSize: 12.5, color: '#64748B' }}>{CHECK_TYPE_LABEL[r.check_type] || 'ออฟฟิศ'}</span>
            <span className="v">
              {r.clock_in ? `${r.clock_in.slice(0, 5)}` : '—'}
              {' → '}
              {r.clock_out ? `${r.clock_out.slice(0, 5)}` : '—'}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
export const AttendanceTab = AttendanceSection;

/* ═══════════════════ EVALUATION SUB-SECTION ═══════════════════ */
export function EvaluationSection({ back, showToast }) {
  const [data, setData] = useState(null);
  const [viewTab, setViewTab] = useState('give');
  const [targetId, setTargetId] = useState('');
  const [period, setPeriod] = useState(new Date().getFullYear().toString());
  const [scores, setScores] = useState({ teamwork: 5, communication: 5, responsibility: 5, punctuality: 5, leadership: 5 });
  const [comments, setComments] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadData = () => {
    fetch('/api/me/evaluations', { headers: authHeaders() })
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!targetId.trim()) return showToast('กรุณาระบุรหัสพนักงานที่ต้องการประเมิน', true);
    setSubmitting(true);
    try {
      const res = await fetch('/api/me/evaluations', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ target_id: targetId.trim(), period, scores, comments }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'ส่งผลประเมินไม่สำเร็จ');
      showToast('ส่งผลประเมิน 360° เรียบร้อยแล้ว');
      setComments('');
      setTargetId('');
      setViewTab('give');
      loadData();
    } catch (err) {
      showToast(err.message, true);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <button
        className="me-badge me-badge-gray"
        style={{ cursor: 'pointer', border: 'none', marginBottom: 12, padding: '7px 14px', display: 'inline-flex', alignItems: 'center', gap: 6 }}
        onClick={back}
      >
        <AppIcon name="chevron-left" size={14} /> กลับ
      </button>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button
          className={`me-badge ${viewTab === 'give' ? 'me-badge-blue' : 'me-badge-gray'}`}
          style={{ cursor: 'pointer', border: 'none', padding: '8px 16px' }}
          onClick={() => setViewTab('give')}
        >
          ฉันประเมิน
        </button>
        <button
          className={`me-badge ${viewTab === 'received' ? 'me-badge-blue' : 'me-badge-gray'}`}
          style={{ cursor: 'pointer', border: 'none', padding: '8px 16px' }}
          onClick={() => setViewTab('received')}
        >
          ผลประเมินฉัน
        </button>
        <button
          className={`me-badge ${viewTab === 'form' ? 'me-badge-navy' : 'me-badge-gray'}`}
          style={{ cursor: 'pointer', border: 'none', padding: '8px 16px', marginLeft: 'auto' }}
          onClick={() => setViewTab('form')}
        >
          ประเมินเพื่อนร่วมงาน
        </button>
      </div>

      {!data && <div className="me-empty">กำลังโหลด...</div>}

      {viewTab === 'form' && (
        <form onSubmit={handleSubmit} className="me-card">
          <div className="me-section-title">
            <AppIcon name="evaluation" size={18} /> แบบประเมินเพื่อนร่วมงาน 360°
          </div>
          <div className="me-field">
            <label>รหัสพนักงานที่ต้องการประเมิน *</label>
            <input className="me-input" placeholder="เช่น DD-002, EMP002" value={targetId} onChange={(e) => setTargetId(e.target.value)} required />
          </div>
          <div className="me-field">
            <label>รอบการประเมิน (ปี/รอบ)</label>
            <input className="me-input" value={period} onChange={(e) => setPeriod(e.target.value)} required />
          </div>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>ให้คะแนนเกณฑ์การประเมิน (1-5)</div>
            {(data?.criteria || [
              { key: 'teamwork', label: 'การทำงานเป็นทีม' },
              { key: 'communication', label: 'การสื่อสาร' },
              { key: 'responsibility', label: 'ความรับผิดชอบ' },
              { key: 'punctuality', label: 'ความตรงต่อเวลา' },
              { key: 'leadership', label: 'ภาวะผู้นำ' },
            ]).map((c) => (
              <div key={c.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, fontSize: 13 }}>
                <span>{c.label}</span>
                <select className="me-input" style={{ width: 110 }} value={scores[c.key] || 5} onChange={(e) => setScores({ ...scores, [c.key]: Number(e.target.value) })}>
                  <option value={5}>5 - ดีเลิศ</option>
                  <option value={4}>4 - ดี</option>
                  <option value={3}>3 - ปานกลาง</option>
                  <option value={2}>2 - พอใช้</option>
                  <option value={1}>1 - ต้องปรับปรุง</option>
                </select>
              </div>
            ))}
          </div>
          <div className="me-field">
            <label>ข้อเสนอแนะเพิ่มเติม</label>
            <textarea value={comments} onChange={(e) => setComments(e.target.value)} placeholder="ข้อคิดเห็นหรือข้อเสนอแนะเพิ่มเติม..." />
          </div>
          <button type="submit" className="me-btn" disabled={submitting}>
            {submitting ? 'กำลังส่งข้อมูล...' : 'ส่งผลประเมิน'}
          </button>
        </form>
      )}

      {viewTab === 'give' && data && (
        <div className="me-card">
          <div className="me-section-title">
            <AppIcon name="star" size={18} /> รายการที่ฉันประเมิน
          </div>
          {(data.myEvaluations || []).length === 0 && <div className="me-empty">ยังไม่มีรายการ</div>}
          {(data.myEvaluations || []).map((e) => {
            const badge = STATUS_BADGE[e.status] || STATUS_BADGE.draft;
            return (
              <div key={e.id} className="me-row">
                <span className="k">ประเมิน {e.target_id} · รอบ {e.period}</span>
                <span className={`me-badge ${badge.cls}`}>{badge.label}</span>
              </div>
            );
          })}
        </div>
      )}

      {viewTab === 'received' && data && (
        <div className="me-card">
          <div className="me-section-title">
            <AppIcon name="target" size={18} /> คะแนนเฉลี่ยที่ฉันได้รับ
          </div>
          {!data.avgScores && <div className="me-empty">ยังไม่มีผลประเมิน</div>}
          {data.avgScores && (data.criteria || []).map((c) => (
            <div key={c.key} className="me-row">
              <span className="k">{c.label}</span>
              <span className="v">{data.avgScores[c.key] != null ? `${data.avgScores[c.key]} / 5` : '—'}</span>
            </div>
          ))}
          <div style={{ marginTop: 12, fontSize: 12, color: '#64748B' }}>
            จากผู้ประเมิน {data.receivedEvaluations?.length || 0} คน
          </div>
        </div>
      )}
    </>
  );
}
export const EvaluationTab = EvaluationSection;

/* ═══════════════════ 50 ทวิ SUB-SECTION ═══════════════════ */
export function TaxCertSection({ back, profile }) {
  const thisYearBE = new Date().getFullYear() + 543;
  const [year, setYear] = useState(thisYearBE);
  const [data, setData] = useState(null);
  const [showDoc, setShowDoc] = useState(false);

  useEffect(() => {
    fetch(`/api/me/tax-cert?year=${year}`, { headers: authHeaders() })
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
  }, [year]);

  const num = (v) => Number(v || 0).toLocaleString();

  return (
    <>
      <button
        className="me-badge me-badge-gray"
        style={{ cursor: 'pointer', border: 'none', marginBottom: 12, padding: '7px 14px', display: 'inline-flex', alignItems: 'center', gap: 6 }}
        onClick={back}
      >
        <AppIcon name="chevron-left" size={14} /> กลับ
      </button>
      <div className="me-card">
        <div className="me-section-title">
          <AppIcon name="receipt" size={18} /> หนังสือรับรองหักภาษี ณ ที่จ่าย (50 ทวิ)
        </div>
        <div className="me-field">
          <label>ปีภาษี (พ.ศ.)</label>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {[thisYearBE, thisYearBE - 1, thisYearBE - 2].map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
        {data && (
          <>
            <div className="me-row"><span className="k">เงินได้รวมทั้งปี</span><span className="v">{num(data.totalIncome)} ฿</span></div>
            <div className="me-row"><span className="k">ภาษีหัก ณ ที่จ่ายรวม</span><span className="v">{num(data.totalTax)} ฿</span></div>
            <div className="me-row"><span className="k">ประกันสังคมรวม</span><span className="v">{num(data.totalSso)} ฿</span></div>
            <div className="me-row"><span className="k">จำนวนงวด</span><span className="v">{data.months} งวด</span></div>
            {data.months > 0 ? (
              <button className="me-btn" style={{ marginTop: 14 }} onClick={() => setShowDoc(true)}>
                <AppIcon name="printer" size={16} /> ดู / บันทึก 50 ทวิ PDF
              </button>
            ) : (
              <div className="me-empty">ยังไม่มีข้อมูลเงินเดือนในปีนี้</div>
            )}
          </>
        )}
      </div>
      {showDoc && data && <TaxCertDocument cert={data} profile={profile} onClose={() => setShowDoc(false)} />}
    </>
  );
}
export const TaxCertTab = TaxCertSection;

export function TaxCertDocument({ cert, profile, onClose }) {
  const num = (v) => Number(v || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const incomeRows = [
    { no: '1.', label: 'เงินเดือน ค่าจ้าง เบี้ยเลี้ยง โบนัส ฯลฯ ตามมาตรา 40 (1)', amount: cert.totalIncome, tax: cert.totalTax },
    { no: '2.', label: 'ค่าธรรมเนียม ค่านายหน้า ฯลฯ ตามมาตรา 40 (2)', amount: 0, tax: 0 },
    { no: '3.', label: 'ค่าแห่งลิขสิทธิ์ ฯลฯ ตามมาตรา 40 (3)', amount: 0, tax: 0 },
    { no: '4.', label: 'ดอกเบี้ย เงินปันผล ฯลฯ ตามมาตรา 40 (4)', amount: 0, tax: 0 },
    { no: '5.', label: 'เงินได้ตามคำสั่งกรมสรรพากร (รางวัล ส่วนลด ฯลฯ)', amount: 0, tax: 0 },
    { no: '6.', label: 'อื่น ๆ', amount: 0, tax: 0 },
  ];

  return (
    <div className="me-doc-overlay">
      <div className="me-doc-actions">
        <button
          className="me-badge me-badge-gray"
          style={{ border: 'none', padding: '8px 16px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}
          onClick={onClose}
        >
          <AppIcon name="chevron-left" size={14} /> ปิด
        </button>
        <button
          className="me-badge me-badge-blue"
          style={{ border: 'none', padding: '8px 16px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}
          onClick={() => window.print()}
        >
          <AppIcon name="printer" size={15} /> พิมพ์ / บันทึก PDF
        </button>
      </div>
      <div className="me-doc-print">
        <div className="me-doc" style={{ fontSize: 12 }}>
          <div style={{ textAlign: 'right', fontSize: 10, color: '#64748B' }}>ฉบับที่ 1 (สำหรับผู้ถูกหักภาษี ณ ที่จ่าย)</div>
          <div className="me-doc-head" style={{ borderBottom: 'none', marginBottom: 8 }}>
            <div className="me-doc-title" style={{ marginTop: 4 }}>หนังสือรับรองการหักภาษี ณ ที่จ่าย</div>
            <div style={{ fontSize: 11.5 }}>ตามมาตรา 50 ทวิ แห่งประมวลรัษฎากร</div>
          </div>

          <div style={{ border: '1px solid #CBD5E1', padding: '8px 10px', marginBottom: 6, borderRadius: 6 }}>
            <div style={{ fontWeight: 700 }}>ผู้มีหน้าที่หักภาษี ณ ที่จ่าย :</div>
            <div>ชื่อ {COMPANY.legalName}</div>
            <div>ที่อยู่ {COMPANY.address}</div>
            <div>เลขประจำตัวผู้เสียภาษีอากร {COMPANY.taxId}</div>
          </div>
          <div style={{ border: '1px solid #CBD5E1', padding: '8px 10px', marginBottom: 8, borderRadius: 6 }}>
            <div style={{ fontWeight: 700 }}>ผู้ถูกหักภาษี ณ ที่จ่าย :</div>
            <div>ชื่อ {profile?.name || '-'}</div>
            <div>เลขประจำตัวผู้เสียภาษีอากร {profile?.taxId || profile?.nationalId || '-'}</div>
          </div>

          <table className="me-doc-table">
            <thead>
              <tr>
                <th style={{ width: 24 }}></th>
                <th>ประเภทเงินได้พึงประเมินที่จ่าย</th>
                <th className="r" style={{ width: 70 }}>วันเดือนปีภาษี</th>
                <th className="r" style={{ width: 90 }}>จำนวนเงินที่จ่าย</th>
                <th className="r" style={{ width: 80 }}>ภาษีที่หักและนำส่ง</th>
              </tr>
            </thead>
            <tbody>
              {incomeRows.map((r) => (
                <tr key={r.no}>
                  <td>{r.no}</td><td>{r.label}</td>
                  <td className="r">{r.amount ? cert.year : ''}</td>
                  <td className="r">{r.amount ? num(r.amount) : ''}</td>
                  <td className="r">{r.amount ? num(r.tax) : ''}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td></td><td>รวมเงินภาษีที่หักนำส่ง</td><td></td>
                <td className="r">{num(cert.totalIncome)}</td>
                <td className="r">{num(cert.totalTax)}</td>
              </tr>
            </tfoot>
          </table>

          <div style={{ margin: '6px 0', fontSize: 11.5 }}>
            กองทุนประกันสังคม {num(cert.totalSso)} บาท
          </div>
          <div className="me-doc-sign" style={{ marginTop: 22 }}>
            <div>ลงชื่อ ......................................... ผู้จ่ายเงิน</div>
            <div>วันที่ 31 / 12 / {cert.year}</div>
          </div>
          <div className="me-doc-foot">ออกให้เพื่อเป็นหลักฐานในการยื่นแบบแสดงรายการภาษีเงินได้บุคคลธรรมดา</div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════ ALLOWANCE (ลย.01) SUB-SECTION ═══════════════════ */
export const ALLOWANCE_GROUPS = [
  {
    key: 'family', icon: 'user', title: 'ตนเองและครอบครัว',
    desc: 'รายการลดหย่อนสำหรับตนเอง ครอบครัว ฝากครรภ์ บุตร และอุปการะเลี้ยงดูผู้พิการ',
    fields: [
      { key: 'spouse', label: 'คู่สมรสไม่มีเงินได้', type: 'check', value: 60000 },
      { key: 'children', label: 'จำนวนบุตร (คนละ 30,000)', type: 'count', unit: 30000 },
      { key: 'parents', label: 'อุปการะบิดามารดา (คนละ 30,000)', type: 'count', unit: 30000 },
    ],
  },
  {
    key: 'insurance', icon: 'shield', title: 'ประกัน',
    desc: 'รายการลดหย่อนสำหรับค่าประกันชีวิต ประกันชีวิตแบบบำนาญ และประกันสุขภาพ',
    fields: [
      { key: 'life_insurance', label: 'เบี้ยประกันชีวิต (สูงสุด 100,000)', type: 'baht' },
      { key: 'health_insurance', label: 'เบี้ยประกันสุขภาพ (สูงสุด 25,000)', type: 'baht' },
    ],
  },
  {
    key: 'fund', icon: 'wallet', title: 'กองทุน',
    desc: 'รายการลดหย่อนสำหรับกองทุนประกันสังคม RMF TESG และกองทุนสำรองเลี้ยงชีพ',
    fields: [
      { key: 'provident_fund', label: 'กองทุนสำรองเลี้ยงชีพ', type: 'baht' },
    ],
  },
  {
    key: 'other', icon: 'file-text', title: 'อื่นๆ',
    desc: 'รายการลดหย่อนอื่นๆ เช่น ดอกเบี้ยกู้ซื้อบ้าน เงินบริจาค',
    fields: [
      { key: 'mortgage', label: 'ดอกเบี้ยกู้ซื้อบ้าน (สูงสุด 100,000)', type: 'baht' },
      { key: 'donation', label: 'เงินบริจาค', type: 'baht' },
    ],
  },
];

export function groupTotal(group, form) {
  let sum = 0;
  for (const f of group.fields) {
    if (f.type === 'check') sum += form[f.key] ? f.value : 0;
    else if (f.type === 'count') sum += (Number(form[f.key]) || 0) * f.unit;
    else sum += Number(form[f.key]) || 0;
  }
  return sum;
}

export function AllowanceSection({ back, showToast }) {
  const thisYearBE = new Date().getFullYear() + 543;
  const [year, setYear] = useState(thisYearBE);
  const [form, setForm] = useState({});
  const [open, setOpen] = useState(null);
  const [saving, setSaving] = useState(false);
  const PERSONAL = 60000;

  useEffect(() => {
    fetch(`/api/me/allowances?year=${year}`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => setForm(d.allowance?.data || {}))
      .catch(() => {});
  }, [year]);

  const num = (v) => Number(v || 0).toLocaleString();
  const total = PERSONAL + ALLOWANCE_GROUPS.reduce((a, g) => a + groupTotal(g, form), 0);

  const save = async () => {
    setSaving(true);
    const res = await fetch('/api/me/allowances', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ year, data: form }),
    });
    setSaving(false);
    if (res.ok) showToast('บันทึกแบบลดหย่อนภาษีเรียบร้อย');
    else showToast('บันทึกไม่สำเร็จ', true);
  };

  const setF = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  return (
    <>
      <button
        className="me-badge me-badge-gray"
        style={{ cursor: 'pointer', border: 'none', marginBottom: 12, padding: '7px 14px', display: 'inline-flex', alignItems: 'center', gap: 6 }}
        onClick={back}
      >
        <AppIcon name="chevron-left" size={14} /> กลับ
      </button>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div className="me-section-title" style={{ margin: 0 }}>
          <AppIcon name="file-text" size={18} /> แบบลดหย่อนภาษี (ลย.01)
        </div>
        <select
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          style={{ width: 'auto', padding: '6px 12px', borderRadius: 10, border: '1px solid #CBD5E1', fontSize: 13 }}
        >
          {[thisYearBE, thisYearBE + 1].map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      </div>

      {ALLOWANCE_GROUPS.map((g) => {
        const gt = groupTotal(g, form) + (g.key === 'family' ? PERSONAL : 0);
        const isOpen = open === g.key;
        return (
          <div className="me-card" key={g.key} style={{ padding: 0, overflow: 'hidden' }}>
            <div
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 14, cursor: 'pointer' }}
              onClick={() => setOpen(isOpen ? null : g.key)}
            >
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  background: 'rgba(2, 132, 199, 0.08)',
                  color: '#0284C7',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <AppIcon name={g.icon} size={18} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{g.title}</div>
                <div style={{ fontSize: 12, color: '#64748B', lineHeight: 1.3 }}>{g.desc}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 700, color: gt > 0 ? '#0284C7' : '#64748B' }}>฿{num(gt)}</div>
                <div style={{ fontSize: 12, color: '#94A3B8' }}>{isOpen ? '▲' : '▼'}</div>
              </div>
            </div>

            {isOpen && (
              <div style={{ padding: '0 14px 14px', borderTop: '1px solid #F1F5F9' }}>
                {g.key === 'family' && (
                  <div className="me-row">
                    <span className="k">ลดหย่อนส่วนตัว (อัตโนมัติ)</span>
                    <span className="v">฿{num(PERSONAL)}</span>
                  </div>
                )}
                {g.fields.map((f) => (
                  <div className="me-field" key={f.key} style={{ marginTop: 10 }}>
                    <label>{f.label}</label>
                    {f.type === 'check' ? (
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={!!form[f.key]}
                          onChange={(e) => setF(f.key, e.target.checked)}
                          style={{ width: 'auto' }}
                        />
                        <span>มีสิทธิ์ (฿{num(f.value)})</span>
                      </label>
                    ) : (
                      <input
                        className="me-input"
                        type="number"
                        placeholder={f.type === 'count' ? 'จำนวน (คน)' : 'จำนวนเงิน'}
                        value={form[f.key] ?? ''}
                        onChange={(e) => setF(f.key, e.target.value === '' ? '' : Number(e.target.value))}
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      <div
        style={{
          position: 'sticky',
          bottom: 84,
          marginTop: 8,
          background: '#FFFFFF',
          border: '1px solid #E2E8F0',
          borderRadius: 16,
          padding: 14,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          boxShadow: '0 -2px 10px rgba(15, 23, 42, 0.08)',
        }}
      >
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, color: '#64748B' }}>ลดหย่อนรวมทั้งปี</div>
          <div style={{ fontWeight: 800, fontSize: 20, color: '#0284C7' }}>฿{num(total)}</div>
        </div>
        <button
          className="me-btn"
          style={{ width: 'auto', padding: '12px 24px', minHeight: 44 }}
          disabled={saving}
          onClick={save}
        >
          {saving ? 'กำลังบันทึก...' : 'บันทึกข้อมูล'}
        </button>
      </div>
    </>
  );
}
export const AllowanceTab = AllowanceSection;

/* ═══════════════════ TEAM APPROVAL SUB-SECTION ═══════════════════ */
export function TeamLeaveSection({ back, showToast }) {
  const [tab, setTab] = useState('leave');
  const [items, setItems] = useState([]);
  const [otItems, setOtItems] = useState([]);
  const [expenseItems, setExpenseItems] = useState([]);
  const [loaded, setLoaded] = useState(false);

  const load = () => {
    fetch('/api/me/team-leave', { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => {
        setItems(d.items || []);
        setOtItems(d.otItems || []);
        setExpenseItems(d.expenseItems || []);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  };

  useEffect(() => {
    load();
  }, []);

  const act = async (id, action, type = 'leave') => {
    const res = await fetch('/api/me/team-leave', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ id, action, type }),
    });
    const d = await res.json();
    if (res.ok) {
      showToast(action === 'approve' ? 'อนุมัติขั้นต้นแล้ว (ส่งต่อ HR)' : 'ปฏิเสธคำขอแล้ว');
      load();
    } else {
      showToast(d.error || 'ไม่สำเร็จ', true);
    }
  };

  const LB = { annual: 'พักร้อน', sick: 'ลาป่วย', personal: 'ลากิจ' };

  return (
    <>
      <button
        className="me-badge me-badge-gray"
        style={{ cursor: 'pointer', border: 'none', marginBottom: 12, padding: '7px 14px', display: 'inline-flex', alignItems: 'center', gap: 6 }}
        onClick={back}
      >
        <AppIcon name="chevron-left" size={14} /> กลับ
      </button>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button
          className={'me-badge ' + (tab === 'leave' ? 'me-badge-blue' : 'me-badge-gray')}
          style={{ border: 'none', padding: '8px 14px', cursor: 'pointer' }}
          onClick={() => setTab('leave')}
        >
          ใบลา ({items.filter((i) => i.manager_status === 'pending').length})
        </button>
        <button
          className={'me-badge ' + (tab === 'ot' ? 'me-badge-blue' : 'me-badge-gray')}
          style={{ border: 'none', padding: '8px 14px', cursor: 'pointer' }}
          onClick={() => setTab('ot')}
        >
          OT ({otItems.filter((i) => i.status === 'pending' && !String(i.note || '').includes('[หัวหน้าอนุมัติ:')).length})
        </button>
        <button
          className={'me-badge ' + (tab === 'expense' ? 'me-badge-blue' : 'me-badge-gray')}
          style={{ border: 'none', padding: '8px 14px', cursor: 'pointer' }}
          onClick={() => setTab('expense')}
        >
          เบิกจ่าย ({expenseItems.filter((i) => i.status === 'pending' && !String(i.description || '').includes('[หัวหน้าอนุมัติ:')).length})
        </button>
      </div>

      {tab === 'leave' && (
        <div className="me-card">
          <div className="me-section-title">
            <AppIcon name="check-circle" size={18} /> อนุมัติการลาของลูกทีม (ขั้นที่ 1 → HR)
          </div>
          {loaded && items.length === 0 && <div className="me-empty">ไม่มีใบลาของลูกทีม</div>}
          {items.map((l) => (
            <div key={l.id} style={{ borderTop: '1px solid #F1F5F9', padding: '12px 0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 700 }}>{l.employeeName}</span>
                <span className={'me-badge ' + (l.manager_status === 'pending' ? 'me-badge-yellow' : l.manager_status === 'approved' ? 'me-badge-green' : 'me-badge-red')}>
                  {l.manager_status === 'pending' ? 'รอหัวหน้า' : l.manager_status === 'approved' ? 'ส่งต่อ HR แล้ว' : 'ปฏิเสธ'}
                </span>
              </div>
              <div style={{ fontSize: 13, color: '#64748B', margin: '4px 0' }}>
                {LB[l.leave_type] || l.leave_type} · {l.days} วัน · {l.start_date} ถึง {l.end_date}
              </div>
              {l.reason && <div style={{ fontSize: 12.5, color: '#0F172A' }}>เหตุผล: {l.reason}</div>}
              {l.manager_status === 'pending' && (
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <button className="me-btn" style={{ flex: 1, background: '#16A34A' }} onClick={() => act(l.id, 'approve', 'leave')}>
                    <AppIcon name="check" size={14} /> อนุมัติส่งต่อ HR
                  </button>
                  <button className="me-btn" style={{ flex: 1, background: '#DC2626' }} onClick={() => act(l.id, 'reject', 'leave')}>
                    <AppIcon name="x" size={14} /> ปฏิเสธ
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === 'ot' && (
        <div className="me-card">
          <div className="me-section-title">
            <AppIcon name="ot" size={18} /> อนุมัติ OT ลูกทีม (ขั้นที่ 1 → HR)
          </div>
          {loaded && otItems.length === 0 && <div className="me-empty">ไม่มีคำขอ OT ของลูกทีม</div>}
          {otItems.map((o) => {
            const mgrApproved = String(o.note || '').includes('[หัวหน้าอนุมัติ:');
            return (
              <div key={o.id} style={{ borderTop: '1px solid #F1F5F9', padding: '12px 0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 700 }}>{o.employeeName}</span>
                  <span className={'me-badge ' + (o.status === 'approved' ? 'me-badge-green' : o.status === 'rejected' ? 'me-badge-red' : mgrApproved ? 'me-badge-blue' : 'me-badge-yellow')}>
                    {o.status === 'approved' ? 'HR อนุมัติแล้ว' : o.status === 'rejected' ? 'ปฏิเสธ' : mgrApproved ? 'ส่งต่อ HR แล้ว' : 'รอหัวหน้า'}
                  </span>
                </div>
                <div style={{ fontSize: 13, color: '#64748B', margin: '4px 0' }}>
                  วันที่ {o.ot_date} · {o.hours} ชม. (x{o.rate || 1.5})
                </div>
                {o.note && <div style={{ fontSize: 12.5, color: '#0F172A' }}>{o.note}</div>}
                {o.status === 'pending' && !mgrApproved && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                    <button className="me-btn" style={{ flex: 1, background: '#16A34A' }} onClick={() => act(o.id, 'approve', 'ot')}>
                      <AppIcon name="check" size={14} /> อนุมัติส่งต่อ HR
                    </button>
                    <button className="me-btn" style={{ flex: 1, background: '#DC2626' }} onClick={() => act(o.id, 'reject', 'ot')}>
                      <AppIcon name="x" size={14} /> ปฏิเสธ
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {tab === 'expense' && (
        <div className="me-card">
          <div className="me-section-title">
            <AppIcon name="receipt" size={18} /> อนุมัติเบิกจ่ายลูกทีม (ขั้นที่ 1 → HR)
          </div>
          {loaded && expenseItems.length === 0 && <div className="me-empty">ไม่มีรายการเบิกของลูกทีม</div>}
          {expenseItems.map((ex) => {
            const rawDesc = String(ex.description || '');
            const mgrApproved = rawDesc.includes('[หัวหน้าอนุมัติ:');
            const receiptMatch = rawDesc.match(/\[RECEIPT:([^\]]+)\]/);
            const receiptFile = receiptMatch ? receiptMatch[1].trim() : null;
            const cleanDesc = rawDesc.replace(/\[RECEIPT:[^\]]+\]/g, '').trim();
            const catLabel = EXPENSE_CATS.find((c) => c.value === ex.category)?.label || ex.category;

            return (
              <div key={ex.id} style={{ borderTop: '1px solid #F1F5F9', padding: '12px 0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 700 }}>{ex.employeeName}</span>
                  <span className={'me-badge ' + (ex.status === 'approved' || ex.status === 'paid' ? 'me-badge-green' : ex.status === 'rejected' ? 'me-badge-red' : mgrApproved ? 'me-badge-blue' : 'me-badge-yellow')}>
                    {ex.status === 'approved' ? 'HR อนุมัติแล้ว' : ex.status === 'paid' ? 'จ่ายแล้ว' : ex.status === 'rejected' ? 'ปฏิเสธ' : mgrApproved ? 'ส่งต่อ HR แล้ว' : 'รอหัวหน้า'}
                  </span>
                </div>
                <div style={{ fontSize: 13, color: '#64748B', margin: '4px 0' }}>
                  {catLabel} · {Number(ex.amount || 0).toLocaleString()} ฿ · วันที่ {ex.claim_date}
                </div>
                {cleanDesc && <div style={{ fontSize: 12.5, color: '#0F172A' }}>{cleanDesc}</div>}
                {receiptFile && (
                  <div style={{ marginTop: 4 }}>
                    <a href={assetImg(receiptFile)} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: '#0284C7', fontWeight: 600 }}>
                      ดูใบเสร็จแนบ
                    </a>
                  </div>
                )}
                {ex.status === 'pending' && !mgrApproved && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                    <button className="me-btn" style={{ flex: 1, background: '#16A34A' }} onClick={() => act(ex.id, 'approve', 'expense')}>
                      <AppIcon name="check" size={14} /> อนุมัติส่งต่อ HR
                    </button>
                    <button className="me-btn" style={{ flex: 1, background: '#DC2626' }} onClick={() => act(ex.id, 'reject', 'expense')}>
                      <AppIcon name="x" size={14} /> ปฏิเสธ
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
export const TeamLeaveTab = TeamLeaveSection;

/* ═══════════════════ DOCUMENT REQUESTS SUB-SECTION ═══════════════════ */
export function DocumentRequestsSection({ back, showToast, profile }) {
  const [data, setData] = useState(null);
  const [form, setForm] = useState({ document_type: 'salary_certificate', purpose: '' });
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = () => {
    fetch('/api/me/document-requests', { headers: authHeaders() })
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
  };

  useEffect(() => {
    load();
  }, []);

  async function submit(e) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch('/api/me/document-requests', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(form),
      });
      const d = await res.json();
      if (!res.ok) {
        showToast(d.error || 'ส่งคำขอไม่สำเร็จ', true);
        return;
      }
      showToast('ส่งคำขอเอกสารแล้ว รอ HR อนุมัติ');
      setForm({ document_type: 'salary_certificate', purpose: '' });
      setData((p) => ({ ...(p || {}), requests: [d.item, ...(p?.requests || [])] }));
    } catch {
      showToast('เชื่อมต่อไม่สำเร็จ', true);
    } finally {
      setLoading(false);
    }
  }

  const requests = data?.requests || [];

  return (
    <>
      <button
        className="me-badge me-badge-gray"
        style={{ cursor: 'pointer', border: 'none', marginBottom: 12, padding: '7px 14px', display: 'inline-flex', alignItems: 'center', gap: 6 }}
        onClick={back}
      >
        <AppIcon name="chevron-left" size={14} /> กลับ
      </button>

      <div className="me-card">
        <div className="me-section-title">
          <AppIcon name="document-requests" size={18} /> ขอหนังสือรับรองเงินเดือน / การทำงาน
        </div>
        <form onSubmit={submit}>
          <div className="me-field">
            <label>ประเภทเอกสาร</label>
            <select value={form.document_type} onChange={(e) => setForm((p) => ({ ...p, document_type: e.target.value }))}>
              <option value="salary_certificate">หนังสือรับรองเงินเดือน</option>
              <option value="employment_certificate">หนังสือรับรองการทำงาน</option>
            </select>
          </div>
          <div className="me-field">
            <label>วัตถุประสงค์ในการขอ</label>
            <textarea
              value={form.purpose}
              onChange={(e) => setForm((p) => ({ ...p, purpose: e.target.value }))}
              placeholder="เช่น ใช้ประกอบการขอสินเชื่อ / สมัครเรียน / ยื่นราชการ"
              required
            />
          </div>
          <button className="me-btn" disabled={loading}>
            {loading ? 'กำลังส่งคำขอ...' : 'ส่งคำขอเอกสารรับรอง'}
          </button>
        </form>
      </div>

      <div className="me-card">
        <div className="me-section-title">
          <AppIcon name="file-text" size={18} /> รายการคำขอของฉัน
        </div>
        {!data && <div className="me-empty">กำลังโหลด...</div>}
        {data && requests.length === 0 && <div className="me-empty">ยังไม่มีคำขอเอกสาร</div>}
        {requests.map((item) => {
          const badge = STATUS_BADGE[item.status] || STATUS_BADGE.pending;
          return (
            <div key={item.id} style={{ borderTop: '1px solid #F1F5F9', padding: '12px 0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontWeight: 700 }}>{CERTIFICATE_TYPES[item.document_type] || item.document_type}</span>
                <span className={`me-badge ${badge.cls}`}>{badge.label}</span>
              </div>
              <div style={{ color: '#64748B', fontSize: 12.5, marginTop: 3 }}>ยื่นเมื่อ {thaiDateShort(item.requested_at)}</div>
              {item.purpose && <div style={{ color: '#0F172A', fontSize: 13, marginTop: 4 }}>วัตถุประสงค์: {item.purpose}</div>}
              {item.review_note && <div style={{ color: '#64748B', fontSize: 13, marginTop: 4 }}>หมายเหตุ HR: {item.review_note}</div>}
              {item.status === 'approved' && (
                <button
                  className="me-btn"
                  style={{ marginTop: 10, minHeight: 40 }}
                  onClick={() => setSelected(item)}
                >
                  <AppIcon name="printer" size={15} /> ดู / บันทึก PDF
                </button>
              )}
            </div>
          );
        })}
      </div>

      {selected && (
        <CertificateDocument
          request={selected}
          fallbackProfile={profile}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}
export const DocumentRequestsTab = DocumentRequestsSection;

export function CertificateDocument({ request, fallbackProfile, onClose }) {
  const docProfile = request.employeeProfile || fallbackProfile || {};
  const isSalary = request.document_type === 'salary_certificate';
  const title = CERTIFICATE_TYPES[request.document_type] || 'หนังสือรับรอง';
  const salary = Number(docProfile.salary) || Number(request.latestPayslip?.base_salary) || 0;
  const issuedDate = thaiDate(request.approved_at || new Date().toISOString());
  const purpose = request.purpose || 'ใช้เป็นหลักฐานตามที่พนักงานร้องขอ';
  const signature = request.signatureAsset;
  const stamp = request.stampAsset;
  const logo = request.logoAsset;
  const logoSrc = logo?.image_url ? storedImage(logo.image_url) : '/brand/hr-pro-logo.svg';
  const startDate = docProfile.startDate ? thaiDate(docProfile.startDate) : '-';
  const employeeName = docProfile.name || '-';
  const employeeId = docProfile.employeeId || request.employee_id;
  const position = docProfile.position || '-';
  const department = docProfile.department || '-';
  const salaryText = salary.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="me-doc-overlay">
      <div className="me-doc-actions">
        <button
          className="me-badge me-badge-gray"
          style={{ border: 'none', padding: '8px 16px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}
          onClick={onClose}
        >
          <AppIcon name="chevron-left" size={14} /> ปิด
        </button>
        <button
          className="me-badge me-badge-blue"
          style={{ border: 'none', padding: '8px 16px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}
          onClick={() => window.print()}
        >
          <AppIcon name="printer" size={15} /> พิมพ์ / บันทึก PDF
        </button>
      </div>
      <div className="me-doc-print">
        <div className="me-doc me-cert-doc">
          <div className="me-doc-head">
            <img className="me-doc-logo me-cert-logo" src={logoSrc} alt="" />
            <div className="me-doc-co">{COMPANY.legalName}</div>
            <div className="me-doc-addr">{COMPANY.nameEn}</div>
            <div className="me-doc-addr">{COMPANY.address}</div>
            <div className="me-doc-addr">เลขประจำตัวผู้เสียภาษี {COMPANY.taxId}</div>
          </div>

          <div className="me-cert-ref">เลขที่เอกสาร HR-CERT-{String(request.id).padStart(5, '0')}</div>
          <div className="me-doc-title me-cert-title">{title}</div>
          <div className="me-cert-date">ออกให้ ณ วันที่ {issuedDate}</div>

          <div className="me-cert-body">
            {isSalary ? (
              <>
                <p>หนังสือฉบับนี้ออกเพื่อรับรองว่า คุณ{employeeName} รหัสพนักงาน {employeeId} เป็นพนักงานของ {COMPANY.legalName}</p>
                <p>ปฏิบัติงานในตำแหน่ง {position} แผนก/ฝ่าย {department} โดยเริ่มทำงานตั้งแต่วันที่ {startDate} จนถึงปัจจุบัน</p>
                <p>มีอัตราเงินเดือนประจำเดือนละ {salaryText} บาท ({thaiBahtText(salary)}) ซึ่งอัตรานี้ยังไม่รวมค่าตอบแทนและเงินพิเศษอื่นๆ</p>
                <p>หนังสือรับรองเงินเดือนฉบับนี้ใช้เพื่อ {purpose} เท่านั้น</p>
              </>
            ) : (
              <>
                <p>ขอรับรองว่า คุณ{employeeName} รหัสพนักงาน {employeeId} เป็นพนักงานของ {COMPANY.legalName}</p>
                <p>ปฏิบัติงานในตำแหน่ง {position} แผนก/ฝ่าย {department} เริ่มปฏิบัติงานตั้งแต่วันที่ {startDate} จนถึงปัจจุบัน</p>
                <p>ตลอดระยะเวลาการปฏิบัติงาน พนักงานดังกล่าวอยู่ในสถานะพนักงานของบริษัทตามข้อมูลที่บริษัทมีอยู่ในระบบ</p>
                <p>หนังสือรับรองการทำงานฉบับนี้ออกให้เพื่อ {purpose}</p>
              </>
            )}
            <p>จึงออกหนังสือรับรองฉบับนี้ไว้เป็นหลักฐาน</p>
          </div>

          <div className="me-cert-assets">
            {stamp?.image_url && <img className="me-cert-stamp" src={storedImage(stamp.image_url)} alt={stamp.name || 'company stamp'} />}
            <div className="me-cert-sign-box">
              {signature?.image_url && <img className="me-cert-signature-img" src={storedImage(signature.image_url)} alt={signature.name || 'signature'} />}
              <div className="me-cert-sign-line">ลงชื่อ ................................................ ผู้รับรอง</div>
              <div>{signature?.signer_name || request.approved_by || 'ผู้มีอำนาจลงนาม'}</div>
              <div>{signature?.signer_title || 'ฝ่ายทรัพยากรบุคคล'}</div>
              <div className="me-cert-issued-by">วันที่ {issuedDate}</div>
            </div>
          </div>

          <div className="me-cert-contact">สอบถามฝ่ายบุคคล{COMPANY.phone ? ` โทร. ${COMPANY.phone}` : ''}</div>
          <div className="me-doc-foot">เอกสารนี้ออกจากระบบ HR Pro Suite ตามคำขอเลขที่ #{request.id}</div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════ ASSETS SUB-SECTION ═══════════════════ */
export const ASSET_STATUS = {
  available: { c: 'me-badge-green', l: 'ว่าง' },
  assigned: { c: 'me-badge-blue', l: 'มีคนใช้' },
  repair: { c: 'me-badge-yellow', l: 'ส่งซ่อม' },
  retired: { c: 'me-badge-gray', l: 'ปลดระวาง' },
};
export const ASSET_REQ_TYPE = { borrow: 'ขอเบิก', return: 'ขอคืน', replace: 'ขอเปลี่ยน' };

export function AssetsSection({ back, showToast }) {
  const [data, setData] = useState(null);
  const [modal, setModal] = useState(null);
  const [targetBranch, setTargetBranch] = useState('');
  const [reason, setReason] = useState('');

  const load = () => {
    fetch('/api/me/assets', { headers: authHeaders() })
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
  };

  useEffect(() => {
    load();
  }, []);

  const openReq = (asset, type) => {
    setModal({ asset, type });
    setTargetBranch('');
    setReason('');
  };

  const submit = async () => {
    const res = await fetch('/api/me/assets', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        asset_id: modal.asset.id,
        type: modal.type,
        target_branch_id: targetBranch || null,
        reason,
      }),
    });
    const d = await res.json();
    if (res.ok) {
      showToast('ส่งคำขอแล้ว รอ HR อนุมัติ');
      setModal(null);
      load();
    } else {
      showToast(d.error || 'ส่งไม่สำเร็จ', true);
    }
  };

  if (!data) return <div className="me-empty">กำลังโหลด...</div>;

  return (
    <>
      <button
        className="me-badge me-badge-gray"
        style={{ cursor: 'pointer', border: 'none', marginBottom: 12, padding: '7px 14px', display: 'inline-flex', alignItems: 'center', gap: 6 }}
        onClick={back}
      >
        <AppIcon name="chevron-left" size={14} /> กลับ
      </button>

      {data.myRequests.length > 0 && (
        <div className="me-card">
          <div className="me-section-title">
            <AppIcon name="file-text" size={18} /> คำขอทรัพย์สินของฉัน
          </div>
          {data.myRequests.map((r) => (
            <div key={r.id} className="me-row">
              <span className="k">{ASSET_REQ_TYPE[r.type]} · #{r.asset_id}</span>
              <span className={`me-badge ${STATUS_BADGE[r.status]?.cls || 'me-badge-yellow'}`}>
                {STATUS_BADGE[r.status]?.label || r.status}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="me-card">
        <div className="me-section-title">
          <AppIcon name="package" size={18} /> รถขนส่ง / ทรัพย์สินและอุปกรณ์
        </div>
        {data.assets.length === 0 && <div className="me-empty">ยังไม่มีทรัพย์สิน</div>}
        {data.assets.map((a) => (
          <div key={a.id} style={{ borderTop: '1px solid #F1F5F9', padding: '12px 0', display: 'flex', gap: 12, alignItems: 'center' }}>
            {a.imageUrl ? (
              <img src={assetImg(a.imageUrl)} alt="" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 12, border: '1px solid #E2E8F0' }} />
            ) : (
              <div style={{ width: 56, height: 56, borderRadius: 12, background: '#F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748B' }}>
                <AppIcon name="package" size={26} />
              </div>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontWeight: 700 }}>{a.name}</span>
                <span className={`me-badge ${ASSET_STATUS[a.status]?.c || 'me-badge-gray'}`}>
                  {ASSET_STATUS[a.status]?.l || a.status}
                </span>
              </div>
              <div style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>
                {a.code} · {a.category || '-'} · สาขา {a.branchName}
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                {a.status === 'available' && !a.isMine && (
                  <button className="me-btn" style={{ padding: '6px 12px', width: 'auto', fontSize: 12.5, minHeight: 34 }} onClick={() => openReq(a, 'borrow')}>
                    เบิกใช้งาน
                  </button>
                )}
                {a.isMine && (
                  <>
                    <button className="me-btn" style={{ padding: '6px 12px', width: 'auto', fontSize: 12.5, minHeight: 34, background: '#16A34A' }} onClick={() => openReq(a, 'return')}>
                      ขอคืน
                    </button>
                    <button className="me-btn" style={{ padding: '6px 12px', width: 'auto', fontSize: 12.5, minHeight: 34, background: '#D97706' }} onClick={() => openReq(a, 'replace')}>
                      ขอเปลี่ยน
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {modal && (
        <div className="me-doc-overlay" style={{ background: 'rgba(15, 23, 42, 0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setModal(null)}>
          <div className="me-card" style={{ maxWidth: 380, width: '100%', margin: 16 }} onClick={(e) => e.stopPropagation()}>
            <div className="me-section-title">
              {ASSET_REQ_TYPE[modal.type]} · {modal.asset.name}
            </div>
            {modal.type !== 'return' && (
              <div className="me-field">
                <label>จัดส่งไปสาขา / สถานี</label>
                <select value={targetBranch} onChange={(e) => setTargetBranch(e.target.value)}>
                  <option value="">— เลือกสาขา —</option>
                  {(data.branches || []).map((b) => (
                    <option key={b.id} value={b.id}>{b.label}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="me-field">
              <label>เหตุผล / รายละเอียด</label>
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="ระบุเหตุผลในการขอเบิกหรือเปลี่ยน..." />
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button className="me-btn" style={{ background: '#F1F5F9', color: '#0F172A', border: '1px solid #CBD5E1' }} onClick={() => setModal(null)}>
                ยกเลิก
              </button>
              <button className="me-btn" onClick={submit}>
                ส่งคำขอ
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
export const AssetsTab = AssetsSection;

/* ═══════════════════ BENEFITS SUB-SECTION ═══════════════════ */
export function BenefitsTab({ back }) {
  const benefits = [
    { title: 'ประกันสังคมและกองทุนเงินทดแทน', desc: 'คุ้มครองตามสิทธิประกันสังคม มาตรา 33', icon: 'shield' },
    { title: 'ประกันอุบัติเหตุกลุ่มพนักงานขับรถ', desc: 'วงเงินคุ้มครองค่ารักษาพยาบาลและอุบัติเหตุจากการขนส่ง', icon: 'heart-pulse' },
    { title: 'เงินกู้สวัสดิการพนักงาน', desc: 'สินเชื่ออัตราดอกเบี้ยพิเศษเพื่อช่วยเหลือกรณีฉุกเฉิน', icon: 'wallet' },
    { title: 'ตรวจสุขภาพประจำปี', desc: 'ตรวจสุขภาพและสมรรถภาพการมองเห็นประจำปีสำหรับฝ่ายปฏิบัติการ', icon: 'heart-pulse' },
    { title: 'เบี้ยเลี้ยงและค่าล่วงเวลาพิเศษ', desc: 'ค่าเบี้ยเลี้ยงรายวันตามระยะทางและสถานีขนส่ง', icon: 'gift' },
  ];

  return (
    <>
      <button
        className="me-badge me-badge-gray"
        style={{ cursor: 'pointer', border: 'none', marginBottom: 12, padding: '7px 14px', display: 'inline-flex', alignItems: 'center', gap: 6 }}
        onClick={back}
      >
        <AppIcon name="chevron-left" size={14} /> กลับ
      </button>
      <div className="me-card">
        <div className="me-section-title">
          <AppIcon name="benefits" size={18} /> สวัสดิการและเงินกู้พนักงาน
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {benefits.map((b, i) => (
            <div key={i} className="me-row" style={{ alignItems: 'flex-start', padding: '12px 0' }}>
              <span className="k" style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <span className="me-menu-icon-badge" style={{ marginTop: 2 }}>
                  <AppIcon name={b.icon} size={18} />
                </span>
                <span>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{b.title}</div>
                  <div style={{ fontSize: 12.5, color: '#64748B', marginTop: 3 }}>{b.desc}</div>
                </span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

/* ═══════════════════ ONBOARDING SUB-SECTION ═══════════════════ */
export function OnboardingTab({ back }) {
  const steps = [
    { title: '1. ตรวจสอบข้อมูลส่วนตัวและเอกสารสัญญาจ้าง', done: true },
    { title: '2. รับมอบบัตรพนักงานและอุปกรณ์ปฏิบัติงาน', done: true },
    { title: '3. อบรมมาตรฐานความปลอดภัยในการขับขี่และการขนส่ง', done: false },
    { title: '4. ติดตั้งแอปพลิเคชันและการใช้งานระบบบันทึกเวลา GPS', done: true },
    { title: '5. แนะนำพี่เลี้ยงประจำสายงานและหัวหน้าสถานี', done: false },
  ];

  return (
    <>
      <button
        className="me-badge me-badge-gray"
        style={{ cursor: 'pointer', border: 'none', marginBottom: 12, padding: '7px 14px', display: 'inline-flex', alignItems: 'center', gap: 6 }}
        onClick={back}
      >
        <AppIcon name="chevron-left" size={14} /> กลับ
      </button>
      <div className="me-card">
        <div className="me-section-title">
          <AppIcon name="rocket" size={18} /> ปฐมนิเทศพนักงานใหม่ (Onboarding)
        </div>
        <div style={{ fontSize: 13, color: '#64748B', marginBottom: 14 }}>
          คู่มือและรายการสิ่งที่ต้องดำเนินการสำหรับพนักงานใหม่
        </div>
        {steps.map((s, i) => (
          <div key={i} className="me-row" style={{ padding: '12px 0' }}>
            <span className="k" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: s.done ? '#16A34A' : '#64748B' }}>
                <AppIcon name={s.done ? 'check-circle' : 'clock'} size={18} />
              </span>
              <span style={{ fontWeight: s.done ? 600 : 400 }}>{s.title}</span>
            </span>
            <span className={`me-badge ${s.done ? 'me-badge-green' : 'me-badge-yellow'}`}>
              {s.done ? 'เรียบร้อย' : 'รอดำเนินการ'}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

/* ═══════════════════ SHIFT SWAP SUB-SECTION ═══════════════════ */
export function ShiftSwapTab({ back, showToast }) {
  return (
    <>
      <button
        className="me-badge me-badge-gray"
        style={{ cursor: 'pointer', border: 'none', marginBottom: 12, padding: '7px 14px', display: 'inline-flex', alignItems: 'center', gap: 6 }}
        onClick={back}
      >
        <AppIcon name="chevron-left" size={14} /> กลับ
      </button>
      <div className="me-card">
        <div className="me-section-title">
          <AppIcon name="calendar" size={18} /> ตารางกะและการขอสลับกะ
        </div>
        <div style={{ fontSize: 13, color: '#64748B', marginBottom: 14 }}>
          คุณสามารถดูตารางกะในปฏิทินงาน หรือติดต่อหัวหน้างานเพื่อยื่นขอสลับกะงานได้โดยตรง
        </div>
        <div className="me-empty">
          ระบบสลับกะอัตโนมัติจะเปิดให้บริการในรอบถัดไป หากต้องการสลับกะด่วนกรุณาประสานงานหัวหน้าสถานีค่ะ
        </div>
      </div>
    </>
  );
}

/* ═══════════════════ PROFILE SUB-SECTION ═══════════════════ */
export function ProfileTab({ user, profile, back }) {
  const p = profile || {};
  return (
    <>
      <button
        className="me-badge me-badge-gray"
        style={{ cursor: 'pointer', border: 'none', marginBottom: 12, padding: '7px 14px', display: 'inline-flex', alignItems: 'center', gap: 6 }}
        onClick={back}
      >
        <AppIcon name="chevron-left" size={14} /> กลับ
      </button>
      <div className="me-card">
        <div className="me-section-title">
          <AppIcon name="user" size={18} /> ข้อมูลส่วนตัวพนักงาน
        </div>
        <div className="me-row"><span className="k">ชื่อ-นามสกุล</span><span className="v">{p.name || user?.name}</span></div>
        <div className="me-row"><span className="k">รหัสพนักงาน</span><span className="v">{p.employeeId || user?.employeeId}</span></div>
        <div className="me-row"><span className="k">ตำแหน่ง</span><span className="v">{p.position || '-'}</span></div>
        <div className="me-row"><span className="k">ฝ่าย / แผนก</span><span className="v">{p.department || '-'}</span></div>
        <div className="me-row"><span className="k">สิทธิ์ระบบ (Role)</span><span className="v">{user?.role || '-'}</span></div>
        <div className="me-row"><span className="k">วันที่เริ่มงาน</span><span className="v">{p.startDate || '-'}</span></div>
        <div className="me-row"><span className="k">สาขา / สถานี</span><span className="v">{p.branch || 'สำนักงานใหญ่'}</span></div>
      </div>
    </>
  );
}

/* ═══════════════════ ANNOUNCEMENTS SUB-SECTION ═══════════════════ */
export function AnnouncementsTab({ announcements, back }) {
  const [selected, setSelected] = useState(null);
  const list = announcements || [];

  return (
    <>
      <button
        className="me-badge me-badge-gray"
        style={{ cursor: 'pointer', border: 'none', marginBottom: 12, padding: '7px 14px', display: 'inline-flex', alignItems: 'center', gap: 6 }}
        onClick={back}
      >
        <AppIcon name="chevron-left" size={14} /> กลับ
      </button>
      <div className="me-card">
        <div className="me-section-title">
          <AppIcon name="megaphone" size={18} /> ข่าวสารและประกาศบริษัท
        </div>
        {list.length === 0 && <div className="me-empty">ยังไม่มีประกาศ</div>}
        {list.map((a) => (
          <button
            key={a.id}
            type="button"
            className="me-row me-announcement-row"
            onClick={() => setSelected(a)}
            style={{ width: '100%', textAlign: 'left', border: 'none', background: 'transparent', cursor: 'pointer' }}
          >
            <span className="k" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {a.pinned && <AppIcon name="pin" size={14} />}
              <span>{a.title}</span>
            </span>
            <span className="v" style={{ fontSize: 12 }}>{a.publish_date || '›'}</span>
          </button>
        ))}
      </div>

      {selected && (
        <div className="me-sheet-overlay" onClick={() => setSelected(null)}>
          <div className="me-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="me-sheet-head">
              <div>
                <div className="me-sheet-title">{selected.title}</div>
                <div className="me-sheet-meta">
                  {[selected.category, selected.publish_date, selected.author].filter(Boolean).join(' · ')}
                </div>
              </div>
              <button className="me-sheet-close" onClick={() => setSelected(null)}>✕</button>
            </div>
            <div className="me-sheet-body">
              {selected.body ? selected.body.split('\n').map((line, idx) => <p key={idx}>{line || '\u00a0'}</p>) : <p>ไม่มีรายละเอียด</p>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function toVideoEmbedUrl(url) {
  if (!url) return '';
  const driveMatch =
    url.match(/drive\.google\.com\/file\/d\/([^/?]+)/i) ||
    url.match(/drive\.google\.com\/(?:open|uc)\?(?:[^&]+&)*id=([^&]+)/i);
  if (driveMatch?.[1]) {
    return `https://drive.google.com/file/d/${driveMatch[1]}/preview`;
  }
  const ytMatch = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{6,})/i);
  if (ytMatch?.[1]) {
    return `https://www.youtube.com/embed/${ytMatch[1]}`;
  }
  return url;
}

export function DriverManualsTab({ back }) {
  const [manuals, setManuals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeVideo, setActiveVideo] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/documents?category=driver-manuals', { headers: authHeaders() });
        const d = await res.json();
        if (!cancelled && res.ok) setManuals(d.documents || []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const audienceText = (doc) => {
    const roles = Array.isArray(doc.accessRoles) ? doc.accessRoles : [];
    if (roles.includes('employee') && !roles.includes('partner_driver')) return 'สำหรับพนักงานบริษัทดีดี';
    if (!roles.includes('employee') && roles.includes('partner_driver')) return 'สำหรับพนักงานขับรถร่วม';
    return 'คู่มือทั่วไป (ทุกกลุ่ม)';
  };

  return (
    <>
      <button
        className="me-badge me-badge-gray"
        style={{ cursor: 'pointer', border: 'none', marginBottom: 12, padding: '7px 14px', display: 'inline-flex', alignItems: 'center', gap: 6 }}
        onClick={back}
      >
        <AppIcon name="chevron-left" size={14} /> กลับ
      </button>

      <div className="me-card">
        <div className="me-section-title">
          <AppIcon name="rocket" size={18} /> คู่มือ & คลิปอบรมพนักงานขับรถ
        </div>
        {loading && <div className="me-empty">กำลังโหลดรายการคู่มือ...</div>}
        {!loading && manuals.length === 0 && (
          <div className="me-empty">ยังไม่มีคลิปคู่มือสำหรับกลุ่มของคุณ</div>
        )}
        {!loading && manuals.map((doc) => (
          <button
            key={doc.id}
            type="button"
            className="me-row"
            onClick={() => setActiveVideo(doc)}
            style={{ width: '100%', textAlign: 'left', border: 'none', background: 'transparent', cursor: 'pointer', padding: '12px 0' }}
          >
            <span className="k" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontWeight: 600 }}>{doc.name}</span>
              <span style={{ fontSize: 12, opacity: 0.7 }}>{audienceText(doc)} · {doc.size || 'วิดีโอ'}</span>
            </span>
            <span className="v" style={{ fontSize: 13, fontWeight: 600, color: 'var(--primary, #2563eb)' }}>▶ ดูคลิป</span>
          </button>
        ))}
      </div>

      {activeVideo && (
        <div className="me-sheet-overlay" onClick={() => setActiveVideo(null)}>
          <div className="me-sheet" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 720, width: '95%' }}>
            <div className="me-sheet-head">
              <div>
                <div className="me-sheet-title">{activeVideo.name}</div>
                <div className="me-sheet-meta">{audienceText(activeVideo)} · {activeVideo.updatedAt || ''}</div>
              </div>
              <button className="me-sheet-close" onClick={() => setActiveVideo(null)} aria-label="ปิด">✕</button>
            </div>
            <div className="me-sheet-body">
              {activeVideo.type === 'video' ? (
                <div style={{ position: 'relative', width: '100%', paddingTop: '56.25%', borderRadius: 12, overflow: 'hidden', background: '#000', marginBottom: 14 }}>
                  <iframe
                    src={toVideoEmbedUrl(activeVideo.fileName)}
                    title={activeVideo.name}
                    allow="autoplay; fullscreen"
                    allowFullScreen
                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 'none' }}
                  />
                </div>
              ) : null}
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  type="button"
                  className="me-btn"
                  onClick={() => {
                    const token = localStorage.getItem('hr-token');
                    window.open(`/api/documents/${activeVideo.id}/download?token=${encodeURIComponent(token || '')}`, '_blank');
                  }}
                >
                  <AppIcon name="download" size={16} /> {activeVideo.type === 'video' ? 'เปิดดูเต็มจอ (Google Drive / แท็บใหม่)' : 'ดาวน์โหลดเอกสาร'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
