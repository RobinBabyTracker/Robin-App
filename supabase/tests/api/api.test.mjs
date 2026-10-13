// API-level tests: the app's real data functions (src/lib/api.ts) running
// through supabase-js against a real PostgREST server, with row-level security,
// JWT roles and the Robin migrations. Needs the PostgREST binary
// (POSTGREST_BIN, default /home/claude/tools/postgrest).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import http from 'node:http';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { freshDatabase, taskPayload } from '../db/_harness.mjs';
import * as api from '../../../src/lib/api.ts';

const SECRET = 'robin-test-secret-robin-test-secret-0123456789';
const PORT = 54330; // PostgREST
const GATEWAY = 54332; // stands in for Supabase's API gateway (/rest/v1 -> PostgREST)
const URL_ = `http://127.0.0.1:${GATEWAY}`;
let world, server, gateway;

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function jwt(claims) {
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({ exp: Math.floor(Date.now() / 1000) + 3600, ...claims });
  const sig = createHmac('sha256', SECRET).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}
const ANON = jwt({ role: 'anon' });
const clientFor = (userId) => createClient(URL_, ANON, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { headers: { Authorization: `Bearer ${userId ? jwt({ sub: userId, role: 'authenticated' }) : ANON}` } },
});

before(async () => {
  world = await freshDatabase('api');
  const conf = path.join(tmpdir(), 'robin-postgrest.conf');
  writeFileSync(conf, [
    `db-uri = "postgres://authenticator@/${world.db}?host=/tmp&port=54322"`,
    'db-schemas = "public"',
    'db-anon-role = "anon"',
    `jwt-secret = "${SECRET}"`,
    `server-port = ${PORT}`,
    'server-host = "127.0.0.1"',
    'db-pool = 20',
  ].join('\n'));
  server = spawn(process.env.POSTGREST_BIN ?? '/home/claude/tools/postgrest', [conf], { stdio: 'ignore' });
  gateway = http.createServer((req, res) => {
    const target = req.url.replace(/^\/rest\/v1/, '');
    const up = http.request({ host: '127.0.0.1', port: PORT, path: target, method: req.method, headers: req.headers }, (r) => {
      res.writeHead(r.statusCode, r.headers);
      r.pipe(res);
    });
    up.on('error', () => { res.writeHead(502); res.end(); });
    req.pipe(up);
  }).listen(GATEWAY);
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(`${URL_}/rest/v1/`); if (r.ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('PostgREST did not start');
});
after(async () => { server?.kill(); gateway?.close(); await world?.close(); });

async function user(name) {
  const actor = await world.createUser(name);
  return { id: actor.id, c: clientFor(actor.id) };
}

test('end-to-end through the app’s data layer', async () => {
  const jess = await user('Jess');
  const dan = await user('Dan');
  const nana = await user('Nana');
  const stranger = await user('Stranger');

  // Family + invitations
  const fam = await api.rpcCall(jess.c, 'create_family', { p_name: 'The Parkers', p_relation_label: 'Mum' });
  for (const [u, role] of [[dan, 'parent'], [nana, 'helper']]) {
    const [inv] = await api.rpcCall(jess.c, 'create_invitation', { p_family: fam, p_role: role, p_expires_in_hours: 72 });
    const [pv] = await api.rpcCall(u.c, 'preview_invitation', { p_token: inv.token });
    assert.equal(pv.family_name, 'The Parkers');
    assert.equal(await api.rpcCall(u.c, 'accept_invitation', { p_token: inv.token, p_relation_label: role === 'helper' ? 'Nana' : null }), fam);
  }
  assert.deepEqual((await api.fetchMyFamilies(nana.c, nana.id)).map((f) => [f.name, f.role]), [['The Parkers', 'helper']]);
  const members = await api.fetchMembers(nana.c, fam);
  assert.equal(members.length, 3);
  assert.equal(members[0].profile.display_name, 'Jess');
  assert.deepEqual(await api.fetchMembers(stranger.c, fam), []);
  assert.equal((await api.fetchInvitations(jess.c, fam)).length, 2);
  assert.equal((await api.fetchInvitations(nana.c, fam)).length, 0);
  assert.equal((await api.fetchProfile(nana.c, jess.id)).display_name, 'Jess');
  await assert.rejects(api.fetchProfile(stranger.c, jess.id));

  // A help request exactly as the form sends it
  const payload = { ...taskPayload(), description: '', location: 'Home', notes: '', links: ['https://example.com/note'] };
  const taskId = await api.rpcCall(jess.c, 'create_task', { p_family: fam, p: payload, p_send: true });
  const from = new Date().toISOString();
  const to = new Date(Date.now() + 14 * 86400e3).toISOString();
  const nanaCal = await api.fetchCalendar(nana.c, fam, from, to, 'mine');
  assert.equal(nanaCal.length, 1);
  assert.equal(nanaCal[0].my_role, 'invited');
  assert.deepEqual(await api.fetchCalendar(stranger.c, fam, from, to, 'family'), []);
  const detail = await api.fetchTask(nana.c, taskId);
  assert.equal(detail.task.location, 'Home');
  assert.deepEqual(detail.task.links, ['https://example.com/note']);
  assert.equal(detail.invitees.length, 2);
  assert.equal(await api.fetchTask(stranger.c, taskId), null);

  // Dan and Nana both tap "I can help" at the same moment
  const results = await Promise.all([dan, nana].map((u) => api.rpcCall(u.c, 'respond_to_task', { p_task: taskId, p_response: 'accepted' })));
  assert.deepEqual(results.map((r) => r[0].result).sort(), ['already_filled', 'assigned']);
  assert.equal((await api.fetchTask(jess.c, taskId)).task.status, 'confirmed');
  const notes = await api.fetchNotifications(jess.c);
  assert.equal(notes.filter((n) => n.type === 'task_accepted').length, 1);

  // Messaging with pagination and unread counts
  const conv = await api.rpcCall(jess.c, 'create_conversation', { p_family: fam, p_members: [nana.id, dan.id], p_name: 'Family Group' });
  for (let i = 0; i < 35; i++) {
    await api.rpcCall(jess.c, 'send_message', { p_conversation: conv, p_body: `Message ${i}`, p_client_id: randomUUID(), p_media: [] });
  }
  const [summary] = await api.fetchConversations(nana.c, fam);
  assert.equal(summary.unread_count, 35);
  assert.equal(summary.last_body, 'Message 34');
  const page1 = await api.fetchMessagesPage(nana.c, conv, null);
  assert.equal(page1.length, 30);
  assert.equal(page1[0].body, 'Message 34');
  const page2 = await api.fetchMessagesPage(nana.c, conv, page1[29].created_at);
  assert.equal(page2.length, 5);
  assert.equal(page2[4].body, 'Message 0');
  assert.deepEqual(await api.fetchMessagesPage(stranger.c, conv, null), []);
  await api.rpcCall(nana.c, 'mark_conversation_read', { p_conversation: conv });
  assert.equal((await api.fetchConversations(nana.c, fam))[0].unread_count, 0);
  const cd = await api.fetchConversation(jess.c, conv);
  assert.equal(cd.members.length, 3);
  assert.equal(await api.fetchConversation(stranger.c, conv), null);

  // A photo in the chat, then saved to Memories
  const [m] = await api.rpcCall(jess.c, 'create_media', { p_family: fam, p_kind: 'photo', p_mime: 'image/jpeg', p_bytes: 5000, p_width: 100, p_height: 100, p_duration_ms: null });
  const admin = await world.admin();
  await admin.query("insert into storage.objects (bucket_id, name, metadata) values ('family-media', $1, $2)", [m.storage_path, { size: 5000 }]);
  await api.rpcCall(jess.c, 'finalize_media', { p_media: m.media_id });
  const sent = await api.rpcCall(jess.c, 'send_message', { p_conversation: conv, p_body: 'Look!', p_client_id: randomUUID(), p_media: [m.media_id] });
  const latest = (await api.fetchMessagesPage(nana.c, conv, null))[0];
  assert.equal(latest.id, sent.id);
  assert.equal(latest.message_attachments[0].media.storage_path, m.storage_path);
  assert.equal((await api.fetchSharedMedia(dan.c, conv)).length, 1);
  assert.equal((await api.fetchSharedMedia(stranger.c, conv)).length, 0);
  assert.equal(await api.conversationIdForMessage(nana.c, sent.id), conv);
  assert.equal(await api.conversationIdForMessage(stranger.c, sent.id), null);

  const memId = await api.rpcCall(nana.c, 'add_memory', { p_media: m.media_id, p_caption: 'First smile', p_source_message: sent.id, p_taken_on: '2026-10-13' });
  const gallery = await api.fetchMemoriesPage(dan.c, fam, 0);
  assert.equal(gallery.length, 1);
  assert.equal(gallery[0].media.storage_path, m.storage_path);
  assert.equal((await api.fetchMemory(dan.c, memId)).caption, 'First smile');
  assert.equal(await api.fetchMemory(stranger.c, memId), null);
  await api.rpcCall(jess.c, 'update_memory', { p_memory: memId, p_caption: 'First smile', p_taken_on: null, p_visibility: 'parents_only' });
  // Nana added it, so she keeps seeing it; other helpers wouldn't (covered in the database tests).
  assert.equal((await api.fetchMemory(nana.c, memId)).visibility, 'parents_only');
  assert.equal(await api.fetchMemory(stranger.c, memId), null);
  assert.equal((await api.fetchMemoriesPage(dan.c, fam, 0)).length, 1);

  // Preferences: your own saves; anyone else's fails rather than pretending
  await api.updatePref(nana.c, nana.id, 'messages', false);
  assert.equal((await api.fetchPrefs(nana.c)).messages, false);
  await assert.rejects(api.updatePref(nana.c, jess.id, 'messages', false));
  assert.equal((await api.fetchPrefs(jess.c)).messages, true);

  // Signed-out requests get nothing
  const anon = clientFor(null);
  const { error: anonErr } = await anon.from('families').select('*');
  assert.ok(anonErr, 'anonymous read should be refused');
  const { error: anonRpc } = await anon.rpc('create_family', { p_name: 'x' });
  assert.ok(anonRpc);
});
