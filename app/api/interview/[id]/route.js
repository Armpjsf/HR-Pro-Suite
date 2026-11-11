import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// GET /api/interview/[id] — ดึงข้อมูลรอบสัมภาษณ์สำหรับผู้สมัคร (Public endpoint)
export async function GET(request, { params }) {
  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'ไม่พบรหัสรอบสัมภาษณ์' }, { status: 400 });

  const { data: session, error: sErr } = await supabase
    .from('interview_sessions')
    .select('id, applicant_id, question_set_id, status, started_at, ended_at, duration_sec, created_at')
    .eq('id', id)
    .maybeSingle();

  if (sErr || !session) {
    return NextResponse.json({ error: 'ไม่พบรอบสัมภาษณ์นี้ หรือลิงก์อาจหมดอายุ' }, { status: 404 });
  }

  // ดึงข้อมูลผู้สมัคร (เฉพาะชื่อและตำแหน่งที่สมัคร เพื่อความเป็นส่วนตัว)
  const { data: applicant } = await supabase
    .from('applicants')
    .select('id, name, position_applied')
    .eq('id', session.applicant_id)
    .maybeSingle();

  // ดึงชุดคำถาม (ถ้ามี) หรือใช้ชุดคำถามมาตรฐาน
  let questionSet = null;
  if (session.question_set_id) {
    const { data: qset } = await supabase
      .from('interview_question_sets')
      .select('id, name, position, intro_script, consent_script, questions')
      .eq('id', session.question_set_id)
      .maybeSingle();
    if (qset) {
      questionSet = {
        id: qset.id,
        name: qset.name,
        position: qset.position,
        intro_script: qset.intro_script,
        consent_script: qset.consent_script,
        // ส่งเฉพาะข้อความคำถาม ไม่ส่ง weight เพื่อป้องกันการเก็งคะแนน
        questions: (qset.questions || []).map((q, idx) => ({
          index: idx + 1,
          q: q.q,
        })),
      };
    }
  }

  // ถ้าไม่มีชุดคำถาม ให้ใช้คำถามคัดกรองมาตรฐาน
  if (!questionSet) {
    questionSet = {
      id: null,
      name: 'คำถามสัมภาษณ์เบื้องต้นมาตรฐาน',
      position: applicant?.position_applied || 'ทั่วไป',
      intro_script: `สวัสดีครับคุณ ${applicant?.name || 'ผู้สมัคร'} ยินดีต้อนรับสู่การสัมภาษณ์งานเบื้องต้นกับระบบ AI ของเราครับ วันนี้เราจะพูดคุยสั้นๆ เพื่อทำความรู้จักกันครับ`,
      consent_script: 'การสัมภาษณ์นี้จะถูกบันทึกเสียงและประมวลผลคำตอบเพื่อส่งให้ฝ่ายบุคคลพิจารณา คุณยินยอมที่จะดำเนินการต่อหรือไม่ครับ',
      questions: [
        { index: 1, q: 'ช่วยแนะนำตัวเองสั้นๆ พร้อมเล่าประสบการณ์ทำงานที่ผ่านมาที่เกี่ยวข้องกับตำแหน่งนี้ครับ' },
        { index: 2, q: 'ทำไมถึงสนใจร่วมงานกับบริษัทเรา และมีจุดเด่นอะไรที่จะช่วยให้ทำงานในตำแหน่งนี้ได้ดีครับ' },
        { index: 3, q: 'หากได้รับการคัดเลือก คุณพร้อมเริ่มงานได้เมื่อไหร่ และมีความคาดหวังเรื่องเงินเดือนหรือสวัสดิการอย่างไรครับ' },
      ],
    };
  }

  // ดึง turns เดิมที่เคยตอบไว้แล้ว (กรณีเน็ตหลุดแล้วเปิดใหม่)
  const { data: turns } = await supabase
    .from('interview_turns')
    .select('turn_index, role, question_ref, text, created_at')
    .eq('session_id', id)
    .order('turn_index', { ascending: true });

  return NextResponse.json({
    ok: true,
    session,
    applicant: {
      name: applicant?.name || 'ผู้สมัครงาน',
      position: applicant?.position_applied || 'ไม่ระบุ',
    },
    questionSet,
    turns: turns || [],
  });
}
