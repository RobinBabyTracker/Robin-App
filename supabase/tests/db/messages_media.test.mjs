import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { freshDatabase, family, rejects, taskPayload } from './_harness.mjs';

let world;
before(async () => { world = await freshDatabase('messages'); });
after(async () => { await world.close(); });

const send = (who, conv, body, extra = {}) =>
  who.rpc('send_message', { p_conversation: conv, p_body: body, p_client_id: randomUUID(), ...extra });

test('direct chats are created once per pair; groups need family members', async () => {
  const { familyId, owner, helpers } = await family(world, 2);
  const a = await owner.rpcValue('create_conversation', { p_family: familyId, p_members: [helpers[0].id] });
  const b = await helpers[0].rpcValue('create_conversation', { p_family: familyId, p_members: [owner.id] });
  assert.equal(a, b);
  const outsider = await world.createUser('Outsider');
  await rejects(owner.rpc('create_conversation', { p_family: familyId, p_members: [outsider.id] }), 'not_member');
  await rejects(outsider.rpc('create_conversation', { p_family: familyId, p_members: [owner.id] }), 'not_member');
  const g = await owner.rpcValue('create_conversation', { p_family: familyId, p_members: helpers.map((h) => h.id), p_name: 'Family Group' });
  const [c] = await helpers[1].q('select kind, name from public.conversations where id = $1', [g]);
  assert.deepEqual(c, { kind: 'group', name: 'Family Group' });
});

test('messages persist, retries never duplicate, outsiders see nothing', async () => {
  const { familyId, owner, parent, helpers } = await family(world, 1);
  const conv = await owner.rpcValue('create_conversation', { p_family: familyId, p_members: [helpers[0].id] });
  const clientId = randomUUID();
  const [m1] = await owner.rpc('send_message', { p_conversation: conv, p_body: 'Can you do Friday?', p_client_id: clientId });
  const [m2] = await owner.rpc('send_message', { p_conversation: conv, p_body: 'Can you do Friday?', p_client_id: clientId });
  assert.equal(m1.id, m2.id);
  assert.equal((await helpers[0].q('select id from public.messages where conversation_id = $1', [conv])).length, 1);
  // Same family, not in the chat: can't read or post.
  assert.equal((await parent.q('select id from public.messages where conversation_id = $1', [conv])).length, 0);
  await rejects(send(parent, conv, 'sneaky'), 'not_found');
  await rejects(send(owner, conv, '   '), 'empty_message');
  await rejects(send(owner, conv, 'x'.repeat(4001)), 'message_too_long');
});

test('unread counts, read state, one notification per chat, mute', async () => {
  const { familyId, owner, helpers } = await family(world, 1);
  const h = helpers[0];
  const conv = await owner.rpcValue('create_conversation', { p_family: familyId, p_members: [h.id] });
  await send(owner, conv, 'one');
  await send(owner, conv, 'two');
  await send(owner, conv, 'three');
  let [row] = await h.rpc('conversation_list', { p_family: familyId });
  assert.equal(row.unread_count, 3);
  assert.equal(row.last_body, 'three');
  const notes = await h.q('select body, read_at from public.notifications where conversation_id = $1', [conv]);
  assert.equal(notes.length, 1, 'messages collapse into one notification per chat');
  assert.equal(notes[0].body, 'three');

  await h.rpc('mark_conversation_read', { p_conversation: conv });
  [row] = await h.rpc('conversation_list', { p_family: familyId });
  assert.equal(row.unread_count, 0);
  assert.ok((await h.q('select read_at from public.notifications where conversation_id = $1', [conv]))[0].read_at);

  await h.rpc('set_conversation_muted', { p_conversation: conv, p_until: new Date(Date.now() + 3600e3).toISOString() });
  await world.admin().then((a) => a.query('delete from public.notifications where conversation_id = $1', [conv]));
  await send(owner, conv, 'four');
  assert.equal((await h.q('select 1 from public.notifications where conversation_id = $1', [conv])).length, 0);
  [row] = await h.rpc('conversation_list', { p_family: familyId });
  assert.equal(row.unread_count, 1, 'muted chats still count unread');
});

test('notification preferences are respected', async () => {
  const { familyId, owner, helpers } = await family(world, 1);
  const h = helpers[0];
  await h.q('update public.notification_prefs set messages = false, task_requests = false');
  const conv = await owner.rpcValue('create_conversation', { p_family: familyId, p_members: [h.id] });
  await send(owner, conv, 'hello');
  await owner.rpc('create_task', { p_family: familyId, p: taskPayload() });
  assert.equal((await h.q('select 1 from public.notifications')).length, 0);
  // Users can't edit someone else's prefs or read their notifications.
  const res = await h.q('update public.notification_prefs set messages = false where user_id = $1 returning 1', [owner.id]);
  assert.equal(res.length, 0);
  assert.equal((await h.q('select 1 from public.notifications where user_id = $1', [owner.id])).length, 0);
  await rejects(h.q('update public.notifications set title = $1', ['x']), 'permission denied');
});

test('deleting a message hides its text', async () => {
  const { familyId, owner, helpers } = await family(world, 1);
  const conv = await owner.rpcValue('create_conversation', { p_family: familyId, p_members: [helpers[0].id] });
  const [m] = await send(owner, conv, 'oops');
  await rejects(helpers[0].rpc('delete_message', { p_message: m.id }), 'not_found');
  await owner.rpc('delete_message', { p_message: m.id });
  const [seen] = await helpers[0].q('select body, deleted_at from public.messages where id = $1', [m.id]);
  assert.equal(seen.body, null);
  assert.ok(seen.deleted_at);
});

// --- media ---------------------------------------------------------------

async function upload(who, familyId, kind = 'photo', mime = 'image/jpeg', bytes = 1000, duration = null) {
  const [r] = await who.rpc('create_media', { p_family: familyId, p_kind: kind, p_mime: mime, p_bytes: bytes, p_duration_ms: duration });
  await who.q("insert into storage.objects (bucket_id, name, owner, metadata) values ('family-media', $1, $2, $3)",
    [r.storage_path, who.id, { size: bytes, mimetype: mime }]);
  await who.rpc('finalize_media', { p_media: r.media_id });
  return r;
}
const canRead = async (who, path) =>
  (await who.q("select 1 from storage.objects where bucket_id = 'family-media' and name = $1", [path])).length === 1;

test('upload rules: type, size and video length', async () => {
  const { familyId, owner } = await family(world, 0);
  await rejects(owner.rpc('create_media', { p_family: familyId, p_kind: 'photo', p_mime: 'image/gif', p_bytes: 10 }), 'media_type_not_allowed');
  await rejects(owner.rpc('create_media', { p_family: familyId, p_kind: 'photo', p_mime: 'image/jpeg', p_bytes: 21 * 1024 * 1024 }), 'media_too_large');
  await rejects(owner.rpc('create_media', { p_family: familyId, p_kind: 'video', p_mime: 'video/mp4', p_bytes: 1000, p_duration_ms: 181000 }), 'video_too_long');
  await rejects(owner.rpc('create_media', { p_family: familyId, p_kind: 'video', p_mime: 'application/x-msdownload', p_bytes: 1000, p_duration_ms: 1000 }), 'media_type_not_allowed');
  await owner.rpc('create_media', { p_family: familyId, p_kind: 'video', p_mime: 'video/mp4', p_bytes: 1000, p_duration_ms: 180000 });
});

test('uploads only go to a reserved path, and must actually arrive', async () => {
  const { familyId, owner, helpers } = await family(world, 1);
  const [r] = await owner.rpc('create_media', { p_family: familyId, p_kind: 'photo', p_mime: 'image/jpeg', p_bytes: 1000 });
  await rejects(owner.rpc('finalize_media', { p_media: r.media_id }), 'upload_missing');
  // Someone else can't upload to your reserved path, and you can't upload anywhere else.
  await rejects(helpers[0].q("insert into storage.objects (bucket_id, name) values ('family-media', $1)", [r.storage_path]), 'row-level security');
  await rejects(owner.q("insert into storage.objects (bucket_id, name) values ('family-media', $1)", [`${familyId}/made-up.jpg`]), 'row-level security');
  await owner.q("insert into storage.objects (bucket_id, name, metadata) values ('family-media', $1, $2)", [r.storage_path, { size: 1000 }]);
  await owner.rpc('finalize_media', { p_media: r.media_id });
  await rejects(helpers[0].rpc('finalize_media', { p_media: r.media_id }), 'not_found');
});

test('private media: only people in the chat (or with the memory) can open it', async () => {
  const { familyId, owner, parent, helpers } = await family(world, 2);
  const [h1, h2] = helpers;
  const otherFamily = await family(world, 0);
  const photo = await upload(owner, familyId);

  assert.ok(await canRead(owner, photo.storage_path), 'uploader');
  assert.ok(!(await canRead(h1, photo.storage_path)), 'not shared yet');
  assert.ok(!(await canRead(otherFamily.owner, photo.storage_path)), 'other family, even knowing the path');

  // Can't attach media you didn't upload, or media from another family.
  const conv = await owner.rpcValue('create_conversation', { p_family: familyId, p_members: [h1.id] });
  await rejects(send(h1, conv, null, { p_media: [photo.media_id] }), 'media_invalid');
  await send(owner, conv, 'Look!', { p_media: [photo.media_id] });
  assert.ok(await canRead(h1, photo.storage_path), 'in the chat');
  assert.ok(!(await canRead(h2, photo.storage_path)), 'same family, not in the chat');
  assert.equal((await h2.q('select 1 from public.media where id = $1', [photo.media_id])).length, 0);

  // Saving it as a memory shares it with the family.
  const mem = await h1.rpcValue('add_memory', { p_media: photo.media_id, p_caption: 'First smile' });
  assert.ok(await canRead(h2, photo.storage_path));
  assert.equal((await h2.q('select caption from public.memories where id = $1', [mem]))[0].caption, 'First smile');
  assert.ok(!(await canRead(otherFamily.owner, photo.storage_path)));

  // Parents-only memories are hidden from helpers.
  await rejects(h1.rpc('update_memory', { p_memory: mem, p_caption: 'x', p_taken_on: null, p_visibility: 'parents_only' }), 'not_allowed');
  const photo2 = await upload(parent, familyId);
  const mem2 = await parent.rpcValue('add_memory', { p_media: photo2.media_id, p_visibility: 'parents_only' });
  assert.equal((await h2.q('select 1 from public.memories where id = $1', [mem2])).length, 0);
  assert.ok(!(await canRead(h2, photo2.storage_path)));
  assert.ok(await canRead(owner, photo2.storage_path));
});

test('deleted memories and removed members lose access to files', async () => {
  const { familyId, owner, helpers } = await family(world, 2);
  const [h1, h2] = helpers;
  const p = await upload(h1, familyId);
  const mem = await h1.rpcValue('add_memory', { p_media: p.media_id });
  assert.ok(await canRead(h2, p.storage_path));
  await rejects(h2.rpc('delete_memory', { p_memory: mem }), 'not_allowed');
  // Storage delete is refused while the record is live.
  assert.equal((await h1.q("delete from storage.objects where name = $1 returning 1", [p.storage_path])).length, 0);
  const path = await h1.rpcValue('delete_memory', { p_memory: mem });
  assert.equal(path, p.storage_path);
  assert.ok(!(await canRead(h2, p.storage_path)), 'gone for others immediately');
  assert.ok(!(await canRead(owner, p.storage_path)));
  assert.equal((await h1.q("delete from storage.objects where name = $1 returning 1", [p.storage_path])).length, 1, 'uploader can now remove the file');

  const p2 = await upload(owner, familyId);
  await owner.rpcValue('add_memory', { p_media: p2.media_id });
  assert.ok(await canRead(h2, p2.storage_path));
  await owner.rpc('remove_member', { p_family: familyId, p_user: h2.id });
  assert.ok(!(await canRead(h2, p2.storage_path)), 'removed member');
  assert.equal((await h2.q('select 1 from public.memories')).length, 0);
});

test('a parent can delete any memory; media still in a chat stays for the chat', async () => {
  const { familyId, owner, helpers } = await family(world, 1);
  const h = helpers[0];
  const p = await upload(h, familyId);
  const conv = await h.rpcValue('create_conversation', { p_family: familyId, p_members: [owner.id] });
  await send(h, conv, null, { p_media: [p.media_id] });
  const mem = await h.rpcValue('add_memory', { p_media: p.media_id });
  const path = await owner.rpcValue('delete_memory', { p_memory: mem });
  assert.equal(path, null, 'still attached to a message, so the file stays');
  assert.ok(await canRead(owner, p.storage_path));
  assert.equal((await owner.q('select 1 from public.memories where id = $1', [mem])).length, 0);
});

// --- account deletion ----------------------------------------------------

test('account deletion hands over ownership, cancels their requests and removes their uploads', async () => {
  const { familyId, owner, parent, helpers } = await family(world, 1);
  const taskId = await owner.rpcValue('create_task', { p_family: familyId, p: taskPayload() });
  const conv = await owner.rpcValue('create_conversation', { p_family: familyId, p_members: [helpers[0].id] });
  await send(owner, conv, 'hi');
  const p = await upload(owner, familyId);
  await owner.rpcValue('add_memory', { p_media: p.media_id });

  await rejects(owner.q('select * from private.prepare_account_deletion($1)', [owner.id]), 'permission denied');

  const svc = await world.serviceRole();
  const paths = (await svc.q('select * from private.prepare_account_deletion($1)', [owner.id])).map((r) => r.storage_path);
  assert.deepEqual(paths, [p.storage_path]);
  const admin = await world.admin();
  await admin.query('delete from auth.users where id = $1', [owner.id]);

  const [m] = await parent.q('select role from public.family_members where user_id = $1', [parent.id]);
  assert.equal(m.role, 'owner', 'next parent becomes owner');
  const [t] = await parent.q('select status, created_by from public.tasks where id = $1', [taskId]);
  assert.deepEqual(t, { status: 'cancelled', created_by: null });
  const [msg] = await helpers[0].q('select sender_id, body from public.messages where conversation_id = $1', [conv]);
  assert.equal(msg.sender_id, null, 'shown as a former member');
  assert.equal((await parent.q('select 1 from public.memories')).length, 0, 'their uploads are gone');
  assert.equal((await admin.query('select 1 from public.profiles where id = $1', [owner.id])).rowCount, 0);
});

test('deleting the last member removes the whole family', async () => {
  const solo = await world.createUser('Solo');
  const fam = await solo.rpcValue('create_family', { p_name: 'Solo family' });
  const p = await upload(solo, fam);
  const svc = await world.serviceRole();
  const paths = (await svc.q('select * from private.prepare_account_deletion($1)', [solo.id])).map((r) => r.storage_path);
  assert.ok(paths.includes(p.storage_path));
  const admin = await world.admin();
  assert.equal((await admin.query('select 1 from public.families where id = $1', [fam])).rowCount, 0);
});
