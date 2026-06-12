import { createClient } from '@supabase/supabase-js';

// สร้าง client แบบ lazy — เพื่อไม่ให้ build (collect page data) ล้มเหลว
// ตอนที่ยังไม่ได้ตั้งค่า env vars
let client = null;

function getClient() {
  if (client) return client;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars');
  }

  client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
  return client;
}

export const supabase = new Proxy({}, {
  get(_target, prop) {
    return getClient()[prop];
  },
});

export const DOCUMENTS_BUCKET = 'documents';
