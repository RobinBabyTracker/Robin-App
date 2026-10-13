-- Robin: access rules
-- Reads go through row-level security. Every write that matters goes through a
-- SECURITY DEFINER function in public (see the next migration) that checks
-- membership and permissions itself, so clients get no direct write access to
-- most tables.

-- ---------------------------------------------------------------------------
-- Helper predicates (private schema: not exposed through the API)
-- ---------------------------------------------------------------------------

create or replace function private.uid() returns uuid
language sql stable as $$ select auth.uid() $$;

create or replace function private.is_member(p_family uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.family_members m
    where m.family_id = p_family and m.user_id = auth.uid()
  )
$$;

create or replace function private.member_role(p_family uuid) returns text
language sql stable security definer set search_path = '' as $$
  select m.role from public.family_members m
  where m.family_id = p_family and m.user_id = auth.uid()
$$;

create or replace function private.is_parent(p_family uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.member_role(p_family) in ('owner', 'parent'), false)
$$;

create or replace function private.shares_family(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_user = auth.uid() or exists (
    select 1
    from public.family_members a
    join public.family_members b on b.family_id = a.family_id
    where a.user_id = auth.uid() and b.user_id = p_user
  )
$$;

-- Who can see a task: its creator; anyone it was sent to; and the family's
-- parents/owners. Drafts are visible to their creator only.
create or replace function private.can_view_task(p_task uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.tasks t
    where t.id = p_task
      and private.is_member(t.family_id)
      and (
        t.created_by = auth.uid()
        or (t.status <> 'draft' and (
              private.is_parent(t.family_id)
              or exists (select 1 from public.task_invitees i where i.task_id = t.id and i.user_id = auth.uid())
           ))
      )
  )
$$;

create or replace function private.is_conversation_member(p_conversation uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.conversation_members cm
    join public.conversations c on c.id = cm.conversation_id
    join public.family_members fm on fm.family_id = c.family_id and fm.user_id = cm.user_id
    where cm.conversation_id = p_conversation and cm.user_id = auth.uid()
  )
$$;

create or replace function private.can_view_memory(p_memory uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memories mm
    join public.media md on md.id = mm.media_id and md.status = 'ready'
    where mm.id = p_memory
      and mm.deleted_at is null
      and private.is_member(mm.family_id)
      and (mm.visibility = 'family' or private.is_parent(mm.family_id) or mm.added_by = auth.uid())
  )
$$;

-- A media item is viewable if it is ready and the viewer is still in its family
-- and EITHER uploaded it, OR is in a conversation where it was sent (and the
-- message is not deleted), OR can see a memory that uses it.
create or replace function private.can_view_media(p_media uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.media md
    where md.id = p_media
      and md.status = 'ready'
      and private.is_member(md.family_id)
      and (
        md.uploaded_by = auth.uid()
        or exists (
          select 1 from public.message_attachments a
          join public.messages msg on msg.id = a.message_id and msg.deleted_at is null
          where a.media_id = md.id and private.is_conversation_member(msg.conversation_id)
        )
        or exists (
          select 1 from public.memories mm
          where mm.media_id = md.id and private.can_view_memory(mm.id)
        )
      )
  )
$$;

create or replace function private.can_view_media_path(p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select private.can_view_media(md.id) from public.media md where md.storage_path = p_path), false)
$$;

grant execute on all functions in schema private to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Table privileges: start from nothing, then grant only what is needed.
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon, authenticated;

grant select on
  public.profiles, public.families, public.family_members,
  public.tasks, public.task_invitees, public.task_responses,
  public.conversations, public.conversation_members, public.messages,
  public.media, public.message_attachments, public.memories,
  public.notifications, public.notification_prefs
to authenticated;

-- Token hashes are never readable by clients.
grant select (id, family_id, invited_by, role, note, expires_at, created_at,
              accepted_by, accepted_at, declined_at, revoked_at)
  on public.invitations to authenticated;

-- Small self-service updates allowed directly (column-limited + RLS).
grant update (task_requests, task_updates, event_changes, messages, reminders,
              push_enabled, quiet_hours_start, quiet_hours_end)
  on public.notification_prefs to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant delete on public.notifications to authenticated;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.families enable row level security;
alter table public.family_members enable row level security;
alter table public.invitations enable row level security;
alter table public.tasks enable row level security;
alter table public.task_invitees enable row level security;
alter table public.task_responses enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.media enable row level security;
alter table public.message_attachments enable row level security;
alter table public.memories enable row level security;
alter table public.notifications enable row level security;
alter table public.notification_prefs enable row level security;
alter table public.push_devices enable row level security;

create policy "see people who share a family" on public.profiles
  for select to authenticated using (private.shares_family(id));

create policy "members see their family" on public.families
  for select to authenticated using (private.is_member(id));

create policy "members see fellow members" on public.family_members
  for select to authenticated using (private.is_member(family_id));

create policy "parents see invitations" on public.invitations
  for select to authenticated using (private.is_parent(family_id));

create policy "see permitted tasks" on public.tasks
  for select to authenticated using (private.can_view_task(id));

create policy "see invitees of visible tasks" on public.task_invitees
  for select to authenticated using (private.can_view_task(task_id));

-- Declines are private: only the decliner and the person who asked can see them.
create policy "see responses" on public.task_responses
  for select to authenticated using (
    user_id = (select auth.uid())
    or exists (select 1 from public.tasks t where t.id = task_id and t.created_by = (select auth.uid()) and private.is_member(t.family_id))
    or (response <> 'declined' and private.can_view_task(task_id))
  );

create policy "see own conversations" on public.conversations
  for select to authenticated using (private.is_conversation_member(id));

create policy "see members of own conversations" on public.conversation_members
  for select to authenticated using (private.is_conversation_member(conversation_id));

create policy "see messages in own conversations" on public.messages
  for select to authenticated using (private.is_conversation_member(conversation_id));

create policy "see viewable media" on public.media
  for select to authenticated using (
    private.can_view_media(id)
    or (uploaded_by = (select auth.uid()) and private.is_member(family_id))
  );

create policy "see attachments in own conversations" on public.message_attachments
  for select to authenticated using (
    exists (select 1 from public.messages m where m.id = message_id and private.is_conversation_member(m.conversation_id))
  );

create policy "see permitted memories" on public.memories
  for select to authenticated using (private.can_view_memory(id));

create policy "see own notifications" on public.notifications
  for select to authenticated using (user_id = (select auth.uid()));
create policy "mark own notifications" on public.notifications
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "clear own notifications" on public.notifications
  for delete to authenticated using (user_id = (select auth.uid()));

create policy "see own prefs" on public.notification_prefs
  for select to authenticated using (user_id = (select auth.uid()));
create policy "edit own prefs" on public.notification_prefs
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
-- push_devices: no client policies; managed by functions only.
