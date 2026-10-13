-- Robin: core schema
-- All timestamps are timestamptz (stored UTC). Display conversion happens on the client
-- using each person's profile timezone (IANA name).

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Accounts and families
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 60),
  avatar_path text,
  timezone text not null default 'Australia/Brisbane',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.families (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.family_members (
  family_id uuid not null references public.families (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null check (role in ('owner', 'parent', 'helper')),
  relation_label text check (relation_label is null or char_length(relation_label) <= 40),
  joined_at timestamptz not null default now(),
  last_helped_at timestamptz,
  primary key (family_id, user_id)
);
create index family_members_user_idx on public.family_members (user_id);

-- Invitation tokens are never stored: only a SHA-256 hash. The plaintext token is
-- returned exactly once to the person who created the invitation.
create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  invited_by uuid references public.profiles (id) on delete set null,
  token_hash text not null unique,
  role text not null default 'helper' check (role in ('parent', 'helper')),
  note text check (note is null or char_length(note) <= 80),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  accepted_by uuid references public.profiles (id) on delete set null,
  accepted_at timestamptz,
  declined_at timestamptz,
  revoked_at timestamptz
);
create index invitations_family_idx on public.invitations (family_id);

-- ---------------------------------------------------------------------------
-- Tasks and events
-- ---------------------------------------------------------------------------

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  created_by uuid references public.profiles (id) on delete set null,
  client_id uuid,
  kind text not null check (kind in ('help', 'event')),
  category text not null check (category in ('childcare', 'meals', 'errands', 'appointment', 'family_event', 'other')),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  description text check (description is null or char_length(description) <= 2000),
  location text check (location is null or char_length(location) <= 200),
  notes text check (notes is null or char_length(notes) <= 2000),
  links text[] not null default '{}' check (cardinality(links) <= 5),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  all_day boolean not null default false,
  timezone text not null default 'Australia/Brisbane',
  respond_by timestamptz,
  helpers_needed int not null default 1 check (helpers_needed between 1 and 20),
  status text not null default 'draft' check (status in ('draft', 'open', 'confirmed', 'completed', 'cancelled')),
  cancelled_reason text check (cancelled_reason is null or char_length(cancelled_reason) <= 300),
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at >= starts_at),
  check (respond_by is null or respond_by <= starts_at),
  unique (created_by, client_id)
);
create index tasks_family_time_idx on public.tasks (family_id, starts_at);

create table public.task_invitees (
  task_id uuid not null references public.tasks (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  invited_at timestamptz not null default now(),
  primary key (task_id, user_id)
);
create index task_invitees_user_idx on public.task_invitees (user_id);

-- For help tasks, an 'accepted' row IS the assignment. Rows are only written by
-- respond_to_task(), which serialises on the task row.
create table public.task_responses (
  task_id uuid not null references public.tasks (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  response text not null check (response in ('accepted', 'declined', 'tentative')),
  responded_at timestamptz not null default now(),
  primary key (task_id, user_id)
);
create index task_responses_user_idx on public.task_responses (user_id);

-- ---------------------------------------------------------------------------
-- Messaging
-- ---------------------------------------------------------------------------

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  kind text not null check (kind in ('direct', 'group')),
  name text check (name is null or char_length(btrim(name)) between 1 and 60),
  direct_key text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  last_message_at timestamptz,
  unique (family_id, direct_key)
);

create table public.conversation_members (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  last_read_at timestamptz not null default now(),
  muted_until timestamptz,
  primary key (conversation_id, user_id)
);
create index conversation_members_user_idx on public.conversation_members (user_id);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid references public.profiles (id) on delete set null,
  body text check (body is null or char_length(body) <= 4000),
  client_id uuid not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (conversation_id, sender_id, client_id)
);
create index messages_conv_time_idx on public.messages (conversation_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Media and memories
-- ---------------------------------------------------------------------------

create table public.media (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  uploaded_by uuid references public.profiles (id) on delete set null,
  storage_path text not null unique,
  kind text not null check (kind in ('photo', 'video')),
  mime_type text not null,
  bytes bigint not null check (bytes > 0),
  width int,
  height int,
  duration_ms int check (duration_ms is null or duration_ms between 0 and 180000),
  status text not null default 'uploading' check (status in ('uploading', 'ready', 'failed', 'deleted')),
  created_at timestamptz not null default now()
);
create index media_family_idx on public.media (family_id, created_at desc);

create table public.message_attachments (
  message_id uuid not null references public.messages (id) on delete cascade,
  media_id uuid not null references public.media (id) on delete cascade,
  position int not null default 0,
  primary key (message_id, media_id)
);
create index message_attachments_media_idx on public.message_attachments (media_id);

create table public.memories (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  media_id uuid not null unique references public.media (id) on delete cascade,
  caption text check (caption is null or char_length(caption) <= 500),
  taken_on date not null default current_date,
  visibility text not null default 'family' check (visibility in ('family', 'parents_only')),
  source_message_id uuid references public.messages (id) on delete set null,
  source_task_id uuid references public.tasks (id) on delete set null,
  added_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index memories_family_idx on public.memories (family_id, taken_on desc, created_at desc);

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  family_id uuid references public.families (id) on delete cascade,
  type text not null,
  category text not null check (category in ('task_requests', 'task_updates', 'event_changes', 'messages', 'reminders')),
  actor_id uuid references public.profiles (id) on delete set null,
  task_id uuid references public.tasks (id) on delete cascade,
  conversation_id uuid references public.conversations (id) on delete cascade,
  title text not null,
  body text,
  dedupe_key text not null,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

create table public.notification_prefs (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  task_requests boolean not null default true,
  task_updates boolean not null default true,
  event_changes boolean not null default true,
  messages boolean not null default true,
  reminders boolean not null default true,
  push_enabled boolean not null default true,
  quiet_hours_start time,
  quiet_hours_end time,
  updated_at timestamptz not null default now()
);

create table public.push_devices (
  token text primary key check (char_length(token) <= 300),
  user_id uuid not null references public.profiles (id) on delete cascade,
  platform text not null check (platform in ('ios', 'android', 'web')),
  updated_at timestamptz not null default now()
);
create index push_devices_user_idx on public.push_devices (user_id);
