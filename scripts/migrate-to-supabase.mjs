/**
 * One-off migration: copy data/*.json + data/files/* into Supabase.
 * Run once after creating the Supabase project, running supabase/schema.sql,
 * and creating the "documents" storage bucket.
 *
 * Usage: node scripts/migrate-to-supabase.mjs
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
loadEnvLocal(path.join(ROOT, '.env.local'));

function loadEnvLocal(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

const DATA_DIR = path.join(ROOT, 'data');
const FILES_DIR = path.join(DATA_DIR, 'files');

function readJson(fileName, fallback) {
  const filePath = path.join(DATA_DIR, fileName);
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

async function migrateUsers() {
  const users = readJson('users.json', []);
  if (users.length === 0) return;

  const rows = users.map((u) => ({
    id: u.id,
    username: u.username,
    password: u.password,
    name: u.name,
    name_en: u.nameEn || null,
    email: u.email || null,
    role: u.role,
    employee_id: u.employeeId,
    department: u.department || null,
    avatar: u.avatar || null,
  }));

  const { error } = await supabase.from('users').upsert(rows);
  if (error) throw new Error(`users: ${error.message}`);
  console.log(`✓ migrated ${rows.length} users`);
}

async function migrateDocumentsAndFiles() {
  const kb = readJson('knowledge-base.json', { documents: [], employeeData: {} });
  const docs = kb.documents || [];

  for (const d of docs) {
    if (d.storedFileName) {
      const filePath = path.join(FILES_DIR, d.storedFileName);
      if (fs.existsSync(filePath)) {
        const buffer = fs.readFileSync(filePath);
        const { error: uploadErr } = await supabase.storage
          .from('documents')
          .upload(d.storedFileName, buffer, { upsert: true });
        if (uploadErr) throw new Error(`storage upload ${d.storedFileName}: ${uploadErr.message}`);
      }
    }

    const row = {
      id: d.id,
      name: d.name,
      file_name: d.fileName,
      stored_file_name: d.storedFileName,
      category: d.category,
      type: d.type,
      template_type: d.templateType || null,
      size: d.size || null,
      updated_at: d.updatedAt || null,
      access_roles: d.accessRoles || [],
      content: d.content || '',
      uploaded_by: d.uploadedBy || null,
      employee_id: d.employeeId || null,
    };

    const { error } = await supabase.from('documents').upsert(row);
    if (error) throw new Error(`documents ${d.id}: ${error.message}`);
  }
  console.log(`✓ migrated ${docs.length} documents (+ files)`);

  const employeeData = kb.employeeData || {};
  const employeeIds = Object.keys(employeeData);
  for (const employeeId of employeeIds) {
    const rec = employeeData[employeeId];
    const row = {
      employee_id: employeeId,
      position: rec.position || null,
      start_date: rec.startDate || null,
      leave_annual_total: rec.leave?.annual?.total ?? 0,
      leave_annual_used: rec.leave?.annual?.used ?? 0,
      leave_sick_total: rec.leave?.sick?.total ?? 0,
      leave_sick_used: rec.leave?.sick?.used ?? 0,
      leave_personal_total: rec.leave?.personal?.total ?? 0,
      leave_personal_used: rec.leave?.personal?.used ?? 0,
    };
    const { error } = await supabase.from('employee_records').upsert(row);
    if (error) throw new Error(`employee_records ${employeeId}: ${error.message}`);
  }
  console.log(`✓ migrated ${employeeIds.length} employee records`);
}

async function migrateLineMappings() {
  const mappings = readJson('line-mappings.json', {});
  const lineUserIds = Object.keys(mappings);
  if (lineUserIds.length === 0) return;

  const rows = lineUserIds.map((lineUserId) => {
    const m = mappings[lineUserId];
    return {
      line_user_id: lineUserId,
      employee_id: m.employeeId,
      name: m.name || null,
      role: m.role || null,
      registered_at: m.registeredAt || new Date().toISOString(),
    };
  });

  const { error } = await supabase.from('line_mappings').upsert(rows);
  if (error) throw new Error(`line_mappings: ${error.message}`);
  console.log(`✓ migrated ${rows.length} line mappings`);
}

async function migrateAuditLog() {
  const log = readJson('audit-log.json', []);
  if (log.length === 0) return;

  const rows = log.map((e) => ({
    user_name: e.user,
    action: e.action,
    channel: e.channel || null,
    type: e.type || null,
    at: e.at || new Date().toISOString(),
  }));

  const { error } = await supabase.from('audit_logs').insert(rows);
  if (error) throw new Error(`audit_logs: ${error.message}`);
  console.log(`✓ migrated ${rows.length} audit log entries`);
}

async function main() {
  await migrateUsers();
  await migrateDocumentsAndFiles();
  await migrateLineMappings();
  await migrateAuditLog();
  console.log('Migration complete.');
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
