import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { freshDatabase, family, rejects, taskPayload, isoIn } from './_harness.mjs';

let world;
before(async () => { world = await freshDatabase('tasks'); });
after(async () => { await world.close(); });

test('a parent creates a help request; invitees see it and are notified', async () => {
  const { familyId, owner, helpers } = await family(world, 2);
  const id = await owner.rpcValue('create_task', { p_family: familyId, p: taskPayload() });
  for (const h of helpers) {
    const [t] = await h.q('select status, title from public.tasks where id = $1', [id]);
    assert.equal(t.status, 'open');
    const n = await h.q("select type, title from public.notifications where task_id = $1", [id]);
    assert.deepEqual(n.map((x) => x.type), ['task_request']);
  }
  // Creator sees it on their calendar.
  const cal = await owner.rpc('calendar_items', { p_from: isoIn(0), p_to: isoIn(24 * 7) });
  assert.equal(cal.filter((c) => c.id === id).length, 1);
  assert.equal(cal.find((c) => c.id === id).my_role, 'organiser');
});

test('helpers cannot create requests', async () => {
  const { familyId, helpers } = await family(world, 1);
  await rejects(helpers[0].rpc('create_task', { p_family: familyId, p: taskPayload() }), 'not_allowed');
});

test('validation: times, reply-by, title, timezone', async () => {
  const { familyId, owner } = await family(world, 1);
  await rejects(owner.rpc('create_task', { p_family: familyId, p: taskPayload({ starts_at: isoIn(5), ends_at: isoIn(4) }) }), 'invalid_time');
  await rejects(owner.rpc('create_task', { p_family: familyId, p: taskPayload({ respond_by: isoIn(100) }) }), 'invalid_respond_by');
  await rejects(owner.rpc('create_task', { p_family: familyId, p: taskPayload({ title: '  ' }) }), 'invalid_title');
  await rejects(owner.rpc('create_task', { p_family: familyId, p: taskPayload({ timezone: 'Nowhere/Land' }) }), 'invalid_timezone');
  await rejects(owner.rpc('create_task', { p_family: familyId, p: taskPayload({ starts_at: isoIn(-72), ends_at: isoIn(-70) }) }), 'in_the_past');
});

test('double-tapping submit creates exactly one task', async () => {
  const { familyId, owner } = await family(world, 1);
  const payload = taskPayload();
  const [a, b] = await Promise.all([
    owner.rpcValue('create_task', { p_family: familyId, p: payload }),
    owner.rpcValue('create_task', { p_family: familyId, p: payload }),
  ]).catch(async () => {
    // The unique (created_by, client_id) constraint may reject the racing insert;
    // a retry must then return the original.
    return [await owner.rpcValue('create_task', { p_family: familyId, p: payload }), null];
  });
  const again = await owner.rpcValue('create_task', { p_family: familyId, p: payload });
  assert.equal(again, a);
  if (b) assert.equal(b, a);
  const rows = await owner.q('select id from public.tasks where client_id = $1', [payload.client_id]);
  assert.equal(rows.length, 1);
});

test('choosing specific people: others in the family (except parents) cannot see it', async () => {
  const { familyId, owner, parent, helpers } = await family(world, 2);
  const id = await owner.rpcValue('create_task', { p_family: familyId, p: taskPayload({ invitees: [helpers[0].id] }) });
  assert.equal((await helpers[0].q('select id from public.tasks where id = $1', [id])).length, 1);
  assert.equal((await helpers[1].q('select id from public.tasks where id = $1', [id])).length, 0);
  assert.equal((await parent.q('select id from public.tasks where id = $1', [id])).length, 1, 'parents see family requests');
  await rejects(helpers[1].rpc('respond_to_task', { p_task: id, p_response: 'accepted' }), 'not_invited');
  const outsider = await world.createUser('Outsider');
  await rejects(owner.rpc('create_task', { p_family: familyId, p: taskPayload({ invitees: [outsider.id] }) }), 'invalid_invitees');
});

test('drafts are private until sent', async () => {
  const { familyId, owner, parent, helpers } = await family(world, 1);
  const id = await owner.rpcValue('create_task', { p_family: familyId, p: taskPayload(), p_send: false });
  assert.equal((await helpers[0].q('select id from public.tasks where id = $1', [id])).length, 0);
  assert.equal((await parent.q('select id from public.tasks where id = $1', [id])).length, 0);
  assert.equal((await helpers[0].q('select id from public.notifications where task_id = $1', [id])).length, 0);
  await rejects(helpers[0].rpc('respond_to_task', { p_task: id, p_response: 'accepted' }), 'task_closed');
  await owner.rpc('send_task', { p_task: id });
  assert.equal((await helpers[0].q('select id from public.tasks where id = $1', [id])).length, 1);
  assert.equal((await helpers[0].q('select id from public.notifications where task_id = $1', [id])).length, 1);
});

async function raceAccept(world, familyId, helpers, taskId) {
  // Each helper on their own connection, released at the same instant.
  const actors = await Promise.all(helpers.map((h) => world.as(h.id, h.name)));
  let release;
  const gate = new Promise((r) => { release = r; });
  const runs = actors.map(async (a) => { await gate; return (await a.rpc('respond_to_task', { p_task: taskId, p_response: 'accepted' }))[0]; });
  release();
  return Promise.all(runs);
}

test('single helper: when everyone accepts at once, exactly one wins', async () => {
  for (let round = 0; round < 5; round++) {
    const { familyId, owner, helpers } = await family(world, 8);
    const id = await owner.rpcValue('create_task', { p_family: familyId, p: taskPayload() });
    const results = await raceAccept(world, familyId, helpers, id);
    const winners = results.filter((r) => r.result === 'assigned');
    assert.equal(winners.length, 1, `round ${round}: ${JSON.stringify(results.map((r) => r.result))}`);
    assert.equal(results.filter((r) => r.result === 'already_filled').length, 7);
    const accepted = await owner.q("select user_id from public.task_responses where task_id = $1 and response = 'accepted'", [id]);
    assert.equal(accepted.length, 1);
    const [t] = await owner.q('select status from public.tasks where id = $1', [id]);
    assert.equal(t.status, 'confirmed');
    // Everyone else is told, accurately, that it's covered.
    const winnerId = accepted[0].user_id;
    for (const h of helpers.filter((h) => h.id !== winnerId)) {
      const n = await h.q("select type from public.notifications where task_id = $1 and type = 'task_filled'", [id]);
      assert.equal(n.length, 1);
      const view = await h.q('select status from public.tasks where id = $1', [id]);
      assert.equal(view[0].status, 'confirmed');
    }
  }
});

test('two helpers needed: exactly two win a six-way race', async () => {
  const { familyId, owner, helpers } = await family(world, 6);
  const id = await owner.rpcValue('create_task', { p_family: familyId, p: taskPayload({ helpers_needed: 2 }) });
  const results = await raceAccept(world, familyId, helpers, id);
  assert.equal(results.filter((r) => r.result === 'assigned').length, 2);
  assert.equal(results.filter((r) => r.result === 'already_filled').length, 4);
});

test('accepting twice is harmless; withdrawing reopens the task', async () => {
  const { familyId, owner, helpers } = await family(world, 2);
  const id = await owner.rpcValue('create_task', { p_family: familyId, p: taskPayload() });
  assert.equal((await helpers[0].rpc('respond_to_task', { p_task: id, p_response: 'accepted' }))[0].result, 'assigned');
  assert.equal((await helpers[0].rpc('respond_to_task', { p_task: id, p_response: 'accepted' }))[0].result, 'already_yours');
  assert.equal((await helpers[1].rpc('respond_to_task', { p_task: id, p_response: 'accepted' }))[0].result, 'already_filled');
  const w = (await helpers[0].rpc('respond_to_task', { p_task: id, p_response: 'declined' }))[0];
  assert.equal(w.result, 'withdrawn');
  assert.equal(w.task_status, 'open');
  assert.equal((await owner.q("select 1 from public.notifications where task_id = $1 and type = 'helper_withdrew'", [id])).length, 1);
  assert.equal((await helpers[1].rpc('respond_to_task', { p_task: id, p_response: 'accepted' }))[0].result, 'assigned');
});

test('declines are private to the person who asked', async () => {
  const { familyId, owner, parent, helpers } = await family(world, 2);
  const id = await owner.rpcValue('create_task', { p_family: familyId, p: taskPayload() });
  await helpers[0].rpc('respond_to_task', { p_task: id, p_response: 'declined' });
  assert.equal((await owner.q("select 1 from public.task_responses where task_id = $1 and response = 'declined'", [id])).length, 1);
  assert.equal((await parent.q("select 1 from public.task_responses where task_id = $1 and response = 'declined'", [id])).length, 0);
  assert.equal((await helpers[1].q("select 1 from public.task_responses where task_id = $1 and response = 'declined'", [id])).length, 0);
  assert.equal((await helpers[0].q("select 1 from public.task_responses where task_id = $1", [id])).length, 1, 'you can see your own reply');
  // No notification is sent for a decline.
  assert.equal((await owner.q("select 1 from public.notifications where task_id = $1", [id])).length, 0);
});

test('reply-by time is enforced on the server', async () => {
  const { familyId, owner, helpers } = await family(world, 1);
  const id = await owner.rpcValue('create_task', { p_family: familyId, p: taskPayload({ respond_by: isoIn(1) }) });
  const admin = await world.admin();
  await admin.query("update public.tasks set respond_by = now() - interval '1 minute' where id = $1", [id]);
  await rejects(helpers[0].rpc('respond_to_task', { p_task: id, p_response: 'accepted' }), 'response_closed');
});

test('group events: separate replies, attendance, calendar, edits and cancellation', async () => {
  const { familyId, owner, parent, helpers } = await family(world, 3);
  const [h1, h2, h3] = helpers;
  const id = await owner.rpcValue('create_task', {
    p_family: familyId,
    p: taskPayload({ kind: 'event', category: 'family_event', title: "Poppy's birthday picnic", location: 'New Farm Park' }),
  });
  await h1.rpc('respond_to_task', { p_task: id, p_response: 'accepted' });
  await h2.rpc('respond_to_task', { p_task: id, p_response: 'tentative' });
  await h3.rpc('respond_to_task', { p_task: id, p_response: 'declined' });
  await h1.rpc('respond_to_task', { p_task: id, p_response: 'accepted' }); // repeat is fine

  const att = await owner.q('select user_id, response from public.task_responses where task_id = $1 order by response', [id]);
  assert.deepEqual(att.map((a) => a.response).sort(), ['accepted', 'declined', 'tentative']);

  const calFor = async (who) => (await who.rpc('calendar_items', { p_from: isoIn(0), p_to: isoIn(24 * 7) })).filter((c) => c.id === id);
  assert.equal((await calFor(h1)).length, 1);
  assert.equal((await calFor(h1))[0].my_role, 'attendee');
  assert.equal((await calFor(h2)).length, 1);
  assert.equal((await calFor(h2))[0].my_role, 'attendee', 'maybe still shows as an attendee');
  assert.equal((await calFor(h3)).length, 0, 'declined: not on your calendar');
  assert.equal((await calFor(parent)).length, 1, 'parent was invited and has not replied');

  // Edit with a stale version is refused; correct version notifies everyone except decliners.
  const [{ version }] = await owner.q('select version from public.tasks where id = $1', [id]);
  await rejects(owner.rpc('update_task', { p_task: id, p: taskPayload({ kind: 'event', category: 'family_event', title: 'x' }), p_expected_version: version - 1 }), 'version_conflict');
  await rejects(h1.rpc('update_task', { p_task: id, p: taskPayload({ kind: 'event', category: 'family_event' }), p_expected_version: version }), 'not_found');
  const newStart = isoIn(72);
  await owner.rpc('update_task', {
    p_task: id,
    p: taskPayload({ kind: 'event', category: 'family_event', title: "Poppy's birthday picnic", location: 'New Farm Park', starts_at: newStart, ends_at: isoIn(75) }),
    p_expected_version: version,
  });
  for (const [who, expected] of [[h1, 1], [h2, 1], [h3, 0], [parent, 1]]) {
    const n = await who.q("select 1 from public.notifications where task_id = $1 and type = 'task_changed'", [id]);
    assert.equal(n.length, expected);
  }
  const [moved] = await calFor(h1);
  assert.equal(new Date(moved.starts_at).toISOString(), newStart);

  await owner.rpc('cancel_task', { p_task: id, p_reason: 'Rain' });
  assert.equal((await h1.q("select 1 from public.notifications where task_id = $1 and type = 'task_cancelled'", [id])).length, 1);
  assert.equal((await h3.q("select 1 from public.notifications where task_id = $1 and type = 'task_cancelled'", [id])).length, 0);
  await rejects(h2.rpc('respond_to_task', { p_task: id, p_response: 'accepted' }), 'task_closed');
  await rejects(owner.rpc('cancel_task', { p_task: id }), 'task_closed');
  const [c] = await calFor(h1);
  assert.equal(c.status, 'cancelled', 'cancelled events stay visible, clearly marked');
});

test('the calendar never lists a task twice', async () => {
  const { familyId, owner, helpers } = await family(world, 2);
  for (let i = 0; i < 3; i++) {
    const id = await owner.rpcValue('create_task', { p_family: familyId, p: taskPayload({ kind: 'event', category: 'family_event' }) });
    await helpers[0].rpc('respond_to_task', { p_task: id, p_response: 'accepted' });
  }
  for (const who of [owner, helpers[0]]) {
    for (const scope of ['mine', 'family']) {
      const items = await who.rpc('calendar_items', { p_from: isoIn(0), p_to: isoIn(24 * 30), p_scope: scope });
      assert.equal(new Set(items.map((i) => i.id)).size, items.length);
    }
  }
});

test('a filled request leaves the calendars of people who were not chosen', async () => {
  const { familyId, owner, helpers } = await family(world, 2);
  const id = await owner.rpcValue('create_task', { p_family: familyId, p: taskPayload() });
  const has = async (who) => (await who.rpc('calendar_items', { p_from: isoIn(0), p_to: isoIn(24 * 7) })).some((c) => c.id === id);
  assert.ok(await has(helpers[1]));
  await helpers[0].rpc('respond_to_task', { p_task: id, p_response: 'accepted' });
  assert.ok(await has(helpers[0]));
  assert.ok(!(await has(helpers[1])));
});

test('completing a request records who helped', async () => {
  const { familyId, owner, helpers } = await family(world, 1);
  const id = await owner.rpcValue('create_task', { p_family: familyId, p: taskPayload() });
  await rejects(owner.rpc('complete_task', { p_task: id }), 'task_not_confirmed');
  await helpers[0].rpc('respond_to_task', { p_task: id, p_response: 'accepted' });
  await rejects(helpers[0].rpc('complete_task', { p_task: id }), 'not_found');
  await owner.rpc('complete_task', { p_task: id });
  const [m] = await owner.q('select last_helped_at from public.family_members where user_id = $1', [helpers[0].id]);
  assert.ok(m.last_helped_at);
});

test('removing a helper who had accepted hands the task back', async () => {
  const { familyId, owner, helpers } = await family(world, 2);
  const id = await owner.rpcValue('create_task', { p_family: familyId, p: taskPayload() });
  await helpers[0].rpc('respond_to_task', { p_task: id, p_response: 'accepted' });
  await owner.rpc('remove_member', { p_family: familyId, p_user: helpers[0].id });
  const [t] = await owner.q('select status from public.tasks where id = $1', [id]);
  assert.equal(t.status, 'open');
  assert.equal((await helpers[0].q('select 1 from public.tasks where id = $1', [id])).length, 0);
  assert.equal((await helpers[1].rpc('respond_to_task', { p_task: id, p_response: 'accepted' }))[0].result, 'assigned');
});

test('scheduled reminders are sent once', async () => {
  const { familyId, owner, helpers } = await family(world, 1);
  const id = await owner.rpcValue('create_task', { p_family: familyId, p: taskPayload({ starts_at: isoIn(1), ends_at: isoIn(2) }) });
  await helpers[0].rpc('respond_to_task', { p_task: id, p_response: 'accepted' });
  const admin = await world.admin();
  await admin.query('select private.run_scheduled_notifications()');
  await admin.query('select private.run_scheduled_notifications()');
  const n = await admin.query("select user_id from public.notifications where task_id = $1 and type = 'reminder'", [id]);
  assert.equal(n.rowCount, 2, 'organiser + helper, once each');
  await rejects(helpers[0].q('select private.run_scheduled_notifications()'), 'permission denied');
});
