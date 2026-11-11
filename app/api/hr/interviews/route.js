import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requireMenu } from '@/lib/hr-access';
import { twilioConfigured, placeInterviewCall } from '@/lib/twilio';

// GET /api/hr/interviews?applicant_id=123 — รอบสัมภาษณ์ (กรองตามผู้สมัครได้)
export async function GET(request) {
  const { error, status } = await requireMenu(request, 'applicants');
  if (error) return NextResponse.json({ error }, { status });

  const url = new URL(request.url);
  let query = supabase
    .from('interview_sessions')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1000);

  const applicantId = url.searchParams.get('applicant_id');
  if (applicantId) query = query.eq('applicant_id', applicantId);

  const { data, error: dbError } = await query;
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  return NextResponse.json({ items: data || [] });
}

// POST /api/hr/interviews — สร้างรอบสัมภาษณ์ (เข้าคิวรอโทร)
// body: { applicant_id, question_set_id }
// เฟส 1: บันทึกเป็น status 'queued' เท่านั้น — การต่อสายจริงอยู่ในเฟส 3
export async function POST(request) {
  const { error, status, user } = await requireMenu(request, 'applicants');
  if (error) return NextResponse.json({ error }, { status });

  const body = await request.json();
  const applicantId = body.applicant_id;
  if (!applicantId) return NextResponse.json({ error: 'ไม่พบ applicant_id' }, { status: 400 });

  const { data: applicant, error: aErr } = await supabase
    .from('applicants')
    .select('id, name, phone, position_applied')
    .eq('id', applicantId)
    .single();
  if (aErr || !applicant) return NextResponse.json({ error: 'ไม่พบผู้สมัคร' }, { status: 404 });
  if (!applicant.phone) {
    return NextResponse.json({ error: 'ผู้สมัครยังไม่มีเบอร์โทร กรุณากรอกเบอร์ก่อน' }, { status: 400 });
  }

  const row = {
    applicant_id: applicant.id,
    question_set_id: body.question_set_id || null,
    phone: applicant.phone || '-',
    status: 'queued',
    created_by: user?.employeeId || null,
  };

  const { data, error: dbError } = await supabase
    .from('interview_sessions')
    .insert(row)
    .select()
    .single();
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  // เลื่อนสถานะผู้สมัครเป็น "สัมภาษณ์" ให้เห็นความคืบหน้าในตาราง
  await supabase.from('applicants').update({ status: 'interview' }).eq('id', applicant.id);

  const interviewPath = `/interview/${data.id}`;
  const shareMessage = `เรียนคุณ ${applicant.name} บริษัทขอเชิญท่านเข้ารับการสัมภาษณ์งานเบื้องต้นออนไลน์ (AI Voice Interview)\nตำแหน่ง: ${applicant.position_applied || 'ทั่วไป'}\nคลิกลิงก์เพื่อเริ่มสัมภาษณ์: [URL]${interviewPath}\n(ใช้เวลาเพียง 3-5 นาที สามารถเปิดผ่านโทรศัพท์มือถือและพูดคุยกับ AI ได้ทันทีครับ)`;

  // ถ้าตั้งค่า Twilio แล้ว → ให้ตัวเลือกโทรออกจริง
  if (twilioConfigured() && applicant.phone && applicant.phone !== '-') {
    try {
      const { sid } = await placeInterviewCall({ sessionId: data.id, toPhone: applicant.phone });
      await supabase
        .from('interview_sessions')
        .update({ status: 'calling', provider_call_sid: sid })
        .eq('id', data.id);
      return NextResponse.json({
        item: { ...data, status: 'calling', provider_call_sid: sid },
        interview_url: interviewPath,
        share_message: shareMessage,
        notice: `กำลังโทรหา ${applicant.name} (${applicant.phone})... หรือสามารถส่งลิงก์สัมภาษณ์ออนไลน์ให้ผู้สมัครได้ทันที`,
      });
    } catch (e) {
      await supabase.from('interview_sessions').update({ status: 'queued' }).eq('id', data.id);
      return NextResponse.json({
        item: data,
        interview_url: interviewPath,
        share_message: shareMessage,
        notice: `โทรออกผ่านเบอร์ไม่สำเร็จ (${e.message}) — แต่ท่านสามารถส่งลิงก์สัมภาษณ์ออนไลน์ฟรีให้ผู้สมัครได้ตามปกติ`,
      });
    }
  }

  // โหมดหลัก: Web Voice Interview ฟรี 100%
  return NextResponse.json({
    item: data,
    interview_url: interviewPath,
    share_message: shareMessage,
    notice: 'สร้างรอบสัมภาษณ์เรียบร้อยแล้ว! สามารถคัดลอกลิงก์สัมภาษณ์ออนไลน์ส่งให้ผู้สมัครทาง LINE หรือ SMS ได้ทันที (ฟรี ไม่เสียค่าโทร)',
  });
}
