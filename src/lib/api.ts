// Every database read the app makes, as plain functions over a Supabase client.
// The React hooks call these, and the API tests call the very same functions
// against a real PostgREST server with row-level security on.
// (No React Native imports here, so Node can run it.)
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  CalendarItem, ConversationSummary, Invitation, Media, MemberWithProfile, Memory, Message, Notification,
  NotificationPrefs, Role, Task, TaskResponse,
} from './types';

type C = SupabaseClient;

function must<T>(res: { data: unknown; error: unknown }): T {
  if (res.error) throw res.error;
  return res.data as T;
}

export async function rpcCall<T = unknown>(c: C, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  return must<T>(await c.rpc(fn, args));
}

export type MyFamily = { id: string; name: string; role: Role; relation_label: string | null };

export async function fetchMyFamilies(c: C, userId: string): Promise<MyFamily[]> {
  const rows = must<{ family_id: string; role: Role; relation_label: string | null; families: { id: string; name: string } | null }[]>(
    await c.from('family_members').select('family_id, role, relation_label, families ( id, name )').eq('user_id', userId).order('joined_at'),
  );
  return rows.map((r) => ({ id: r.family_id, name: r.families?.name ?? 'Family', role: r.role, relation_label: r.relation_label }));
}

export async function fetchProfile(c: C, userId: string) {
  return must<{ id: string; display_name: string; avatar_path: string | null; timezone: string }>(
    await c.from('profiles').select('id, display_name, avatar_path, timezone').eq('id', userId).single(),
  );
}

export async function fetchMembers(c: C, familyId: string): Promise<MemberWithProfile[]> {
  return must(await c
    .from('family_members')
    .select('family_id, user_id, role, relation_label, joined_at, last_helped_at, profile:profiles ( id, display_name, avatar_path, timezone )')
    .eq('family_id', familyId)
    .order('joined_at'));
}

export async function fetchInvitations(c: C, familyId: string): Promise<Invitation[]> {
  return must(await c
    .from('invitations')
    .select('id, family_id, invited_by, role, note, expires_at, created_at, accepted_by, accepted_at, declined_at, revoked_at')
    .eq('family_id', familyId)
    .order('created_at', { ascending: false })
    .limit(50));
}

export async function fetchCalendar(c: C, familyId: string, from: string, to: string, scope: 'mine' | 'family'): Promise<CalendarItem[]> {
  return (await rpcCall<CalendarItem[]>(c, 'calendar_items', { p_from: from, p_to: to, p_family: familyId, p_scope: scope })) ?? [];
}

export type TaskDetail = { task: Task; invitees: string[]; responses: TaskResponse[] };

export async function fetchTask(c: C, id: string): Promise<TaskDetail | null> {
  const task = must<Task | null>(await c.from('tasks').select('*').eq('id', id).maybeSingle());
  if (!task) return null;
  const [inv, resp] = await Promise.all([
    c.from('task_invitees').select('user_id').eq('task_id', id),
    c.from('task_responses').select('*').eq('task_id', id),
  ]);
  return {
    task,
    invitees: must<{ user_id: string }[]>(inv).map((r) => r.user_id),
    responses: must<TaskResponse[]>(resp),
  };
}

export async function fetchConversations(c: C, familyId: string): Promise<ConversationSummary[]> {
  return (await rpcCall<ConversationSummary[]>(c, 'conversation_list', { p_family: familyId })) ?? [];
}

export type ConversationDetail = {
  id: string; family_id: string; kind: 'direct' | 'group'; name: string | null; created_by: string | null;
  members: { user_id: string; last_read_at: string; muted_until: string | null }[];
};

export async function fetchConversation(c: C, id: string): Promise<ConversationDetail | null> {
  const conv = must<Omit<ConversationDetail, 'members'> | null>(
    await c.from('conversations').select('id, family_id, kind, name, created_by').eq('id', id).maybeSingle(),
  );
  if (!conv) return null;
  const members = must<ConversationDetail['members']>(
    await c.from('conversation_members').select('user_id, last_read_at, muted_until').eq('conversation_id', id),
  );
  return { ...conv, members };
}

const MEDIA_COLS = 'id, storage_path, kind, mime_type, width, height, duration_ms, status, family_id, uploaded_by, bytes, created_at';
export const MESSAGE_PAGE = 30;

export async function fetchMessagesPage(c: C, conversationId: string, before: string | null): Promise<Message[]> {
  let q = c
    .from('messages')
    .select(`id, conversation_id, sender_id, body, client_id, created_at, deleted_at, message_attachments ( media_id, position, media ( ${MEDIA_COLS} ) )`)
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(MESSAGE_PAGE);
  if (before) q = q.lt('created_at', before);
  return must(await q);
}

export async function fetchSharedMedia(c: C, conversationId: string): Promise<Media[]> {
  const rows = must<{ media: Media | null }[]>(await c
    .from('message_attachments')
    .select(`media_id, media ( ${MEDIA_COLS} ), messages!inner ( conversation_id, deleted_at, created_at )`)
    .eq('messages.conversation_id', conversationId)
    .is('messages.deleted_at', null)
    .limit(60));
  return rows.map((r) => r.media).filter(Boolean) as Media[];
}

export const MEMORY_PAGE = 48;
const MEMORY_COLS = `id, family_id, media_id, caption, taken_on, visibility, source_message_id, source_task_id, added_by, created_at, media ( ${MEDIA_COLS} )`;

export async function fetchMemoriesPage(c: C, familyId: string, offset: number): Promise<Memory[]> {
  return must(await c
    .from('memories')
    .select(MEMORY_COLS)
    .eq('family_id', familyId)
    .is('deleted_at', null)
    .order('taken_on', { ascending: false })
    .order('created_at', { ascending: false })
    .range(offset, offset + MEMORY_PAGE - 1));
}

export async function fetchMemory(c: C, id: string): Promise<Memory | null> {
  return must(await c.from('memories').select(MEMORY_COLS).eq('id', id).is('deleted_at', null).maybeSingle());
}

export async function fetchNotifications(c: C): Promise<Notification[]> {
  return must(await c.from('notifications').select('*').order('created_at', { ascending: false }).limit(100));
}

export async function fetchPrefs(c: C): Promise<NotificationPrefs> {
  return must(await c.from('notification_prefs').select('*').single());
}

export async function updatePref(c: C, userId: string, key: keyof NotificationPrefs, value: boolean) {
  must(await c.from('notification_prefs').update({ [key]: value }).eq('user_id', userId).select('user_id').single());
}

export async function conversationIdForMessage(c: C, messageId: string): Promise<string | null> {
  const row = must<{ conversation_id: string } | null>(await c.from('messages').select('conversation_id').eq('id', messageId).maybeSingle());
  return row?.conversation_id ?? null;
}
