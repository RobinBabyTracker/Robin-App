import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshDatabase, family, rejects } from './_harness.mjs';

let world;
before(async () => { world = await freshDatabase('service'); });
after(async () => { await world.close(); });

const ADMIN_FNS = [
  "select public.admin_prepare_account_deletion(gen_random_uuid())",
  'select public.admin_media_to_clean(10)',
  "select public.admin_forget_media(array[gen_random_uuid()])",
  "select public.admin_push_targets(gen_random_uuid())",
  "select public.admin_forget_push_tokens(array['x'])",
];

test('signed-in users cannot call server-only functions', async () => {
  const u = await world.createUser('Curious');
  for (const sql of ADMIN_FNS) await rejects(u.q(sql), 'permission denied');
  const anon = await world.connect();
  await anon.query('set role anon');
  for (const sql of ADMIN_FNS) await assert.rejects(anon.query(sql), /permission denied/);
});

test('media cleanup sweeps removed and abandoned files, never live ones', async () => {
  const { familyId, owner } = await family(world, 0);
  const svc = await world.serviceRole();
  const admin = await world.admin();
  const mk = async () => (await owner.rpc('create_media', { p_family: familyId, p_kind: 'photo', p_mime: 'image/jpeg', p_bytes: 10 }))[0];
  const live = await mk();
  await owner.q("insert into storage.objects (bucket_id, name) values ('family-media', $1)", [live.storage_path]);
  await owner.rpc('finalize_media', { p_media: live.media_id });
  await owner.rpc('add_memory', { p_media: live.media_id });
  const removed = await mk();
  await owner.q("insert into storage.objects (bucket_id, name) values ('family-media', $1)", [removed.storage_path]);
  await owner.rpc('finalize_media', { p_media: removed.media_id });
  const mem = await owner.rpcValue('add_memory', { p_media: removed.media_id });
  await owner.rpc('delete_memory', { p_memory: mem });
  const abandoned = await mk();
  await admin.query("update public.media set created_at = now() - interval '2 days' where id = $1", [abandoned.media_id]);
  const fresh = await mk(); // still uploading: leave it alone

  const toClean = (await svc.q('select * from public.admin_media_to_clean(100)')).map((r) => r.media_id).sort();
  assert.deepEqual(toClean, [removed.media_id, abandoned.media_id].sort());
  const n = (await svc.q('select public.admin_forget_media($1) as n', [[...toClean, live.media_id, fresh.media_id]]))[0].n;
  assert.equal(n, 2);
  const left = (await admin.query('select id from public.media where family_id = $1', [familyId])).rows.map((r) => r.id).sort();
  assert.deepEqual(left, [live.media_id, fresh.media_id].sort());
});

test('push targets respect read state and only exist for registered devices', async () => {
  const { familyId, owner, helpers } = await family(world, 1);
  const h = helpers[0];
  await h.rpc('register_push_device', { p_token: 'ExponentPushToken[abc]', p_platform: 'android' });
  const conv = await owner.rpcValue('create_conversation', { p_family: familyId, p_members: [h.id] });
  await owner.rpc('send_message', { p_conversation: conv, p_body: 'Hi Nana', p_client_id: crypto.randomUUID() });
  const [note] = await h.q('select id from public.notifications where conversation_id = $1', [conv]);
  const svc = await world.serviceRole();
  const targets = await svc.q('select * from public.admin_push_targets($1)', [note.id]);
  assert.equal(targets.length, 1);
  assert.equal(targets[0].token, 'ExponentPushToken[abc]');
  assert.equal(targets[0].body, 'Hi Nana');
  await h.rpc('mark_conversation_read', { p_conversation: conv });
  assert.equal((await svc.q('select * from public.admin_push_targets($1)', [note.id])).length, 0, 'already read: no push');
  // A device token moves with whoever registers it last (shared phones).
  await owner.rpc('register_push_device', { p_token: 'ExponentPushToken[abc]', p_platform: 'android' });
  await rejects(h.q('select 1 from public.push_devices'), 'permission denied'); // clients cannot read device tokens
});
