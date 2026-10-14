-- Short, friendly invite codes (e.g. K7PQ-2MXR) instead of long links.
--
-- A code is 8 characters from a 31-letter alphabet with no look-alikes
-- (no 0/O, 1/I/L), about 40 bits of randomness. That is plenty for a one-time
-- code that expires within days, provided nobody can try codes quickly, so
-- every lookup is rate-limited per person: 10 wrong codes an hour, then wait.
-- Codes are still stored only as a SHA-256 hash. Older long links keep working.

create table private.invite_attempts (
  user_id uuid not null,
  attempted_at timestamptz not null default now()
);
create index invite_attempts_user_idx on private.invite_attempts (user_id, attempted_at);

-- Codes are typed by people: ignore case, spaces and dashes.
create or replace function private.normalize_invite_code(p text) returns text
language sql immutable as $$
  select upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g'))
$$;

-- Finds the invitation for a code (or an old long token), enforcing the
-- attempt limit. Wrong guesses are recorded by the caller (see below).
create or replace function private.find_invitation(p_token text, p_lock boolean default false)
returns public.invitations
language plpgsql security definer set search_path = '' as $$
declare v public.invitations; v_uid uuid := private.require_user(); v_hashes text[];
begin
  if (select count(*) from private.invite_attempts a
        where a.user_id = v_uid and a.attempted_at > now() - interval '1 hour') >= 10 then
    raise exception 'too_many_attempts';
  end if;
  v_hashes := array[
    encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex'),                         -- older long links
    encode(extensions.digest(private.normalize_invite_code(p_token), 'sha256'), 'hex')          -- short codes
  ];
  if p_lock then
    select * into v from public.invitations i where i.token_hash = any (v_hashes) limit 1 for update;
  else
    select * into v from public.invitations i where i.token_hash = any (v_hashes) limit 1;
  end if;
  return v;
end $$;

create or replace function private.note_wrong_invite() returns void
language sql security definer set search_path = '' as $$
  insert into private.invite_attempts (user_id) values (auth.uid());
  delete from private.invite_attempts where attempted_at < now() - interval '1 day';
$$;

-- Returns the code ONCE. Only its hash is stored.
create or replace function public.create_invitation(p_family uuid, p_role text default 'helper',
  p_expires_in_hours int default 72, p_note text default null)
returns table (invitation_id uuid, token text, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_code text; v_id uuid; v_exp timestamptz; v_bytes bytea; b int; i int;
begin
  perform private.require_parent(p_family);
  if p_role not in ('parent', 'helper') then raise exception 'invalid_input'; end if;
  if p_expires_in_hours is null or p_expires_in_hours not between 1 and 336 then raise exception 'invalid_input'; end if;
  if p_note is not null and char_length(p_note) > 80 then raise exception 'invalid_input'; end if;
  if (select count(*) from public.invitations iv where iv.family_id = p_family and iv.accepted_at is null
        and iv.revoked_at is null and iv.declined_at is null and iv.expires_at > now()) >= 50 then
    raise exception 'too_many_invitations';
  end if;
  v_exp := now() + make_interval(hours => p_expires_in_hours);
  loop
    -- Unbiased: bytes 248-255 are skipped so every letter is equally likely.
    v_code := '';
    while char_length(v_code) < 8 loop
      v_bytes := extensions.gen_random_bytes(16);
      for i in 0..15 loop
        b := get_byte(v_bytes, i);
        if b < 248 and char_length(v_code) < 8 then
          v_code := v_code || substr(v_alphabet, (b % 31) + 1, 1);
        end if;
      end loop;
    end loop;
    begin
      insert into public.invitations (family_id, invited_by, token_hash, role, note, expires_at)
        values (p_family, auth.uid(), encode(extensions.digest(v_code, 'sha256'), 'hex'), p_role,
                nullif(btrim(coalesce(p_note, '')), ''), v_exp)
        returning id into v_id;
      exit;
    exception when unique_violation then
      -- Astronomically rare clash with an older code: pick another.
    end;
  end loop;
  return query select v_id, v_code, v_exp;
end $$;

create or replace function public.preview_invitation(p_token text)
returns table (state text, family_name text, invited_by_name text, role text, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare v public.invitations;
begin
  v := private.find_invitation(p_token);
  if v.id is null then
    perform private.note_wrong_invite();
    return query select 'invalid'::text, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;
  return query select private.invitation_state(v),
    case when private.invitation_state(v) = 'valid' then (select f.name from public.families f where f.id = v.family_id) end,
    case when private.invitation_state(v) = 'valid' then private.display_name(v.invited_by) end,
    v.role, v.expires_at;
end $$;

-- A wrong code returns null rather than raising an error, so that the wrong
-- attempt is still recorded (an error would undo it). The app shows
-- "That code isn't valid" when it gets null back.
create or replace function public.accept_invitation(p_token text, p_relation_label text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_user(); v public.invitations; v_state text;
begin
  v := private.find_invitation(p_token, true);
  if v.id is null then
    perform private.note_wrong_invite();
    return null;
  end if;
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
  v := private.find_invitation(p_token, true);
  if v.id is null then
    perform private.note_wrong_invite();
    return;
  end if;
  if private.invitation_state(v) <> 'valid' then raise exception 'invite_%', private.invitation_state(v); end if;
  update public.invitations set declined_at = now() where id = v.id;
end $$;

revoke all on function private.find_invitation(text, boolean) from public;
revoke all on function private.note_wrong_invite() from public;
