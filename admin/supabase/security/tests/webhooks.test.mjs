/*
 * Outside-facing Edge Functions — the real code, bundled with esbuild and run in Node with
 * stand-ins for Deno, Supabase and Meta (no network, no production):
 *   sms-inbound / sms-delivery-webhook  → need ?key=<SMS_WEBHOOK_SECRET>, fail closed without it
 *   whatsapp-media                       → only a signed-in admin gets customer files
 */
import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const fnDir = join(here, '..', '..', 'functions');
let passed = 0, failed = 0;
const ok = (c, m) => { if (c) { passed++; console.log('  ✓', m); } else { failed++; console.log('  ✗', m); } };

// ── Fakes ────────────────────────────────────────────────────────────────────
const SERVICE_KEY = 'service-role-key', SECRET = 'hook-secret-123';
const HOOK_KEY = Buffer.from('portal-hook-test-key-0123456789ab').toString('base64');
const env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, SUPABASE_ANON_KEY: 'anon-key', SMS_WEBHOOK_SECRET: SECRET, WHATSAPP_TOKEN: 'meta-token',
  TEXTLK_API_TOKEN: 'tl-token', TEXTLK_SENDER_ID: 'TestSender', PORTAL_SMS_HOOK_SECRET: 'v1,whsec_' + HOOK_KEY };
globalThis.Deno = { env: { get: (k) => env[k] } };

const users = { 'admin-token': { id: 'a', app_metadata: { role: 'admin' } }, 'owner-token': { id: 'o', app_metadata: { role: 'owner', owner_id: 'oA' } } };
const writes = [];
const tables = { whatsapp_messages: [{ media_id: '111222333', media_name: 'licence.jpg' }], app_settings: [{ key: 'sms', value: { enabled: true } }] };
const rpcCalls = [], created = [];
const rpcAnswer = {};   // rpc name → value to return
globalThis.__fakeCreateClient = () => ({
  auth: {
    getUser: async (t) => (users[t] ? { data: { user: users[t] }, error: null } : { data: { user: null }, error: { message: 'bad jwt' } }),
    admin: { createUser: async (u) => { created.push(u); return created.filter((x) => x.phone === u.phone).length > 1 ? { data: null, error: { message: 'Phone number already registered' } } : { data: { user: u }, error: null }; } },
  },
  rpc: async (name, args) => { rpcCalls.push({ name, args }); return { data: rpcAnswer[name], error: null }; },
  from: (table) => {
    const q = { _f: () => true };
    q.select = () => q;
    q.eq = (c, v) => { const prev = q._f; q._f = (r) => prev(r) && r[c] === v; if (q._op) writes.push({ table, op: q._op, col: c, val: v, row: q._row }); return q; };
    q.maybeSingle = async () => ({ data: (tables[table] ?? []).find(q._f) ?? null, error: null });
    q.upsert = async (row) => { writes.push({ table, op: 'upsert', row }); return { error: null }; };
    q.insert = (row) => { writes.push({ table, op: 'insert', row }); return Promise.resolve({ error: null }); };
    q.delete = () => { q._op = 'delete'; return q; };
    q.update = (row) => { q._op = 'update'; q._row = row; return q; };
    q.then = (res) => res({ data: null, error: null });
    return q;
  },
});
const outbound = [];
let otpStatus = 200, textlkOk = true;
globalThis.fetch = async (url, init = {}) => {
  if (String(url).endsWith('/auth/v1/otp')) { outbound.push({ to: 'otp', body: JSON.parse(init.body) }); return new Response(otpStatus === 200 ? '{}' : JSON.stringify({ msg: 'For security purposes, you can only request this after 52 seconds' }), { status: otpStatus }); }
  if (String(url).startsWith('https://app.text.lk/')) { outbound.push({ to: 'textlk', body: JSON.parse(init.body) }); return new Response(JSON.stringify(textlkOk ? { status: 'success', data: { uid: 'tl1', cost: 1 } } : { status: 'error' }), { status: textlkOk ? 200 : 400 }); }
  if (String(url).startsWith('https://graph.facebook.com/')) return new Response(JSON.stringify({ url: 'https://cdn.meta/file', mime_type: 'image/jpeg' }), { status: 200 });
  if (url === 'https://cdn.meta/file') return new Response('JPEGDATA', { status: 200 });
  throw new Error('unexpected fetch ' + url);
};

async function load(name) {
  const out = join(mkdtempSync(join(tmpdir(), name + '-')), 'fn.mjs');
  await build({
    entryPoints: [join(fnDir, name, 'index.ts')], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error',
    plugins: [{ name: 'fakes', setup(b) {
      b.onResolve({ filter: /^https:\/\/deno\.land\/std.*\/http\/server\.ts$/ }, () => ({ path: 'serve', namespace: 'fake' }));
      b.onResolve({ filter: /^https:\/\/esm\.sh\/@supabase\/supabase-js/ }, () => ({ path: 'supabase', namespace: 'fake' }));
      b.onLoad({ filter: /^serve$/, namespace: 'fake' }, () => ({ contents: 'export const serve = (h) => { globalThis.__serve = h; };' }));
      b.onLoad({ filter: /^supabase$/, namespace: 'fake' }, () => ({ contents: 'export const createClient = (...a) => globalThis.__fakeCreateClient(...a);' }));
    } }],
  });
  globalThis.__serve = null;
  await import(pathToFileURL(out).href);
  return globalThis.__serve;
}
const post = (fn, path, body) => fn(new Request('https://x.supabase.co/functions/v1/' + path, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}));

// ── SMS webhooks ─────────────────────────────────────────────────────────────
console.log('\nsms-inbound');
const inbound = await load('sms-inbound');
let r = await post(inbound, 'sms-inbound', { from: '0771234567', message: 'STOP' });
ok(r.status === 401 && writes.length === 0, 'no key → refused, nobody is opted out');
r = await post(inbound, 'sms-inbound?key=wrong-secret-12', { from: '0771234567', message: 'STOP' });
ok(r.status === 401 && writes.length === 0, 'wrong key (same length) → refused');
r = await post(inbound, `sms-inbound?key=${SECRET}`, { from: '0771234567', message: 'STOP' });
ok(r.status === 200 && writes.some((w) => w.table === 'sms_opt_out' && w.op === 'upsert' && w.row.phone === '94771234567'), 'right key → STOP opts the number out');
ok((await inbound(new Request('https://x.supabase.co/functions/v1/sms-inbound'))).status === 200, 'GET health check still answers');

console.log('\nsms-delivery-webhook');
const dlr = await load('sms-delivery-webhook');
writes.length = 0;
r = await post(dlr, 'sms-delivery-webhook', { uid: 'u1', status: 'DELIVERED' });
ok(r.status === 401 && writes.length === 0, 'no key → refused, no status changed');
r = await post(dlr, `sms-delivery-webhook?key=${SECRET}`, { uid: 'u1', status: 'DELIVERED' });
ok(r.status === 200 && writes.some((w) => w.table === 'sms_log' && w.row?.status === 'delivered'), 'right key → delivery status saved');
delete env.SMS_WEBHOOK_SECRET;
writes.length = 0;
r = await post(dlr, 'sms-delivery-webhook?key=', { uid: 'u1', status: 'DELIVERED' });
ok(r.status === 401 && writes.length === 0, 'secret not set → everything refused (fails closed)');
env.SMS_WEBHOOK_SECRET = SECRET;

// ── WhatsApp media ───────────────────────────────────────────────────────────
console.log('\nwhatsapp-media');
const media = await load('whatsapp-media');
const get = (token, id = '111222333') => media(new Request(`https://x.supabase.co/functions/v1/whatsapp-media?id=${id}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} }));
ok((await get()).status === 401, 'no login (e.g. a leaked link) → refused');
ok((await get('anon-key')).status === 401, 'website public key → refused');
ok((await get('owner-token')).status === 401, 'owner login → refused (chats are admin-only)');
r = await get('admin-token');
ok(r.status === 200 && (await r.text()) === 'JPEGDATA', 'admin login → gets the file');
ok(r.headers.get('cache-control')?.includes('no-store'), 'not kept in shared caches');
ok((await get('admin-token', '999')).status === 404, 'admin: unknown media id → not found');
ok((await get(SERVICE_KEY)).status === 200, 'server-side callers (service key) still work');
r = await media(new Request('https://x.supabase.co/functions/v1/whatsapp-media?id=1', { method: 'OPTIONS' }));
ok(r.status === 200 && /authorization/i.test(r.headers.get('access-control-allow-headers') ?? ''), 'browser pre-check allows the login header');

// ── Customer portal: portal-login ────────────────────────────────────────────
console.log('\nportal-login');
const login = await load('portal-login');
const ask = (phone, ip = '1.1.1.1') => login(new Request('https://x.supabase.co/functions/v1/portal-login', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify({ phone }) }));
rpcAnswer.portal_phone_status = 'unknown'; outbound.length = 0;
r = await ask('077 000 0000');
ok(r.status === 404 && (await r.json()).notFound && outbound.length === 0 && created.length === 0, 'unknown number → "no bookings found", no login made, no SMS');
ok(rpcCalls.at(-1).args.p_phone === '94770000000' && rpcCalls.at(-1).args.p_ip === '1.1.1.1', 'checks the normalised number and the visitor connection');
rpcAnswer.portal_phone_status = 'limited';
ok((await ask('0771234567')).status === 429 && outbound.length === 0, 'over the limit → refused, no SMS');
rpcAnswer.portal_phone_status = 'invalid';
ok((await ask('12')).status === 400, 'not a phone number → refused');
rpcAnswer.portal_phone_status = 'ok';
r = await ask('077 123 4567');
const j = await r.json();
ok(r.status === 200 && j.phone === '+94771234567', 'known number → code requested');
ok(created[0]?.phone === '94771234567' && created[0]?.app_metadata?.role === 'customer' && created[0]?.phone_confirm === true, 'login created with role "customer" (never staff)');
ok(outbound.some((o) => o.to === 'otp' && o.body.phone === '+94771234567' && o.body.create_user === false), 'asks Supabase Auth for the code (no sign-up)');
ok((await ask('0771234567')).status === 200, 'second time: existing login is fine');
otpStatus = 429;
ok((await ask('0771234567')).status === 429, 'Supabase "wait a minute" → passed on to the customer');
otpStatus = 200;

// ── Customer portal: portal-sms (Auth hook) ──────────────────────────────────
console.log('\nportal-sms (Send SMS hook)');
const hook = await load('portal-sms');
const { createHmac } = await import('node:crypto');
const signed = (payload, { key = HOOK_KEY, ts = Math.floor(Date.now() / 1000), id = 'msg_1', tamper = false } = {}) => {
  const body = JSON.stringify(payload);
  const sig = createHmac('sha256', Buffer.from(key, 'base64')).update(id + '.' + ts + '.' + body).digest('base64');
  return hook(new Request('https://x.supabase.co/functions/v1/portal-sms', { method: 'POST',
    headers: { 'webhook-id': id, 'webhook-timestamp': String(ts), 'webhook-signature': 'v1,' + sig, 'Content-Type': 'application/json' },
    body: tamper ? body.replace('987654', '999999') : body }));
};
const payload = { user: { phone: '94771234567' }, sms: { otp: '987654' } };
outbound.length = 0; writes.length = 0; rpcAnswer.portal_sms_allow = true;
r = await signed(payload);
const sms = outbound.find((o) => o.to === 'textlk');
ok(r.status === 200 && sms?.body.recipient === '94771234567' && sms.body.message.startsWith('987654 ') && sms.body.sender_id === 'TestSender', 'signed call → code sent by Text.lk with your sender ID');
ok(writes.some((w) => w.table === 'sms_log' && w.row.category === 'portalOtp') && !JSON.stringify(writes).includes('987654'), 'logged in sms_log — without the code');
outbound.length = 0;
ok((await signed(payload, { key: Buffer.from('some-other-key-xxxxxxxxxxxxxxxxx').toString('base64') })).status === 401 && !outbound.length, 'wrong signature → refused, nothing sent');
ok((await signed(payload, { tamper: true })).status === 401 && !outbound.length, 'changed message → refused');
ok((await signed(payload, { ts: Math.floor(Date.now() / 1000) - 3600 })).status === 401 && !outbound.length, 'old (replayed) call → refused');
ok((await hook(new Request('https://x.supabase.co/functions/v1/portal-sms', { method: 'POST', body: JSON.stringify(payload) }))).status === 401, 'unsigned call → refused');
rpcAnswer.portal_sms_allow = false;
ok((await signed(payload)).status === 429 && !outbound.length, 'over 8 codes today → refused, nothing sent');
rpcAnswer.portal_sms_allow = true;
tables.app_settings[0].value.enabled = false;
ok((await signed(payload)).status === 503 && !outbound.length, 'SMS paused in admin Settings → no code sent');
tables.app_settings[0].value.enabled = true;
textlkOk = false;
ok((await signed(payload)).status === 502, 'Text.lk failure → error shown instead of a code that never comes');
textlkOk = true;

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
