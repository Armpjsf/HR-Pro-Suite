import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { getDocuments, getUsers, getLineMappings, getAuditLog } from '@/lib/db';

/**
 * GET /api/stats — สถิติจริงสำหรับแดชบอร์ด (admin/hr)
 */
export async function GET(request) {
  const { error, status } = requireRole(request, ['admin', 'hr']);
  if (error) return NextResponse.json({ error }, { status });

  const [log, documents, users, lineMappings] = await Promise.all([
    getAuditLog(),
    getDocuments(),
    getUsers(),
    getLineMappings(),
  ]);
  const today = new Date().toISOString().split('T')[0];
  const chatsToday = log.filter(
    (e) => e.type === 'chat' && e.at?.startsWith(today)
  ).length;

  return NextResponse.json({
    stats: {
      documents: documents.length,
      users: users.length,
      chatsToday,
      lineUsers: Object.keys(lineMappings).length,
    },
    recentActivity: log.slice(0, 10).map((e) => ({
      time: e.at
        ? new Date(e.at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })
        : '',
      user: e.user,
      action: e.action,
      channel: e.channel || 'PWA',
    })),
  });
}
