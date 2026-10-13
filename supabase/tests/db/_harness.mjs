// Test harness: builds a fresh database from the Supabase stubs + Robin's real
// migrations, and gives each test "user" their own connection with Supabase's
// authenticated role and JWT claims, exactly as PostgREST would.
import pg from 'pg';
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const PGHOST = process.env.PGHOST ?? '/tmp';
const PGPORT = process.env.PGPORT ?? '54322';
const PGUSER = process.env.PGUSER ?? 'postgres';

function psql(db, args) {
  execFileSync('psql', ['-h', PGHOST, '-p', PGPORT, '-U', PGUSER, '-v', 'ON_ERROR_STOP=1', '-q', '-d', db, ...args], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
}

export async function freshDatabase(name) {
  const db = `robin_${name}`;
  psql('postgres', ['-c', `drop database if exists ${db} with (force)`, '-c', `create database ${db}`]);
  psql(db, ['-f', path.join(root, 'tests/supabase_stubs.sql')]);
  for (const f of readdirSync(path.join(root, 'migrations')).sort()) {
    psql(db, ['-f', path.join(root, 'migrations', f)]);
  }
  return new World(db);
}

export class World {
  constructor(db) {
    this.db = db;
    this.clients = [];
  }
  async connect() {
    const c = new pg.Client({ host: PGHOST, port: Number(PGPORT), user: PGUSER, database: this.db });
    await c.connect();
    this.clients.push(c);
    return c;
  }
  async admin() {
    if (!this._admin) this._admin = await this.connect();
    return this._admin;
  }
  async createUser(displayName) {
    const a = await this.admin();
    const id = randomUUID();
    await a.query('insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)', [
      id, `${displayName.toLowerCase().replace(/\W/g, '')}.${id.slice(0, 6)}@example.com`, { display_name: displayName },
    ]);
    return this.as(id, displayName);
  }
  // A fresh connection acting as the given user.
  async as(id, name = 'user') {
    const c = await this.connect();
    await c.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: id, role: 'authenticated' })]);
    await c.query('set role authenticated');
    return new Actor(c, id, name);
  }
  async serviceRole() {
    const c = await this.connect();
    await c.query('set role service_role');
    return new Actor(c, null, 'service');
  }
  async close() {
    await Promise.all(this.clients.map((c) => c.end().catch(() => {})));
  }
}

export class Actor {
  constructor(client, id, name) {
    this.client = client;
    this.id = id;
    this.name = name;
  }
  async q(sql, params = []) {
    return (await this.client.query(sql, params)).rows;
  }
  // Calls a public function with named arguments, like supabase.rpc(name, args).
  async rpc(fn, args = {}) {
    const keys = Object.keys(args);
    const sql = `select * from public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')})`;
    const rows = await this.q(sql, keys.map((k) => args[k]));
    return rows;
  }
  async rpcValue(fn, args = {}) {
    const rows = await this.rpc(fn, args);
    return rows[0] ? Object.values(rows[0])[0] : undefined;
  }
}

export async function rejects(promise, code) {
  try {
    await promise;
  } catch (e) {
    if (code && !String(e.message).includes(code)) {
      throw new Error(`Expected error containing "${code}" but got "${e.message}"`);
    }
    return e;
  }
  throw new Error(`Expected an error${code ? ` (${code})` : ''} but the call succeeded`);
}

export function isoIn(hours) {
  return new Date(Date.now() + hours * 3600_000).toISOString();
}

export function taskPayload(overrides = {}) {
  return {
    kind: 'help', category: 'childcare', title: 'Mind Poppy for the morning',
    starts_at: isoIn(48), ends_at: isoIn(51), all_day: false, timezone: 'Australia/Brisbane',
    helpers_needed: 1, invitees: null, client_id: randomUUID(), ...overrides,
  };
}

// Builds a family: owner (parent), a second parent, and some helpers.
export async function family(world, helperCount = 3) {
  const owner = await world.createUser('Jess');
  const familyId = await owner.rpcValue('create_family', { p_name: 'The Parkers' });
  const join = async (name, role) => {
    const u = await world.createUser(name);
    const [inv] = await owner.rpc('create_invitation', { p_family: familyId, p_role: role });
    await u.rpcValue('accept_invitation', { p_token: inv.token });
    return u;
  };
  const parent = await join('Dan', 'parent');
  const helpers = [];
  for (let i = 0; i < helperCount; i++) helpers.push(await join(`Helper${i + 1}`, 'helper'));
  return { familyId, owner, parent, helpers };
}
