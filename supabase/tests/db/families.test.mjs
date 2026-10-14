import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshDatabase, family, rejects } from './_harness.mjs';

let world;
before(async () => { world = await freshDatabase('families'); });
after(async () => { await world.close(); });

test('sign-up creates a profile and notification preferences', async () => {
  const u = await world.createUser('Nana Rose');
  const [p] = await u.q('select display_name, timezone from public.profiles where id = $1', [u.id]);
  assert.equal(p.display_name, 'Nana Rose');
  assert.equal(p.timezone, 'Australia/Brisbane');
  const prefs = await u.q('select * from public.notification_prefs');
  assert.equal(prefs.length, 1);
});

test('profile update validates name and timezone', async () => {
  const u = await world.createUser('Sam');
  await u.rpc('update_profile', { p_display_name: 'Sam P', p_timezone: 'Europe/London' });
  await rejects(u.rpc('update_profile', { p_display_name: 'Sam', p_timezone: 'Mars/Base' }), 'invalid_timezone');
  await rejects(u.rpc('update_profile', { p_display_name: '   ', p_timezone: 'Europe/London' }), 'invalid_name');
});

test('outsiders cannot see a family, its members or their profiles', async () => {
  const { familyId, owner } = await family(world, 1);
  const outsider = await world.createUser('Stranger');
  assert.equal((await outsider.q('select * from public.families where id = $1', [familyId])).length, 0);
  assert.equal((await outsider.q('select * from public.family_members where family_id = $1', [familyId])).length, 0);
  assert.equal((await outsider.q('select * from public.profiles where id = $1', [owner.id])).length, 0);
  // But members can see each other.
  assert.equal((await owner.q('select * from public.family_members where family_id = $1', [familyId])).length, 3);
});

test('clients cannot write to tables directly', async () => {
  const { familyId, helpers } = await family(world, 1);
  const h = helpers[0];
  await rejects(h.q("insert into public.family_members (family_id, user_id, role) values ($1, $2, 'owner')", [familyId, h.id]), 'permission denied');
  await rejects(h.q("update public.family_members set role = 'owner' where user_id = $1", [h.id]), 'permission denied');
  await rejects(h.q('delete from public.families where id = $1', [familyId]), 'permission denied');
  await rejects(h.q("insert into public.tasks (family_id, kind, category, title, starts_at, ends_at) values ($1,'help','meals','x',now(),now())", [familyId]), 'permission denied');
  await rejects(h.q("update public.profiles set display_name = 'hacked'"), 'permission denied');
});

test('invitation lifecycle: preview, accept once, no reuse', async () => {
  const { familyId, owner } = await family(world, 0);
  const [inv] = await owner.rpc('create_invitation', { p_family: familyId, p_role: 'helper' });
  assert.match(inv.token, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/, 'a short code with no look-alike characters');

  const grandma = await world.createUser('Grandma');
  const [pv] = await grandma.rpc('preview_invitation', { p_token: inv.token });
  assert.equal(pv.state, 'valid');
  assert.equal(pv.family_name, 'The Parkers');
  assert.equal(pv.invited_by_name, 'Jess');

  // Previewing doesn't grant access.
  assert.equal((await grandma.q('select * from public.families')).length, 0);

  assert.equal(await grandma.rpcValue('accept_invitation', { p_token: inv.token, p_relation_label: 'Nana' }), familyId);
  const [m] = await grandma.q('select role, relation_label from public.family_members where user_id = $1', [grandma.id]);
  assert.deepEqual(m, { role: 'helper', relation_label: 'Nana' });

  const someoneElse = await world.createUser('Forwarded');
  await rejects(someoneElse.rpc('accept_invitation', { p_token: inv.token }), 'invite_used');
  const [pv2] = await someoneElse.rpc('preview_invitation', { p_token: inv.token });
  assert.equal(pv2.state, 'used');
  assert.equal(pv2.family_name, null, 'a used invite should not reveal the family name');
});

test('expired, revoked, declined and made-up invitations are refused', async () => {
  const { familyId, owner } = await family(world, 0);
  const admin = await world.admin();
  const u = await world.createUser('Late');

  const [expired] = await owner.rpc('create_invitation', { p_family: familyId });
  await admin.query("update public.invitations set expires_at = now() - interval '1 minute' where id = $1", [expired.invitation_id]);
  await rejects(u.rpc('accept_invitation', { p_token: expired.token }), 'invite_expired');

  const [revoked] = await owner.rpc('create_invitation', { p_family: familyId });
  await owner.rpc('revoke_invitation', { p_invitation: revoked.invitation_id });
  await rejects(u.rpc('accept_invitation', { p_token: revoked.token }), 'invite_revoked');

  const [declined] = await owner.rpc('create_invitation', { p_family: familyId });
  await u.rpc('decline_invitation', { p_token: declined.token });
  await rejects(u.rpc('accept_invitation', { p_token: declined.token }), 'invite_declined');

  // A made-up code returns null (so the wrong guess is still counted).
  assert.equal(await u.rpcValue('accept_invitation', { p_token: 'not-a-real-token' }), null);
  assert.equal((await u.q('select * from public.family_members where family_id = $1', [familyId])).length, 0);
});

test('codes are forgiving to type: any case, spaces and dashes', async () => {
  const { familyId, owner } = await family(world, 0);
  const [inv] = await owner.rpc('create_invitation', { p_family: familyId });
  const typed = ` ${inv.token.slice(0, 4).toLowerCase()} - ${inv.token.slice(4)} `;
  const u = await world.createUser('Uncle Tom');
  const [pv] = await u.rpc('preview_invitation', { p_token: typed });
  assert.equal(pv.state, 'valid');
  assert.equal(await u.rpcValue('accept_invitation', { p_token: typed }), familyId);
});

test('older long invite links still work', async () => {
  const { familyId, owner } = await family(world, 0);
  const admin = await world.admin();
  const legacy = 'Ab3_xY-' + 'q'.repeat(36);
  await admin.query(
    "insert into public.invitations (family_id, invited_by, token_hash, expires_at) values ($1, $2, encode(extensions.digest($3, 'sha256'), 'hex'), now() + interval '1 day')",
    [familyId, owner.id, legacy]);
  const u = await world.createUser('Old Link');
  assert.equal(await u.rpcValue('accept_invitation', { p_token: legacy }), familyId);
});

test('guessing codes is cut off after 10 wrong tries an hour', async () => {
  const { familyId, owner } = await family(world, 0);
  const [inv] = await owner.rpc('create_invitation', { p_family: familyId });
  const guesser = await world.createUser('Guesser');
  for (let i = 0; i < 6; i++) await guesser.rpc('preview_invitation', { p_token: `WRONG${i}AA` });
  for (let i = 0; i < 4; i++) assert.equal(await guesser.rpcValue('accept_invitation', { p_token: `NOPE${i}AAA` }), null);
  // Even the right code is refused now, so guessing can't continue.
  await rejects(guesser.rpc('preview_invitation', { p_token: inv.token }), 'too_many_attempts');
  await rejects(guesser.rpc('accept_invitation', { p_token: inv.token }), 'too_many_attempts');
  // Other people are unaffected.
  const friend = await world.createUser('Friend');
  assert.equal(await friend.rpcValue('accept_invitation', { p_token: inv.token }), familyId);
  // Nobody can read or clear the attempt log.
  await rejects(guesser.q('delete from private.invite_attempts'), 'permission denied');
});

test('only parents can invite, and nobody can read token hashes', async () => {
  const { familyId, helpers, parent } = await family(world, 1);
  await rejects(helpers[0].rpc('create_invitation', { p_family: familyId }), 'not_allowed');
  await rejects(parent.rpc('create_invitation', { p_family: familyId, p_role: 'owner' }), 'invalid_input');
  await parent.rpc('create_invitation', { p_family: familyId, p_role: 'parent' });
  await rejects(parent.q('select token_hash from public.invitations'), 'permission denied');
  assert.ok((await parent.q('select id, role from public.invitations')).length >= 1);
  assert.equal((await helpers[0].q('select id from public.invitations')).length, 0, 'helpers cannot list invitations');
  const outsider = await world.createUser('Outsider');
  await rejects(outsider.rpc('create_invitation', { p_family: familyId }), 'not_member');
});

test('accepting twice or joining a family you are in is refused', async () => {
  const { familyId, owner, helpers } = await family(world, 1);
  const [inv] = await owner.rpc('create_invitation', { p_family: familyId });
  await rejects(helpers[0].rpc('accept_invitation', { p_token: inv.token }), 'already_member');
});

test('removed members lose access immediately', async () => {
  const { familyId, owner, parent, helpers } = await family(world, 2);
  const [h1, h2] = helpers;
  const conv = await h1.rpcValue('create_conversation', { p_family: familyId, p_members: [owner.id] });
  await owner.rpc('send_message', { p_conversation: conv, p_body: 'hello', p_client_id: crypto.randomUUID() });

  // A parent can't remove the owner or another parent; can remove a helper.
  await rejects(parent.rpc('remove_member', { p_family: familyId, p_user: owner.id }), 'not_allowed');
  await rejects(h2.rpc('remove_member', { p_family: familyId, p_user: h1.id }), 'not_allowed');
  await parent.rpc('remove_member', { p_family: familyId, p_user: h1.id });

  assert.equal((await h1.q('select * from public.families')).length, 0);
  assert.equal((await h1.q('select * from public.messages')).length, 0);
  assert.equal((await h1.q('select * from public.conversations')).length, 0);
  await rejects(h1.rpc('send_message', { p_conversation: conv, p_body: 'still here?', p_client_id: crypto.randomUUID() }), 'not_found');
  await rejects(h1.rpc('create_invitation', { p_family: familyId }), 'not_member');
});

test('owners: roles, last-owner protection, leaving', async () => {
  const { familyId, owner, parent, helpers } = await family(world, 1);
  await rejects(parent.rpc('set_member_role', { p_family: familyId, p_user: helpers[0].id, p_role: 'parent' }), 'not_allowed');
  await owner.rpc('set_member_role', { p_family: familyId, p_user: helpers[0].id, p_role: 'parent' });
  await rejects(owner.rpc('set_member_role', { p_family: familyId, p_user: owner.id, p_role: 'parent' }), 'last_owner');
  await rejects(owner.rpc('leave_family', { p_family: familyId }), 'last_owner');

  await helpers[0].rpc('leave_family', { p_family: familyId });
  assert.equal((await helpers[0].q('select * from public.families')).length, 0);

  await owner.rpc('set_member_role', { p_family: familyId, p_user: parent.id, p_role: 'owner' });
  await owner.rpc('leave_family', { p_family: familyId });
  const remaining = await parent.q('select user_id, role from public.family_members where family_id = $1', [familyId]);
  assert.deepEqual(remaining.map((r) => r.role), ['owner']);
});

test('sole member leaving deletes the family', async () => {
  const solo = await world.createUser('Solo');
  const fam = await solo.rpcValue('create_family', { p_name: 'Just me' });
  await solo.rpc('leave_family', { p_family: fam });
  const admin = await world.admin();
  assert.equal((await admin.query('select 1 from public.families where id = $1', [fam])).rowCount, 0);
});

test('anonymous callers can do nothing', async () => {
  const c = await world.connect();
  await c.query('set role anon');
  await assert.rejects(c.query('select * from public.families'), /permission denied/);
  await assert.rejects(c.query("select public.create_family('x')"), /permission denied/);
});
