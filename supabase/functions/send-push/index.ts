// Sends a push notification for each new in-app notification.
// Triggered by a Supabase Database Webhook on INSERT and UPDATE of public.notifications
// (chat notifications are refreshed in place, so each new message is an UPDATE),
// with the header `x-robin-secret: <ROBIN_FUNCTION_SECRET>`.
// Honours: notification already read, push turned off, quiet hours (in the
// person's own time zone). The in-app notification exists regardless.
import { json, requireSecret, serviceClient } from '../_shared/env.ts';
import { inQuietHours } from '../_shared/quiet.ts';

type Target = {
  token: string; push_enabled: boolean; quiet_start: string | null; quiet_end: string | null; timezone: string;
  title: string; body: string | null; task_id: string | null; conversation_id: string | null; family_id: string | null; unread: number;
};

Deno.serve(async (req) => {
  const denied = requireSecret(req);
  if (denied) return denied;
  type Row = { id?: string; created_at?: string; read_at?: string | null };
  let payload: { type?: string; table?: string; record?: Row; old_record?: Row };
  try { payload = await req.json(); } catch { return json({ error: 'bad_request' }, 400); }
  if (payload.table !== 'notifications' || !payload.record?.id) return json({ skipped: true });
  // Only a new notification, or one refreshed by a new message, should buzz a phone.
  const refreshed = payload.type === 'UPDATE' && !payload.record.read_at && payload.old_record?.created_at !== payload.record.created_at;
  if (payload.type !== 'INSERT' && !refreshed) return json({ skipped: true });

  const admin = serviceClient();
  const { data, error } = await admin.rpc('admin_push_targets', { p_notification: payload.record.id });
  if (error) return json({ error: 'lookup_failed' }, 500);
  const targets = ((data ?? []) as Target[]).filter((t) => t.push_enabled && !inQuietHours(new Date(), t.timezone, t.quiet_start, t.quiet_end));
  if (!targets.length) return json({ sent: 0 });

  const messages = targets.map((t) => ({
    to: t.token,
    title: t.title,
    body: t.body ?? undefined,
    sound: 'default',
    badge: t.unread,
    data: { taskId: t.task_id, conversationId: t.conversation_id, familyId: t.family_id },
  }));
  const res = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(Deno.env.get('EXPO_ACCESS_TOKEN') ? { authorization: `Bearer ${Deno.env.get('EXPO_ACCESS_TOKEN')}` } : {}),
    },
    body: JSON.stringify(messages),
  });
  if (!res.ok) return json({ error: 'push_service_error', status: res.status }, 502);
  const out = await res.json() as { data?: { status: string; details?: { error?: string } }[] };
  const dead = (out.data ?? []).flatMap((r, i) => (r.status === 'error' && r.details?.error === 'DeviceNotRegistered' ? [targets[i].token] : []));
  if (dead.length) await admin.rpc('admin_forget_push_tokens', { p_tokens: dead });
  return json({ sent: targets.length - dead.length, removed: dead.length });
});
