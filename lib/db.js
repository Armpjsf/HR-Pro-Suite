/**
 * Supabase storage layer — แทนที่ JSON files เดิม (data/*.json + data/files/)
 * Export function names/shapes เดิมไว้ เพื่อให้ caller เปลี่ยนแค่เติม await
 */
import { supabase, DOCUMENTS_BUCKET } from './supabase';

function throwIfError(error, context) {
  if (error) throw new Error(`[db] ${context}: ${error.message}`);
}

// ---------- Users ----------
function fromUserRow(r) {
  return {
    id: r.id,
    username: r.username,
    password: r.password,
    name: r.name,
    nameEn: r.name_en || undefined,
    email: r.email || '',
    role: r.role,
    employeeId: r.employee_id,
    department: r.department || '',
    avatar: r.avatar || '👤',
  };
}

function toUserRow(u) {
  return {
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
  };
}

export async function getUsers() {
  const { data, error } = await supabase.from('users').select('*').order('created_at');
  throwIfError(error, 'getUsers');
  return (data || []).map(fromUserRow);
}

export async function saveUsers(users) {
  const { data: existing, error: selErr } = await supabase.from('users').select('id');
  throwIfError(selErr, 'saveUsers (select existing)');

  const newIds = users.map((u) => u.id);
  const removedIds = (existing || [])
    .map((r) => r.id)
    .filter((id) => !newIds.includes(id));

  if (removedIds.length > 0) {
    const { error: delErr } = await supabase.from('users').delete().in('id', removedIds);
    throwIfError(delErr, 'saveUsers (delete removed)');
  }

  if (users.length > 0) {
    const { error: upsertErr } = await supabase.from('users').upsert(users.map(toUserRow));
    throwIfError(upsertErr, 'saveUsers (upsert)');
  }
}

export async function findUserByUsername(username) {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('username', username)
    .maybeSingle();
  throwIfError(error, 'findUserByUsername');
  return data ? fromUserRow(data) : null;
}

export async function findUserByEmployeeId(employeeId) {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('employee_id', employeeId)
    .maybeSingle();
  throwIfError(error, 'findUserByEmployeeId');
  return data ? fromUserRow(data) : null;
}

// ---------- Documents ----------
function fromDocRow(r) {
  return {
    id: r.id,
    name: r.name,
    fileName: r.file_name,
    storedFileName: r.stored_file_name,
    category: r.category,
    type: r.type,
    templateType: r.template_type || undefined,
    size: r.size || undefined,
    updatedAt: r.updated_at || undefined,
    accessRoles: r.access_roles || [],
    content: r.content || '',
    uploadedBy: r.uploaded_by || undefined,
    employeeId: r.employee_id || undefined,
  };
}

function toDocRow(d) {
  return {
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
}

export async function getDocuments() {
  const { data, error } = await supabase.from('documents').select('*').order('id', { ascending: false });
  throwIfError(error, 'getDocuments');
  return (data || []).map(fromDocRow);
}

export async function addDocument(doc) {
  const { error } = await supabase.from('documents').insert(toDocRow(doc));
  throwIfError(error, 'addDocument');
  return doc;
}

export async function deleteDocument(docId) {
  const { data, error: selErr } = await supabase
    .from('documents')
    .select('*')
    .eq('id', docId)
    .maybeSingle();
  throwIfError(selErr, 'deleteDocument (select)');
  if (!data) return null;

  const doc = fromDocRow(data);

  const { error: delErr } = await supabase.from('documents').delete().eq('id', docId);
  throwIfError(delErr, 'deleteDocument (delete row)');

  if (doc.storedFileName) {
    await supabase.storage.from(DOCUMENTS_BUCKET).remove([doc.storedFileName]);
  }

  return doc;
}

// ---------- Employee records (leave balances / profile) ----------
function leaveField(total, used) {
  total = Number(total) || 0;
  used = Number(used) || 0;
  return { total, used, remaining: total - used };
}

export async function getEmployeeRecord(employeeId) {
  const [{ data: userRow, error: userErr }, { data: recRow, error: recErr }] = await Promise.all([
    supabase.from('users').select('name, department').eq('employee_id', employeeId).maybeSingle(),
    supabase.from('employee_records').select('*').eq('employee_id', employeeId).maybeSingle(),
  ]);
  throwIfError(userErr, 'getEmployeeRecord (user)');
  throwIfError(recErr, 'getEmployeeRecord (record)');

  if (!recRow) return null;

  return {
    name: userRow?.name,
    department: userRow?.department,
    position: recRow.position || undefined,
    startDate: recRow.start_date || undefined,
    leave: {
      annual: leaveField(recRow.leave_annual_total, recRow.leave_annual_used),
      sick: leaveField(recRow.leave_sick_total, recRow.leave_sick_used),
      personal: leaveField(recRow.leave_personal_total, recRow.leave_personal_used),
    },
  };
}

export async function saveEmployeeRecord(employeeId, record) {
  const row = {
    employee_id: employeeId,
    position: record.position || null,
    start_date: record.startDate || null,
    leave_annual_total: record.leave?.annual?.total ?? 0,
    leave_annual_used: record.leave?.annual?.used ?? 0,
    leave_sick_total: record.leave?.sick?.total ?? 0,
    leave_sick_used: record.leave?.sick?.used ?? 0,
    leave_personal_total: record.leave?.personal?.total ?? 0,
    leave_personal_used: record.leave?.personal?.used ?? 0,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('employee_records').upsert(row);
  throwIfError(error, 'saveEmployeeRecord');
}

// ---------- Stored files (Supabase Storage) ----------
export async function readStoredFile(storedFileName) {
  const { data, error } = await supabase.storage.from(DOCUMENTS_BUCKET).download(storedFileName);
  if (error) return null;
  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export async function writeStoredFile(storedFileName, buffer) {
  const { error } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .upload(storedFileName, buffer, { upsert: true });
  throwIfError(error, 'writeStoredFile');
  return storedFileName;
}

// ---------- LINE mappings ----------
export async function getLineMappings() {
  const { data, error } = await supabase.from('line_mappings').select('*');
  throwIfError(error, 'getLineMappings');
  const mappings = {};
  for (const r of data || []) {
    mappings[r.line_user_id] = {
      employeeId: r.employee_id,
      name: r.name,
      role: r.role,
      registeredAt: r.registered_at,
    };
  }
  return mappings;
}

export async function setLineMapping(lineUserId, info) {
  const { error } = await supabase.from('line_mappings').upsert({
    line_user_id: lineUserId,
    employee_id: info.employeeId,
    name: info.name,
    role: info.role,
    registered_at: info.registeredAt || new Date().toISOString(),
  });
  throwIfError(error, 'setLineMapping');
}

export async function deleteLineMapping(lineUserId) {
  const { data, error: selErr } = await supabase
    .from('line_mappings')
    .select('line_user_id')
    .eq('line_user_id', lineUserId)
    .maybeSingle();
  throwIfError(selErr, 'deleteLineMapping (select)');
  if (!data) return false;

  const { error } = await supabase.from('line_mappings').delete().eq('line_user_id', lineUserId);
  throwIfError(error, 'deleteLineMapping');
  return true;
}

// ---------- Audit log ----------
const MAX_AUDIT_ENTRIES = 500;

export async function getAuditLog() {
  const { data, error } = await supabase
    .from('audit_logs')
    .select('*')
    .order('at', { ascending: false })
    .limit(MAX_AUDIT_ENTRIES);
  throwIfError(error, 'getAuditLog');
  return (data || []).map((r) => ({
    user: r.user_name,
    action: r.action,
    channel: r.channel,
    type: r.type || undefined,
    at: r.at,
  }));
}

export async function addAuditEntry(entry) {
  const { error } = await supabase.from('audit_logs').insert({
    user_name: entry.user,
    action: entry.action,
    channel: entry.channel,
    type: entry.type || null,
    at: new Date().toISOString(),
  });
  throwIfError(error, 'addAuditEntry');
}
