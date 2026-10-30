// db.js — เขียนสถานะสาย + บทสนทนา ลง Supabase (ใช้ service role key)
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const supabase = url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;

export async function getSession(sessionId) {
  if (!supabase) return null;
  const { data } = await supabase.from('interview_sessions').select('*').eq('id', sessionId).maybeSingle();
  return data;
}

export async function getApplicant(id) {
  if (!supabase || !id) return null;
  const { data } = await supabase.from('applicants').select('*').eq('id', id).maybeSingle();
  return data;
}

export async function getQuestionSet(id) {
  if (!supabase || !id) return null;
  const { data } = await supabase.from('interview_question_sets').select('*').eq('id', id).maybeSingle();
  return data;
}

export async function updateSession(sessionId, patch) {
  if (!supabase) return;
  await supabase.from('interview_sessions').update(patch).eq('id', sessionId);
}

export async function insertTurn(sessionId, turnIndex, role, text, questionRef = null) {
  if (!supabase || !text?.trim()) return;
  await supabase.from('interview_turns').insert({
    session_id: sessionId,
    turn_index: turnIndex,
    role,
    text: text.trim(),
    question_ref: questionRef,
  });
}

export async function markApplicantInterviewed(applicantId, score) {
  if (!supabase) return;
  const patch = { last_interview_at: new Date().toISOString() };
  if (score != null) patch.interview_score = score;
  await supabase.from('applicants').update(patch).eq('id', applicantId);
}
