-- Robin: private media bucket, live updates and schedules

-- Private bucket. Size and type limits are enforced by storage itself as well as
-- by create_media(). Files are only ever served through short-lived signed URLs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('family-media', 'family-media', false, 209715200,
        array['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp', 'video/mp4', 'video/quicktime'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Read: only if you are allowed to see the media record behind this exact path.
-- Guessing a path or changing an id doesn't help: the check is on the database row.
create policy "family media: read if permitted" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'family-media'
    and (
      private.can_view_media_path(name)
      -- the uploader must still be able to see a removed file in order to
      -- delete it from storage
      or exists (
        select 1 from public.media md
        where md.storage_path = name and md.status = 'deleted' and md.uploaded_by = (select auth.uid())
      )
    )
  );

-- Upload: only to a path you reserved with create_media() and haven't finished.
create policy "family media: upload reserved path" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'family-media'
    and exists (
      select 1 from public.media md
      where md.storage_path = name and md.uploaded_by = (select auth.uid())
        and md.status in ('uploading', 'failed') and private.is_member(md.family_id)
    )
  );

-- Delete: only files whose record is already marked deleted, by their uploader.
-- Anything else marked deleted (e.g. a parent removed someone else's memory) is
-- swept by the cleanup-media edge function using the service role.
create policy "family media: delete removed files" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'family-media'
    and exists (
      select 1 from public.media md
      where md.storage_path = name and md.status = 'deleted' and md.uploaded_by = (select auth.uid())
    )
  );

-- Live updates. Supabase Realtime applies the same row-level security, so a
-- removed member stops receiving changes immediately.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table
      public.tasks, public.task_responses, public.messages, public.conversation_members,
      public.notifications, public.family_members, public.memories;
  end if;
end $$;

-- Schedules (pg_cron is available on Supabase; enable it under Database > Extensions).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('robin-reminders', '*/15 * * * *', 'select private.run_scheduled_notifications()');
  end if;
end $$;
