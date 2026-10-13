// Creates a clearly-labelled DEMO family in a DEVELOPMENT Supabase project, so
// you can click around with realistic content. Demo people use @demo.invalid
// email addresses and the family is named "Demo · The Parkers".
//
// Never run this against your live project. It refuses unless you opt in:
//   ROBIN_ALLOW_DEMO=1 SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... SUPABASE_ANON_KEY=... node scripts/seed-demo.mjs
//
// It goes through the same checked database functions as the app, signed in as
// each demo person, so the demo data obeys every rule real data does.
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY, ROBIN_ALLOW_DEMO } = process.env;
if (ROBIN_ALLOW_DEMO !== '1') {
  console.error('Refusing to run: set ROBIN_ALLOW_DEMO=1, and only point this at a development project.');
  process.exit(1);
}
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
  console.error('Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ANON_KEY.');
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const PASSWORD = `Demo-${randomUUID().slice(0, 8)}!`;

async function person(name) {
  const email = `${name.toLowerCase().replace(/\W/g, '')}@demo.invalid`;
  const { error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true, user_metadata: { display_name: name } });
  if (error && !/already/i.test(error.message)) throw error;
  if (error) await admin.auth.admin.updateUserById((await findUser(email)).id, { password: PASSWORD });
  const c = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data, error: e2 } = await c.auth.signInWithPassword({ email, password: PASSWORD });
  if (e2) throw e2;
  return { c, id: data.user.id, email };
}
async function findUser(email) {
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  return data.users.find((u) => u.email === email);
}
async function rpc(who, fn, args) {
  const { data, error } = await who.c.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data;
}
const at = (days, hour) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour - 10, 0, 0, 0); // Brisbane wall time
  return d.toISOString();
};

const jess = await person('Jess Parker');
const dan = await person('Dan Parker');
const nana = await person('Rose');
const sarah = await person('Sarah Johnson');

const fam = await rpc(jess, 'create_family', { p_name: 'Demo · The Parkers', p_relation_label: 'Mum' });
for (const [p, role, label] of [[dan, 'parent', 'Dad'], [nana, 'helper', 'Nana'], [sarah, 'helper', 'Aunty Sarah']]) {
  const [inv] = await rpc(jess, 'create_invitation', { p_family: fam, p_role: role });
  await rpc(p, 'accept_invitation', { p_token: inv.token, p_relation_label: label });
}

const base = { all_day: false, timezone: 'Australia/Brisbane', links: [], description: '', notes: '', location: '' };
const babysit = await rpc(jess, 'create_task', { p_family: fam, p_send: true, p: { ...base, kind: 'help', category: 'childcare', title: 'Afternoon babysitting', starts_at: at(1, 14), ends_at: at(1, 17), helpers_needed: 1, invitees: null, client_id: randomUUID() } });
await rpc(sarah, 'respond_to_task', { p_task: babysit, p_response: 'accepted' });
await rpc(jess, 'create_task', { p_family: fam, p_send: true, p: { ...base, kind: 'help', category: 'errands', title: 'Groceries pick-up', starts_at: at(3, 11), ends_at: at(3, 12), respond_by: at(2, 18), helpers_needed: 1, invitees: null, client_id: randomUUID() } });
const picnic = await rpc(dan, 'create_task', { p_family: fam, p_send: true, p: { ...base, kind: 'event', category: 'family_event', title: "Poppy's first birthday picnic", location: 'New Farm Park', starts_at: at(13, 11), ends_at: at(13, 14), invitees: null, client_id: randomUUID() } });
await rpc(nana, 'respond_to_task', { p_task: picnic, p_response: 'accepted' });

const group = await rpc(jess, 'create_conversation', { p_family: fam, p_members: [dan.id, nana.id, sarah.id], p_name: 'Family Group' });
await rpc(dan, 'send_message', { p_conversation: group, p_body: '6pm works for us', p_client_id: randomUUID(), p_media: [] });
const dm = await rpc(sarah, 'create_conversation', { p_family: fam, p_members: [jess.id] });
await rpc(sarah, 'send_message', { p_conversation: dm, p_body: 'Let me know if you need me this week', p_client_id: randomUUID(), p_media: [] });

console.log(`Demo family ready. Sign in as ${jess.email} (or dan/rose/sarahjohnson@demo.invalid) with password: ${PASSWORD}`);
