// Creates the private Jones demo family in your Supabase project, for recording
// a walkthrough video. Everyone signs in with the same demo password.
//
//   SUPABASE_SECRET_KEY=sb_secret_... node --env-file=.env scripts/seed-jones.mjs
//
// The secret key is only used here, on the codespace, to create the demo
// accounts. It never goes into the app. Nobody outside the Jones family can see
// anything in it, just like any other family in Robin.
import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
import { buildJones, FAMILY_NAME, PEOPLE } from './jones-scenario.mjs';

const URL_ = process.env.EXPO_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const PUBLIC_KEY = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
const SECRET = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !PUBLIC_KEY || !SECRET) {
  console.error('Missing settings. Run it like this:\n  SUPABASE_SECRET_KEY=sb_secret_... node --env-file=.env scripts/seed-jones.mjs');
  process.exit(1);
}

const BASE_EMAIL = process.env.DEMO_EMAIL ?? 'robin.babytracker@gmail.com';
const [local, domain] = BASE_EMAIL.split('@');
const emailFor = (key) => `${local}+jones-${key}@${domain}`;
const PASSWORD = process.env.DEMO_PASSWORD ?? `Jones-${randomBytes(4).toString('hex')}`;

const admin = createClient(URL_, SECRET, { auth: { persistSession: false, autoRefreshToken: false } });

async function findUser(email) {
  for (let page = 1; page < 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const u = data.users.find((x) => x.email === email);
    if (u || data.users.length < 200) return u ?? null;
  }
  return null;
}

async function signIn(key, name) {
  const email = emailFor(key);
  const existing = await findUser(email);
  if (existing) {
    const { error } = await admin.auth.admin.updateUserById(existing.id, { password: PASSWORD, email_confirm: true });
    if (error) throw error;
  } else {
    const { error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true, user_metadata: { display_name: name } });
    if (error) throw error;
  }
  const c = createClient(URL_, PUBLIC_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await c.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`${name}: ${error.message}`);
  return {
    id: data.user.id,
    c,
    async call(fn, args) {
      const { data: out, error: e } = await c.rpc(fn, args);
      if (e) throw new Error(`${name} → ${fn}: ${e.message}`);
      return out;
    },
  };
}

console.log('Creating the Jones family…');
const p = {};
for (const [key, name] of PEOPLE) p[key] = await signIn(key, name);

const { data: already } = await p.sarah.c.from('families').select('id, name').eq('name', FAMILY_NAME);
if (already?.length) {
  console.log(`\nThe Jones family already exists, so nothing new was added.\nPasswords were reset to: ${PASSWORD}`);
} else {
  await buildJones(p);
  console.log('\nDone! The Jones family is ready.');
}
console.log(`\nSign in with password: ${PASSWORD}`);
for (const [key, name, role, label] of PEOPLE) console.log(`  ${label.padEnd(13)} ${name.padEnd(12)} ${emailFor(key)}`);
console.log('\nTip: record as Sarah (Mum) for the parent view, and Mary (Nanna) for the helper view.');
