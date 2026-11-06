/**
 * ดึงข้อความจากไฟล์เอกสาร เพื่อใช้เป็น knowledge ให้ AI
 */
import * as XLSX from 'xlsx';

const MAX_CONTENT_LENGTH = 100000;

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
      let extracted = '';
      try {
        if (!globalThis.pdfjsWorker) {
          const pdfjsWorker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
          globalThis.pdfjsWorker = pdfjsWorker;
        }
        const { PDFParse } = await import('pdf-parse');
        const parser = new PDFParse({ data: new Uint8Array(buffer) });
        const result = await parser.getText();
        await parser.destroy?.();
        extracted = (result.text || '').trim();
      } catch (err) {
        console.warn('[extractText] pdf-parse failed:', err.message);
      }

      // If text is empty or very short (< 60 chars), it is likely a scanned/image PDF.
      // Use Gemini Vision OCR fallback.
      if (extracted.length < 60) {
        try {
          const key = (process.env.GEMINI_API_KEY || '').replace(/^[\"']|[\"']$/g, '').trim();
          if (key && key.length > 20) {
            const { GoogleGenerativeAI } = await import('@google/generative-ai');
            const genAI = new GoogleGenerativeAI(key);
            const model = genAI.getGenerativeModel({ model: 'gemini-3.5-flash' });
            const ocrRes = await model.generateContent([
              {
                inlineData: {
                  data: buffer.toString('base64'),
                  mimeType: 'application/pdf',
                },
              },
              'ดึงข้อความและหัวข้อทั้งหมดจากเอกสารนี้เป็นภาษาไทยอย่างละเอียด ครบถ้วน โดยไม่ต้องสรุป',
            ]);
            extracted = (ocrRes.response.text() || '').trim();
          }
        } catch (ocrErr) {
          console.warn('[extractText] Gemini OCR fallback failed:', ocrErr.message);
        }
      }

      return extracted.slice(0, MAX_CONTENT_LENGTH);
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

    if (fileType === 'docx') {
      const mammoth = await import('mammoth');
      const result = await mammoth.extractRawText({ buffer });
      return (result.value || '').trim().slice(0, MAX_CONTENT_LENGTH);
    }

    // ไฟล์ Word รุ่นเก่า .doc ยังเก็บไฟล์ + ให้ดาวน์โหลดได้ แต่ไม่ดึงข้อความ
    return '';
  } catch (error) {
    console.error('Extract text error:', error);
    return '';
  }
}
