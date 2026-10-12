/*
 * staff-users Edge Function tests — the real function code, bundled with esbuild and run in
 * Node with stand-ins for Deno and Supabase (no network, no production). Checks who may do
 * what, password rules, and the old-login migration's validation.
 */
import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const fnDir = join(here, '..', '..', 'functions');
let passed = 0, failed = 0;
const ok = (c, m) => { if (c) { passed++; console.log('  ✓', m); } else { failed++; console.log('  ✗', m); } };

// ── Fake Supabase ────────────────────────────────────────────────────────────
const SERVICE_KEY = 'service-role-key', ANON_KEY = 'anon-key';
const world = {
  authUsers: [],            // { id, email, password, app_metadata, user_metadata, banned_until }
  tokens: {},               // access token → user id
  tables: { owners: [], users: [] },
};
let seq = 0;
const addAuth = (email, password, app_metadata, token) => {
  const u = { id: 'id' + ++seq, email, password, app_metadata, user_metadata: {}, banned_until: null };
  world.authUsers.push(u); if (token) world.tokens[token] = u.id; return u;
};
const clone = (u) => u && JSON.parse(JSON.stringify(u));
globalThis.__fakeCreateClient = (url, key) => ({
  auth: {
    getUser: async (token) => {
      const u = world.authUsers.find((x) => x.id === world.tokens[token]);
      return u ? { data: { user: clone(u) }, error: null } : { data: { user: null }, error: { message: 'bad jwt' } };
    },
    signInWithPassword: async ({ email, password }) => {
      const u = world.authUsers.find((x) => x.email === email && x.password === password);
      return u ? { data: { user: clone(u) }, error: null } : { data: {}, error: { message: 'Invalid login credentials' } };
    },
    admin: {
      listUsers: async () => ({ data: { users: world.authUsers.map(clone) }, error: null }),
      getUserById: async (id) => { const u = world.authUsers.find((x) => x.id === id); return { data: { user: clone(u) ?? null }, error: u ? null : { message: 'not found' } }; },
      createUser: async ({ email, password, app_metadata, user_metadata }) => {
        if (key !== SERVICE_KEY) return { data: null, error: { message: 'not allowed' } };
        if (world.authUsers.some((x) => x.email === email)) return { data: null, error: { message: 'already registered' } };
        const u = addAuth(email, password, JSON.parse(JSON.stringify(app_metadata)));
        u.user_metadata = user_metadata ?? {};
        return { data: { user: clone(u) }, error: null };
      },
      updateUserById: async (id, patch) => {
        const u = world.authUsers.find((x) => x.id === id);
        if (patch.password) u.password = patch.password;
        if (patch.app_metadata) u.app_metadata = JSON.parse(JSON.stringify(patch.app_metadata));
        if (patch.ban_duration) u.banned_until = patch.ban_duration === 'none' ? null : '2999-01-01T00:00:00Z';
        return { data: { user: clone(u) }, error: null };
      },
      deleteUser: async (id) => { world.authUsers = world.authUsers.filter((x) => x.id !== id); return { error: null }; },
    },
  },
  from: (table) => {
    const q = { _rows: () => world.tables[table] ?? [], _filter: null };
    q.select = () => q;
    q.eq = (col, val) => { q._filter = (r) => r[col] === val; return q; };
    q.maybeSingle = async () => ({ data: q._rows().find(q._filter ?? (() => true)) ?? null, error: null });
    q.then = (res) => res({ data: q._rows().filter(q._filter ?? (() => true)), error: null });
    return q;
  },
});
globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, SUPABASE_ANON_KEY: ANON_KEY })[k] } };
globalThis.__serve = null;

// ── Bundle the real function with the fakes swapped in ───────────────────────
const out = join(mkdtempSync(join(tmpdir(), 'staffusers-')), 'fn.mjs');
await build({
  entryPoints: [join(fnDir, 'staff-users', 'index.ts')], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error',
  plugins: [{ name: 'fakes', setup(b) {
    b.onResolve({ filter: /^https:\/\/deno\.land\/std.*\/http\/server\.ts$/ }, () => ({ path: 'serve', namespace: 'fake' }));
    b.onResolve({ filter: /^https:\/\/esm\.sh\/@supabase\/supabase-js/ }, () => ({ path: 'supabase', namespace: 'fake' }));
    b.onLoad({ filter: /^serve$/, namespace: 'fake' }, () => ({ contents: 'export const serve = (h) => { globalThis.__serve = h; };' }));
    b.onLoad({ filter: /^supabase$/, namespace: 'fake' }, () => ({ contents: 'export const createClient = (...a) => globalThis.__fakeCreateClient(...a);' }));
  } }],
});
await import(pathToFileURL(out).href);
const handler = globalThis.__serve;
const call = async (token, body) => {
  const res = await handler(new Request('https://x/functions/v1/staff-users', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  }));
  return { status: res.status, body: await res.json() };
};

// ── People ───────────────────────────────────────────────────────────────────
world.tables.owners = [{ id: 'oA', name: 'Alice' }, { id: 'oB', name: 'Bob' }, { id: 'oC', name: 'Carol' }, { id: 'oD', name: 'Dan' }];
const admin = addAuth('admin@staff.ceylonrentacars.com', 'AdminPass123', { role: 'admin', username: 'admin' }, 'tok-admin');
const ownerA = addAuth('alice@staff.ceylonrentacars.com', 'AlicePass123', { role: 'owner', owner_id: 'oA', username: 'alice' }, 'tok-A');
const customer = addAuth('cust@example.com', 'whatever123', {}, 'tok-customer');

console.log('\nWHO MAY CALL IT');
ok((await call(null, { action: 'list' })).status === 401, 'no login → 401');
ok((await call(ANON_KEY, { action: 'list' })).status === 401, 'website (public) key → 401');
ok((await call(SERVICE_KEY, { action: 'list' })).status === 401, 'service-role key → 401 (only real signed-in staff)');
ok((await call('tok-customer', { action: 'list' })).status === 401, 'signed-in non-staff (customer) → 401');
for (const action of ['list', 'create', 'update', 'reset-password', 'delete', 'migrate-preview', 'migrate-legacy']) {
  ok((await call('tok-A', { action, id: admin.id, username: 'x1x', ownerId: 'oA' })).status === 403, `owner → ${action} refused (403)`);
}
ok((await call('tok-admin', { action: 'list' })).status === 200, 'admin → list works');

console.log('\nADMIN ACCOUNTS ARE OUT OF REACH');
ok((await call('tok-admin', { action: 'update', id: admin.id, permissions: { canBook: true } })).status === 404, 'update of an admin login refused');
ok((await call('tok-admin', { action: 'reset-password', id: admin.id })).status === 404, 'reset of an admin login refused');
ok((await call('tok-admin', { action: 'delete', id: admin.id })).status === 404, 'delete of an admin login refused');
const sneaky = await call('tok-admin', { action: 'create', username: 'boss2', ownerId: 'oB', role: 'admin', name: 'x' });
ok(sneaky.status === 200 && world.authUsers.find((u) => u.email === 'boss2@staff.ceylonrentacars.com').app_metadata.role === 'owner', 'create with role "admin" still makes an OWNER');
world.authUsers = world.authUsers.filter((u) => u.email !== 'boss2@staff.ceylonrentacars.com');

console.log('\nCREATE OWNER LOGINS');
ok((await call('tok-admin', { action: 'create', username: 'A!', ownerId: 'oB' })).status === 400, 'bad username refused');
ok((await call('tok-admin', { action: 'create', username: 'bob', ownerId: 'oZ' })).status === 400, 'unknown owner refused');
ok((await call('tok-admin', { action: 'create', username: 'alice2', ownerId: 'oA' })).status === 409, 'second login for the same owner refused');
ok((await call('tok-admin', { action: 'create', username: 'alice', ownerId: 'oB' })).status === 409, 'taken username refused');
ok((await call('tok-admin', { action: 'create', username: 'bob', ownerId: 'oB', password: '123456' })).status === 400, 'weak password (6-digit PIN) refused');
const created = await call('tok-admin', { action: 'create', username: 'bob', ownerId: 'oB', name: 'Bob' });
const bob = world.authUsers.find((u) => u.email === 'bob@staff.ceylonrentacars.com');
ok(created.status === 200 && /^[A-Za-z0-9]{12}$/.test(created.body.tempPassword) && bob.app_metadata.must_change_password === true, 'owner created with a 12-char temporary password, must change at sign-in');
world.tokens['tok-B'] = bob.id;

console.log('\nRESET + CHANGE PASSWORD');
const reset = await call('tok-admin', { action: 'reset-password', id: ownerA.id });
ok(reset.status === 200 && reset.body.tempPassword && world.authUsers.find((u) => u.id === ownerA.id).app_metadata.must_change_password, 'admin reset gives a new temporary password + forces a change');
const tmp = reset.body.tempPassword;
ok((await call('tok-A', { action: 'change-password', currentPassword: 'wrong', newPassword: 'NewSecret2026' })).status === 400, 'change with the wrong current password refused');
ok((await call('tok-A', { action: 'change-password', currentPassword: tmp, newPassword: 'short1' })).status === 400, 'too-short new password refused');
ok((await call('tok-A', { action: 'change-password', currentPassword: tmp, newPassword: 'alice12345xyz' })).status === 400, 'password containing the username refused');
const changed = await call('tok-A', { action: 'change-password', currentPassword: tmp, newPassword: 'NewSecret2026' });
const a2 = world.authUsers.find((u) => u.id === ownerA.id);
ok(changed.status === 200 && a2.password === 'NewSecret2026' && a2.app_metadata.must_change_password === false && a2.app_metadata.role === 'owner', 'own password changed, flag cleared, role unchanged');
ok((await call('tok-A', { action: 'change-password', currentPassword: 'NewSecret2026', newPassword: 'NewSecret2026' })).status === 400, 'same password again refused');

console.log('\nDISABLE');
await call('tok-admin', { action: 'update', id: bob.id, disabled: true });
ok(!!world.authUsers.find((u) => u.id === bob.id).banned_until, 'admin can disable an owner login');
const perm = await call('tok-admin', { action: 'update', id: bob.id, permissions: { canBook: false, role: 'admin', evil: true } });
const bm = world.authUsers.find((u) => u.id === bob.id).app_metadata;
ok(perm.status === 200 && bm.role === 'owner' && bm.permissions.canBook === false && !('role' in bm.permissions) && !('evil' in bm.permissions), 'permissions update keeps only can* flags (no role smuggling)');

console.log('\nMIGRATE OLD LOGINS (validation)');
world.tables.users = [
  { id: 'u1', username: 'carol', password: '111111', role: 'owner', owner_id: 'oC', name: 'Carol' },
  { id: 'u2', username: 'mallory', password: 'x', role: 'admin', owner_id: null, name: 'Mallory' },          // admin row
  { id: 'u3', username: 'ghost', password: 'x', role: 'owner', owner_id: 'oZ', name: 'Ghost' },              // unknown owner
  { id: 'u4', username: 'dan smith', password: 'x', role: 'owner', owner_id: 'oD', name: 'Dan' },            // space: not a valid username
  { id: 'u5', username: 'twin', password: 'x', role: 'owner', owner_id: 'oD', name: 'Twin1' },
  { id: 'u6', username: 'twin', password: 'x', role: 'owner', owner_id: 'oD', name: 'Twin2' },               // duplicate username + owner
  { id: 'u7', username: 'alice', password: 'x', role: 'owner', owner_id: 'oA', name: 'Alice' },              // already moved
  { id: 'u8', username: 'bobby', password: 'x', role: 'owner', owner_id: 'oB', name: 'Bobby' },              // owner B already has "bob"
];
const before = world.authUsers.length;
const prev = await call('tok-admin', { action: 'migrate-preview' });
const st = Object.fromEntries(prev.body.plan.map((p) => [p.username + '/' + p.ownerId + '/' + p.status, p.reason ?? '']));
ok(world.authUsers.length === before, 'preview changes nothing');
ok(prev.body.plan.find((p) => p.username === 'carol').status === 'move', 'valid owner login → move');
ok(/only owner logins/.test(prev.body.plan.find((p) => p.username === 'mallory').reason), 'legacy ADMIN row → rejected (never becomes an admin)');
ok(/owner doesn't exist/.test(prev.body.plan.find((p) => p.username === 'ghost').reason), 'unknown owner → rejected');
ok(/invalid username/.test(prev.body.plan.find((p) => p.username === 'dan smith').reason), 'invalid username (space) → rejected');
ok(prev.body.plan.filter((p) => p.username === 'twin').every((p) => p.status === 'rejected'), 'duplicate usernames → both rejected');
ok(prev.body.plan.find((p) => p.username === 'alice').status === 'already-moved', 'already moved → skipped');
ok(/already has a secure login/.test(prev.body.plan.find((p) => p.username === 'bobby').reason), 'owner who already has a login → rejected');
const mig = await call('tok-admin', { action: 'migrate-legacy' });
const carol = world.authUsers.find((u) => u.email === 'carol@staff.ceylonrentacars.com');
ok(mig.body.moved.length === 1 && mig.body.moved[0].username === 'carol', 'only the valid login is moved');
ok(carol && carol.password !== '111111' && carol.password === mig.body.moved[0].tempPassword, 'moved login gets a NEW password (old exposed one is not reused)');
ok(carol.app_metadata.role === 'owner' && carol.app_metadata.owner_id === 'oC' && carol.app_metadata.must_change_password === true, 'moved login: owner role, right owner, must change password');
ok(!world.authUsers.some((u) => u.email.startsWith('mallory')), 'no login created for the legacy admin row');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
