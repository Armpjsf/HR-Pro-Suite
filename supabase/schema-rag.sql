-- RAG: ตัดเนื้อหาเอกสารเป็นชิ้น + เก็บ embedding เพื่อค้นเฉพาะจุดที่ตรงคำถาม
-- รันครั้งเดียวใน Supabase SQL editor
-- ใช้ Gemini text-embedding-004 → เวกเตอร์ขนาด 768 มิติ

create extension if not exists vector;

create table if not exists document_chunks (
  id bigserial primary key,
  document_id text not null references documents(id) on delete cascade,
  chunk_index int not null,
  content text not null,
  embedding vector(768),
  created_at timestamptz not null default now()
);

create index if not exists document_chunks_doc_idx on document_chunks (document_id);

-- index สำหรับค้นความใกล้เคียง (cosine). ลด lists ลงถ้าข้อมูลยังน้อย
create index if not exists document_chunks_embedding_idx
  on document_chunks using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- ฟังก์ชันค้นชิ้นที่ใกล้เคียงคำถามที่สุด (จำกัดเฉพาะเอกสารที่ผู้ใช้มีสิทธิ์เห็น)
create or replace function match_document_chunks(
  query_embedding vector(768),
  match_count int,
  allowed_doc_ids text[]
)
returns table (
  document_id text,
  content text,
  similarity float
)
language sql stable
as $$
  select
    dc.document_id,
    dc.content,
    1 - (dc.embedding <=> query_embedding) as similarity
  from document_chunks dc
  where dc.document_id = any(allowed_doc_ids)
    and dc.embedding is not null
  order by dc.embedding <=> query_embedding
  limit match_count;
$$;
