import { createHash } from 'node:crypto';

export const BACKUP_TABLES = [
  'users','employee_records','line_mappings','audit_logs','documents','departments','positions','branches','holidays',
  'time_records','leave_requests','payroll_slips','ot_records','shifts','job_openings','applicants','onboarding_checklists',
  'trainings','evaluations','okrs','assets','expense_claims','benefits_loans','social_security','meeting_rooms','room_bookings',
  'company_trips','announcements','check_locations','peer_evaluations','leave_types','shift_patterns','work_settings',
  'tax_allowances','role_permissions','asset_requests','employee_leave_balances','org_chart_nodes','document_assets',
  'document_requests','notifications','push_subscriptions','employee_history','interview_question_sets','interview_sessions','interview_turns',
];
const KEYS = { users:'id', employee_records:'employee_id', line_mappings:'line_user_id', role_permissions:'role', org_chart_nodes:'employee_id' };

export async function readBackupTable(database, table, pageSize = 500) {
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await database.from(table).select('*').order(KEYS[table] || 'id').range(offset, offset + pageSize - 1);
    if (error || !Array.isArray(data)) throw new Error(`อ่านข้อมูล ${table} ไม่สำเร็จ จึงไม่สร้างไฟล์ส่งออกที่ไม่ครบ`);
    rows.push(...data);
    if (data.length < pageSize) return rows;
  }
}

export async function createLogicalBackup(database, bucket, { tables = BACKUP_TABLES, maxBytes = 50 * 1024 * 1024 } = {}) {
  const payload = { format: 'hr-logical-export-v2', schemaPhase: 21, exportedAt: new Date().toISOString(),
    consistency: 'logical export; pause application writes for a consistent recovery set',
    excludes: ['database schema/functions/sequences', 'environment secrets', 'rebuildable RAG embeddings'], tables: {}, files: [] };
  let bytes = 0;
  const budget = (size) => { bytes += size; if (bytes > maxBytes) throw new Error('ข้อมูลเกินขนาดส่งออกผ่านเว็บ กรุณาใช้การสำรองฐานข้อมูลและ Storage โดยผู้ดูแลระบบ'); };
  for (const table of tables) {
    const rows = await readBackupTable(database, table);
    budget(Buffer.byteLength(JSON.stringify(rows)));
    payload.tables[table] = rows;
  }
  async function walk(prefix = '') {
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await bucket.list(prefix, { limit: 500, offset, sortBy: { column: 'name', order: 'asc' } });
      if (error || !Array.isArray(data)) throw new Error('อ่านรายการไฟล์ Storage ไม่ครบ จึงยกเลิกการส่งออก');
      for (const entry of data) {
        const name = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (!entry.id) { await walk(name); continue; }
        budget(Math.ceil(Number(entry.metadata?.size || 0) * 4 / 3));
        const { data: blob, error: downloadError } = await bucket.download(name);
        if (downloadError || !blob) throw new Error('อ่านไฟล์ Storage ไม่ครบ จึงยกเลิกการส่งออก');
        const buf = Buffer.from(await blob.arrayBuffer());
        if (!entry.metadata?.size) budget(Math.ceil(buf.length * 4 / 3));
        payload.files.push({ path: name, bytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex'), contentBase64: buf.toString('base64') });
      }
      if (data.length < 500) break;
    }
  }
  await walk();
  return payload;
}
