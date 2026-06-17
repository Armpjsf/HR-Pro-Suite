import { supabase } from './supabase';

function vapidReady() {
  return Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT);
}

async function sendBrowserPush(employeeId, payload) {
  if (!vapidReady()) return { sent: 0, skipped: true };

  const { default: webpush } = await import('web-push');
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT,
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  );

  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('*')
    .eq('employee_id', employeeId)
    .eq('active', true);

  let sent = 0;
  for (const sub of subs || []) {
    try {
      await webpush.sendNotification({
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      }, JSON.stringify(payload));
      sent += 1;
    } catch (error) {
      if (error?.statusCode === 404 || error?.statusCode === 410) {
        await supabase.from('push_subscriptions').update({ active: false, updated_at: new Date().toISOString() }).eq('id', sub.id);
      }
    }
  }

  return { sent };
}

export async function createNotification({ employeeId, title, body, url = '/', type = 'general', audience = 'employee' }) {
  if (!employeeId || !title || !body) return null;

  const { data: user } = await supabase
    .from('users')
    .select('employee_id, role')
    .eq('employee_id', employeeId)
    .maybeSingle();
  if (!user) return null;

  const { data } = await supabase
    .from('notifications')
    .insert({
      recipient_employee_id: employeeId,
      recipient_role: user.role || null,
      audience,
      title,
      body,
      url,
      type,
    })
    .select()
    .single();

  await sendBrowserPush(employeeId, {
    title,
    body,
    url,
    type,
    notificationId: data?.id,
  });

  return data || null;
}

export async function notifyEmployees(employeeIds, payload) {
  const unique = [...new Set((employeeIds || []).filter(Boolean))];
  await Promise.all(unique.map((employeeId) => createNotification({ ...payload, employeeId })));
}

export async function getHrRecipients(menuKey) {
  const [{ data: users }, { data: permissions }] = await Promise.all([
    supabase.from('users').select('employee_id, role'),
    supabase.from('role_permissions').select('role, menus'),
  ]);
  const permissionMap = new Map((permissions || []).map((p) => [p.role, p.menus || []]));

  return (users || [])
    .filter((user) => {
      if (user.role === 'admin') return true;
      const menus = permissionMap.get(user.role);
      if (!menus) return user.role === 'hr';
      return menus.includes('__all__') || menus.includes(menuKey);
    })
    .map((user) => user.employee_id);
}

export async function notifyHr(menuKey, payload) {
  const recipients = await getHrRecipients(menuKey);
  await notifyEmployees(recipients, { ...payload, audience: 'hr' });
}
