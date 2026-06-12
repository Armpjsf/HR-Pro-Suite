'use client';

import * as XLSX from 'xlsx';

/**
 * Export rows เป็นไฟล์ Excel — ใช้ label ภาษาไทยจาก columns เป็นหัวตาราง
 */
export function exportExcel(rows, columns, filename) {
  const data = rows.map((row) => {
    const out = {};
    for (const col of columns) {
      const value = row[col.key];
      out[col.label] = col.format ? col.format(value, row) : value ?? '';
    }
    return out;
  });
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  XLSX.writeFile(wb, `${filename}.xlsx`);
}

/**
 * พิมพ์เป็น PDF — ใช้ print dialog ของ browser (hr.css มี @media print ซ่อน sidebar/ปุ่ม)
 */
export function printPDF() {
  window.print();
}

/**
 * Header สำหรับเรียก API พร้อม JWT token
 */
export function authHeaders(json = false) {
  const token = localStorage.getItem('hr-token');
  return {
    Authorization: `Bearer ${token}`,
    ...(json ? { 'Content-Type': 'application/json' } : {}),
  };
}
