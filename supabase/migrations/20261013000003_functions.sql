-- Robin: server functions (the only way clients change data)
-- Conventions:
--   * SECURITY DEFINER with an empty search_path; every object is schema-qualified.
--   * Errors are raised with a short stable code as the message (e.g. 'not_allowed'),
--     which the app maps to friendly copy.

-- ---------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------

create or replace function private.require_user() returns uuid
language plpgsql stable as $$
declare v uuid := auth.uid();
begin
  if v is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  return v;
end $$;

create or replace function private.require_member(p_family uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare v_role text;
begin
  perform private.require_user();
  v_role := private.member_role(p_family);
  if v_role is null then raise exception 'not_member' using errcode = '42501'; end if;
  return v_role;
end $$;

create or replace function private.require_parent(p_family uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare v_role text := private.require_member(p_family);
begin
  if v_role not in ('owner', 'parent') then raise exception 'not_allowed' using errcode = '42501'; end if;
  return v_role;
end $$;

create or replace function private.valid_timezone(p_tz text) returns boolean
language sql stable as $$ select exists (select 1 from pg_catalog.pg_timezone_names where name = p_tz) $$;

create or replace function private.display_name(p_user uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select display_name from public.profiles where id = p_user), 'Someone')
$$;

-- Creates (or refreshes) one in-app notification, honouring the recipient's
-- preferences. dedupe_key makes repeats collapse into one row.
create or replace function private.notify(
  p_user uuid, p_family uuid, p_type text, p_category text, p_title text, p_body text,
  p_dedupe text, p_task uuid default null, p_conversation uuid default null, p_refresh boolean default false
) returns void
language plpgsql security definer set search_path = '' as $$
declare v_on boolean;
begin
  if p_user is null or p_user = auth.uid() then return; end if;
  -- Recipient must still be in the family.
  if p_family is not null and not exists (
    select 1 from public.family_members where family_id = p_family and user_id = p_user
  ) then return; end if;
  select case p_category
           when 'task_requests' then task_requests
           when 'task_updates' then task_updates
           when 'event_changes' then event_changes
           when 'messages' then messages
           when 'reminders' then reminders
         end
    into v_on from public.notification_prefs where user_id = p_user;
  if coalesce(v_on, true) = false then return; end if;

  if p_refresh then
    insert into public.notifications (user_id, family_id, type, category, actor_id, task_id, conversation_id, title, body, dedupe_key)
    values (p_user, p_family, p_type, p_category, auth.uid(), p_task, p_conversation, p_title, p_body, p_dedupe)
    on conflict (user_id, dedupe_key) do update
      set title = excluded.title, body = excluded.body, actor_id = excluded.actor_id,
          created_at = now(), read_at = null;
  else
    insert into public.notifications (user_id, family_id, type, category, actor_id, task_id, conversation_id, title, body, dedupe_key)
    values (p_user, p_family, p_type, p_category, auth.uid(), p_task, p_conversation, p_title, p_body, p_dedupe)
    on conflict (user_id, dedupe_key) do nothing;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Accounts
-- ---------------------------------------------------------------------------

create or replace function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_name text;
begin
  v_name := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'display_name', new.raw_user_meta_data ->> 'full_name', '')), '');
  if v_name is null then v_name := split_part(coalesce(new.email, 'Friend'), '@', 1); end if;
  insert into public.profiles (id, display_name) values (new.id, left(v_name, 60));
  insert into public.notification_prefs (user_id) values (new.id);
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

create or replace function public.update_profile(p_display_name text, p_timezone text)
returns public.profiles
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_user(); v_row public.profiles;
begin
  if p_display_name is null or char_length(btrim(p_display_name)) not between 1 and 60 then
    raise exception 'invalid_name';
  end if;
  if p_timezone is null or not private.valid_timezone(p_timezone) then
    raise exception 'invalid_timezone';
  end if;
  update public.profiles set display_name = btrim(p_display_name), timezone = p_timezone, updated_at = now()
    where id = v_uid returning * into v_row;
  return v_row;
end $$;

create or replace function public.register_push_device(p_token text, p_platform text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_user();
begin
  if p_token is null or char_length(p_token) > 300 or p_platform not in ('ios', 'android', 'web') then
    raise exception 'invalid_input';
  end if;
  insert into public.push_devices (token, user_id, platform) values (p_token, v_uid, p_platform)
  on conflict (token) do update set user_id = excluded.user_id, platform = excluded.platform, updated_at = now();
end $$;

create or replace function public.unregister_push_device(p_token text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.push_devices where token = p_token and user_id = private.require_user();
end $$;

-- ---------------------------------------------------------------------------
-- Families, membership and invitations
-- ---------------------------------------------------------------------------

create or replace function public.create_family(p_name text, p_relation_label text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_user(); v_id uuid;
begin
  if p_name is null or char_length(btrim(p_name)) not between 1 and 60 then raise exception 'invalid_name'; end if;
  if (select count(*) from public.family_members where user_id = v_uid) >= 10 then raise exception 'too_many_families'; end if;
  insert into public.families (name, created_by) values (btrim(p_name), v_uid) returning id into v_id;
  insert into public.family_members (family_id, user_id, role, relation_label)
    values (v_id, v_uid, 'owner', nullif(btrim(coalesce(p_relation_label, '')), ''));
  return v_id;
end $$;

create or replace function public.rename_family(p_family uuid, p_name text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_parent(p_family);
  if p_name is null or char_length(btrim(p_name)) not between 1 and 60 then raise exception 'invalid_name'; end if;
  update public.families set name = btrim(p_name) where id = p_family;
end $$;

create or replace function public.set_relation_label(p_family uuid, p_label text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_member(p_family);
  if p_label is not null and char_length(p_label) > 40 then raise exception 'invalid_input'; end if;
  update public.family_members set relation_label = nullif(btrim(coalesce(p_label, '')), '')
    where family_id = p_family and user_id = auth.uid();
end $$;

-- Returns the plaintext token ONCE. Only its hash is stored.
create or replace function public.create_invitation(p_family uuid, p_role text default 'helper',
  p_expires_in_hours int default 72, p_note text default null)
returns table (invitation_id uuid, token text, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare v_token text; v_id uuid; v_exp timestamptz;
begin
  perform private.require_parent(p_family);
  if p_role not in ('parent', 'helper') then raise exception 'invalid_input'; end if;
  if p_expires_in_hours is null or p_expires_in_hours not between 1 and 336 then raise exception 'invalid_input'; end if;
  if p_note is not null and char_length(p_note) > 80 then raise exception 'invalid_input'; end if;
  if (select count(*) from public.invitations i where i.family_id = p_family and i.accepted_at is null
        and i.revoked_at is null and i.declined_at is null and i.expires_at > now()) >= 50 then
    raise exception 'too_many_invitations';
  end if;
  v_token := translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/=', '-_');
  v_exp := now() + make_interval(hours => p_expires_in_hours);
  insert into public.invitations (family_id, invited_by, token_hash, role, note, expires_at)
    values (p_family, auth.uid(), encode(extensions.digest(v_token, 'sha256'), 'hex'), p_role, nullif(btrim(coalesce(p_note, '')), ''), v_exp)
    returning id into v_id;
  return query select v_id, v_token, v_exp;
end $$;

create or replace function private.invitation_state(i public.invitations) returns text
language sql stable as $$
  select case
    when i.revoked_at is not null then 'revoked'
    when i.accepted_at is not null then 'used'
    when i.declined_at is not null then 'declined'
    when i.expires_at <= now() then 'expired'
    else 'valid' end
$$;

-- Lets someone holding a link see who invited them before joining.
create or replace function public.preview_invitation(p_token text)
returns table (state text, family_name text, invited_by_name text, role text, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare v public.invitations;
begin
  perform private.require_user();
  select * into v from public.invitations where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
  if not found then return query select 'invalid'::text, null::text, null::text, null::text, null::timestamptz; return; end if;
  return query select private.invitation_state(v),
    case when private.invitation_state(v) = 'valid' then (select f.name from public.families f where f.id = v.family_id) end,
    case when private.invitation_state(v) = 'valid' then private.display_name(v.invited_by) end,
    v.role, v.expires_at;
end $$;

create or replace function public.accept_invitation(p_token text, p_relation_label text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_user(); v public.invitations; v_state text;
begin
  select * into v from public.invitations
    where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
    for update;
  if not found then raise exception 'invite_invalid'; end if;
  v_state := private.invitation_state(v);
  if v_state <> 'valid' then raise exception 'invite_%', v_state; end if;
  if exists (select 1 from public.family_members where family_id = v.family_id and user_id = v_uid) then
    raise exception 'already_member';
  end if;
  insert into public.family_members (family_id, user_id, role, relation_label)
    values (v.family_id, v_uid, v.role, nullif(btrim(coalesce(p_relation_label, '')), ''));
  update public.invitations set accepted_by = v_uid, accepted_at = now() where id = v.id;
  perform private.notify(v.invited_by, v.family_id, 'member_joined', 'task_updates',
    private.display_name(v_uid) || ' joined your family', null, 'joined:' || v.id::text);
  return v.family_id;
end $$;

create or replace function public.decline_invitation(p_token text) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.invitations;
begin
  perform private.require_user();
  select * into v from public.invitations
    where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex') for update;
  if not found then raise exception 'invite_invalid'; end if;
  if private.invitation_state(v) <> 'valid' then raise exception 'invite_%', private.invitation_state(v); end if;
  update public.invitations set declined_at = now() where id = v.id;
end $$;

create or replace function public.revoke_invitation(p_invitation uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_family uuid;
begin
  select family_id into v_family from public.invitations where id = p_invitation;
  if v_family is null then raise exception 'not_found'; end if;
  perform private.require_parent(v_family);
  update public.invitations set revoked_at = now()
    where id = p_invitation and revoked_at is null and accepted_at is null;
end $$;

-- Removes someone's footprint from a family when they leave or are removed.
create or replace function private.detach_member(p_family uuid, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  -- Hand back any help they had accepted for upcoming tasks, and tell the asker.
  for r in
    select t.id, t.created_by, t.title from public.tasks t
    join public.task_responses tr on tr.task_id = t.id and tr.user_id = p_user and tr.response = 'accepted'
    where t.family_id = p_family and t.kind = 'help' and t.status in ('open', 'confirmed') and t.ends_at > now()
  loop
    delete from public.task_responses where task_id = r.id and user_id = p_user;
    update public.tasks set status = 'open', version = version + 1, updated_at = now() where id = r.id;
    perform private.notify(r.created_by, p_family, 'task_reopened', 'task_updates',
      'A helper is no longer available', r.title, 'reopened:' || r.id || ':' || p_user);
  end loop;
  delete from public.task_responses tr using public.tasks t
    where tr.task_id = t.id and t.family_id = p_family and tr.user_id = p_user and t.ends_at > now();
  delete from public.task_invitees ti using public.tasks t
    where ti.task_id = t.id and t.family_id = p_family and ti.user_id = p_user;
  delete from public.conversation_members cm using public.conversations c
    where cm.conversation_id = c.id and c.family_id = p_family and cm.user_id = p_user;
  delete from public.notifications where family_id = p_family and user_id = p_user;
  delete from public.family_members where family_id = p_family and user_id = p_user;
end $$;

create or replace function public.leave_family(p_family uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_user(); v_role text := private.require_member(p_family);
begin
  if v_role = 'owner' and (select count(*) from public.family_members where family_id = p_family and role = 'owner') = 1 then
    if (select count(*) from public.family_members where family_id = p_family) > 1 then
      raise exception 'last_owner';
    end if;
    -- Sole member and owner: leaving deletes the family and everything in it.
    delete from public.families where id = p_family;
    return;
  end if;
  perform private.detach_member(p_family, v_uid);
end $$;

create or replace function public.remove_member(p_family uuid, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_my_role text := private.require_parent(p_family); v_their_role text;
begin
  if p_user = auth.uid() then raise exception 'use_leave'; end if;
  select role into v_their_role from public.family_members where family_id = p_family and user_id = p_user;
  if v_their_role is null then raise exception 'not_found'; end if;
  -- Owners can remove parents and helpers; parents can remove helpers. Owners can't be removed.
  if v_their_role = 'owner' or (v_my_role = 'parent' and v_their_role <> 'helper') then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  perform private.detach_member(p_family, p_user);
end $$;

create or replace function public.set_member_role(p_family uuid, p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_my_role text := private.require_member(p_family); v_current text;
begin
  if v_my_role <> 'owner' then raise exception 'not_allowed' using errcode = '42501'; end if;
  if p_role not in ('owner', 'parent', 'helper') then raise exception 'invalid_input'; end if;
  select role into v_current from public.family_members where family_id = p_family and user_id = p_user for update;
  if v_current is null then raise exception 'not_found'; end if;
  if v_current = 'owner' and p_role <> 'owner'
     and (select count(*) from public.family_members where family_id = p_family and role = 'owner') = 1 then
    raise exception 'last_owner';
  end if;
  update public.family_members set role = p_role where family_id = p_family and user_id = p_user;
end $$;

-- ---------------------------------------------------------------------------
-- Tasks and events
-- ---------------------------------------------------------------------------

create or replace function private.validate_task_payload(p jsonb) returns void
language plpgsql stable as $$
begin
  if coalesce(p ->> 'kind', '') not in ('help', 'event') then raise exception 'invalid_kind'; end if;
  if coalesce(p ->> 'category', '') not in ('childcare', 'meals', 'errands', 'appointment', 'family_event', 'other') then
    raise exception 'invalid_category'; end if;
  if char_length(btrim(coalesce(p ->> 'title', ''))) not between 1 and 120 then raise exception 'invalid_title'; end if;
  if (p ->> 'starts_at') is null or (p ->> 'ends_at') is null then raise exception 'invalid_time'; end if;
  if (p ->> 'ends_at')::timestamptz < (p ->> 'starts_at')::timestamptz then raise exception 'invalid_time'; end if;
  if (p ->> 'respond_by') is not null and (p ->> 'respond_by')::timestamptz > (p ->> 'starts_at')::timestamptz then
    raise exception 'invalid_respond_by'; end if;
  if not private.valid_timezone(coalesce(p ->> 'timezone', '')) then raise exception 'invalid_timezone'; end if;
  if coalesce((p ->> 'helpers_needed')::int, 1) not between 1 and 20 then raise exception 'invalid_helpers'; end if;
  if jsonb_typeof(coalesce(p -> 'links', '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p -> 'links', '[]'::jsonb)) > 5 then
    raise exception 'invalid_links'; end if;
end $$;

create or replace function private.notify_task_sent(p_task uuid, p_users uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.tasks; u uuid;
begin
  select * into t from public.tasks where id = p_task;
  foreach u in array coalesce(p_users, '{}') loop
    perform private.notify(u, t.family_id,
      case t.kind when 'help' then 'task_request' else 'event_invite' end, 'task_requests',
      case t.kind when 'help' then private.display_name(t.created_by) || ' could use a hand'
                  else private.display_name(t.created_by) || ' invited you' end,
      t.title, 'request:' || t.id, t.id);
  end loop;
end $$;

create or replace function private.set_invitees(p_task uuid, p_family uuid, p_creator uuid, p_invitees jsonb) returns uuid[]
language plpgsql security definer set search_path = '' as $$
declare v_new uuid[];
begin
  -- null => everyone in the family except the creator
  with wanted as (
    select fm.user_id from public.family_members fm
    where fm.family_id = p_family and fm.user_id <> p_creator
      and (p_invitees is null or jsonb_typeof(p_invitees) = 'null'
           or fm.user_id in (select (jsonb_array_elements_text(p_invitees))::uuid))
  ), ins as (
    insert into public.task_invitees (task_id, user_id)
    select p_task, user_id from wanted
    on conflict do nothing
    returning user_id
  )
  select coalesce(array_agg(user_id), '{}') into v_new from ins;
  if p_invitees is not null and jsonb_typeof(p_invitees) = 'array'
     and jsonb_array_length(p_invitees) > (select count(*) from public.task_invitees where task_id = p_task) then
    raise exception 'invalid_invitees';
  end if;
  if (select count(*) from public.task_invitees where task_id = p_task) = 0 then raise exception 'no_invitees'; end if;
  return v_new;
end $$;

-- payload: {kind, category, title, description, location, notes, links[], starts_at, ends_at,
--           all_day, timezone, respond_by, helpers_needed, invitees[] | null, client_id}
create or replace function public.create_task(p_family uuid, p jsonb, p_send boolean default true) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_user(); v_id uuid; v_new uuid[]; v_client uuid := (p ->> 'client_id')::uuid;
begin
  perform private.require_parent(p_family);
  -- Idempotent: the same client_id returns the task created the first time.
  if v_client is not null then
    select id into v_id from public.tasks where created_by = v_uid and client_id = v_client;
    if found then return v_id; end if;
  end if;
  perform private.validate_task_payload(p);
  if p_send and (p ->> 'starts_at')::timestamptz < now() - interval '1 day' then raise exception 'in_the_past'; end if;

  insert into public.tasks (family_id, created_by, client_id, kind, category, title, description, location, notes, links,
    starts_at, ends_at, all_day, timezone, respond_by, helpers_needed, status)
  values (p_family, v_uid, v_client, p ->> 'kind', p ->> 'category', btrim(p ->> 'title'),
    nullif(btrim(coalesce(p ->> 'description', '')), ''), nullif(btrim(coalesce(p ->> 'location', '')), ''),
    nullif(btrim(coalesce(p ->> 'notes', '')), ''),
    coalesce(array(select jsonb_array_elements_text(coalesce(p -> 'links', '[]'::jsonb))), '{}'),
    (p ->> 'starts_at')::timestamptz, (p ->> 'ends_at')::timestamptz, coalesce((p ->> 'all_day')::boolean, false),
    p ->> 'timezone', (p ->> 'respond_by')::timestamptz,
    case when p ->> 'kind' = 'help' then coalesce((p ->> 'helpers_needed')::int, 1) else 1 end,
    case when p_send then 'open' else 'draft' end)
  returning id into v_id;

  v_new := private.set_invitees(v_id, p_family, v_uid, p -> 'invitees');
  if p_send then perform private.notify_task_sent(v_id, v_new); end if;
  return v_id;
end $$;

create or replace function public.send_task(p_task uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.tasks; v_users uuid[];
begin
  select * into t from public.tasks where id = p_task for update;
  if not found or t.created_by is distinct from private.require_user() then raise exception 'not_found'; end if;
  perform private.require_parent(t.family_id);
  if t.status <> 'draft' then raise exception 'not_draft'; end if;
  if t.starts_at < now() - interval '1 day' then raise exception 'in_the_past'; end if;
  update public.tasks set status = 'open', version = version + 1, updated_at = now() where id = p_task;
  select array_agg(user_id) into v_users from public.task_invitees where task_id = p_task;
  perform private.notify_task_sent(p_task, v_users);
end $$;

-- Organiser edits. expected_version guards against overwriting someone else's change.
create or replace function public.update_task(p_task uuid, p jsonb, p_expected_version int) returns int
language plpgsql security definer set search_path = '' as $$
declare t public.tasks; v_uid uuid := private.require_user(); v_changed boolean; v_new uuid[]; v_accepted int; u uuid;
begin
  select * into t from public.tasks where id = p_task for update;
  if not found or t.created_by is distinct from v_uid or not private.is_member(t.family_id) then raise exception 'not_found'; end if;
  if t.status in ('completed', 'cancelled') then raise exception 'task_closed'; end if;
  if t.version <> p_expected_version then raise exception 'version_conflict'; end if;
  if (p ->> 'kind') is distinct from t.kind then raise exception 'cannot_change_kind'; end if;
  perform private.validate_task_payload(p);

  select count(*) into v_accepted from public.task_responses where task_id = p_task and response = 'accepted';
  if t.kind = 'help' and coalesce((p ->> 'helpers_needed')::int, 1) < v_accepted then raise exception 'helpers_below_accepted'; end if;

  v_changed := t.starts_at <> (p ->> 'starts_at')::timestamptz or t.ends_at <> (p ->> 'ends_at')::timestamptz
            or t.location is distinct from nullif(btrim(coalesce(p ->> 'location', '')), '')
            or t.all_day <> coalesce((p ->> 'all_day')::boolean, false);

  update public.tasks set
    category = p ->> 'category', title = btrim(p ->> 'title'),
    description = nullif(btrim(coalesce(p ->> 'description', '')), ''),
    location = nullif(btrim(coalesce(p ->> 'location', '')), ''),
    notes = nullif(btrim(coalesce(p ->> 'notes', '')), ''),
    links = coalesce(array(select jsonb_array_elements_text(coalesce(p -> 'links', '[]'::jsonb))), '{}'),
    starts_at = (p ->> 'starts_at')::timestamptz, ends_at = (p ->> 'ends_at')::timestamptz,
    all_day = coalesce((p ->> 'all_day')::boolean, false), timezone = p ->> 'timezone',
    respond_by = (p ->> 'respond_by')::timestamptz,
    helpers_needed = case when t.kind = 'help' then coalesce((p ->> 'helpers_needed')::int, 1) else 1 end,
    status = case when t.kind = 'help' and t.status in ('open', 'confirmed') then
                    case when v_accepted >= coalesce((p ->> 'helpers_needed')::int, 1) then 'confirmed' else 'open' end
                  else t.status end,
    version = version + 1, updated_at = now()
  where id = p_task;

  -- Invitees can be added (not removed) while editing.
  if (p -> 'invitees') is not null and jsonb_typeof(p -> 'invitees') = 'array' then
    v_new := private.set_invitees(p_task, t.family_id, v_uid, p -> 'invitees');
    if t.status <> 'draft' then perform private.notify_task_sent(p_task, v_new); end if;
  end if;

  if v_changed and t.status <> 'draft' then
    for u in
      select ti.user_id from public.task_invitees ti
      left join public.task_responses tr on tr.task_id = ti.task_id and tr.user_id = ti.user_id
      where ti.task_id = p_task and coalesce(tr.response, '') <> 'declined'
    loop
      perform private.notify(u, t.family_id, 'task_changed', 'event_changes',
        'Plans changed: ' || btrim(p ->> 'title'), 'The time or place has been updated.',
        'changed:' || p_task || ':' || (t.version + 1), p_task);
    end loop;
  end if;
  return t.version + 1;
end $$;

create or replace function public.cancel_task(p_task uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.tasks; u uuid;
begin
  select * into t from public.tasks where id = p_task for update;
  if not found or t.created_by is distinct from private.require_user() or not private.is_member(t.family_id) then raise exception 'not_found'; end if;
  if t.status in ('completed', 'cancelled') then raise exception 'task_closed'; end if;
  if p_reason is not null and char_length(p_reason) > 300 then raise exception 'invalid_input'; end if;
  update public.tasks set status = 'cancelled', cancelled_reason = nullif(btrim(coalesce(p_reason, '')), ''),
    version = version + 1, updated_at = now() where id = p_task;
  if t.status <> 'draft' then
    for u in
      select ti.user_id from public.task_invitees ti
      left join public.task_responses tr on tr.task_id = ti.task_id and tr.user_id = ti.user_id
      where ti.task_id = p_task and coalesce(tr.response, '') <> 'declined'
    loop
      perform private.notify(u, t.family_id, 'task_cancelled', 'event_changes',
        'Cancelled: ' || t.title, nullif(btrim(coalesce(p_reason, '')), ''), 'cancelled:' || p_task, p_task);
    end loop;
  end if;
end $$;

create or replace function public.complete_task(p_task uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.tasks;
begin
  select * into t from public.tasks where id = p_task for update;
  if not found or t.created_by is distinct from private.require_user() or not private.is_member(t.family_id) then raise exception 'not_found'; end if;
  if t.status <> 'confirmed' and not (t.kind = 'event' and t.status = 'open') then raise exception 'task_not_confirmed'; end if;
  update public.tasks set status = 'completed', version = version + 1, updated_at = now() where id = p_task;
  update public.family_members fm set last_helped_at = now()
    from public.task_responses tr
    where tr.task_id = p_task and tr.response = 'accepted' and fm.user_id = tr.user_id and fm.family_id = t.family_id
      and t.kind = 'help';
end $$;

-- The heart of single-helper assignment. Every response serialises on the task
-- row (SELECT ... FOR UPDATE), so when two people accept at the same moment the
-- first transaction to take the lock wins and the second sees the filled task.
-- Returns: assigned | already_yours | already_filled | recorded | withdrawn
create or replace function public.respond_to_task(p_task uuid, p_response text)
returns table (result text, task_status text, task_version int)
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user(); t public.tasks; v_prev text; v_accepted int; v_result text; u uuid;
begin
  if p_response not in ('accepted', 'declined', 'tentative') then raise exception 'invalid_input'; end if;
  select * into t from public.tasks where id = p_task for update;
  if not found or not private.is_member(t.family_id)
     or not exists (select 1 from public.task_invitees where task_id = p_task and user_id = v_uid) then
    raise exception 'not_invited' using errcode = '42501';
  end if;
  if t.status not in ('open', 'confirmed') then raise exception 'task_closed'; end if;
  if t.ends_at < now() then raise exception 'task_closed'; end if;

  select response into v_prev from public.task_responses where task_id = p_task and user_id = v_uid;

  if t.kind = 'help' then
    if p_response = 'tentative' then raise exception 'invalid_input'; end if;
    if p_response = 'accepted' then
      if v_prev = 'accepted' then
        return query select 'already_yours'::text, t.status, t.version; return;
      end if;
      if t.respond_by is not null and t.respond_by < now() then raise exception 'response_closed'; end if;
      select count(*) into v_accepted from public.task_responses where task_id = p_task and response = 'accepted';
      if v_accepted >= t.helpers_needed then
        return query select 'already_filled'::text, t.status, t.version; return;
      end if;
      insert into public.task_responses (task_id, user_id, response) values (p_task, v_uid, 'accepted')
        on conflict (task_id, user_id) do update set response = 'accepted', responded_at = now();
      v_accepted := v_accepted + 1;
      update public.tasks set status = case when v_accepted >= t.helpers_needed then 'confirmed' else 'open' end,
        version = version + 1, updated_at = now() where id = p_task
        returning status, version into t.status, t.version;
      perform private.notify(t.created_by, t.family_id, 'task_accepted', 'task_updates',
        private.display_name(v_uid) || ' can help', t.title, 'accepted:' || p_task || ':' || v_uid, p_task);
      if t.status = 'confirmed' then
        for u in
          select ti.user_id from public.task_invitees ti
          left join public.task_responses tr on tr.task_id = ti.task_id and tr.user_id = ti.user_id
          where ti.task_id = p_task and tr.user_id is null
        loop
          perform private.notify(u, t.family_id, 'task_filled', 'task_updates',
            'All covered, thank you', t.title || ' has been taken care of.', 'filled:' || p_task, p_task, null, true);
        end loop;
      end if;
      return query select 'assigned'::text, t.status, t.version; return;
    else -- declined
      insert into public.task_responses (task_id, user_id, response) values (p_task, v_uid, 'declined')
        on conflict (task_id, user_id) do update set response = 'declined', responded_at = now();
      if v_prev = 'accepted' then
        update public.tasks set status = 'open', version = version + 1, updated_at = now() where id = p_task
          returning status, version into t.status, t.version;
        perform private.notify(t.created_by, t.family_id, 'helper_withdrew', 'task_updates',
          private.display_name(v_uid) || ' can no longer help', t.title, 'withdrew:' || p_task || ':' || v_uid || ':' || t.version, p_task);
        for u in
          select ti.user_id from public.task_invitees ti
          left join public.task_responses tr on tr.task_id = ti.task_id and tr.user_id = ti.user_id
          where ti.task_id = p_task and tr.user_id is null
        loop
          perform private.notify(u, t.family_id, 'task_reopened', 'task_requests',
            private.display_name(t.created_by) || ' could use a hand again', t.title, 'reopened:' || p_task || ':' || t.version, p_task);
        end loop;
        return query select 'withdrawn'::text, t.status, t.version; return;
      end if;
      return query select 'recorded'::text, t.status, t.version; return;
    end if;
  else -- event RSVP
    insert into public.task_responses (task_id, user_id, response) values (p_task, v_uid, p_response)
      on conflict (task_id, user_id) do update set response = excluded.response, responded_at = now();
    update public.tasks set version = version + 1, updated_at = now() where id = p_task
      returning status, version into t.status, t.version;
    if p_response <> 'declined' then
      perform private.notify(t.created_by, t.family_id, 'event_rsvp', 'task_updates',
        private.display_name(v_uid) || case p_response when 'accepted' then ' is going' else ' might come' end,
        t.title, 'rsvp:' || p_task || ':' || v_uid, p_task, null, true);
    end if;
    return query select 'recorded'::text, t.status, t.version; return;
  end if;
end $$;

-- Calendar: one row per task per person, so an item can never appear twice.
-- Runs as the caller, so row-level security decides what is visible.
create or replace function public.calendar_items(p_from timestamptz, p_to timestamptz,
  p_family uuid default null, p_scope text default 'mine')
returns table (
  id uuid, family_id uuid, kind text, category text, title text, location text,
  starts_at timestamptz, ends_at timestamptz, all_day boolean, timezone text, respond_by timestamptz,
  status text, helpers_needed int, created_by uuid, my_role text, my_response text,
  accepted_count int, tentative_count int, invitee_count int, version int
)
language sql stable security invoker set search_path = '' as $$
  select t.id, t.family_id, t.kind, t.category, t.title, t.location, t.starts_at, t.ends_at, t.all_day, t.timezone,
    t.respond_by, t.status, t.helpers_needed, t.created_by,
    case when t.created_by = auth.uid() then 'organiser'
         when me.response = 'accepted' then (case t.kind when 'help' then 'helper' else 'attendee' end)
         when me.response = 'tentative' then 'attendee'
         when inv.user_id is not null then 'invited'
         else 'family' end as my_role,
    me.response,
    (select count(*) from public.task_responses r where r.task_id = t.id and r.response = 'accepted')::int,
    (select count(*) from public.task_responses r where r.task_id = t.id and r.response = 'tentative')::int,
    (select count(*) from public.task_invitees i where i.task_id = t.id)::int,
    t.version
  from public.tasks t
  left join public.task_responses me on me.task_id = t.id and me.user_id = auth.uid()
  left join public.task_invitees inv on inv.task_id = t.id and inv.user_id = auth.uid()
  where t.starts_at < p_to and t.ends_at >= p_from
    and (p_family is null or t.family_id = p_family)
    and (
      p_scope = 'family'
      or t.created_by = auth.uid()
      or me.response in ('accepted', 'tentative')
      or (inv.user_id is not null and me.response is null and t.status = 'open')
    )
  order by t.starts_at, t.id
$$;

-- ---------------------------------------------------------------------------
-- Messaging
-- ---------------------------------------------------------------------------

create or replace function public.create_conversation(p_family uuid, p_members uuid[], p_name text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_user(); v_members uuid[]; v_id uuid; v_key text;
begin
  perform private.require_member(p_family);
  select coalesce(array_agg(distinct m), '{}') into v_members from unnest(coalesce(p_members, '{}')) m where m <> v_uid;
  if cardinality(v_members) = 0 then raise exception 'no_members'; end if;
  if exists (select 1 from unnest(v_members) m
             where not exists (select 1 from public.family_members fm where fm.family_id = p_family and fm.user_id = m)) then
    raise exception 'not_member' using errcode = '42501';
  end if;
  if p_name is not null and char_length(btrim(p_name)) > 60 then raise exception 'invalid_name'; end if;

  if cardinality(v_members) = 1 and nullif(btrim(coalesce(p_name, '')), '') is null then
    v_key := least(v_uid::text, v_members[1]::text) || ':' || greatest(v_uid::text, v_members[1]::text);
    select id into v_id from public.conversations where family_id = p_family and direct_key = v_key;
    if found then
      insert into public.conversation_members (conversation_id, user_id) values (v_id, v_uid), (v_id, v_members[1])
        on conflict do nothing;
      return v_id;
    end if;
    insert into public.conversations (family_id, kind, direct_key, created_by)
      values (p_family, 'direct', v_key, v_uid) returning id into v_id;
  else
    insert into public.conversations (family_id, kind, name, created_by)
      values (p_family, 'group', nullif(btrim(coalesce(p_name, '')), ''), v_uid) returning id into v_id;
  end if;
  insert into public.conversation_members (conversation_id, user_id)
    select v_id, m from unnest(v_members || v_uid) m on conflict do nothing;
  return v_id;
end $$;

create or replace function public.rename_conversation(p_conversation uuid, p_name text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_conversation_member(p_conversation) then raise exception 'not_found'; end if;
  if (select kind from public.conversations where id = p_conversation) <> 'group' then raise exception 'not_group'; end if;
  if p_name is null or char_length(btrim(p_name)) not between 1 and 60 then raise exception 'invalid_name'; end if;
  update public.conversations set name = btrim(p_name) where id = p_conversation;
end $$;

create or replace function public.add_conversation_members(p_conversation uuid, p_members uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.conversations;
begin
  if not private.is_conversation_member(p_conversation) then raise exception 'not_found'; end if;
  select * into c from public.conversations where id = p_conversation;
  if c.kind <> 'group' then raise exception 'not_group'; end if;
  if exists (select 1 from unnest(p_members) m
             where not exists (select 1 from public.family_members fm where fm.family_id = c.family_id and fm.user_id = m)) then
    raise exception 'not_member' using errcode = '42501';
  end if;
  insert into public.conversation_members (conversation_id, user_id)
    select p_conversation, m from unnest(p_members) m on conflict do nothing;
end $$;

create or replace function public.leave_conversation(p_conversation uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_conversation_member(p_conversation) then raise exception 'not_found'; end if;
  if (select kind from public.conversations where id = p_conversation) <> 'group' then raise exception 'not_group'; end if;
  delete from public.conversation_members where conversation_id = p_conversation and user_id = auth.uid();
end $$;

-- Idempotent on (conversation, sender, client_id): a retried send never duplicates.
create or replace function public.send_message(p_conversation uuid, p_body text, p_client_id uuid, p_media uuid[] default '{}')
returns public.messages
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_user(); c public.conversations; v_msg public.messages; v_body text; u record; i int := 0; m uuid;
begin
  if p_client_id is null then raise exception 'invalid_input'; end if;
  if not private.is_conversation_member(p_conversation) then raise exception 'not_found'; end if;
  select * into v_msg from public.messages where conversation_id = p_conversation and sender_id = v_uid and client_id = p_client_id;
  if found then return v_msg; end if;

  select * into c from public.conversations where id = p_conversation;
  v_body := nullif(btrim(coalesce(p_body, '')), '');
  if v_body is null and cardinality(coalesce(p_media, '{}')) = 0 then raise exception 'empty_message'; end if;
  if v_body is not null and char_length(v_body) > 4000 then raise exception 'message_too_long'; end if;
  if cardinality(coalesce(p_media, '{}')) > 10 then raise exception 'too_many_attachments'; end if;
  if exists (select 1 from unnest(coalesce(p_media, '{}')) x
             where not exists (select 1 from public.media md where md.id = x and md.uploaded_by = v_uid
                               and md.family_id = c.family_id and md.status = 'ready')) then
    raise exception 'media_invalid';
  end if;

  insert into public.messages (conversation_id, sender_id, body, client_id)
    values (p_conversation, v_uid, v_body, p_client_id) returning * into v_msg;
  foreach m in array coalesce(p_media, '{}') loop
    insert into public.message_attachments (message_id, media_id, position) values (v_msg.id, m, i);
    i := i + 1;
  end loop;
  update public.conversations set last_message_at = v_msg.created_at where id = p_conversation;
  update public.conversation_members set last_read_at = v_msg.created_at where conversation_id = p_conversation and user_id = v_uid;

  for u in
    select cm.user_id from public.conversation_members cm
    where cm.conversation_id = p_conversation and cm.user_id <> v_uid
      and (cm.muted_until is null or cm.muted_until < now())
  loop
    perform private.notify(u.user_id, c.family_id, 'message', 'messages',
      case when c.kind = 'group' then coalesce(c.name, 'Group chat') else private.display_name(v_uid) end,
      case when c.kind = 'group' then private.display_name(v_uid) || ': ' else '' end
        || coalesce(left(v_body, 120), case when cardinality(coalesce(p_media, '{}')) > 0 then 'Sent a photo or video' end),
      'conversation:' || p_conversation, null, p_conversation, true);
  end loop;
  return v_msg;
end $$;

create or replace function public.delete_message(p_message uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.messages set body = null, deleted_at = now()
    where id = p_message and sender_id = private.require_user() and deleted_at is null
      and private.is_conversation_member(conversation_id);
  if not found then raise exception 'not_found'; end if;
end $$;

create or replace function public.mark_conversation_read(p_conversation uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.conversation_members set last_read_at = now()
    where conversation_id = p_conversation and user_id = private.require_user();
  update public.notifications set read_at = now()
    where user_id = auth.uid() and conversation_id = p_conversation and read_at is null;
end $$;

create or replace function public.set_conversation_muted(p_conversation uuid, p_until timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.conversation_members set muted_until = p_until
    where conversation_id = p_conversation and user_id = private.require_user();
  if not found then raise exception 'not_found'; end if;
end $$;

create or replace function public.conversation_list(p_family uuid)
returns table (id uuid, kind text, name text, last_message_at timestamptz, last_body text, last_sender uuid,
  last_has_media boolean, unread_count int, other_user uuid, member_count int, muted_until timestamptz)
language sql stable security invoker set search_path = '' as $$
  select c.id, c.kind, c.name, c.last_message_at,
    lm.body, lm.sender_id, lm.has_media,
    (select count(*) from public.messages m where m.conversation_id = c.id and m.created_at > me.last_read_at
       and m.sender_id is distinct from auth.uid() and m.deleted_at is null)::int,
    (select cm.user_id from public.conversation_members cm where cm.conversation_id = c.id and cm.user_id <> auth.uid() limit 1),
    (select count(*) from public.conversation_members cm where cm.conversation_id = c.id)::int,
    me.muted_until
  from public.conversations c
  join public.conversation_members me on me.conversation_id = c.id and me.user_id = auth.uid()
  left join lateral (
    select m.body, m.sender_id, exists (select 1 from public.message_attachments a where a.message_id = m.id) as has_media
    from public.messages m where m.conversation_id = c.id and m.deleted_at is null
    order by m.created_at desc limit 1
  ) lm on true
  where c.family_id = p_family
  order by coalesce(c.last_message_at, c.created_at) desc
$$;

-- ---------------------------------------------------------------------------
-- Media and memories
-- ---------------------------------------------------------------------------

create or replace function private.media_rules(p_kind text, p_mime text, p_bytes bigint, p_duration int) returns void
language plpgsql immutable as $$
begin
  if p_kind = 'photo' then
    if p_mime not in ('image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp') then raise exception 'media_type_not_allowed'; end if;
    if p_bytes > 20 * 1024 * 1024 then raise exception 'media_too_large'; end if;
  elsif p_kind = 'video' then
    if p_mime not in ('video/mp4', 'video/quicktime') then raise exception 'media_type_not_allowed'; end if;
    if p_bytes > 200 * 1024 * 1024 then raise exception 'media_too_large'; end if;
    if p_duration is null or p_duration > 180000 then raise exception 'video_too_long'; end if;
  else
    raise exception 'media_type_not_allowed';
  end if;
  if p_bytes is null or p_bytes <= 0 then raise exception 'invalid_input'; end if;
end $$;

-- Step 1 of an upload: reserve a private path. The storage policy only accepts an
-- upload to a path reserved this way by the same person.
create or replace function public.create_media(p_family uuid, p_kind text, p_mime text, p_bytes bigint,
  p_width int default null, p_height int default null, p_duration_ms int default null)
returns table (media_id uuid, storage_path text)
language plpgsql security definer set search_path = '' as $$
declare v_id uuid := gen_random_uuid(); v_path text; v_ext text;
begin
  perform private.require_member(p_family);
  perform private.media_rules(p_kind, lower(p_mime), p_bytes, p_duration_ms);
  if (select count(*) from public.media where uploaded_by = auth.uid() and created_at > now() - interval '1 hour') >= 200 then
    raise exception 'rate_limited';
  end if;
  v_ext := case lower(p_mime) when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/heic' then 'heic'
    when 'image/heif' then 'heif' when 'image/webp' then 'webp' when 'video/mp4' then 'mp4' else 'mov' end;
  v_path := p_family || '/' || v_id || '.' || v_ext;
  insert into public.media (id, family_id, uploaded_by, storage_path, kind, mime_type, bytes, width, height, duration_ms)
    values (v_id, p_family, auth.uid(), v_path, p_kind, lower(p_mime), p_bytes, p_width, p_height, p_duration_ms);
  return query select v_id, v_path;
end $$;

-- Step 2: confirm the file really arrived in storage before it can be used.
create or replace function public.finalize_media(p_media uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare md public.media; v_size bigint;
begin
  select * into md from public.media where id = p_media and uploaded_by = private.require_user() for update;
  if not found or not private.is_member(md.family_id) then raise exception 'not_found'; end if;
  if md.status = 'ready' then return; end if;
  if md.status = 'deleted' then raise exception 'not_found'; end if;
  select coalesce((o.metadata ->> 'size')::bigint, 0) into v_size
    from storage.objects o where o.bucket_id = 'family-media' and o.name = md.storage_path;
  if not found then raise exception 'upload_missing'; end if;
  if v_size > 0 and v_size > (case md.kind when 'photo' then 20 else 200 end) * 1024 * 1024 then
    raise exception 'media_too_large';
  end if;
  update public.media set status = 'ready', bytes = case when v_size > 0 then v_size else bytes end where id = p_media;
end $$;

create or replace function public.mark_media_failed(p_media uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.media set status = 'failed' where id = p_media and uploaded_by = private.require_user() and status = 'uploading';
end $$;

create or replace function public.add_memory(p_media uuid, p_caption text default null, p_taken_on date default null,
  p_visibility text default 'family', p_source_message uuid default null, p_source_task uuid default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare md public.media; v_id uuid;
begin
  perform private.require_user();
  select * into md from public.media where id = p_media;
  if not found or not private.can_view_media(p_media) then raise exception 'not_found'; end if;
  perform private.require_member(md.family_id);
  if p_visibility not in ('family', 'parents_only') then raise exception 'invalid_input'; end if;
  if p_visibility = 'parents_only' and not private.is_parent(md.family_id) then raise exception 'not_allowed' using errcode = '42501'; end if;
  if p_caption is not null and char_length(p_caption) > 500 then raise exception 'invalid_input'; end if;
  if p_source_task is not null and not private.can_view_task(p_source_task) then raise exception 'not_found'; end if;
  if p_source_message is not null and not exists (
    select 1 from public.messages m where m.id = p_source_message and private.is_conversation_member(m.conversation_id)) then
    raise exception 'not_found';
  end if;
  select id into v_id from public.memories where media_id = p_media and deleted_at is null;
  if found then return v_id; end if;
  delete from public.memories where media_id = p_media and deleted_at is not null;
  insert into public.memories (family_id, media_id, caption, taken_on, visibility, source_message_id, source_task_id, added_by)
    values (md.family_id, p_media, nullif(btrim(coalesce(p_caption, '')), ''), coalesce(p_taken_on, current_date),
            p_visibility, p_source_message, p_source_task, auth.uid())
    returning id into v_id;
  return v_id;
end $$;

create or replace function public.update_memory(p_memory uuid, p_caption text, p_taken_on date, p_visibility text) returns void
language plpgsql security definer set search_path = '' as $$
declare mm public.memories;
begin
  select * into mm from public.memories where id = p_memory and deleted_at is null;
  if not found or not private.can_view_memory(p_memory) then raise exception 'not_found'; end if;
  if mm.added_by is distinct from auth.uid() and not private.is_parent(mm.family_id) then raise exception 'not_allowed' using errcode = '42501'; end if;
  if p_visibility not in ('family', 'parents_only') then raise exception 'invalid_input'; end if;
  if p_visibility <> mm.visibility and not private.is_parent(mm.family_id) then raise exception 'not_allowed' using errcode = '42501'; end if;
  if p_caption is not null and char_length(p_caption) > 500 then raise exception 'invalid_input'; end if;
  update public.memories set caption = nullif(btrim(coalesce(p_caption, '')), ''), taken_on = coalesce(p_taken_on, taken_on),
    visibility = p_visibility where id = p_memory;
end $$;

-- Deleting a memory: the record goes immediately; the file becomes unreadable at
-- once (status 'deleted') unless it's still attached to a chat message. Returns the
-- storage path the app should then remove (the storage policy permits it).
create or replace function public.delete_memory(p_memory uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare mm public.memories; md public.media;
begin
  select * into mm from public.memories where id = p_memory and deleted_at is null for update;
  if not found or not private.can_view_memory(p_memory) then raise exception 'not_found'; end if;
  if mm.added_by is distinct from auth.uid() and not private.is_parent(mm.family_id) then raise exception 'not_allowed' using errcode = '42501'; end if;
  update public.memories set deleted_at = now() where id = p_memory;
  select * into md from public.media where id = mm.media_id;
  if not exists (select 1 from public.message_attachments a join public.messages m on m.id = a.message_id
                 where a.media_id = md.id and m.deleted_at is null) then
    update public.media set status = 'deleted' where id = md.id;
    return md.storage_path;
  end if;
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------

create or replace function public.mark_notifications_read(p_ids uuid[] default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.notifications set read_at = now()
    where user_id = private.require_user() and read_at is null and (p_ids is null or id = any (p_ids));
end $$;

-- Run by a schedule (pg_cron) every 15 minutes: reminders two hours ahead, and a
-- gentle note to the asker when a reply-by time passes with no helper.
create or replace function private.run_scheduled_notifications() returns void
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in
    select t.id, t.family_id, t.title, t.kind, u.user_id
    from public.tasks t
    cross join lateral (
      select t.created_by as user_id
      union
      select tr.user_id from public.task_responses tr where tr.task_id = t.id and tr.response in ('accepted', 'tentative')
    ) u
    where t.status in ('open', 'confirmed') and not t.all_day
      and t.starts_at between now() and now() + interval '2 hours'
      and (t.kind = 'event' or t.status = 'confirmed')
  loop
    perform private.notify(r.user_id, r.family_id, 'reminder', 'reminders', 'Coming up soon', r.title, 'reminder:' || r.id, r.id);
  end loop;

  for r in
    select t.id, t.family_id, t.title, t.created_by from public.tasks t
    where t.kind = 'help' and t.status = 'open' and t.respond_by is not null
      and t.respond_by < now() and t.starts_at > now()
  loop
    perform private.notify(r.created_by, r.family_id, 'no_helper_yet', 'task_updates', 'No one is free yet',
      r.title || ': you could ask again or try someone new.', 'nohelper:' || r.id, r.id);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Account deletion (called by the delete-account edge function with the
-- service role, after it has removed the person's storage files).
-- ---------------------------------------------------------------------------

create or replace function private.prepare_account_deletion(p_user uuid)
returns table (storage_path text)
language plpgsql security definer set search_path = '' as $$
declare f record; v_next uuid;
begin
  for f in select fm.family_id, fm.role from public.family_members fm where fm.user_id = p_user loop
    if f.role = 'owner' and (select count(*) from public.family_members where family_id = f.family_id and role = 'owner') = 1 then
      select user_id into v_next from public.family_members
        where family_id = f.family_id and user_id <> p_user
        order by (role = 'parent') desc, joined_at limit 1;
      if v_next is null then
        -- Last person in the family: everything in it goes.
        return query select md.storage_path from public.media md where md.family_id = f.family_id;
        delete from public.families where id = f.family_id;
        continue;
      end if;
      update public.family_members set role = 'owner' where family_id = f.family_id and user_id = v_next;
    end if;
    -- Cancel their upcoming requests so nobody turns up for a task that no longer has an organiser.
    update public.tasks set status = 'cancelled', cancelled_reason = 'Organiser left Robin', version = version + 1
      where family_id = f.family_id and created_by = p_user and status in ('draft', 'open', 'confirmed') and ends_at > now();
    perform private.detach_member(f.family_id, p_user);
  end loop;
  return query select md.storage_path from public.media md where md.uploaded_by = p_user;
  update public.media set status = 'deleted' where uploaded_by = p_user;
  update public.memories set deleted_at = now()
    where deleted_at is null and media_id in (select id from public.media where uploaded_by = p_user);
end $$;

revoke all on function private.prepare_account_deletion(uuid) from public, authenticated;
grant execute on function private.prepare_account_deletion(uuid) to service_role;
revoke all on function private.run_scheduled_notifications() from public, authenticated;

-- Lock down: functions are callable by signed-in users only.
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated, service_role;
