/**
 * JSON file storage layer — อ่าน/เขียนไฟล์ใน data/ ที่ runtime
 * (แทน static import เพื่อให้ข้อมูลอัพเดทได้จริงโดยไม่ต้อง rebuild)
 */
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');
const FILES_DIR = path.join(DATA_DIR, 'files');

function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FILES_DIR)) fs.mkdirSync(FILES_DIR, { recursive: true });
}

function readJson(fileName, fallback) {
  ensureDirs();
  const filePath = path.join(DATA_DIR, fileName);
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(fileName, data) {
  ensureDirs();
  const filePath = path.join(DATA_DIR, fileName);
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmpPath, filePath);
}

// ---------- Users ----------
export function getUsers() {
  return readJson('users.json', []);
}

export function saveUsers(users) {
  writeJson('users.json', users);
}

export function findUserByUsername(username) {
  return getUsers().find((u) => u.username === username) || null;
}

export function findUserByEmployeeId(employeeId) {
  return getUsers().find((u) => u.employeeId === employeeId) || null;
}

// ---------- Knowledge base (documents + employee data) ----------
export function getKnowledgeBase() {
  return readJson('knowledge-base.json', { documents: [], employeeData: {} });
}

export function saveKnowledgeBase(kb) {
  writeJson('knowledge-base.json', kb);
}

export function getDocuments() {
  return getKnowledgeBase().documents || [];
}

export function addDocument(doc) {
  const kb = getKnowledgeBase();
  kb.documents = [doc, ...(kb.documents || [])];
  saveKnowledgeBase(kb);
  return doc;
}

export function deleteDocument(docId) {
  const kb = getKnowledgeBase();
  const doc = (kb.documents || []).find((d) => d.id === docId);
  if (!doc) return null;
  kb.documents = kb.documents.filter((d) => d.id !== docId);
  saveKnowledgeBase(kb);
  // ลบไฟล์จริงถ้ามี
  if (doc.storedFileName) {
    const filePath = path.join(FILES_DIR, doc.storedFileName);
    try { fs.unlinkSync(filePath); } catch {}
  }
  return doc;
}

export function getEmployeeRecord(employeeId) {
  const kb = getKnowledgeBase();
  return (kb.employeeData || {})[employeeId] || null;
}

export function saveEmployeeRecord(employeeId, record) {
  const kb = getKnowledgeBase();
  kb.employeeData = kb.employeeData || {};
  kb.employeeData[employeeId] = record;
  saveKnowledgeBase(kb);
}

// ---------- Stored files ----------
export function getFilesDir() {
  ensureDirs();
  return FILES_DIR;
}

export function readStoredFile(storedFileName) {
  // ป้องกัน path traversal
  const safeName = path.basename(storedFileName);
  const filePath = path.join(FILES_DIR, safeName);
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath);
}

export function writeStoredFile(storedFileName, buffer) {
  ensureDirs();
  const safeName = path.basename(storedFileName);
  fs.writeFileSync(path.join(FILES_DIR, safeName), buffer);
  return safeName;
}

// ---------- LINE mappings ----------
export function getLineMappings() {
  return readJson('line-mappings.json', {});
}

export function saveLineMappings(mappings) {
  writeJson('line-mappings.json', mappings);
}

export function setLineMapping(lineUserId, info) {
  const mappings = getLineMappings();
  mappings[lineUserId] = info;
  saveLineMappings(mappings);
}

export function deleteLineMapping(lineUserId) {
  const mappings = getLineMappings();
  if (!(lineUserId in mappings)) return false;
  delete mappings[lineUserId];
  saveLineMappings(mappings);
  return true;
}

// ---------- Audit log (กิจกรรมล่าสุด / สถิติ) ----------
const MAX_AUDIT_ENTRIES = 500;

export function getAuditLog() {
  return readJson('audit-log.json', []);
}

export function addAuditEntry(entry) {
  const log = getAuditLog();
  log.unshift({ ...entry, at: new Date().toISOString() });
  writeJson('audit-log.json', log.slice(0, MAX_AUDIT_ENTRIES));
}
