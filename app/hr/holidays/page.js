'use client';

import { useState, useEffect, useRef } from 'react';
import ResourceTable from '@/components/hr/ResourceTable';
import { authHeaders } from '@/components/hr/exportUtils';

export default function HolidaysPage() {
  const [showScanModal, setShowScanModal] = useState(false);
  const [branches, setBranches] = useState([]);
  const [targetBranchId, setTargetBranchId] = useState('');
  const [file, setFile] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [extractedHolidays, setExtractedHolidays] = useState(null);
  const [toast, setToast] = useState(null);
  const fileInputRef = useRef(null);

  function showToast(message, type = 'success') {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  }

  useEffect(() => {
    fetch('/api/hr/branches', { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => setBranches(d.items || []))
      .catch(() => {});
  }, []);

  async function handleScan(e) {
    e.preventDefault();
    if (!file) {
      showToast('กรุณาเลือกไฟล์รูปภาพหรือเอกสาร PDF', 'error');
      return;
    }

    setScanning(true);
    setExtractedHolidays(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/hr/holidays/scan', {
        method: 'POST',
        headers: authHeaders(),
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'การสแกนล้มเหลว');

      if (!data.holidays || data.holidays.length === 0) {
        showToast('ไม่พบรายการวันหยุดในเอกสารที่แนบ กรุณาตรวจสอบไฟล์อีกครั้ง', 'error');
      } else {
        setExtractedHolidays(data.holidays);
        showToast(`AI ตรวจพบ ${data.holidays.length} วันหยุด กรุณาตรวจทานและกดยืนยันบันทึก`, 'success');
      }
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setScanning(false);
    }
  }

  async function handleSaveBatch() {
    if (!extractedHolidays || extractedHolidays.length === 0) return;

    setSaving(true);
    try {
      const res = await fetch('/api/hr/holidays/batch', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({
          branchId: targetBranchId ? Number(targetBranchId) : null,
          holidays: extractedHolidays,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'บันทึกไม่สำเร็จ');

      showToast(data.message || 'บันทึกวันหยุดเข้าสู่ระบบสำเร็จ', 'success');
      setShowScanModal(false);
      setExtractedHolidays(null);
      setFile(null);
      setTimeout(() => window.location.reload(), 1200);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  const updateHolidayRow = (index, field, val) => {
    setExtractedHolidays((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: val };
      return next;
    });
  };

  const removeHolidayRow = (index) => {
    setExtractedHolidays((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <>
      <ResourceTable
        config={{
          resource: 'holidays',
          exportName: 'holidays',
          searchPlaceholder: 'ค้นหาชื่อวันหยุด...',
          headerExtra: (
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
              <button
                type="button"
                className="hr-btn hr-btn-primary"
                style={{
                  background: 'linear-gradient(135deg, #007AFF 0%, #5856D6 100%)',
                  borderColor: 'transparent',
                  color: '#FFFFFF',
                  fontWeight: 600,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  boxShadow: '0 2px 8px rgba(0, 122, 255, 0.25)',
                }}
                onClick={() => {
                  setShowScanModal(true);
                  setExtractedHolidays(null);
                  setFile(null);
                }}
              >
                <span>📸</span> สแกนวันหยุดจากรูปภาพ / PDF ด้วย AI
              </button>
            </div>
          ),
          columns: [
            { key: 'holiday_date', label: 'วันที่' },
            { key: 'name', label: 'ชื่อวันหยุด' },
            { key: 'branch_id', label: 'สาขา', branchLookup: true },
            { key: 'note', label: 'หมายเหตุ' },
          ],
          fields: [
            { key: 'holiday_date', label: 'วันที่', type: 'date', required: true },
            { key: 'name', label: 'ชื่อวันหยุด', type: 'text', required: true },
            { key: 'branch_id', label: 'สาขา (เว้นว่าง = ทุกสาขา)', type: 'branch' },
            { key: 'note', label: 'หมายเหตุ', type: 'text' },
          ],
        }}
      />

      {/* ─── Modal สแกนวันหยุดด้วย AI ─── */}
      {showScanModal && (
        <div className="hr-modal-overlay" onClick={() => !scanning && !saving && setShowScanModal(false)}>
          <div
            className="hr-modal"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: extractedHolidays ? 720 : 540 }}
          >
            <div className="hr-modal-header">
              <div className="hr-modal-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>✨</span> สแกนและนำเข้าวันหยุดด้วย Vision AI
              </div>
              <button
                type="button"
                className="hr-modal-close"
                onClick={() => setShowScanModal(false)}
                disabled={scanning || saving}
              >
                ✕
              </button>
            </div>

            {!extractedHolidays ? (
              <form onSubmit={handleScan} style={{ padding: '4px 0' }}>
                <div style={{ background: '#F8F9FE', padding: 14, borderRadius: 14, marginBottom: 16, border: '1px solid rgba(60,60,67,0.1)', fontSize: 13, lineHeight: 1.6, color: 'var(--hr-text-2)' }}>
                  <div>📸 <b>ระบบรองรับ:</b> รูปถ่ายประกาศวันหยุด, รูปแคปหน้าจอ, หรือไฟล์เอกสาร PDF ประจำปี</div>
                  <div style={{ marginTop: 2, color: 'var(--hr-text-3)' }}>AI จะสแกนตาราง ตรวจสอบวันที่ (ค.ศ./พ.ศ.) และถอดชื่อวันหยุดไทย-อังกฤษให้โดยอัตโนมัติ</div>
                </div>

                <div className="hr-field">
                  <label>สาขาที่ใช้วันหยุดนี้ *</label>
                  <select
                    className="hr-input"
                    value={targetBranchId}
                    onChange={(e) => setTargetBranchId(e.target.value)}
                  >
                    <option value="">— ทุกสาขา (วันหยุดบริษัทส่วนกลาง) —</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.code} · {b.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="hr-field">
                  <label>เลือกไฟล์รูปภาพหรือเอกสาร PDF *</label>
                  <input
                    type="file"
                    ref={fileInputRef}
                    accept="image/*,application/pdf"
                    style={{ display: 'none' }}
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                  />

                  <div
                    onClick={() => fileInputRef.current?.click()}
                    style={{
                      border: '2px dashed rgba(0, 122, 255, 0.4)',
                      borderRadius: 14,
                      padding: '24px 16px',
                      textAlign: 'center',
                      background: file ? 'rgba(0, 122, 255, 0.04)' : '#FAFBFD',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {file ? (
                      <div>
                        <div style={{ fontSize: 28, marginBottom: 4 }}>📄</div>
                        <div style={{ fontWeight: 700, fontSize: 14, color: '#007AFF' }}>{file.name}</div>
                        <div style={{ fontSize: 12, color: '#8E8E93', marginTop: 2 }}>
                          {(file.size / 1024).toFixed(1)} KB · คลิกเพื่อเปลี่ยนไฟล์
                        </div>
                      </div>
                    ) : (
                      <div>
                        <div style={{ fontSize: 32, marginBottom: 6 }}>📤</div>
                        <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--hr-text)' }}>
                          คลิกเพื่อเลือกไฟล์รูปภาพ หรือ PDF วันหยุด
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--hr-text-3)', marginTop: 4 }}>
                          รองรับ .JPG, .PNG, .WEBP หรือ .PDF
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="hr-modal-actions" style={{ marginTop: 20 }}>
                  <button
                    type="button"
                    className="hr-btn"
                    onClick={() => setShowScanModal(false)}
                    disabled={scanning}
                  >
                    ยกเลิก
                  </button>
                  <button
                    type="submit"
                    className="hr-btn hr-btn-primary"
                    disabled={scanning || !file}
                    style={{
                      background: 'linear-gradient(135deg, #007AFF 0%, #5856D6 100%)',
                      borderColor: 'transparent',
                    }}
                  >
                    {scanning ? '⏳ AI กำลังอ่านและถอดข้อมูลวันหยุด...' : '✨ เริ่มสแกนด้วย AI'}
                  </button>
                </div>
              </form>
            ) : (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#15803D' }}>
                    ✅ ตรวจพบวันหยุดทั้งหมด {extractedHolidays.length} วัน
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--hr-text-3)' }}>
                    เป้าหมาย: <strong>{targetBranchId ? branches.find((b) => String(b.id) === String(targetBranchId))?.name || `สาขา ${targetBranchId}` : 'ทุกสาขา'}</strong>
                  </div>
                </div>

                <div style={{ maxHeight: '340px', overflowY: 'auto', border: '1px solid var(--hr-border)', borderRadius: 12 }}>
                  <table className="hr-table" style={{ margin: 0, fontSize: 12.5 }}>
                    <thead>
                      <tr>
                        <th style={{ width: 140 }}>วันที่</th>
                        <th>ชื่อวันหยุด</th>
                        <th>หมายเหตุ</th>
                        <th style={{ width: 44, textAlign: 'center' }}>ลบ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {extractedHolidays.map((row, idx) => (
                        <tr key={idx}>
                          <td>
                            <input
                              type="date"
                              className="hr-input"
                              style={{ padding: '4px 6px', fontSize: 12 }}
                              value={row.holiday_date}
                              onChange={(e) => updateHolidayRow(idx, 'holiday_date', e.target.value)}
                            />
                          </td>
                          <td>
                            <input
                              type="text"
                              className="hr-input"
                              style={{ padding: '4px 8px', fontSize: 12 }}
                              value={row.name}
                              onChange={(e) => updateHolidayRow(idx, 'name', e.target.value)}
                            />
                          </td>
                          <td>
                            <input
                              type="text"
                              className="hr-input"
                              style={{ padding: '4px 8px', fontSize: 12 }}
                              value={row.note || ''}
                              placeholder="-"
                              onChange={(e) => updateHolidayRow(idx, 'note', e.target.value)}
                            />
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <button
                              type="button"
                              className="hr-btn hr-btn-danger"
                              style={{ padding: '3px 8px', fontSize: 11 }}
                              onClick={() => removeHolidayRow(idx)}
                              title="ลบรายการนี้"
                            >
                              ✕
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="hr-modal-actions" style={{ marginTop: 16 }}>
                  <button
                    type="button"
                    className="hr-btn"
                    onClick={() => setExtractedHolidays(null)}
                    disabled={saving}
                  >
                    🔄 สแกนไฟล์ใหม่
                  </button>
                  <button
                    type="button"
                    className="hr-btn hr-btn-primary"
                    disabled={saving || extractedHolidays.length === 0}
                    onClick={handleSaveBatch}
                    style={{ background: '#16A34A', borderColor: '#16A34A' }}
                  >
                    {saving ? '⏳ กำลังบันทึก...' : `💾 ยืนยันบันทึกทั้งหมด (${extractedHolidays.length} วัน)`}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {toast && <div className={`hr-toast ${toast.type}`}>{toast.message}</div>}
    </>
  );
}
