import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshDatabase } from './_harness.mjs';
import { buildJones, PEOPLE } from '../../../scripts/jones-scenario.mjs';

let world;
before(async () => { world = await freshDatabase('demo'); });
after(async () => { await world.close(); });

test('the Jones demo family builds within the normal rules', async () => {
  const p = {};
  for (const [key, name] of PEOPLE) {
    const u = await world.createUser(name);
    p[key] = { id: u.id, call: async (fn, args) => (['create_invitation', 'respond_to_task'].includes(fn) ? u.rpc(fn, args) : u.rpcValue(fn, args)), u };
  }
  const { familyId } = await buildJones(p);
  const members = await p.sarah.u.q('select role, relation_label from public.family_members where family_id = $1', [familyId]);
  assert.equal(members.length, 12);
  assert.ok(members.some((m) => m.relation_label === 'Nanna'));
  const tasks = await p.sarah.u.q('select title, status from public.tasks where family_id = $1 order by starts_at', [familyId]);
  assert.equal(tasks.length, 6);
  assert.equal(tasks.find((t) => t.title.startsWith('Cook')).status, 'confirmed');
  // Friends see only the chats they're in.
  const lizzyChats = await p.lizzy.u.q('select name from public.conversations');
  assert.deepEqual(lizzyChats.map((c) => c.name), ['Mums & bubs crew']);
  // Outsiders see nothing.
  const outsider = await world.createUser('Stranger');
  assert.equal((await outsider.q('select * from public.families')).length, 0);
});
