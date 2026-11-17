import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export async function GET(request) {
  const { user, error, status } = await requireAuth(request);
  if (error) return NextResponse.json({ error }, { status });

  const url = new URL(request.url);
  const refId = url.searchParams.get('refId');

  // If HR/Admin requests specific refId, return list of readers
  if ((user.role === 'admin' || user.role === 'hr') && refId) {
    const { data, error: dbError } = await supabase
      .from('audit_logs')
      .select('user_name, at')
      .eq('type', 'read_receipt')
      .eq('action', `ack:${refId}`)
      .order('at', { ascending: false });

    if (dbError) {
      return NextResponse.json({ error: dbError.message }, { status: 500 });
    }

    const readers = (data || []).map((r) => ({
      user_name: r.user_name,
      created_at: r.at,
    }));

    return NextResponse.json({ refId, readers });
  }

  // Current user's acknowledged refIds
  const userName = user.employeeId || user.username || user.name;
  const { data, error: dbError } = await supabase
    .from('audit_logs')
    .select('action')
    .eq('type', 'read_receipt')
    .eq('user_name', userName);

  if (dbError) {
    return NextResponse.json({ error: dbError.message }, { status: 500 });
  }

  const acknowledgedIds = (data || [])
    .map((r) => (r.action && r.action.startsWith('ack:') ? r.action.slice(4) : null))
    .filter(Boolean);

  return NextResponse.json({ acknowledgedIds });
}

export async function POST(request) {
  const { user, error, status } = await requireAuth(request);
  if (error) return NextResponse.json({ error }, { status });

  try {
    const body = await request.json();
    const { refId, title } = body || {};

    if (!refId) {
      return NextResponse.json({ error: 'Missing refId' }, { status: 400 });
    }

    const key = user.employeeId || user.username || user.name;
    const actionKey = `ack:${refId}`;

    const { data: existing, error: checkError } = await supabase
      .from('audit_logs')
      .select('id')
      .eq('type', 'read_receipt')
      .eq('action', actionKey)
      .eq('user_name', key)
      .maybeSingle();

    if (checkError) {
      return NextResponse.json({ error: checkError.message }, { status: 500 });
    }

    if (!existing) {
      const channel = title ? String(title).slice(0, 60) : 'PWA';
      const { error: insertError } = await supabase.from('audit_logs').insert({
        user_name: key,
        action: actionKey,
        channel,
        type: 'read_receipt',
      });

      if (insertError) {
        return NextResponse.json({ error: insertError.message }, { status: 500 });
      }
    }

    return NextResponse.json({ success: true, refId });
  } catch (err) {
    return NextResponse.json({ error: err.message || 'Invalid request' }, { status: 400 });
  }
}
