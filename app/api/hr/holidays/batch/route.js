import { NextResponse } from 'next/server';
import { requireMenu } from '@/lib/hr-access';
import { supabase } from '@/lib/supabase';
import { addAuditEntry } from '@/lib/db';

export async function POST(request) {
  const { user, error, status } = await requireMenu(request, 'holidays');
  if (error) return NextResponse.json({ error }, { status });

  try {
    const body = await request.json();
    const { branchId, holidays } = body;

    if (!Array.isArray(holidays) || holidays.length === 0) {
      return NextResponse.json({ error: 'ไม่พบรายการวันหยุดที่ต้องการบันทึก' }, { status: 400 });
    }

    const bId = branchId !== undefined && branchId !== null && branchId !== '' ? Number(branchId) : null;

    let inserted = 0;
    let updated = 0;

    for (const h of holidays) {
      if (!h.holiday_date || !h.name) continue;

      let query = supabase.from('holidays').select('id').eq('holiday_date', h.holiday_date);
      query = bId !== null ? query.eq('branch_id', bId) : query.is('branch_id', null);

      const { data: exist } = await query.maybeSingle();

      if (exist) {
        await supabase.from('holidays').update({
          name: h.name.trim(),
          note: h.note ? h.note.trim() : null,
        }).eq('id', exist.id);
        updated++;
      } else {
        await supabase.from('holidays').insert({
          holiday_date: h.holiday_date,
          name: h.name.trim(),
          note: h.note ? h.note.trim() : null,
          branch_id: bId,
        });
        inserted++;
      }
    }

    await addAuditEntry({
      user: user.name,
      action: `นำเข้าวันหยุดด้วย AI (${inserted} วันใหม่, ${updated} วันเดิม) ${bId ? `สาขา ID ${bId}` : 'ทุกสาขา'}`,
      channel: 'HR',
    });

    return NextResponse.json({
      success: true,
      inserted,
      updated,
      total: inserted + updated,
      message: `บันทึกวันหยุดสำเร็จทั้งหมด ${inserted + updated} รายการ (เพิ่มใหม่ ${inserted} · ปรับปรุง ${updated})`,
    });
  } catch (err) {
    console.error('[batch-holidays] error:', err);
    return NextResponse.json({ error: 'เกิดข้อผิดพลาดในการบันทึกข้อมูล: ' + err.message }, { status: 500 });
  }
}
