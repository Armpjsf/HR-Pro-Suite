import { NextResponse } from 'next/server';
import { requireMenu } from '@/lib/hr-access';
import { supabase } from '@/lib/supabase';
import { addAuditEntry } from '@/lib/db';

/**
 * POST /api/hr/shifts/bulk — จัดกะทำงานแบบกลุ่ม (หลายคน + ช่วงวันที่)
 * Body: { employee_ids: [], start_date, end_date, pattern_id, shift_type, start_time, end_time, off_days: [0, 6] }
 */
export async function POST(request) {
  const { user, error, status } = await requireMenu(request, 'shifts');
  if (error) return NextResponse.json({ error }, { status });

  const body = await request.json();
  const { employee_ids, start_date, end_date, shift_type = 'morning', start_time, end_time, off_days = [0] } = body;

  if (!Array.isArray(employee_ids) || employee_ids.length === 0) {
    return NextResponse.json({ error: 'กรุณาเลือกพนักงานอย่างน้อย 1 คน' }, { status: 400 });
  }
  if (!start_date || !end_date) {
    return NextResponse.json({ error: 'กรุณาระบุช่วงวันที่เริ่มต้นและสิ้นสุด' }, { status: 400 });
  }

  const offSet = new Set((off_days || []).map(Number));
  const rows = [];

  for (const empId of employee_ids) {
    for (let d = new Date(`${start_date}T00:00:00`); ; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toLocaleDateString('en-CA');
      if (dateStr > end_date) break;

      const isOff = offSet.has(d.getDay());
      rows.push({
        employee_id: empId,
        shift_date: dateStr,
        shift_type: isOff ? 'off' : shift_type,
        start_time: isOff ? null : start_time || '08:30',
        end_time: isOff ? null : end_time || '17:30',
        note: isOff ? 'วันหยุดประจำสัปดาห์' : 'จัดกะแบบกลุ่ม',
      });
    }
  }

  const { error: dbError } = await supabase.from('shifts').upsert(rows);
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  await addAuditEntry({
    user: user.name,
    action: `จัดกะแบบกลุ่ม ${employee_ids.length} คน ช่วง ${start_date} ถึง ${end_date} รวม ${rows.length} รายการ`,
    channel: 'HR',
  });

  return NextResponse.json({ success: true, count: rows.length });
}
