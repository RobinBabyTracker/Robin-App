// Row shapes returned by the database. (Can be replaced with generated types:
// `npx supabase gen types typescript --project-id <id> > src/lib/database.types.ts`.)
import type { TaskCategory, TaskKind } from './forms';

export type Role = 'owner' | 'parent' | 'helper';
export type TaskStatus = 'draft' | 'open' | 'confirmed' | 'completed' | 'cancelled';
export type ResponseKind = 'accepted' | 'declined' | 'tentative';

export type Profile = { id: string; display_name: string; avatar_path: string | null; timezone: string };
export type Family = { id: string; name: string; created_by: string | null; created_at: string };
export type Membership = {
  family_id: string; user_id: string; role: Role; relation_label: string | null; joined_at: string; last_helped_at: string | null;
};
export type MemberWithProfile = Membership & { profile: Profile | null };

export type Invitation = {
  id: string; family_id: string; invited_by: string | null; role: 'parent' | 'helper'; note: string | null;
  expires_at: string; created_at: string; accepted_by: string | null; accepted_at: string | null;
  declined_at: string | null; revoked_at: string | null;
};

export type Task = {
  id: string; family_id: string; created_by: string | null; kind: TaskKind; category: TaskCategory; title: string;
  description: string | null; location: string | null; notes: string | null; links: string[];
  starts_at: string; ends_at: string; all_day: boolean; timezone: string; respond_by: string | null;
  helpers_needed: number; status: TaskStatus; cancelled_reason: string | null; version: number;
  created_at: string; updated_at: string;
};

export type CalendarItem = {
  id: string; family_id: string; kind: TaskKind; category: TaskCategory; title: string; location: string | null;
  starts_at: string; ends_at: string; all_day: boolean; timezone: string; respond_by: string | null;
  status: TaskStatus; helpers_needed: number; created_by: string | null;
  my_role: 'organiser' | 'helper' | 'attendee' | 'invited' | 'family'; my_response: ResponseKind | null;
  accepted_count: number; tentative_count: number; invitee_count: number; version: number;
};

export type TaskResponse = { task_id: string; user_id: string; response: ResponseKind; responded_at: string };

export type ConversationSummary = {
  id: string; kind: 'direct' | 'group'; name: string | null; last_message_at: string | null; last_body: string | null;
  last_sender: string | null; last_has_media: boolean; unread_count: number; other_user: string | null;
  member_count: number; muted_until: string | null;
};

export type Media = {
  id: string; family_id: string; uploaded_by: string | null; storage_path: string; kind: 'photo' | 'video';
  mime_type: string; bytes: number; width: number | null; height: number | null; duration_ms: number | null;
  status: 'uploading' | 'ready' | 'failed' | 'deleted'; created_at: string;
};

export type Message = {
  id: string; conversation_id: string; sender_id: string | null; body: string | null; client_id: string;
  created_at: string; deleted_at: string | null;
  message_attachments?: { media_id: string; position: number; media: Media | null }[];
};

export type Memory = {
  id: string; family_id: string; media_id: string; caption: string | null; taken_on: string;
  visibility: 'family' | 'parents_only'; source_message_id: string | null; source_task_id: string | null;
  added_by: string | null; created_at: string; media: Media | null;
};

export type Notification = {
  id: string; user_id: string; family_id: string | null; type: string; category: string; actor_id: string | null;
  task_id: string | null; conversation_id: string | null; title: string; body: string | null; read_at: string | null; created_at: string;
};

export type NotificationPrefs = {
  user_id: string; task_requests: boolean; task_updates: boolean; event_changes: boolean; messages: boolean;
  reminders: boolean; push_enabled: boolean; quiet_hours_start: string | null; quiet_hours_end: string | null;
};
