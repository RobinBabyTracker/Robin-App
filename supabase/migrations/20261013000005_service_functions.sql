-- Robin: functions only the server (service role, used by edge functions) may call.

create or replace function public.admin_prepare_account_deletion(p_user uuid)
returns setof text
language sql security definer set search_path = '' as $$
  select storage_path from private.prepare_account_deletion(p_user)
$$;

-- Files to sweep from storage: removed media, and uploads abandoned for a day.
create or replace function public.admin_media_to_clean(p_limit int default 200)
returns table (media_id uuid, storage_path text)
language sql security definer set search_path = '' as $$
  select id, storage_path from public.media
  where status = 'deleted'
     or (status in ('uploading', 'failed') and created_at < now() - interval '1 day')
  order by created_at
  limit greatest(1, least(p_limit, 1000))
$$;

-- After their files are gone, drop records nothing refers to any more.
create or replace function public.admin_forget_media(p_ids uuid[])
returns int
language plpgsql security definer set search_path = '' as $$
declare v int;
begin
  delete from public.media md
  where md.id = any (p_ids)
    and (md.status = 'deleted' or (md.status in ('uploading', 'failed') and md.created_at < now() - interval '1 day'))
    and not exists (select 1 from public.memories mm where mm.media_id = md.id and mm.deleted_at is null)
    and not exists (select 1 from public.message_attachments a join public.messages m on m.id = a.message_id
                    where a.media_id = md.id and m.deleted_at is null);
  get diagnostics v = row_count;
  return v;
end $$;

-- Push delivery details for one notification (used by the send-push function).
create or replace function public.admin_push_targets(p_notification uuid)
returns table (token text, push_enabled boolean, quiet_start time, quiet_end time, timezone text, title text, body text,
  task_id uuid, conversation_id uuid, family_id uuid, unread int)
language sql security definer set search_path = '' as $$
  select d.token, coalesce(p.push_enabled, true), p.quiet_hours_start, p.quiet_hours_end, pr.timezone,
    n.title, n.body, n.task_id, n.conversation_id, n.family_id,
    (select count(*) from public.notifications x where x.user_id = n.user_id and x.read_at is null)::int
  from public.notifications n
  join public.profiles pr on pr.id = n.user_id
  left join public.notification_prefs p on p.user_id = n.user_id
  join public.push_devices d on d.user_id = n.user_id
  where n.id = p_notification and n.read_at is null
$$;

create or replace function public.admin_forget_push_tokens(p_tokens text[])
returns void
language sql security definer set search_path = '' as $$
  delete from public.push_devices where token = any (p_tokens)
$$;

revoke all on function public.admin_prepare_account_deletion(uuid) from public, anon, authenticated;
revoke all on function public.admin_media_to_clean(int) from public, anon, authenticated;
revoke all on function public.admin_forget_media(uuid[]) from public, anon, authenticated;
revoke all on function public.admin_push_targets(uuid) from public, anon, authenticated;
revoke all on function public.admin_forget_push_tokens(text[]) from public, anon, authenticated;
grant execute on function public.admin_prepare_account_deletion(uuid), public.admin_media_to_clean(int),
  public.admin_forget_media(uuid[]), public.admin_push_targets(uuid), public.admin_forget_push_tokens(text[])
  to service_role;
