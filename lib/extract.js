/**
 * ดึงข้อความจากไฟล์เอกสาร เพื่อใช้เป็น knowledge ให้ AI
 */
import * as XLSX from 'xlsx';

const MAX_CONTENT_LENGTH = 100000;

export function isGarbledThaiText(str) {
  if (!str || typeof str !== 'string') return false;
  // ตรวจจับตัวอักษร mojibake จาก legacy font ไทยที่ถูกแมปเป็น Windows-1252 uppercase accented letters เช่น É, Ê, Ë, Í, Î, ř, ť
  if (/[ÉÊËÍÎÏÌÐÑÒÓÔÕÖØÙÚÛÜÝÞßřť]/.test(str)) {
    return true;
  }
  // ถ้ามีอักษรไทยปนกับตัวอักษรละตินมี accent เกิน 5 ตัว
  const hasThai = /[\u0E00-\u0E7F]/.test(str);
  if (hasThai) {
    const accented = str.match(/[\u00C0-\u00FF]/g);
    if (accented && accented.length >= 5) {
      return true;
    }
  }
  return false;
}

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

      // If text is empty, very short (< 60 chars), or contains garbled Thai font mojibake,
      // use Gemini Vision OCR fallback.
      if (extracted.length < 60 || isGarbledThaiText(extracted)) {
        try {
          const key = (process.env.GEMINI_API_KEY || '').replace(/^[\"']|[\"']$/g, '').trim();
          if (key && key.length > 20) {
            const { GoogleGenerativeAI } = await import('@google/generative-ai');
            const genAI = new GoogleGenerativeAI(key);
            const models = ['gemini-2.5-flash', 'gemini-3.5-flash'];
            let ocrText = '';
            for (const m of models) {
              try {
                const model = genAI.getGenerativeModel({ model: m });
                const ocrRes = await model.generateContent([
                  {
                    inlineData: {
                      data: buffer.toString('base64'),
                      mimeType: 'application/pdf',
                    },
                  },
                  'ดึงข้อความและหัวข้อทั้งหมดจากเอกสารนี้เป็นภาษาไทยอย่างละเอียด ครบถ้วน โดยไม่ต้องสรุป (หากมีเส้นจุดไข่ปลาหรือช่องว่างสำหรับกรอกข้อมูล ให้ย่อเป็น ___ แทน ห้ามพิมพ์จุดซ้ำยาวๆ)',
                ]);
                ocrText = (ocrRes.response.text() || '').trim();
                if (ocrText) break;
              } catch (modelErr) {
                console.warn(`[extractText] Gemini OCR (${m}) failed:`, modelErr.message);
              }
            }
            if (ocrText) {
              extracted = ocrText;
            }
          }
        } catch (ocrErr) {
          console.warn('[extractText] Gemini OCR fallback failed:', ocrErr.message);
        }
      }

      // ย่อเส้นจุดไข่ปลา/ขีดล่างที่ยาวเกิน 3 ตัวติดกัน ลดขนาดขยะใน index
      extracted = extracted.replace(/([.…_-])\1{3,}/g, '___');
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
      let bodyText = '';
      try {
        const mammoth = await import('mammoth');
        const result = await mammoth.extractRawText({ buffer });
        bodyText = (result.value || '').trim();
      } catch (mammothErr) {
        console.warn('[extractText] mammoth failed:', mammothErr.message);
      }

      const headerTexts = [];
      const footerTexts = [];

      try {
        const JSZip = (await import('jszip')).default;
        const zip = await JSZip.loadAsync(buffer);

        const xmlFiles = Object.keys(zip.files).filter((fileName) =>
          /^word\/(header|footer)\d*\.xml$/i.test(fileName)
        );

        for (const fileName of xmlFiles) {
          const xmlContent = await zip.files[fileName].async('text');
          const matches = xmlContent.matchAll(/<w:t[^>]*>([^<]+)<\/w:t>/g);
          const pieces = [];
          for (const match of matches) {
            const piece = (match[1] || '').trim();
            if (piece) pieces.push(piece);
          }
          const text = pieces.join(' ').trim();
          if (text) {
            if (/header/i.test(fileName)) {
              if (!headerTexts.includes(text)) headerTexts.push(text);
            } else {
              if (!footerTexts.includes(text)) footerTexts.push(text);
            }
          }
        }
      } catch (zipErr) {
        console.warn('[extractText] Failed to extract header/footer from docx:', zipErr.message);
      }

      const combined = [];
      for (const h of headerTexts) {
        if (!combined.includes(h)) combined.push(h);
      }
      if (bodyText && !combined.includes(bodyText)) {
        combined.push(bodyText);
      }
      for (const f of footerTexts) {
        if (!combined.includes(f)) combined.push(f);
      }

      let extracted = combined.join('\n\n').trim();
      extracted = extracted.replace(/([.…_-])\1{3,}/g, '___');
      return extracted.slice(0, MAX_CONTENT_LENGTH);
    }

    // ไฟล์ Word รุ่นเก่า .doc ยังเก็บไฟล์ + ให้ดาวน์โหลดได้ แต่ไม่ดึงข้อความ
    return '';
  } catch (error) {
    console.error('Extract text error:', error);
    return '';
  }
}
