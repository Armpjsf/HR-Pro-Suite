/**
 * ดึงข้อความจากไฟล์เอกสาร เพื่อใช้เป็น knowledge ให้ AI
 */
import * as XLSX from 'xlsx';

const MAX_CONTENT_LENGTH = 20000;

export function detectFileType(fileName) {
  const ext = (fileName.split('.').pop() || '').toLowerCase();
  if (ext === 'pdf') return 'pdf';
  if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') return 'excel';
  if (ext === 'docx' || ext === 'doc') return 'docx';
  if (ext === 'txt' || ext === 'md') return 'text';
  return 'other';
}

export async function extractText(buffer, fileType) {
  try {
    if (fileType === 'pdf') {
      const { PDFParse } = await import('pdf-parse');
      const parser = new PDFParse({ data: new Uint8Array(buffer) });
      const result = await parser.getText();
      await parser.destroy?.();
      return (result.text || '').trim().slice(0, MAX_CONTENT_LENGTH);
    }

    if (fileType === 'excel') {
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      const parts = [];
      for (const sheetName of workbook.SheetNames) {
        const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName]);
        if (csv.trim()) parts.push(`[Sheet: ${sheetName}]\n${csv}`);
      }
      return parts.join('\n\n').trim().slice(0, MAX_CONTENT_LENGTH);
    }

    if (fileType === 'text') {
      return buffer.toString('utf8').trim().slice(0, MAX_CONTENT_LENGTH);
    }

    // docx/อื่น ๆ — ยังไม่รองรับการดึงข้อความ (เก็บไฟล์ + ให้ดาวน์โหลดได้)
    return '';
  } catch (error) {
    console.error('Extract text error:', error);
    return '';
  }
}
