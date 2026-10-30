-- เฟส 19: AI สัมภาษณ์ผู้สมัครด้วยเสียง (โครงข้อมูล + UI — เฟส 1)
-- ยังไม่ต่อ Twilio/Gemini Live ในเฟสนี้ (เฟส 2-3) — เก็บชุดคำถาม, รอบสัมภาษณ์, บทสนทนา, คะแนน
--
-- วิธีรัน: เปิด Supabase -> SQL Editor -> วางไฟล์นี้ทั้งไฟล์ -> Run
-- (รันซ้ำได้ ปลอดภัย เพราะใช้ if not exists / add column if not exists)

-- 1) ชุดคำถามสัมภาษณ์ (ผูกกับตำแหน่งได้ หรือใช้เป็นชุดกลาง)
create table if not exists interview_question_sets (
  id bigserial primary key,
  name text not null,                       -- ชื่อชุด เช่น "คัดกรองพนักงานขับรถ"
  position text,                            -- ตำแหน่งที่ใช้ชุดนี้ (ว่าง = ใช้ได้ทุกตำแหน่ง)
  lang text not null default 'th',          -- ภาษาที่ AI ใช้พูด (th/en)
  intro_script text,                        -- ประโยคเปิดสาย (แนะนำตัว AI + บริษัท)
  consent_script text,                      -- ข้อความขอความยินยอมบันทึกเสียง (PDPA)
  questions jsonb not null default '[]'::jsonb, -- [{ "q": "คำถาม", "weight": 1 }]
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ค่าเริ่มต้นของข้อความ PDPA (ให้แก้เองภายหลังได้)
-- consent_script ตัวอย่าง: "สายนี้เป็นการสัมภาษณ์งานเบื้องต้นด้วยระบบ AI และมีการบันทึกเสียง
--   เพื่อใช้ในการพิจารณาคัดเลือกเท่านั้น หากยินยอมให้ดำเนินการต่อ กรุณาพูดว่า 'ยินยอม' ค่ะ"

-- 2) รอบสัมภาษณ์ (1 แถว = 1 สายที่โทรหาผู้สมัคร)
create table if not exists interview_sessions (
  id bigserial primary key,
  applicant_id bigint not null references applicants(id) on delete cascade,
  question_set_id bigint references interview_question_sets(id) on delete set null,
  phone text,                               -- เบอร์ที่โทร (snapshot ตอนสร้าง)
  status text not null default 'queued',
    -- queued: รอโทร | calling: กำลังต่อสาย | in_progress: กำลังสัมภาษณ์
    -- completed: จบสมบูรณ์ | no_consent: ไม่ยินยอม | no_answer: ไม่รับสาย | failed: ผิดพลาด
  provider_call_sid text,                   -- Twilio Call SID (เฟส 3)
  score int,                                -- คะแนนรวมที่ AI ให้ (เฟส 4)
  max_score int,                            -- คะแนนเต็ม
  summary text,                             -- สรุปผลสั้น ๆ สำหรับ HR อ่าน
  recommendation text,                      -- ข้อเสนอแนะ: pass / borderline / reject (คนตัดสินสุดท้าย)
  started_at timestamptz,
  ended_at timestamptz,
  duration_sec int,
  created_by text,                          -- employee_id ของ HR ที่กดโทร
  created_at timestamptz not null default now()
);
create index if not exists interview_sessions_applicant_idx
  on interview_sessions (applicant_id, created_at desc);
create index if not exists interview_sessions_status_idx
  on interview_sessions (status);

-- 3) บทสนทนาแต่ละ turn (append-only เพื่อ audit ย้อนกลับได้)
create table if not exists interview_turns (
  id bigserial primary key,
  session_id bigint not null references interview_sessions(id) on delete cascade,
  turn_index int not null,                  -- ลำดับใน 1 สาย
  role text not null,                       -- 'ai' | 'applicant'
  question_ref int,                         -- อ้างอิง index ของคำถามในชุด (ถ้ามี)
  text text,                                -- ข้อความที่ถอดจากเสียง / บทที่ AI พูด
  created_at timestamptz not null default now()
);
create index if not exists interview_turns_session_idx
  on interview_turns (session_id, turn_index);

-- 4) เก็บคะแนน/ผลล่าสุดไว้ที่ applicants เพื่อโชว์ในตารางได้เร็ว
alter table applicants add column if not exists interview_score int;
alter table applicants add column if not exists last_interview_at timestamptz;
