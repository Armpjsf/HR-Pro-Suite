// lib/interview-scoring.js — เฟส 4: สรุป + ให้คะแนนบทสัมภาษณ์ด้วย LLM แล้วเขียนกลับ + แจ้ง HR
import { supabase } from './supabase';
import { chatComplete } from './llm';
import { notifyHr } from './notifications';

function buildPrompt({ questions, turns, position, applicantName }) {
  const qLines = (questions || []).length
    ? questions.map((q, i) => `${i + 1}. (${q.q}) [น้ำหนัก ${q.weight || 1}]`).join('\n')
    : '(ใช้เกณฑ์คัดกรองมาตรฐาน: ความพร้อมเริ่มงาน, ความคาดหวังเงินเดือน, ประสบการณ์ที่เกี่ยวข้อง, ความสนใจงาน)';

  const convo = (turns || [])
    .map((t) => `${t.role === 'ai' ? 'ผู้สัมภาษณ์' : 'ผู้สมัคร'}: ${t.text}`)
    .join('\n');

  return `คุณเป็น HR ผู้ประเมินผลสัมภาษณ์งานเบื้องต้น ประเมินอย่างเป็นกลางจากบทสนทนาที่ให้มาเท่านั้น

ตำแหน่ง: ${position || 'ไม่ระบุ'}
ผู้สมัคร: ${applicantName || 'ไม่ระบุ'}

คำถามที่ใช้:
${qLines}

บทสนทนา:
${convo || '(ไม่มีบทสนทนา)'}

ให้คะแนนแต่ละคำถาม 0-5 (0=ไม่ตอบ/ไม่เกี่ยวข้อง, 5=ตอบดีมากตรงประเด็น) จากคำตอบจริงในบทสนทนา
ตอบกลับเป็น JSON เท่านั้น ห้ามมีข้อความอื่นนอก JSON:
{
  "per_question": [{ "index": 1, "score": 0-5, "note": "สรุปคำตอบสั้นๆ" }],
  "summary": "สรุปภาพรวมผู้สมัคร 2-3 ประโยค ภาษาไทย",
  "strengths": "จุดเด่น",
  "concerns": "ข้อกังวล/ธงแดง (ถ้ามี)"
}`;
}

function parseJson(text) {
  const s = text.indexOf('{');
  const e = text.lastIndexOf('}');
  if (s === -1 || e === -1) throw new Error('LLM ไม่ได้ตอบเป็น JSON');
  return JSON.parse(text.slice(s, e + 1));
}

/**
 * ประเมินผล 1 รอบสัมภาษณ์: โหลด → ให้คะแนน → เขียนกลับ session+applicant → แจ้ง HR
 * @returns { score, max_score, summary, recommendation }
 */
export async function runScoring(sessionId, { notify = true } = {}) {
  const { data: session } = await supabase
    .from('interview_sessions').select('*').eq('id', sessionId).maybeSingle();
  if (!session) throw new Error('ไม่พบรอบสัมภาษณ์');

  const [{ data: turns }, { data: applicant }, { data: qset }] = await Promise.all([
    supabase.from('interview_turns').select('*').eq('session_id', sessionId).order('turn_index', { ascending: true }),
    supabase.from('applicants').select('*').eq('id', session.applicant_id).maybeSingle(),
    session.question_set_id
      ? supabase.from('interview_question_sets').select('*').eq('id', session.question_set_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  if (!turns || turns.length === 0) throw new Error('ยังไม่มีบทสนทนาให้ประเมิน');

  const questions = qset?.questions || [];
  const prompt = buildPrompt({
    questions,
    turns,
    position: applicant?.position_applied,
    applicantName: applicant?.name,
  });

  const raw = await chatComplete(prompt);
  const parsed = parseJson(raw);

  // คำนวณคะแนนถ่วงน้ำหนักในโค้ด (เชื่อถือได้กว่าให้ LLM บวกเลข)
  const weights = questions.length ? questions.map((q) => Number(q.weight) || 1) : [1, 1, 1, 1];
  const perQ = Array.isArray(parsed.per_question) ? parsed.per_question : [];
  let total = 0;
  let max = 0;
  weights.forEach((w, i) => {
    const item = perQ.find((p) => Number(p.index) === i + 1) || perQ[i];
    const sc = Math.max(0, Math.min(5, Number(item?.score) || 0));
    total += sc * w;
    max += 5 * w;
  });
  total = Math.round(total);

  const ratio = max ? total / max : 0;
  const recommendation = ratio >= 0.7 ? 'pass' : ratio >= 0.5 ? 'borderline' : 'reject';

  const summaryParts = [parsed.summary];
  if (parsed.strengths) summaryParts.push(`จุดเด่น: ${parsed.strengths}`);
  if (parsed.concerns) summaryParts.push(`ข้อกังวล: ${parsed.concerns}`);
  const summary = summaryParts.filter(Boolean).join('\n');

  await supabase.from('interview_sessions').update({
    score: total, max_score: max, summary, recommendation,
  }).eq('id', sessionId);

  await supabase.from('applicants').update({
    interview_score: total, last_interview_at: new Date().toISOString(),
  }).eq('id', session.applicant_id);

  if (notify) {
    const recLabel = { pass: '✅ ผ่านเกณฑ์', borderline: '⚠️ ก้ำกึ่ง', reject: '❌ ต่ำกว่าเกณฑ์' }[recommendation];
    try {
      await notifyHr('applicants', {
        title: '🎙️ ผลสัมภาษณ์ AI พร้อมแล้ว',
        body: `${applicant?.name || 'ผู้สมัคร'} — คะแนน ${total}/${max} (${recLabel})`,
        url: `/hr/interviews/${sessionId}`,
        type: 'interview',
      });
    } catch { /* แจ้งเตือนล้มเหลวไม่ควรทำให้การให้คะแนนพัง */ }
  }

  return { score: total, max_score: max, summary, recommendation };
}
