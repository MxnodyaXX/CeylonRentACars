/*
 * Security migration tests — runs the REAL SQL files against a local Postgres 16 (PGlite)
 * set up like Supabase (anon / authenticated roles with Supabase's default grants, auth.jwt(),
 * storage schema). Nothing here touches production.
 *
 *   cd admin/supabase/security/tests && npm install && npm test
 *
 * Covers: anonymous visitor, admin, and two different owners (A and B).
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const sqlDir = join(here, '..', '..');            // admin/supabase
const sql = (f) => readFileSync(join(sqlDir, f), 'utf8');

let passed = 0, failed = 0;
const ok = (cond, msg) => { if (cond) { passed++; console.log('  ✓', msg); } else { failed++; console.log('  ✗', msg); } };

const db = new PGlite();

// ── Supabase-like environment ────────────────────────────────────────────────
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text unique,
                           raw_app_meta_data jsonb not null default '{}', banned_until timestamptz);
  create function auth.jwt() returns jsonb language sql stable as
    $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on all functions in schema auth to anon, authenticated, service_role;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean not null default false);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  create function storage.foldername(name text) returns text[] language sql immutable as
    $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
  alter table storage.objects enable row level security;
  grant usage on schema storage to anon, authenticated, service_role;
  grant all on storage.objects, storage.buckets to anon, authenticated, service_role;
  grant execute on all functions in schema storage to anon, authenticated;
  create publication supabase_realtime;
  -- Supabase default: website + logged-in roles get every new table / function in public
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`);

// ── The real schema as it is in production today ─────────────────────────────
for (const f of ['schema.sql', 'sms-setup.sql', 'whatsapp.sql', 'website.sql', 'fix-missing-columns.sql']) {
  await db.exec(sql(f));
}
await db.exec(`insert into storage.buckets (id, name, public) values ('vehicle-images','vehicle-images',true), ('receipts','receipts',true) on conflict do nothing`);

// ── Seed: owners A and B, a vehicle and booking each; B's booking was referred by A ──
const now = new Date().toISOString();
const soon = (d) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
await db.exec(`
  insert into owners (id, name, phone, email, total_earnings, pending_payout, created_at) values
    ('oA', 'Alice Owner', '0771111111', 'a@x.lk', 1000, 500, '${now}'),
    ('oB', 'Bob Owner',   '0772222222', 'b@x.lk', 2000, 900, '${now}');
  insert into vehicles (id, vehicle_number, brand, model, year, owner_id, daily_rent, status, created_at) values
    ('vA', 'CAA-1111', 'Toyota', 'Aqua', 2018, 'oA', 6000, 'Available', '${now}'),
    ('vB', 'CBB-2222', 'Honda',  'Fit',  2019, 'oB', 7000, 'Available', '${now}');
  insert into customers (id, name, phone, nic, created_at) values
    ('cA', 'Customer of A', '0711000001', '900000001V', '${now}'),
    ('cB', 'Customer of B', '0711000002', '900000002V', '${now}');
  insert into bookings (id, vehicle_id, customer_id, customer_name, customer_phone, start_date, end_date, total_days, total_amount, paid_amount, status, referral, created_at) values
    ('bA', 'vA', 'cA', 'Customer of A', '0711000001', '${soon(40)}', '${soon(42)}', 2, 12000, 0, 'Confirmed', 'Direct', '${now}'),
    ('bB', 'vB', 'cB', 'Customer of B', '0711000002', '${soon(50)}', '${soon(52)}', 2, 14000, 0, 'Confirmed', 'Alice Owner', '${now}');
  insert into commissions (id, booking_id, vehicle_id, owner_id, referral, total_income, commission_rate, commission_amount, owner_payout, coordinator_fee, status, created_at) values
    ('kA', 'bA', 'vA', 'oA', 'Direct', 12000, 0, 0, 12000, 0, 'Pending', '${now}'),
    ('kB', 'bB', 'vB', 'oB', 'Alice Owner', 14000, 0, 0, 13000, 1000, 'Pending', '${now}');
  insert into expenses (id, vehicle_id, category, amount, description, date, created_at) values
    ('eA', 'vA', 'Fuel', 100, 'a', '${soon(0)}', '${now}'), ('eB', 'vB', 'Fuel', 200, 'b', '${soon(0)}', '${now}');
  insert into handovers (id, booking_id, vehicle_id, type, location, date_time, mileage, fuel_level, created_at) values
    ('hA', 'bA', 'vA', 'delivery', 'x', '${now}', 1, 'Full', '${now}'), ('hB', 'bB', 'vB', 'delivery', 'y', '${now}', 1, 'Full', '${now}');
  insert into notifications (id, type, title, message, owner_id, read, created_at) values
    ('nA', 'x', 'for A', 'm', 'oA', false, '${now}'), ('nB', 'x', 'for B', 'm', 'oB', false, '${now}'), ('nAll', 'x', 'company-wide', 'm', null, false, '${now}');
  insert into inquiries (id, customer_name, customer_phone, requested_vehicle, referral, status, created_at, start_date, end_date, notes, alternatives_offered)
    values ('web_abc123', 'Lead Person', '0719999999', 'Toyota Aqua', 'Website', 'Pending', '${now}', '${soon(30)}', '${soon(33)}', 'Website booking request CRC-ABC123', '["vA","vB"]');
  insert into users (id, username, password, name, role, owner_id, created_at) values
    ('u1', 'alice', '123456', 'Alice Owner', 'owner', 'oA', '${now}'),
    ('u2', 'evil',  'x',      'Evil',        'admin', null, '${now}');
  insert into storage.objects (bucket_id, name) values
    ('booking-files', 'bA/licence.jpg'), ('booking-files', 'bB/licence.jpg'),
    ('receipts', 'bA/r1.pdf'), ('receipts', 'bB/r2.pdf'), ('vehicle-images', 'vA/p.jpg'), ('vehicle-images', 'vB/p.jpg');
`);

// ── Helpers to act as someone ────────────────────────────────────────────────
const claims = {
  admin: { sub: '00000000-0000-0000-0000-00000000000a', role: 'authenticated', app_metadata: { role: 'admin' } },
  A: { sub: '00000000-0000-0000-0000-0000000000a1', role: 'authenticated', app_metadata: { role: 'owner', owner_id: 'oA' } },
  B: { sub: '00000000-0000-0000-0000-0000000000b1', role: 'authenticated', app_metadata: { role: 'owner', owner_id: 'oB' } },
  Ainq: { sub: '00000000-0000-0000-0000-0000000000a1', role: 'authenticated', app_metadata: { role: 'owner', owner_id: 'oA', permissions: { canViewInquiries: true } } },
  customer: { sub: '00000000-0000-0000-0000-0000000000c1', role: 'authenticated', app_metadata: {} },
  custA: { sub: '00000000-0000-0000-0000-0000000000c2', role: 'authenticated', phone: '94711000001', app_metadata: { role: 'customer' } },
  lead: { sub: '00000000-0000-0000-0000-0000000000c3', role: 'authenticated', phone: '94719999999', app_metadata: { role: 'customer' } },
  stranger: { sub: '00000000-0000-0000-0000-0000000000c4', role: 'authenticated', phone: '94770000000', app_metadata: { role: 'customer' } },
  ownerWithPhone: { sub: '00000000-0000-0000-0000-0000000000c5', role: 'authenticated', phone: '94711000001', app_metadata: { role: 'owner', owner_id: 'oB' } },
};
async function as(who, fn, ip = '10.0.0.1') {
  await db.exec('reset role');
  await db.query(`select set_config('request.jwt.claims', $1, false), set_config('request.headers', $2, false)`,
    [who === 'anon' ? '' : JSON.stringify(claims[who]), JSON.stringify({ 'x-forwarded-for': ip })]);
  await db.exec(`set role ${who === 'anon' ? 'anon' : 'authenticated'}`);
  try { return await fn(); } finally { await db.exec('reset role'); }
}
const ids = async (q) => (await db.query(q)).rows.map((r) => Object.values(r)[0]).sort();
const tryQ = async (q, params) => { try { await db.query(q, params); return null; } catch (e) { return e.message; } };
const count = async (q) => Number((await db.query(q)).rows[0].n);

// ── Before: the problem ──────────────────────────────────────────────────────
console.log('\nBEFORE migration (current production setup)');
ok((await as('anon', () => ids('select id from customers'))).length === 2, 'website visitors can read every customer (the bug)');
ok((await as('anon', () => ids('select username from users'))).length === 2, 'website visitors can read the logins table (the bug)');
await db.exec(sql('security/verify.sql'));
const beforeFails = (await db.query(`select count(*) n from security_check where result = 'FAIL'`)).rows[0].n;
ok(beforeFails > 20, `verify.sql flags the current setup (${beforeFails} FAIL)`);

// ── Apply migrations ─────────────────────────────────────────────────────────
await db.exec(sql('security/01_scoped_access.sql'));
await db.exec(sql('security/02_public_functions.sql'));
await db.exec(`update inquiries set alt_token = 'secret-token-123' where id = 'web_abc123'`);

const PRIVATE = ['owners', 'vehicles', 'bookings', 'customers', 'commissions', 'expenses', 'handovers',
  'notifications', 'inquiries', 'inquiry_followups', 'users', 'drivers', 'sms_log', 'sms_opt_out',
  'whatsapp_chats', 'whatsapp_messages', 'service_reviews', 'vehicle_reviews', 'app_settings'];

console.log('\nANONYMOUS website visitor');
for (const t of PRIVATE) {
  const r = await as('anon', () => tryQ(`select * from ${t} limit 1`));
  ok(r && /permission denied/.test(r), `cannot read ${t}`);
}
ok(!!(await as('anon', () => tryQ(`insert into bookings (id, vehicle_id, customer_id, customer_name, customer_phone, start_date, end_date, total_days, total_amount, paid_amount, status, created_at) values ('x','vA','c','n','p','2030-01-01','2030-01-02',1,1,0,'Confirmed','x')`))), 'cannot insert bookings');
ok(!!(await as('anon', () => tryQ(`update vehicles set daily_rent = 1`))), 'cannot update vehicles');
ok((await as('anon', () => ids('select id from catalog_vehicles'))).length === 2, 'website catalog view still works');
ok((await as('anon', () => count('select count(*) n from vehicle_busy_dates'))) >= 0, 'busy-dates view still works');
ok(!!(await as('anon', () => tryQ(`select private.owns_vehicle('vA')`))), 'cannot call private helper functions');
ok(!!(await as('anon', () => tryQ(`select _switch_inquiry_vehicle('web_abc123','vB','x')`))), 'cannot call internal _switch_inquiry_vehicle');
ok((await as('anon', () => db.query(`select count(*) n from storage.objects`))).rows[0].n == 0, 'cannot list any storage files');

console.log('\nANONYMOUS — public functions');
const book = (ip, phone = '0770000001', extra = '') => as('anon', () => db.query(
  `select submit_booking_request('vA','Real Customer',$1,'',null,current_date+60,'10:00',current_date+62,'10:00','Colombo','Colombo','Self drive','',1 ${extra}) as ref`, [phone]), ip);
const r1 = await book('1.1.1.1');
ok(/^CRC-[A-F0-9]{6}$/.test(r1.rows[0].ref), 'booking request works and returns a reference');
const notes = (await db.query(`select notes from inquiries where id = 'web_' || lower(substr($1, 5))`, [r1.rows[0].ref])).rows[0].notes;
ok(/Estimate: Rs 12,000/.test(notes), 'estimate is calculated by the server (browser sent Rs 1)');
let phoneLimited = null;
for (let i = 0; i < 4; i++) { try { await book('1.1.1.' + (10 + i), '0770000002'); } catch (e) { phoneLimited = e.message; } }
ok(/already have your recent booking requests/.test(phoneLimited ?? ''), 'per-phone limit: 4th request in a day is refused');
let ipLimited = null;
for (let i = 0; i < 8; i++) { try { await book('2.2.2.2', '07700001' + (10 + i)); } catch (e) { ipLimited = e.message; } }
ok(/Too many booking requests/.test(ipLimited ?? ''), 'per-IP limit: 7th request in an hour is refused');
const hijack = await as('anon', () => tryQ(`select submit_booking_request('vB','Lead',$1,'',null,current_date+60,'10:00',current_date+62,'10:00','x','x','Self drive','',0,'web_abc123',null)`, ['0719999999']), '3.3.3.3');
const inqAfter = (await db.query(`select vehicle_id from inquiries where id = 'web_abc123'`)).rows[0].vehicle_id;
ok(hijack === null && inqAfter === null, 'alternative without the token creates a NEW request — the existing inquiry is untouched');
ok(/no longer valid/.test(await as('anon', () => tryQ(`select choose_alternative('web_abc123','vB',null)`), '4.4.4.4') ?? ''), 'choose_alternative refuses without the token');
ok(/no longer valid/.test(await as('anon', () => tryQ(`select choose_alternative('web_abc123','vB','wrong')`), '4.4.4.4') ?? ''), 'choose_alternative refuses a wrong token');
ok((await as('anon', () => tryQ(`select choose_alternative('web_abc123','vB','secret-token-123')`), '4.4.4.5')) === null, 'choose_alternative works with the right token');
ok((await db.query(`select vehicle_id from inquiries where id = 'web_abc123'`)).rows[0].vehicle_id === 'vB', '…and switched the inquiry to the chosen vehicle');
let fbLimited = null;
for (let i = 0; i < 4; i++) { try { await as('anon', () => db.query(`select submit_feedback('Happy Guest',null,'vA',5,'great',5,'nice')`), '5.5.5.5'); } catch (e) { fbLimited = e.message; } }
ok(/already received your feedback/.test(fbLimited ?? ''), 'feedback limit: 4th in an hour is refused');
ok(!!(await as('anon', () => tryQ(`select * from private.rate_limits`))), 'rate-limit table is not readable');

console.log('\nADMIN');
for (const t of ['owners', 'vehicles', 'bookings', 'customers', 'commissions', 'expenses', 'notifications', 'users']) {
  const n = await as('admin', () => count(`select count(*) n from ${t}`));
  ok(n >= 2, `sees all ${t} (${n})`);
}
await as('admin', () => db.query(`update owners set total_earnings = 1234 where id = 'oB'`));
ok((await db.query(`select total_earnings from owners where id = 'oB'`)).rows[0].total_earnings == 1234, 'can change owner earnings');
ok((await as('admin', () => count(`select count(*) n from storage.objects where bucket_id in ('booking-files','receipts')`))) === 4, 'sees all private files');

for (const [me, other, myV, otherV, myB, otherB] of [['A', 'B', 'vA', 'vB', 'bA', 'bB'], ['B', 'A', 'vB', 'vA', 'bB', 'bA']]) {
  console.log(`\nOWNER ${me}`);
  ok(JSON.stringify(await as(me, () => ids('select id from vehicles'))) === JSON.stringify([myV]), `vehicles: only ${myV}`);
  ok(JSON.stringify(await as(me, () => ids('select id from owners'))) === JSON.stringify(['o' + me]), 'owners: only own row (no other bank details)');
  ok(JSON.stringify(await as(me, () => ids('select id from customers'))) === JSON.stringify(['c' + me]), "customers: only their own vehicles' customers");
  ok(JSON.stringify(await as(me, () => ids('select id from expenses'))) === JSON.stringify(['e' + me]), 'expenses: own only');
  ok(JSON.stringify(await as(me, () => ids('select id from handovers'))) === JSON.stringify(['h' + me]), 'handovers: own only');
  ok(JSON.stringify(await as(me, () => ids('select id from notifications'))) === JSON.stringify(['n' + me]), 'notifications: own only (no company-wide)');
  ok((await as(me, () => ids('select id from inquiries'))).length === 0, 'inquiries: none without permission');
  ok((await as(me, () => tryQ('select * from users'))) === null && (await as(me, () => ids('select id from users'))).length === 0, 'logins table: nothing');
  const bks = await as(me, () => ids('select id from bookings'));
  if (me === 'A') ok(JSON.stringify(bks) === '["bA","bB"]', 'bookings: own + the one Alice referred (read only)');
  else ok(JSON.stringify(bks) === '["bB"]', "bookings: own only (not A's)");
  // writes on the other owner's data change nothing
  await as(me, () => db.query(`update bookings set total_amount = 1 where id = '${otherB}'`));
  ok((await db.query(`select total_amount from bookings where id = '${otherB}'`)).rows[0].total_amount != 1, `cannot change ${other}'s booking`);
  await as(me, () => db.query(`update vehicles set daily_rent = 1 where id = '${otherV}'`));
  ok((await db.query(`select daily_rent from vehicles where id = '${otherV}'`)).rows[0].daily_rent != 1, `cannot change ${other}'s vehicle`);
  await as(me, () => db.query(`delete from expenses where id = 'e${other}'`));
  ok((await db.query(`select count(*) n from expenses where id = 'e${other}'`)).rows[0].n == 1, `cannot delete ${other}'s expense`);
  ok(!!(await as(me, () => tryQ(`insert into bookings (id, vehicle_id, customer_id, customer_name, customer_phone, start_date, end_date, total_days, total_amount, paid_amount, status, created_at) values ('z${me}','${otherV}','c','n','p','2030-01-01','2030-01-02',1,1,0,'Confirmed','x')`))), `cannot create a booking on ${other}'s vehicle`);
  ok((await as(me, () => tryQ(`insert into bookings (id, vehicle_id, customer_id, customer_name, customer_phone, start_date, end_date, total_days, total_amount, paid_amount, status, created_at) values ('y${me}','${myV}','c','n','p','2030-01-01','2030-01-02',1,1,0,'Confirmed','x')`))) === null, 'can create a booking on own vehicle');
  ok((await as(me, () => tryQ(`update bookings set notes = 'ok' where id = '${myB}'`))) === null, 'can update own booking');
  // financial fields are protected even on their own rows
  await as(me, () => db.query(`update owners set total_earnings = 999999, pending_payout = 999999, phone = '0779999999' where id = 'o${me}'`));
  const ow = (await db.query(`select total_earnings, pending_payout, phone from owners where id = 'o${me}'`)).rows[0];
  ok(ow.total_earnings != 999999 && ow.pending_payout != 999999, 'cannot change own earnings / pending payout');
  ok(ow.phone === '0779999999', 'can change own contact details');
  await as(me, () => db.query(`update commissions set owner_payout = 999999, status = 'Paid' where id = 'k${me}'`));
  const k = (await db.query(`select owner_payout, status from commissions where id = 'k${me}'`)).rows[0];
  ok(k.owner_payout != 999999 && k.status === 'Pending', 'cannot change own commission payout or mark it paid');
  await as(me, () => db.query(`update vehicles set owner_id = 'o${other}' where id = '${myV}'`));
  ok((await db.query(`select owner_id from vehicles where id = '${myV}'`)).rows[0].owner_id === 'o' + me, 'cannot give a vehicle to another owner');
  // storage
  ok((await as(me, () => ids(`select name from storage.objects where bucket_id in ('booking-files','receipts')`))).every((n) => n.startsWith(myB + '/')), 'private files: only their bookings');
  ok(!!(await as(me, () => tryQ(`insert into storage.objects (bucket_id, name) values ('vehicle-images', '${otherV}/hack.jpg')`))), `cannot upload photos for ${other}'s vehicle`);
  ok((await as(me, () => tryQ(`insert into storage.objects (bucket_id, name) values ('vehicle-images', '${myV}/new.jpg')`))) === null, 'can upload photos for own vehicle');
}

console.log('\nverify.sql (the read-only production check) on this database');
await db.exec(sql('security/verify.sql'));
const checks = (await db.query('select area, check_name, result, detail from security_check')).rows;
const fails = checks.filter((c) => c.result === 'FAIL');
ok(checks.length > 40 && fails.length === 0,
  `verify.sql ran ${checks.length} checks, ${fails.length} FAIL${fails.length ? ' → ' + JSON.stringify(fails.slice(0, 5)) : ''}`);
ok(checks.some((c) => c.check_name.includes('cannot see') && c.result === 'PASS'), 'verify.sql compared two real owners');

console.log('\nRE-RUNNING fix-missing-columns.sql after the lockdown');
await db.exec(sql('fix-missing-columns.sql'));
ok((await db.query(`select count(*) n from pg_policies where schemaname = 'storage' and policyname like 'admin app %'`)).rows[0].n == 0, 'does not bring back the open file rules');
ok((await db.query(`select relrowsecurity r from pg_class where oid = 'public.app_settings'::regclass`)).rows[0].r === true, 'leaves row-level security on for app_settings');
ok(!!(await as('anon', () => tryQ(`update app_settings set value = '{}' where key = 'sms'`)) ) || (await db.query(`select value->>'enabled' v from app_settings where key = 'sms'`)).rows[0].v !== null, 'website visitors still cannot change settings');
ok((await as('B', () => ids(`select name from storage.objects where bucket_id = 'booking-files'`))).every((n) => n.startsWith('bB/')), 'owner file access still scoped');

console.log('\nOWNER with the Inquiries permission');
ok((await as('Ainq', () => ids('select id from inquiries'))).length >= 1, 'sees inquiries when the admin allowed it');

console.log('\nSIGNED-IN USER WITHOUT A STAFF ROLE (e.g. a future customer login)');
for (const t of ['bookings', 'customers', 'owners', 'vehicles']) {
  ok((await as('customer', () => ids(`select id from ${t}`))).length === 0, `sees no ${t}`);
}

console.log('\n03 — remove old logins');
let refused = null;
try { await db.exec(sql('security/03_remove_legacy_logins.sql')); } catch (e) { refused = e.message; }
ok(/NOT removed/.test(refused ?? '') && /evil: legacy ADMIN row/.test(refused) && /alice: no secure login/.test(refused), 'refuses while logins are unverified and reports the admin row');
ok((await db.query(`select to_regclass('public.users') t`)).rows[0].t !== null, '…and keeps the table');
await db.exec(`delete from users where username = 'evil';
  insert into auth.users (email, raw_app_meta_data) values ('alice@staff.ceylonrentacars.com', '{"role":"owner","owner_id":"oB"}')`);
refused = null;
try { await db.exec(sql('security/03_remove_legacy_logins.sql')); } catch (e) { refused = e.message; }
ok(/role\/owner does not match/.test(refused ?? ''), 'refuses when the secure login points at the wrong owner');
await db.exec(`update auth.users set raw_app_meta_data = '{"role":"owner","owner_id":"oA"}' where email = 'alice@staff.ceylonrentacars.com'`);
await db.exec(sql('security/03_remove_legacy_logins.sql'));
ok((await db.query(`select to_regclass('public.users') t`)).rows[0].t === null, 'drops the old logins table once everything matches');

console.log('\nROLLBACK of 01 (security stays on)');
await db.exec(sql('security/rollback/01_rollback_scoped_access.sql'));
ok(!!(await as('anon', () => tryQ('select * from customers limit 1'))), 'website visitors still cannot read customers');
ok((await as('B', () => ids('select id from bookings'))).length >= 2, 'staff get the broader access back');
ok((await db.query(`select bool_and(relrowsecurity) r from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'`)).rows[0].r === true, 'row-level security still ON for every table');
await db.exec(sql('security/01_scoped_access.sql'));
ok(JSON.stringify(await as('B', () => ids('select id from vehicles'))) === '["vB"]', 're-running 01 restores owner scoping');

console.log('\nROLLBACK of 02');
await db.exec(sql('security/rollback/02_rollback_public_functions.sql'));
ok((await as('anon', () => tryQ(`select submit_booking_request('vA','Old Path','0770000999','',null,current_date+70,'10:00',current_date+71,'10:00','x','x','Self drive','',1)`))) === null, 'previous booking function works again');
await db.exec(sql('security/02_public_functions.sql'));
ok((await as('anon', () => tryQ(`select choose_alternative('web_abc123','vA',null)`), '9.9.9.9')) !== null, 're-running 02 restores the token check');

console.log('\n04 — AI chat limits');
await db.exec(sql('security/04_assistant_limits.sql'));
await db.exec(sql('security/04_assistant_limits.sql'));   // safe to re-run
ok(!!(await as('anon', () => tryQ(`select assistant_allow('1.2.3.4')`))), 'website visitors cannot call it (or reset limits)');
ok(!!(await as('A', () => tryQ(`select assistant_allow('1.2.3.4')`))), 'signed-in staff cannot call it either');
const allow = async (ip) => { await db.exec('set role service_role'); try { return (await db.query('select assistant_allow($1) a', [ip])).rows[0].a; } finally { await db.exec('reset role'); } };
let firstNo = 0;
for (let i = 1; i <= 26 && !firstNo; i++) if (!(await allow('7.7.7.7'))) firstNo = i;
ok(firstNo === 26, `per visitor: 25 messages allowed, the 26th refused (refused at #${firstNo})`);
ok(await allow('8.8.8.8'), 'another visitor is not affected');
await db.exec(`update private.rate_limits set hits = 1500 where bucket = 'assistant:all'`);
ok(!(await allow('9.9.9.1')), 'site-wide daily ceiling stops everyone');
await db.exec(sql('security/verify.sql'));
ok((await db.query(`select count(*) n from security_check where result = 'FAIL'`)).rows[0].n == 0, 'verify.sql still all PASS with 04');
await db.exec(sql('security/rollback/04_rollback_assistant_limits.sql'));
ok((await db.query(`select to_regprocedure('public.assistant_allow(text)') f`)).rows[0].f === null, 'rollback removes it');

console.log('\n05 — customer portal');
await db.exec(sql('security/05_customer_portal.sql'));
await db.exec(sql('security/05_customer_portal.sql'));   // safe to re-run
const mine = (who, fn) => as(who, async () => (await db.query(`select * from ${fn}()`)).rows);
await db.exec(`update bookings set payments = '[{"id":"p1","at":"2026-10-01T10:00:00Z","kind":"Advance","amount":5000,"method":"Cash","receiptNo":"R-1","note":"staff only note","by":"Admin"}]' where id = 'bA'`);
await db.exec(`update bookings set exchanges = '[{"id":"x1","at":"2026-10-05T10:00:00Z","fromVehicleId":"vB","toVehicleId":"vA","fromDays":2,"fromRevenue":9000,"fromPayout":9000,"toRate":6000,"commissionId":"k9","reason":"Accident","returned":{"odometer":1,"fuel":"Full"},"delivered":{"odometer":1,"fuel":"Full"},"damage":{"description":"bumper","payer":"Customer","amount":20000}}]' where id = 'bA'`);
const custA = await mine('custA', 'my_bookings');
ok(custA.length === 1 && custA[0].id === 'bA', 'customer sees their own booking (phone typed 0711000001, login +94711000001)');
ok(custA[0].reference === 'MRAC-BA' && custA[0].vehicle === 'Toyota Aqua' && Number(custA[0].balance) === 12000, 'with reference, car and balance');
ok(!('internal_notes' in custA[0]) && !('notes' in custA[0]) && !('referral' in custA[0]), 'no staff notes or referral details');
ok(custA[0].payments.length === 1 && custA[0].payments[0].amount === 5000 && custA[0].payments[0].receipt_no === 'R-1', 'payments listed (amount, method, receipt no)');
ok(custA[0].vehicle_changes.length === 1 && custA[0].vehicle_changes[0].from === 'Honda Fit' && custA[0].vehicle_changes[0].to === 'Toyota Aqua', 'vehicle exchange shown (which car, when)');
ok(!/fromPayout|toRate|9000|20000|bumper/.test(JSON.stringify(custA[0].vehicle_changes)), '…without owner payouts or damage costs');
ok(!JSON.stringify(custA[0].payments).includes('staff only note') && !JSON.stringify(custA[0].payments).includes('Admin'), "…without staff notes or who entered them");
const prof = await mine('custA', 'my_profile');
ok(prof.length === 1 && prof[0].name === 'Customer of A' && prof[0].phone === '+94711000001', 'profile: name from their customer record + phone');
ok((await mine('stranger', 'my_profile'))[0]?.name == null, 'profile: unknown number has no name');
ok((await mine('ownerWithPhone', 'my_profile')).length === 0, 'profile: staff logins get nothing');
ok(!!(await as('anon', () => tryQ('select * from my_profile()'))), 'profile: visitors cannot call it');
ok((await mine('custA', 'my_requests')).every((r) => r.id !== 'web_abc123'), "doesn't see someone else's request");
const lead = await mine('lead', 'my_requests');
ok(lead.some((r) => r.id === 'web_abc123' && r.reference === 'CRC-ABC123'), 'customer sees their own booking request with its CRC reference');
ok((await mine('lead', 'my_bookings')).length === 0, '…and no bookings that aren\'t theirs');
ok((await mine('stranger', 'my_bookings')).length === 0 && (await mine('stranger', 'my_requests')).length === 0, 'a number with no history sees nothing');
ok((await mine('ownerWithPhone', 'my_bookings')).length === 0, 'staff logins get nothing from the portal functions');
ok(!!(await as('anon', () => tryQ('select * from my_bookings()'))), 'website visitors (not signed in) cannot call it');
for (const t of ['bookings', 'customers', 'inquiries']) {
  ok((await as('custA', () => ids(`select id from ${t}`))).length === 0, `customer login still has no direct access to ${t}`);
}
const status = async (phone, ip = '5.5.5.5') => { await db.exec('set role service_role'); try { return (await db.query('select portal_phone_status($1, $2) s', [phone, ip])).rows[0].s; } finally { await db.exec('reset role'); } };
ok(await status('+94 71 100 0001') === 'ok', 'login check: known customer number → ok');
ok(await status('0719999999') === 'ok', 'login check: number from a booking request → ok');
ok(await status('0770000000') === 'unknown', 'login check: unknown number → unknown (no SMS sent)');
ok(await status('12') === 'invalid', 'login check: not a phone number → invalid');
let lim = '';
for (let i = 0; i < 6; i++) lim = await status('0711000002', '6.6.6.' + i);
ok(lim === 'limited', 'login check: 6th code request for one number within an hour → limited');
lim = '';
for (let i = 0; i < 11; i++) lim = await status('07700001' + String(i).padStart(2, '0'), '7.7.7.7');
ok(lim === 'limited', 'login check: 11th try from one connection within an hour → limited (no number guessing)');
ok(!!(await as('anon', () => tryQ(`select portal_phone_status('0711000001', 'x')`))), 'website visitors cannot call the login check');
ok(!!(await as('custA', () => tryQ(`select portal_sms_allow('0711000001')`))), 'signed-in customers cannot call the SMS limit');
await db.exec('set role service_role');
const smsOk = [];
for (let i = 0; i < 9; i++) smsOk.push((await db.query(`select portal_sms_allow('+94711000009') a`)).rows[0].a);
await db.exec('reset role');
ok(smsOk.slice(0, 8).every(Boolean) && smsOk[8] === false, 'at most 8 codes a day per number');
await db.exec(sql('security/verify.sql'));
ok((await db.query(`select count(*) n from security_check where result = 'FAIL'`)).rows[0].n == 0, 'verify.sql still all PASS with 05');
await db.exec(sql('security/rollback/05_rollback_customer_portal.sql'));
ok((await db.query(`select to_regprocedure('public.my_bookings()') f`)).rows[0].f === null, 'rollback removes the portal functions');

console.log('\n06 — breakdown management');
await db.exec(sql('security/06_breakdowns.sql'));
await db.exec(sql('security/06_breakdowns.sql'));   // safe to re-run
const incident = (id, booking, vehicle, owner) => `insert into breakdown_incidents (id, ref, booking_id, vehicle_id, owner_id, category, description, created_by)
  values ('${id}', 'BD-${id}', '${booking}', '${vehicle}', '${owner}', 'mechanical', 'Engine stopped', 'Admin')`;
ok((await as('admin', () => tryQ(incident('iA', 'bA', 'vA', 'oA')))) === null, 'admin can report a breakdown');
await as('admin', () => db.exec(incident('iB', 'bB', 'vB', 'oB')));
await as('admin', () => db.exec(`
  insert into breakdown_events (id, incident_id, by, type, text) values ('eA1', 'iA', 'Admin', 'created', 'Reported'), ('eB1', 'iB', 'Admin', 'created', 'Reported');
  insert into breakdown_solutions (id, incident_id, kind, created_by) values ('sA', 'iA', 'onsite_repair', 'Admin'), ('sB', 'iB', 'towing_garage', 'Admin');
  insert into breakdown_expenses (id, incident_id, solution_id, category, description, quantity, unit_cost, amount, created_by)
    values ('xA', 'iA', 'sA', 'labour', 'Labour', 2, 1500, 3000, 'Admin'), ('xB', 'iB', 'sB', 'towing', 'Tow', 1, 8000, 8000, 'Admin');
  insert into breakdown_allocations (id, incident_id, party, mode, value, amount, reason, decided_by) values ('aA', 'iA', 'owner', 'percent', 100, 3000, 'Wear and tear', 'Admin');
  insert into breakdown_payments (id, incident_id, kind, payer, payee, amount, idempotency_key, created_by) values ('pA', 'iA', 'vendor_payment', 'company', 'Garage', 3000, 'k-1', 'Admin');
  insert into breakdown_documents (id, incident_id, kind, name, path, uploaded_by) values ('dA', 'iA', 'photo', 'x.jpg', 'bA/breakdowns/iA/x.jpg', 'Admin');`));
for (const t of ['breakdown_incidents', 'breakdown_events', 'breakdown_solutions', 'breakdown_expenses', 'breakdown_allocations', 'breakdown_payments', 'breakdown_documents']) {
  const key = t === 'breakdown_incidents' ? 'id' : 'incident_id';
  const a = await as('A', () => ids(`select ${key} from ${t}`));
  ok(a.length > 0 && a.every((x) => x === 'iA'), `owner A sees only their incident in ${t}`);
}
ok((await as('B', () => ids('select id from breakdown_incidents'))).join() === 'iB', "owner B doesn't see owner A's incident");
ok(!!(await as('A', () => tryQ(incident('iX', 'bA', 'vA', 'oA')))), 'owners cannot report / change incidents (read-only)');
ok((await as('A', () => db.query(`update breakdown_payments set amount = 1 where id = 'pA' returning id`))).rows.length === 0, 'owners cannot change payments');
ok(!!(await as('anon', () => tryQ('select * from breakdown_incidents'))), 'website visitors have no access');
ok((await as('custA', () => ids('select id from breakdown_incidents'))).length === 0, 'customer logins see nothing');
ok(!!(await as('admin', () => tryQ(`delete from breakdown_payments where id = 'pA'`))), 'no one can delete financial history (even admins)');
ok(!!(await as('admin', () => tryQ(`delete from breakdown_incidents where id = 'iA'`))), '…or incidents');
ok(!!(await as('admin', () => tryQ(`insert into breakdown_payments (id, incident_id, kind, payer, payee, amount, idempotency_key, created_by) values ('pA2', 'iA', 'vendor_payment', 'company', 'Garage', 3000, 'k-1', 'Admin')`))), 'the same payment cannot be posted twice (one-time key)');
ok(!!(await as('admin', () => tryQ(`insert into breakdown_expenses (id, incident_id, category, description, quantity, unit_cost, amount, created_by) values ('xBad', 'iA', 'parts', 'Wrong total', 2, 1000, 5000, 'Admin')`))), 'an expense total must equal quantity × unit cost');
ok(!!(await as('admin', () => tryQ(`insert into breakdown_expenses (id, incident_id, category, description, quantity, unit_cost, amount, created_by) values ('xBad2', 'iA', 'parts', 'Negative part', 1, 1000, -1000, 'Admin')`))), 'only a discount can be negative');
ok((await as('admin', () => tryQ(`insert into breakdown_expenses (id, incident_id, category, description, quantity, unit_cost, amount, created_by) values ('xDisc', 'iA', 'discount', 'Goodwill', 1, 500, -500, 'Admin')`))) === null, 'a discount line is negative');
ok(!!(await as('admin', () => tryQ(`insert into breakdown_payments (id, incident_id, kind, payer, payee, amount, idempotency_key, created_by) values ('pZ', 'iA', 'refund', 'company', 'customer', 0, 'k-z', 'Admin')`))), 'payments must be more than zero');
ok(!!(await as('admin', () => tryQ(`insert into breakdown_incidents (id, ref, booking_id, category, description, created_by) values ('iZ', 'BD-iZ', 'no-such-booking', 'tyre', 'x', 'Admin')`))), 'every incident belongs to a real booking');
ok(!!(await as('admin', () => tryQ(`insert into breakdown_allocations (id, incident_id, party, mode, value, amount, reason, decided_by) values ('aBad', 'iA', 'owner', 'percent', 150, 0, 'x', 'Admin')`))), 'a share cannot be more than 100%');
await db.exec(sql('security/verify.sql'));
ok((await db.query(`select count(*) n from security_check where result = 'FAIL'`)).rows[0].n == 0, 'verify.sql still all PASS with 06');
await db.exec(sql('security/rollback/06_rollback_breakdowns.sql'));
ok((await db.query(`select to_regclass('public.breakdown_incidents') t`)).rows[0].t === null, 'rollback removes the breakdown tables');

console.log('\n07 — maintenance holds');
await db.exec(sql('security/06_breakdowns.sql'));
await db.exec(sql('security/07_breakdown_holds.sql'));
await db.exec(sql('security/07_breakdown_holds.sql'));   // safe to re-run
const vStatus = async (id) => (await db.query(`select status from vehicles where id = '${id}'`)).rows[0].status;
await db.exec(`update vehicles set status = 'Reserved' where id = 'vA'`);
const holdInc = (id) => `insert into breakdown_incidents (id, ref, booking_id, vehicle_id, owner_id, category, description, created_by, hold_vehicle_id, hold_placed_at)
  values ('${id}', 'BD-${id}', 'bA', 'vA', 'oA', 'overheating', 'Overheated', 'Admin', 'vA', now())`;
ok((await as('admin', () => tryQ(holdInc('h1')))) === null, 'reporting a breakdown places a hold');
ok(await vStatus('vA') === 'Maintenance', 'the vehicle is under maintenance straight away');
await as('admin', () => db.exec(`update vehicles set status = 'Available' where id = 'vA'`));
ok(await vStatus('vA') === 'Maintenance', 'while held, any status change is kept at Maintenance');
ok(/duplicate|unique/i.test((await as('admin', () => tryQ(holdInc('h2')))) ?? ''), 'only one active hold per vehicle');
ok(/Mark vehicle as ready/.test((await as('admin', () => tryQ(`update breakdown_incidents set hold_cleared_at = now() where id = 'h1'`))) ?? ''), 'a hold cannot be cleared by a plain update');
const ready = (who, safe = true, outcome = 'Radiator replaced, road-tested 20 km') => as(who, () => tryQ(`select breakdown_mark_vehicle_ready('h1', $1, $2, 'Garage invoice attached', null, 'Admin')`, [outcome, safe]));
ok(/Only an admin/.test((await ready('A')) ?? ''), 'owners cannot return a vehicle to service');
ok(/safe for rental/.test((await ready('admin', false)) ?? ''), 'needs the safety confirmation');
ok(/outcome/.test((await ready('admin', true, '  ')) ?? ''), 'needs the repair / inspection outcome');
ok(!!(await as('anon', () => tryQ(`select breakdown_mark_vehicle_ready('h1', 'x', true)`))), 'website visitors cannot call it');
ok(await vStatus('vA') === 'Maintenance', 'still under maintenance after the refused attempts');
ok((await ready('admin')) === null, 'admin confirms the vehicle ready');
const cleared = (await db.query(`select hold_cleared_at, hold_cleared_by, ready_outcome, ready_safe_confirmed from breakdown_incidents where id = 'h1'`)).rows[0];
ok(cleared.hold_cleared_at && cleared.ready_safe_confirmed === true && cleared.ready_outcome.startsWith('Radiator'), 'records the outcome, the safety confirmation and when');
ok(await vStatus('vA') === 'Reserved', 'availability comes back from its bookings (booking bA is confirmed → Reserved)');
ok((await db.query(`select count(*) n from breakdown_events where incident_id = 'h1' and type = 'ready'`)).rows[0].n == 1, 'writes the timeline entry in the same step');
ok(/no active maintenance hold/.test((await ready('admin')) ?? ''), 'cannot be confirmed twice');
ok(/re-opened/.test((await as('admin', () => tryQ(`update breakdown_incidents set hold_cleared_at = null where id = 'h1'`))) ?? ''), 'a cleared hold cannot be re-opened');
ok((await as('admin', () => tryQ(holdInc('h3')))) === null && await vStatus('vA') === 'Maintenance', 'a repeat breakdown is a new incident with a new hold');
ok((await db.query(`select count(*) n from breakdown_incidents where vehicle_id = 'vA'`)).rows[0].n == 2, 'both incidents stay in the vehicle history');
await db.exec(sql('security/verify.sql'));
ok((await db.query(`select count(*) n from security_check where result = 'FAIL'`)).rows[0].n == 0, 'verify.sql still all PASS with 07');
await db.exec(sql('security/rollback/07_rollback_breakdown_holds.sql'));
await db.exec(`update vehicles set status = 'Available' where id = 'vA'`);
ok(await vStatus('vA') === 'Available', 'rollback removes the rules (status can be changed by hand again)');
await db.exec(sql('security/rollback/06_rollback_breakdowns.sql'));

console.log('\n08 — breakdown vehicle swaps');
await db.exec(sql('security/06_breakdowns.sql'));
await db.exec(sql('security/07_breakdown_holds.sql'));
await db.exec(sql('security/08_breakdown_swaps.sql'));
await db.exec(sql('security/08_breakdown_swaps.sql'));   // safe to re-run
await as('admin', () => db.exec(`
  ${incident('iS', 'bA', 'vA', 'oA')};
  insert into breakdown_solutions (id, incident_id, kind, created_by) values ('sR', 'iS', 'replacement', 'Admin'), ('sP', 'iS', 'partner_vehicle', 'Admin');`));
const swap = (id, booking, repl, extra = '') => `insert into breakdown_vehicle_swaps (id, incident_id, solution_id, booking_id, original_vehicle_id, source, replacement_vehicle_id, out_at, out_by, replacement_rate${extra ? ', partner_name' : ''})
  values ('${id}', 'iS', 'sR', '${booking}', 'vA', '${repl ? 'fleet' : 'partner'}', ${repl ? `'${repl}'` : 'null'}, now(), 'Admin', 7000${extra ? `, '${extra}'` : ''})`;
const busyB = () => as('anon', () => count("select count(*) n from vehicle_busy_dates where vehicle_id = 'vB'"));
const busyAll = () => as('anon', () => count('select count(*) n from vehicle_busy_dates'));
const baseB = await busyB(), baseAll = await busyAll();
ok((await as('admin', () => tryQ(swap('w1', 'bA', 'vB')))) === null, 'admin records a replacement handed over (fleet car)');
ok(await busyB() === baseB + 1, 'the replacement shows as busy on the website while it is out');
ok(/duplicate|unique/i.test((await as('admin', () => tryQ(swap('w2', 'bA', null, 'Partner Co')))) ?? ''), 'only one active swap per booking');
ok(/duplicate|unique/i.test((await as('admin', () => tryQ(swap('w3', 'bB', 'vB')))) ?? ''), 'a fleet car can be out on only one swap');
ok(!!(await as('admin', () => tryQ(`insert into breakdown_vehicle_swaps (id, incident_id, solution_id, booking_id, source, out_at, out_by) values ('w4', 'iS', 'sR', 'bB', 'fleet', now(), 'Admin')`))), 'a fleet swap needs the replacement car');
ok((await as('A', () => ids('select id from breakdown_vehicle_swaps'))).join() === 'w1', "the original car's owner can see it");
ok((await as('B', () => ids('select id from breakdown_vehicle_swaps'))).join() === 'w1', "the replacement car's owner can see it");
ok(!!(await as('B', () => tryQ(swap('w5', 'bB', 'vA')))), 'owners cannot record swaps');
ok((await as('B', () => db.query(`update breakdown_vehicle_swaps set days = 99 where id = 'w1' returning id`))).rows.length === 0, 'owners cannot change swaps');
ok(!!(await as('anon', () => tryQ('select * from breakdown_vehicle_swaps'))), 'website visitors have no access to swap records');
ok(!!(await as('admin', () => tryQ(`update breakdown_vehicle_swaps set status = 'closed' where id = 'w1'`))), 'closing needs the outcome and return time');
ok((await as('admin', () => tryQ(`update breakdown_vehicle_swaps set status = 'closed', outcome = 'swapped_back', back_at = now(), back_by = 'Admin', days = 3, replacement_payout = 21000, original_deduction = 18000 where id = 'w1'`))) === null, 'admin records the swap back');
ok(await busyB() === baseB, 'after the swap back the replacement is free again on the website');
ok(/re-opened/.test((await as('admin', () => tryQ(`update breakdown_vehicle_swaps set status = 'active' where id = 'w1'`))) ?? ''), 'a finished swap cannot be re-opened');
ok(/cannot be changed/.test((await as('admin', () => tryQ(`update breakdown_vehicle_swaps set replacement_vehicle_id = 'vA' where id = 'w1'`))) ?? ''), 'its cars cannot be changed afterwards');
ok(!!(await as('admin', () => tryQ(`delete from breakdown_vehicle_swaps where id = 'w1'`))), 'swap history cannot be deleted');
ok((await as('admin', () => tryQ(swap('w6', 'bA', null, 'Lanka Partner Rentals')))) === null, 'a partner car can be recorded next (no fleet car needed)');
ok(await busyAll() === baseAll, "a partner car doesn't touch our calendar");
await db.exec(sql('security/verify.sql'));
ok((await db.query(`select count(*) n from security_check where result = 'FAIL'`)).rows[0].n == 0, 'verify.sql still all PASS with 08');
await db.exec(sql('security/rollback/08_rollback_breakdown_swaps.sql'));
ok((await db.query(`select to_regclass('public.breakdown_vehicle_swaps') t`)).rows[0].t === null
   && (await busyAll()) === baseAll, 'rollback removes the table and restores the calendar view');
await db.exec(sql('security/rollback/07_rollback_breakdown_holds.sql'));
await db.exec(sql('security/rollback/06_rollback_breakdowns.sql'));

console.log('\n09 — payout notes');
for (const f of ['06_breakdowns.sql', '07_breakdown_holds.sql', '08_breakdown_swaps.sql']) await db.exec(sql('security/' + f));
await as('admin', () => db.exec(`
  ${incident('iN', 'bA', 'vA', 'oA')};
  insert into breakdown_solutions (id, incident_id, kind, created_by) values ('sN', 'iN', 'replacement', 'Admin');
  insert into breakdown_vehicle_swaps (id, incident_id, solution_id, booking_id, original_vehicle_id, source, replacement_vehicle_id, out_at, out_by, replacement_rate,
                                       status, outcome, back_at, back_by, days, replacement_payout, commission_id)
    values ('wN', 'iN', 'sN', 'bA', 'vA', 'fleet', 'vB', '2026-10-16T14:00:00Z', 'Admin', 5000, 'closed', 'swapped_back', '2026-10-18T16:00:00Z', 'Admin', 2, 10000, 'sw-pay-wN');
  insert into commissions (id, booking_id, vehicle_id, owner_id, referral, total_income, commission_rate, commission_amount, owner_payout, coordinator_fee, status, created_at)
    values ('sw-pay-wN', 'bA', 'vB', 'oB', 'Direct', 10000, 0, 0, 10000, 0, 'Pending', '${now}');`));
await db.exec(sql('security/09_payout_notes.sql'));
await db.exec(sql('security/09_payout_notes.sql'));   // safe to re-run
const noteOf = async (id) => (await db.query(`select note from commissions where id = '${id}'`)).rows[0]?.note;
const n = await noteOf('sw-pay-wN');
ok(/Breakdown replacement: CBB-2222 replaced CAA-1111 \(BD-iN\).*2 days × Rs 5,000/.test(n ?? ''), 'the existing breakdown payout gets its reason');
ok((await as('B', () => db.query(`select note from commissions where id = 'sw-pay-wN'`))).rows[0]?.note === n, 'the replacement owner sees the reason on their payout');
ok((await db.query(`select count(*) n from notifications where owner_id = 'oB' and related_id = 'payout:sw-pay-wN'`)).rows[0].n == 1, 'the owner gets one alert about it (also on re-run)');
await as('B', () => db.query(`update commissions set note = 'I want more' where id = 'sw-pay-wN'`));
ok(await noteOf('sw-pay-wN') === n, 'owners cannot change the reason');
await as('B', () => db.exec(`insert into commissions (id, booking_id, vehicle_id, owner_id, referral, total_income, commission_rate, commission_amount, owner_payout, status, created_at, note)
  values ('kB2', 'bB', 'vB', 'oB', 'Direct', 1, 0, 0, 1, 'Pending', '${now}', 'self-written')`));
ok(await noteOf('kB2') === null, '…or write one on a new row');
await as('admin', () => db.query(`update commissions set note = 'Corrected by admin' where id = 'kB2'`));
ok(await noteOf('kB2') === 'Corrected by admin', 'admins can');
await db.exec(sql('security/verify.sql'));
ok((await db.query(`select count(*) n from security_check where result = 'FAIL'`)).rows[0].n == 0, 'verify.sql still all PASS with 09');
await db.exec(sql('security/rollback/09_rollback_payout_notes.sql'));
ok((await db.query(`select count(*) n from information_schema.columns where table_name = 'commissions' and column_name = 'note'`)).rows[0].n == 0, 'rollback removes the column');

console.log('\n11 — vehicle recovery, credit and bad debt');
await db.exec(sql('security/11_vehicle_recovery.sql'));
await db.exec(sql('security/11_vehicle_recovery.sql'));   // safe to re-run
const recovery = `{"return": {"at": "2026-10-22T06:50:00Z", "by": "Ceylon Admin", "odometer": 20000, "fuel": "Full", "items": {},
  "recovery": {"reason": "Non-payment", "details": "Rent unpaid, false NIC", "policeRef": "Kandy 45/2026", "customerFlagged": true}}}`;
const bk = async (id) => (await db.query(`select recovered, recovery_reason, bad_debt, credit_amount, checklists from bookings where id = '${id}'`)).rows[0];
ok((await bk('bA')).recovered === false, 'bookings are not recovered by default');
ok(/Only an admin can record/.test((await as('A', () => tryQ(`update bookings set checklists = '${recovery}'::jsonb where id = 'bA'`))) ?? ''), "an owner can't record a recovery on their own car's booking");
ok(/Only an admin can write off/.test((await as('A', () => tryQ(`update bookings set bad_debt = 5000 where id = 'bA'`))) ?? ''), "an owner can't write money off");
ok((await as('admin', () => tryQ(`update bookings set status = 'Completed', total_amount = 171613, checklists = '${recovery}'::jsonb,
  bad_debt = 100000, credit_amount = 71613, credit_settled = false where id = 'bA'`))) === null, 'admin records the recovery, the write-off and the credit');
const rec = await bk('bA');
ok(rec.recovered === true && rec.recovery_reason === 'Non-payment', 'the database marks it recovered, with the reason');
ok(/negative|check constraint/i.test((await as('admin', () => tryQ(`update bookings set bad_debt = -1 where id = 'bA'`))) ?? ''), 'bad debt cannot be negative');
ok(/negative|check constraint/i.test((await as('admin', () => tryQ(`update bookings set credit_amount = -1 where id = 'bA'`))) ?? ''), 'credit cannot be negative');
ok((await as('A', () => tryQ(`update bookings set notes = 'called the customer' where id = 'bA'`))) === null, 'the owner can still edit other things on that booking');
ok(/Only an admin can record/.test((await as('A', () => tryQ(`update bookings set checklists = checklists #- '{return,recovery}' where id = 'bA'`))) ?? ''), "…but can't remove the recovery");
ok(!!(await as('admin', () => tryQ(`update bookings set recovered = false where id = 'bA'`))), 'the recovered column is filled by the database only');
const vr = await as('admin', () => db.query(`select * from vehicle_recoveries`));
ok(vr.rows.length === 1 && vr.rows[0].booking_ref.startsWith('CRC-') && Number(vr.rows[0].bad_debt) === 100000
   && Number(vr.rows[0].credit_outstanding) === 71613 && vr.rows[0].police_ref === 'Kandy 45/2026', 'vehicle_recoveries lists it with the credit, bad debt and police ref');
ok((await as('A', () => ids('select booking_id as id from vehicle_recoveries'))).join() === 'bA', "the car's owner sees the recovery of their car");
ok((await as('B', () => ids('select booking_id as id from vehicle_recoveries'))).length === 0, "another owner doesn't");
ok(!!(await as('anon', () => tryQ('select * from vehicle_recoveries'))), 'website visitors have no access');
await db.exec(sql('security/verify.sql'));
ok((await db.query(`select count(*) n from security_check where result = 'FAIL'`)).rows[0].n == 0, 'verify.sql still all PASS with 11');
await db.exec(sql('security/rollback/11_rollback_vehicle_recovery.sql'));
const after = await db.query(`select bad_debt, credit_amount, checklists -> 'return' -> 'recovery' ->> 'reason' as reason from bookings where id = 'bA'`);
ok((await db.query(`select count(*) n from information_schema.columns where table_name = 'bookings' and column_name = 'recovered'`)).rows[0].n == 0
   && Number(after.rows[0].bad_debt) === 100000 && after.rows[0].reason === 'Non-payment', 'rollback removes the rules and keeps the data');


console.log('\n10 + 12 — swap mileage, readings from trip meters');
await db.exec(sql('security/10_swap_mileage.sql'));
await db.exec(sql('security/12_swap_trip_meters.sql'));
await db.exec(sql('security/12_swap_trip_meters.sql'));   // safe to re-run
const tm = (id, meters) => `insert into breakdown_vehicle_swaps (id, incident_id, solution_id, booking_id, original_vehicle_id, source, replacement_vehicle_id, out_at, out_by, replacement_rate, original_odometer, replacement_odometer_out, meters)
  values ('${id}', 'iN', 'sN', 'bB', 'vA', 'fleet', 'vB', now(), 'Admin', 5000, 24708, 2450, '${meters}')`;
ok(!!(await as('admin', () => tryQ(tm('wT0', '{"originalOdometer": "X"}')))), 'a meter must be odo, A, B or C');
ok(!!(await as('admin', () => tryQ(tm('wT0', '{"pickup": "A"}')))), '…and only on the four swap readings');
ok((await as('admin', () => tryQ(tm('wT1', '{"originalOdometer": "A"}')))) === null, 'admin records a breakdown reading taken from Trip A');
ok((await as('admin', () => tryQ(`update breakdown_vehicle_swaps set status = 'closed', outcome = 'swapped_back', back_at = now(), back_by = 'Admin', days = 2,
  replacement_odometer_in = 3100, original_odometer_back = 559, meters = '{"originalOdometer": "A", "originalOdometerBack": "B"}' where id = 'wT1'`))) === null,
  'Trip B going back (559) is not compared with Trip A at the breakdown (24,708)');
ok(/lower than at the breakdown/.test((await as('admin', () => tryQ(`update breakdown_vehicle_swaps set meters = '{"originalOdometer": "A", "originalOdometerBack": "A"}' where id = 'wT1'`))) ?? ''),
  'on the same meter the old rule still holds');
ok(/handed over/.test((await as('admin', () => tryQ(`update breakdown_vehicle_swaps set replacement_odometer_in = 100 where id = 'wT1'`))) ?? ''), "odometer readings still can't go backwards");
ok(/cannot be removed/.test((await as('admin', () => tryQ(`update breakdown_vehicle_swaps set original_odometer_back = null where id = 'wT1'`))) ?? ''), '…or be removed');
ok((await as('B', () => db.query(`update breakdown_vehicle_swaps set meters = null where id = 'wT1' returning id`))).rows.length === 0, 'owners cannot change the meters');
await db.exec(sql('security/verify.sql'));
ok((await db.query(`select count(*) n from security_check where result = 'FAIL'`)).rows[0].n == 0, 'verify.sql still all PASS with 10 + 12');
let rb12 = null;
try { await db.exec(sql('security/rollback/12_rollback_swap_trip_meters.sql')); } catch (e) { rb12 = e.message; }
ok(/keep 12/.test(rb12 ?? ''), 'rollback stops while a trip-meter reading would break the old rule');
await as('admin', () => db.exec(`update breakdown_vehicle_swaps set original_odometer_back = 25000, meters = '{"originalOdometer": "A", "originalOdometerBack": "A"}' where id = 'wT1'`));
await db.exec(sql('security/rollback/12_rollback_swap_trip_meters.sql'));
ok((await db.query(`select count(*) n from information_schema.columns where table_name = 'breakdown_vehicle_swaps' and column_name = 'meters'`)).rows[0].n == 0
   && Number((await db.query(`select original_odometer_back from breakdown_vehicle_swaps where id = 'wT1'`)).rows[0].original_odometer_back) === 25000,
   'rollback removes the meters and keeps the readings');

console.log('\n13 — partner applications ("List your vehicle")');
await db.exec(sql('security/05_customer_portal.sql'));
// Supabase's buckets table has these two columns
await db.exec(`alter table storage.buckets add column if not exists file_size_limit bigint; alter table storage.buckets add column if not exists allowed_mime_types text[]`);
await db.exec(sql('security/13_partner_applications.sql'));
await db.exec(sql('security/13_partner_applications.sql'));   // safe to re-run
claims.applicant = { sub: '00000000-0000-0000-0000-0000000000d1', role: 'authenticated', phone: '94765551234', app_metadata: { role: 'customer' } };
const sig = 'data:image/png;base64,' + 'A'.repeat(200);
const app = (o = {}) => JSON.stringify({ applicantType: 'individual', name: 'Nimal Perera', nic: '199012345678', address: '12 Lake Rd, Kandy',
  vehicleNumber: 'cab-1234', brand: 'Toyota', model: 'Axio', year: '2017', seats: '5', askingDaily: '9000',
  photos: ['94765551234/front.jpg'], documents: { cr: '94765551234/cr.pdf' },
  agreement: { version: 'v1', text: 'terms', name: 'Nimal Perera', signature: sig }, ...o });
const submit = (who, o) => as(who, async () => { try { return { id: (await db.query('select submit_partner_application($1::jsonb) id', [app(o)])).rows[0].id }; } catch (e) { return { err: e.message }; } });
let s1 = await submit('applicant');
ok(/^PA-[0-9A-F]{6}$/.test(s1.id ?? ''), 'a verified applicant sends an application (PA- reference)');
const row = (await db.query(`select * from partner_applications where id = $1`, [s1.id])).rows[0];
ok(row.phone === '94765551234' && row.status === 'Pending' && row.vehicle_number === 'CAB-1234', 'phone taken from the login, status Pending, number in capitals');
ok(row.agreement.signature === sig && row.agreement.acceptedAt, 'the signed agreement is kept with the time it was accepted');
ok(/sign the partner agreement/.test((await submit('applicant', { agreement: { name: 'x' } })).err ?? ''), 'no signature → refused');
ok(/price/.test((await submit('applicant', { askingDaily: '', askingMonthly: '' })).err ?? ''), 'no asking price → refused');
ok(/Company applications/.test((await submit('applicant', { applicantType: 'company' })).err ?? ''), 'company applications are not open yet');
ok(/photos could not be attached/.test((await submit('applicant', { photos: ['94771111111/x.jpg'] })).err ?? ''), "can't attach someone else's files");
ok(/documents could not/.test((await submit('applicant', { documents: { cr: '../94765551234/x.pdf' } })).err ?? ''), "…or odd file paths");
ok(/verify your phone/.test((await submit('ownerWithPhone')).err ?? ''), 'staff logins cannot apply through the website function');
ok(!!(await as('anon', () => tryQ('select submit_partner_application($1::jsonb)', [app()]))), 'website visitors (not verified) cannot apply');
const minePa = await as('applicant', async () => (await db.query('select * from my_partner_applications()')).rows);
ok(minePa.length === 1 && minePa[0].vehicle === 'Toyota Axio' && !('review_notes' in minePa[0]) && !('phone' in minePa[0]), 'the applicant sees their application, without admin notes');
ok((await as('stranger', async () => (await db.query('select * from my_partner_applications()')).rows)).length === 0, 'another number sees nothing');
ok((await as('applicant', () => ids('select id from partner_applications'))).length === 0, 'applicants have no direct table access');
ok((await as('A', () => ids('select id from partner_applications'))).length === 0, 'owners have no access');
ok(!!(await as('anon', () => tryQ('select id from partner_applications'))), 'website visitors have no access');
ok((await as('admin', () => ids('select id from partner_applications'))).length === 1, 'admin sees every application');
ok(/not waiting for a reply/.test((await as('applicant', () => tryQ(`select reply_partner_application($1, 'here', '[]', '{}')`, [s1.id]))) ?? ''), "can't reply unless asked for more info");
await as('admin', () => db.query(`update partner_applications set status = 'Needs info', info_request = 'Send the insurance', review_notes = 'secret' where id = $1`, [s1.id]));
ok((await as('applicant', async () => (await db.query('select info_request from my_partner_applications()')).rows[0].info_request)) === 'Send the insurance', "the applicant sees what the admin asked for");
ok((await as('applicant', () => tryQ(`select reply_partner_application($1, 'Attached', '[]', '{"insurance": "94765551234/ins.pdf"}')`, [s1.id]))) === null, '…and replies with the file');
const replied = (await db.query(`select status, documents, history from partner_applications where id = $1`, [s1.id])).rows[0];
ok(replied.status === 'Pending' && replied.documents.insurance === '94765551234/ins.pdf' && replied.documents.cr && replied.history.length === 2, 'back to Pending, file added, kept in the history');
ok(!!(await as('stranger', () => tryQ(`select reply_partner_application($1, 'x', '[]', '{}')`, [s1.id]))), "another number can't reply to it");
const up = (who, name) => as(who, () => tryQ(`insert into storage.objects (bucket_id, name) values ('partner-files', $1)`, [name]));
ok((await up('applicant', '94765551234/front2.jpg')) === null, 'applicant uploads into their own folder');
ok(!!(await up('applicant', '94771111111/x.jpg')), "…but not into someone else's");
ok(!!(await up('anon', '94765551234/x.jpg')), 'website visitors cannot upload');
ok((await as('applicant', () => ids(`select name from storage.objects where bucket_id = 'partner-files'`))).length === 0, "applicants can't list or open the files");
ok((await as('A', () => ids(`select name from storage.objects where bucket_id = 'partner-files'`))).length === 0, "owners can't either");
ok((await as('admin', () => ids(`select name from storage.objects where bucket_id = 'partner-files'`))).length === 1, 'admin opens the files');
ok((await db.query(`select public from storage.buckets where id = 'partner-files'`)).rows[0].public === false, 'the bucket is private');
for (let i = 0; i < 5; i++) await submit('applicant');
ok(/Too many applications/.test((await submit('applicant')).err ?? ''), 'at most 5 applications a day per number');
await db.exec(sql('security/verify.sql'));
ok((await db.query(`select count(*) n from security_check where result = 'FAIL'`)).rows[0].n == 0, 'verify.sql still all PASS with 13');
await db.exec(sql('security/rollback/13_rollback_partner_applications.sql'));
ok((await db.query(`select to_regprocedure('public.submit_partner_application(jsonb)') f`)).rows[0].f === null
   && Number((await db.query(`select count(*) n from partner_applications`)).rows[0].n) > 0, 'rollback removes the functions and keeps the applications');
console.log('\nWEDDING CARS (14)');
await db.exec(sql('security/14_wedding_cars.sql'));
await db.exec(sql('security/14_wedding_cars.sql'));   // safe to re-run
await db.exec("update vehicles set web_wedding = true where id = 'vA'");
const weddingRow = (await as('anon', async () => (await db.query('select * from wedding_vehicles')).rows));
ok(weddingRow.length === 1 && weddingRow[0].id === 'vA', 'visitors see only the ticked cars');
ok(!['daily_rent', 'web_price', 'vehicle_number', 'owner_id', 'revenue'].some((c) => c in weddingRow[0]), 'the view has no price, plate, owner or revenue');
const wedding = (o = {}, ip = '7.7.7.1') => as('anon', async () =>
  (await db.query('select submit_wedding_request($1::jsonb) ref', [JSON.stringify({
    name: 'Bride Family', phone: '0771110001', event: 'Wedding', date: soon(90), time: '09:30', venue: 'Galle Face Hotel',
    hours: 'Full day', decoration: 'Yes', vehicleId: 'vA', ...o,
  })])).rows[0].ref, ip);
const wedRef = await wedding();
ok(/^CRC-[A-F0-9]{6}$/.test(wedRef), 'a visitor can send a wedding request and gets a reference');
const wedInq = (await db.query("select * from inquiries where id = $1", ['web_' + wedRef.slice(4).toLowerCase()])).rows[0];
ok(wedInq?.status === 'Pending' && wedInq.referral === 'Website' && wedInq.vehicle_id === 'vA', 'it arrives as a Pending website inquiry for that car');
ok(wedInq.start_date === soon(90) && wedInq.end_date === soon(90), 'the event date is both inquiry dates');
ok(/Type: Wedding car/.test(wedInq.notes) && /Event: Wedding/.test(wedInq.notes) && /Pickup: Galle Face Hotel · .* 09:30/.test(wedInq.notes) && /Decoration: Yes/.test(wedInq.notes), 'event, venue, time and decoration are in the notes');
ok(!/Estimate/.test(wedInq.notes), 'no price estimate: the team quotes');
const wedAny = await wedding({ vehicleId: '', phone: '0771110002' }, '7.7.7.2');
const wedAnyRow = (await db.query("select * from inquiries where id = $1", ['web_' + wedAny.slice(4).toLowerCase()])).rows[0];
ok(wedAnyRow.vehicle_id === null && /help me choose/.test(wedAnyRow.requested_vehicle), 'no car chosen: the team is asked to suggest one');
const wedFails = async (o, re, msg) => {
  const e = await wedding({ phone: '0771110003', ...o }, '7.7.7.3').then(() => '', (x) => x.message);
  ok(re.test(e), msg);
};
await wedFails({ vehicleId: 'vB' }, /isn.t available for weddings/, 'a car that is not ticked is refused');
await wedFails({ vehicleId: 'nope' }, /isn.t available for weddings/, 'an unknown car is refused');
await wedFails({ date: '2020-01-01' }, /past/, 'a past date is refused');
await wedFails({ date: '2027-02-31' }, /choose the date/, 'an impossible date gets a clear message');
await wedFails({ date: 'soon' }, /choose the date/, 'a date that is not a date is refused');
await wedFails({ date: soon(800) }, /two years/, 'a date too far ahead is refused');
await wedFails({ event: 'Party' }, /type of event/, 'an unknown event type is refused');
await wedFails({ venue: '' }, /venue/, 'a missing venue is refused');
await wedFails({ name: 'x' }, /full name/, 'a missing name is refused');
await wedFails({ phone: '12' }, /valid phone/, 'a bad phone is refused');
const wedLimit = await wedding({ phone: '0771110004' }, '7.7.7.4').then(() => 'sent', (x) => x.message);
ok(wedLimit === 'sent', 'mistakes do not use up the visitor\'s tries');
for (let i = 0; i < 2; i++) await wedding({ phone: '0771110005' }, '7.7.7.' + (10 + i));
const wedThird = await wedding({ phone: '0771110005' }, '7.7.7.12').then(() => '', () => '');
const wedFourth = await wedding({ phone: '0771110005' }, '7.7.7.13').then(() => '', (x) => x.message);
ok(wedThird === '' && /recent requests/.test(wedFourth), 'one number can send 3 requests a day');
await db.exec("update bookings set status = 'Confirmed', start_date = '" + soon(200) + "', end_date = '" + soon(202) + "' where id = 'bA'");
const wedBusyRef = await wedding({ phone: '0771110006', date: soon(201) }, '7.7.7.20');
ok(/already has a booking/.test((await db.query('select notes from inquiries where id = $1', ['web_' + wedBusyRef.slice(4).toLowerCase()])).rows[0].notes), 'a date the car is already booked is flagged for the team');
ok(!!(await as('anon', () => tryQ("update vehicles set web_wedding = true where id = 'vB'"))), 'visitors cannot tick cars');
ok(!!(await as('anon', () => tryQ("select web_wedding from vehicles"))), 'visitors still cannot read the vehicles table');
await db.exec(sql('security/verify.sql'));
ok((await db.query("select count(*) n from security_check where result = 'FAIL'")).rows[0].n == 0, 'verify.sql still all PASS with 14');
await db.exec(sql('security/rollback/14_rollback_wedding_cars.sql'));
ok((await db.query("select to_regprocedure('public.submit_wedding_request(jsonb)') f, to_regclass('public.wedding_vehicles') v")).rows[0].f === null, 'rollback removes the function and view');
ok(Number((await db.query("select count(*) n from vehicles where web_wedding")).rows[0].n) === 1, 'rollback keeps the ticks');

console.log('\nVEHICLE DELETE GUARD (15)');
await db.exec(sql('security/15_vehicle_delete_guard.sql'));
await db.exec(sql('security/15_vehicle_delete_guard.sql'));   // safe to re-run
await db.exec(`insert into vehicles (id, vehicle_number, brand, model, year, owner_id, daily_rent, status, created_at) values ('vDel', 'CDD-0001', 'Suzuki', 'Alto', 2015, 'oA', 4000, 'Available', '${now}');
  insert into bookings (id, vehicle_id, customer_id, customer_name, customer_phone, start_date, end_date, total_days, total_amount, paid_amount, status, referral, created_at)
  values ('bDel', 'vDel', 'cA', 'Customer of A', '0711000001', '${soon(5)}', '${soon(6)}', 1, 4000, 0, 'Ongoing', 'Direct', '${now}')`);
ok(/1 confirmed or ongoing/.test(await as('admin', () => tryQ("delete from vehicles where id = 'vDel'")) ?? ''), 'a car with an ongoing booking cannot be deleted, even by an admin');
await db.exec("update bookings set status = 'Completed' where id = 'bDel'");
ok((await as('admin', () => tryQ("delete from vehicles where id = 'vDel'"))) === null, 'once the booking is completed the car can be deleted');
ok((await db.query("select vehicle_id from bookings where id = 'bDel'")).rows[0].vehicle_id === null, 'the finished booking keeps its history (car cleared)');
await db.exec(sql('security/rollback/15_rollback_vehicle_delete_guard.sql'));
ok((await db.query("select count(*) n from pg_trigger where tgname = 'guard_vehicle_delete'")).rows[0].n == 0, 'rollback removes the guard');
await db.exec(sql('security/15_vehicle_delete_guard.sql'));

console.log('\nSTAFF ROLES (16)');
await db.exec(sql('security/11_vehicle_recovery.sql'));   // the recovery / write-off rule, as in production
await db.exec(sql('security/16_staff_roles.sql'));
await db.exec(sql('security/16_staff_roles.sql'));   // safe to re-run
let staffN = 0;
const staff = (perms) => ({ sub: `00000000-0000-0000-0000-0000000000f${staffN++}`, role: 'authenticated', app_metadata: { role: 'staff', permissions: perms } });
claims.ops = staff({ canBook: true, canChangeStatus: true, canViewInquiries: true, canViewCustomers: true, canViewDrivers: true, canViewHandovers: true, canManageBreakdowns: true });
claims.fin = staff({ canBook: true, canViewInquiries: true, canViewCustomers: true, canTakePayments: true, canViewFinance: true, canViewExpenses: true, canAddExpenses: true });
claims.fleet = staff({ canViewHandovers: true, canChangeStatus: true, canManageBreakdowns: true });
claims.none = staff({});
claims.veh = staff({ canEditVehicle: true });
await db.exec("update bookings set status = 'Confirmed', paid_amount = 0 where id = 'bA'");

ok((await as('fleet', () => ids('select id from bookings'))).length >= 2, 'every staff login sees the whole booking schedule');
ok((await as('none', () => ids('select id from customers'))).length >= 2, 'staff see customers');
ok((await as('fleet', () => ids('select id from expenses'))).length === 0, 'Fleet cannot see expenses');
ok((await as('fin', () => ids('select id from expenses'))).length >= 2, 'Finance sees expenses');
ok((await as('fleet', () => ids('select id from commissions'))).length >= 2 && (await as('none', () => ids('select id from commissions'))).length === 0, 'commissions: only staff whose work touches them');
ok((await as('fleet', () => ids('select id from inquiries'))).length === 0 && (await as('ops', () => ids('select id from inquiries'))).length >= 1, 'inquiries: Operations yes, Fleet no');
ok((await as('fin', () => ids('select id from partner_applications'))).length === 0 && (await as('fin', () => ids('select phone from sms_opt_out'))).length === 0, 'partner applications and SMS opt-outs stay admin-only');
ok((await as('ops', () => ids('select id from notifications'))).join() === 'nAll', 'staff see company alerts, not the ones addressed to an owner');

const newBooking = (id, paid) => `insert into bookings (id, vehicle_id, customer_id, customer_name, customer_phone, start_date, end_date, total_days, total_amount, paid_amount, status, created_at) values ('${id}', 'vA', 'cA', 'x', '0711000001', '${soon(80)}', '${soon(81)}', 1, 1000, ${paid}, 'Confirmed', '${now}')`;
ok(!!(await as('fleet', () => tryQ(newBooking('bF', 0)))) && (await as('ops', () => tryQ(newBooking('bO', 500)))) === null,
   'Operations can create a booking (with its advance); Fleet cannot');
await as('fleet', () => db.query(`update bookings set status = 'Ongoing', paid_amount = 99999, discount = 5000, checklists = coalesce(checklists, '{}') || '{"pickup":{"odometer":100}}' where id = 'bA'`));
const bA = (await db.query("select * from bookings where id = 'bA'")).rows[0];
ok(bA.status === 'Ongoing' && bA.checklists?.pickup?.odometer === 100, 'Fleet can start a rental (status + checklist)');
ok(Number(bA.paid_amount) === 0 && bA.discount === null, '…but the payment and discount it tried to set are put back');
await as('fin', () => db.query("update bookings set paid_amount = 6000 where id = 'bA'"));
ok(Number((await db.query("select paid_amount from bookings where id = 'bA'")).rows[0].paid_amount) === 6000, 'Finance records the payment');
ok(!!(await as('fin', () => tryQ("update bookings set bad_debt = 100 where id = 'bA'"))), 'writing money off stays admin-only (Brian)');
ok((await as('none', () => db.query("update bookings set status = 'Cancelled' where id = 'bA' returning id"))).rows.length === 0, 'a login with no booking abilities changes nothing');
ok((await as('fin', () => db.query("delete from bookings where id = 'bA' returning id"))).rows.length === 0
   && (await as('fin', () => db.query("delete from expenses where id = 'eA' returning id"))).rows.length === 0
   && (await as('fleet', () => db.query("delete from handovers where id = 'hA' returning id"))).rows.length === 0, 'staff cannot delete bookings, expenses or handovers');

await as('fleet', () => db.query("update vehicles set status = 'Maintenance', mileage = 5000, daily_rent = 1, brand = 'Hacked', owner_id = 'oB' where id = 'vA'"));
let vA = (await db.query("select * from vehicles where id = 'vA'")).rows[0];
ok(vA.status === 'Maintenance' && vA.mileage === 5000, 'Fleet updates a car\'s status and mileage');
ok(Number(vA.daily_rent) === 6000 && vA.brand === 'Toyota' && vA.owner_id === 'oA', '…but not its price, details or owner');
await as('veh', () => db.query("update vehicles set color = 'Red', daily_rent = 1, web_featured = true where id = 'vA'"));
vA = (await db.query("select * from vehicles where id = 'vA'")).rows[0];
ok(vA.color === 'Red' && Number(vA.daily_rent) === 6000 && !vA.web_featured, 'vehicle editors change details, never the price or website listing');
ok((await as('none', () => db.query("update vehicles set status = 'Available' where id = 'vA' returning id"))).rows.length === 0, 'a login without car-related abilities cannot change cars');
claims.prices = staff({ canEditPrices: true });
await as('prices', () => db.query("update vehicles set daily_rent = 7000, extra_km_rate = 60, included_km_per_day = 120, color = 'Blue', web_price = 1, owner_id = 'oB' where id = 'vA'"));
vA = (await db.query("select * from vehicles where id = 'vA'")).rows[0];
ok(Number(vA.daily_rent) === 7000 && Number(vA.extra_km_rate) === 60 && Number(vA.included_km_per_day) === 120, 'with "Edit prices" a team member changes a car\'s fixed prices');
ok(vA.color === 'Red' && vA.web_price === null && vA.owner_id === 'oA', '…but not its other details, website price or owner (without "Edit vehicle details")');
claims.vehPrices = staff({ canEditVehicle: true, canEditPrices: true });
await as('vehPrices', () => db.query("update vehicles set daily_rent = 6000, color = 'White' where id = 'vA'"));
vA = (await db.query("select * from vehicles where id = 'vA'")).rows[0];
ok(Number(vA.daily_rent) === 6000 && vA.color === 'White', 'with both, details and prices change together');

await as('fin', () => db.query("update owners set pending_payout = 100, commission_rate = 1, bank_account = 'x', phone = '1' where id = 'oA'"));
const oA = (await db.query("select * from owners where id = 'oA'")).rows[0];
ok(Number(oA.pending_payout) === 100, 'Finance records an owner payout');
ok(Number(oA.commission_rate) !== 1 && oA.bank_account !== 'x' && oA.phone !== '1', '…but not the owner\'s rate, bank account or details');
ok((await as('ops', () => db.query("update owners set pending_payout = 0 where id = 'oA' returning id"))).rows.length === 0, 'Operations cannot change owners');
await as('ops', () => db.query("update commissions set status = 'Paid', owner_payout = 11000 where id = 'kA'"));
const kA = (await db.query("select * from commissions where id = 'kA'")).rows[0];
ok(kA.status === 'Pending' && Number(kA.owner_payout) === 11000, 'Operations can adjust a commission line but not mark it paid');
await as('fin', () => db.query("update commissions set status = 'Paid' where id = 'kA'"));
ok((await db.query("select status from commissions where id = 'kA'")).rows[0].status === 'Paid', 'Finance marks a payout paid');

await as('A', () => db.query("update owners set pending_payout = 0 where id = 'oA'"));
ok(Number((await db.query("select pending_payout from owners where id = 'oA'")).rows[0].pending_payout) === 100, 'owners still cannot change their own payout');
ok((await as('B', () => ids('select id from expenses'))).join() === 'eB', 'owner scoping is unchanged');

ok((await as('fleet', () => ids("select name from storage.objects where bucket_id = 'booking-files'"))).length >= 2, 'staff open booking files');
ok((await as('fleet', () => tryQ("insert into storage.objects (bucket_id, name) values ('booking-files', 'bA/return.jpg')"))) === null, 'Fleet uploads return photos');
ok(!!(await as('fin', () => tryQ("insert into storage.objects (bucket_id, name) values ('vehicle-images', 'vA/x.jpg')"))), 'Finance cannot change vehicle photos');
ok((await as('fleet', () => db.query("delete from storage.objects where bucket_id = 'booking-files' returning id"))).rows.length === 0, 'staff cannot delete files');

ok((await as('anon', () => tryQ('select id from bookings'))) !== null, 'website visitors still cannot read bookings');
await db.exec(sql('security/verify.sql'));
ok((await db.query("select count(*) n from security_check where result = 'FAIL'")).rows[0].n == 0, 'verify.sql still all PASS with 16');

await db.exec(sql('security/01_scoped_access.sql'));
ok((await as('fleet', () => ids('select id from bookings'))).length === 0, 're-running 01 removes staff access (checklist: run 16 again)');
await db.exec(sql('security/16_staff_roles.sql'));
ok((await as('fleet', () => ids('select id from bookings'))).length >= 2, '…and running 16 again restores it');
await db.exec(sql('security/rollback/16_rollback_staff_roles.sql'));
ok((await as('ops', () => ids('select id from bookings'))).length === 0 && (await as('admin', () => ids('select id from bookings'))).length >= 2, 'rollback: staff lose access, admins keep everything');
await as('A', () => db.query("update owners set pending_payout = 0 where id = 'oA'"));
ok(Number((await db.query("select pending_payout from owners where id = 'oA'")).rows[0].pending_payout) === 100, 'rollback keeps the owner rule');


console.log('\nOWNER SETTLEMENTS (17)');
await db.exec(sql('security/16_staff_roles.sql'));
await db.exec(sql('security/17_owner_settlements.sql'));
await db.exec(sql('security/17_owner_settlements.sql'));   // safe to re-run
// a completed rental on A's car, an owed-back line, a company-paid expense, and a referral fee A earned on B's car
await db.exec(`
  insert into bookings (id, vehicle_id, customer_id, customer_name, customer_phone, start_date, end_date, total_days, total_amount, paid_amount, status, referral, created_at)
    values ('bS1', 'vA', 'cA', 'Customer of A', '0711000001', '2026-10-01', '2026-10-05', 4, 40000, 10000, 'Completed', 'Direct', '${now}'),
           ('bS2', 'vB', 'cB', 'Customer of B', '0711000002', '2026-10-10', '2026-10-12', 2, 20000, 20000, 'Completed', 'Alice Owner', '${now}');
  update bookings set referral_fee = 2000, referral_paid = false where id = 'bS2';
  insert into commissions (id, booking_id, vehicle_id, owner_id, referral, total_income, commission_rate, commission_amount, owner_payout, coordinator_fee, status, created_at) values
    ('kS1', 'bS1', 'vA', 'oA', 'Direct', 40000, 0, 0, 34000, 0, 'Pending', '${now}'),
    ('kS2', 'bS1', 'vA', 'oA', 'Direct', 0, 0, 0, -1500, 0, 'Pending', '${now}');
  insert into expenses (id, vehicle_id, category, amount, description, date, created_at, paid_by) values
    ('eS1', 'vA', 'Service', 3000, 'oil change', '2026-10-20', '${now}', 'company');
  update owners set pending_payout = 50000 where id = 'oA';
`);
const lines = JSON.stringify([
  { kind: 'rental', id: 'kS1', label: 'bS1', amount: 34000 },
  { kind: 'deduction', id: 'kS2', label: 'tyres', amount: -1500 },
  { kind: 'expense', id: 'eS1', label: 'oil', amount: -3000 },
  { kind: 'referral', id: 'bS2', label: 'ref', amount: 2000 },
]);
const prepare = (who, id = 'stA') => as(who, () => tryQ(
  `insert into owner_settlements (id, owner_id, period, status, lines, rentals, deductions, expenses, referral_fees, net, approved_by)
   values ($1, 'oA', '2026-10', 'paid', $2::jsonb, 34000, -1500, 3000, 2000, 31500, 'me')`, [id, lines]));

ok(!!(await prepare('ops')) && !!(await prepare('fleet')), 'only Finance (or an admin) can prepare a settlement');
ok((await prepare('fin')) === null, 'Finance prepares October for owner A');
let st = (await db.query("select * from owner_settlements where id = 'stA'")).rows[0];
ok(st.status === 'pending_approval' && st.approved_by === null, 'it starts as waiting for approval, whatever status was sent');
ok(!!(await as('fin', () => tryQ("select review_owner_settlement('stA', true)"))), 'Finance cannot approve its own settlement');
ok(!!(await as('A', () => tryQ("update owner_settlements set status = 'approved' where id = 'stA'"))) || (await db.query("select status from owner_settlements where id='stA'")).rows[0].status === 'pending_approval', 'nobody approves by editing the row');
ok((await as('A', () => ids('select id from owner_settlements'))).length === 0, 'the owner does not see it before it is paid');
ok(!!(await as('admin', () => tryQ("select review_owner_settlement('stA', false, '')"))), 'sending back needs a reason');
await as('admin', () => db.query("select review_owner_settlement('stA', false, 'Check the tyres line')"));
ok((await db.query("select status, review_note from owner_settlements where id='stA'")).rows[0].review_note === 'Check the tyres line', 'Brian sends it back with a note');
ok(!!(await as('fin', () => tryQ("select pay_owner_settlement('stA', 'Bank transfer', 'REF1')"))), 'a returned settlement cannot be paid');
await as('fin', () => db.query("update owner_settlements set net = 31500 where id = 'stA'"));
ok((await db.query("select status from owner_settlements where id='stA'")).rows[0].status === 'pending_approval', 'Finance prepares it again → waiting for approval');
await as('admin', () => db.query("select review_owner_settlement('stA', true, null)"));
st = (await db.query("select * from owner_settlements where id = 'stA'")).rows[0];
ok(st.status === 'approved' && !!st.approved_by, 'Brian approves');
ok(!!(await as('fin', () => tryQ("update owner_settlements set net = 999999 where id = 'stA'"))) || Number((await db.query("select net from owner_settlements where id='stA'")).rows[0].net) === 31500, 'an approved settlement cannot be edited');
ok((await as('fin', () => db.query("delete from owner_settlements where id = 'stA' returning id"))).rows.length === 0, '…or withdrawn');
ok(!!(await as('fin', () => tryQ("select pay_owner_settlement('stA', 'Bank transfer', '')"))), 'a payment needs its bank reference');
ok(!!(await as('ops', () => tryQ("select pay_owner_settlement('stA', 'Bank transfer', 'REF1')"))), 'Operations cannot record owner payouts');
// a line changed after approval: refused
await db.exec("update commissions set owner_payout = 34500 where id = 'kS1'");
ok(/changed after it was prepared/.test(await as('fin', () => tryQ("select pay_owner_settlement('stA', 'Bank transfer', 'REF1')")) ?? ''), 'a payout line changed after approval stops the payment');
ok((await db.query("select status from commissions where id = 'kS1'")).rows[0].status === 'Pending', '…and nothing is half-paid');
await db.exec("update commissions set owner_payout = 34000 where id = 'kS1'");
ok((await as('fin', () => tryQ("select pay_owner_settlement('stA', 'Bank transfer', 'REF1')"))) === null, 'Finance records the bank transfer');
st = (await db.query("select * from owner_settlements where id = 'stA'")).rows[0];
ok(st.status === 'paid' && st.pay_ref === 'REF1' && !!st.paid_at, 'it is paid, with the reference and date');
const ks = (await db.query("select id, status, settlement_id from commissions where id in ('kS1','kS2') order by id")).rows;
ok(ks.every((k) => k.status === 'Paid' && k.settlement_id === 'stA'), 'its payout lines are Paid and linked to the settlement');
ok((await db.query("select settlement_id from expenses where id='eS1'")).rows[0].settlement_id === 'stA', 'the expense is marked as taken off');
const bs2 = (await db.query("select referral_paid, referral_settlement_id from bookings where id='bS2'")).rows[0];
ok(bs2.referral_paid === true && bs2.referral_settlement_id === 'stA', 'the referral fee is marked paid');
ok(Number((await db.query("select pending_payout from owners where id='oA'")).rows[0].pending_payout) === 50000 - (34000 - 1500 + 2000), "the owner's pending payout drops by what was paid");
// locked history
ok(/settled with the owner/.test(await as('admin', () => tryQ("update commissions set owner_payout = 1 where id = 'kS1'")) ?? ''), 'a settled payout line cannot be changed — even by an admin');
ok(/settled with the owner/.test(await as('admin', () => tryQ("delete from expenses where id = 'eS1'")) ?? ''), 'a settled expense cannot be deleted');
{ const e = await as('admin', () => tryQ("update expenses set amount = 1 where id = 'eS1'")); if (!/settled with the owner/.test(e ?? '')) console.log('   expense update said:', e); ok(/settled with the owner/.test(e ?? ''), '…or changed'); }
ok(/Owner Settlements page/.test(await as('admin', () => tryQ("update commissions set settlement_id = 'stA' where id = 'kA'")) ?? ''), 'lines are only settled through a payment');
ok(!!(await as('admin', () => tryQ("update owner_settlements set net = 1 where id = 'stA'"))), 'a paid settlement cannot be edited');
ok((await as('admin', () => tryQ("select pay_owner_settlement('stA', 'Bank transfer', 'REF2')"))) !== null, 'it cannot be paid twice');
// the owner
ok((await as('A', () => ids('select id from owner_settlements'))).join() === 'stA', 'owner A now sees their statement');
ok((await as('B', () => ids('select id from owner_settlements'))).length === 0, 'owner B does not see A\'s');
ok(!!(await as('B', () => tryQ("select confirm_owner_settlement('stA')"))), 'owner B cannot confirm it');
await as('A', () => db.query("select confirm_owner_settlement('stA', 'Received, thanks')"));
st = (await db.query("select * from owner_settlements where id = 'stA'")).rows[0];
ok(st.status === 'confirmed' && st.owner_note === 'Received, thanks' && !!st.owner_confirmed_at, 'owner A confirms receipt');
ok(!!(await as('anon', () => tryQ("select confirm_owner_settlement('stA')"))) && !!(await as('anon', () => tryQ('select id from owner_settlements'))), 'website visitors have no access');
ok(!!(await prepare('fin')), 'one settlement per owner per month');
await db.exec(sql('security/verify.sql'));
ok((await db.query("select count(*) n from security_check where result = 'FAIL'")).rows[0].n == 0, 'verify.sql still all PASS with 17');
await db.exec(sql('security/rollback/17_rollback_owner_settlements.sql'));
ok((await db.query("select to_regprocedure('public.pay_owner_settlement(text,text,text,timestamptz,text)') f")).rows[0].f === null
   && Number((await db.query('select count(*) n from owner_settlements')).rows[0].n) === 1, 'rollback removes the functions and keeps the history');


console.log('\nCOMPANY ACCOUNTS (18)');
await db.exec(sql('security/16_staff_roles.sql'));
await db.exec(sql('security/17_owner_settlements.sql'));
await db.exec(sql('security/18_company_accounts.sql'));
await db.exec(sql('security/18_company_accounts.sql'));   // safe to re-run
claims.boss = { sub: '00000000-0000-0000-0000-0000000000b9', role: 'authenticated', app_metadata: { role: 'admin', name: 'Brian' } };
claims.fin2 = { sub: '00000000-0000-0000-0000-0000000000f9', role: 'authenticated', app_metadata: { role: 'staff', name: 'Dinithi', permissions: { canViewFinance: true, canTakePayments: true } } };

ok(!!(await as('fin2', () => tryQ("insert into company_accounts (id, name, kind) values ('acX', 'x', 'cash')"))), 'only admins set up accounts');
await as('boss', () => db.query("insert into company_accounts (id, name, kind, opening_balance) values ('acCash', 'Cash in hand', 'cash', 10000), ('acBank', 'BOC current', 'bank', 500000)"));
ok((await as('fin2', () => ids('select id from company_accounts'))).length === 2, 'Finance sees the accounts');
ok((await as('ops', () => ids('select id from company_accounts'))).length === 0 && (await as('A', () => ids('select id from company_accounts'))).length === 0, 'Operations and owners do not');
ok(!!(await as('anon', () => tryQ('select id from company_accounts'))), 'website visitors have no access');

// expenses: small ones approved at once, big ones wait for Brian
await as('fin2', () => db.query("insert into company_expenses (id, date, category, amount, description, status, approved_by) values ('ce1', '2026-11-03', 'Electricity', 8000, 'CEB bill', 'paid', 'me'), ('ce2', '2026-11-04', 'Rent', 60000, 'Office rent', 'approved', 'me')"));
let ce = Object.fromEntries((await db.query("select id, status, requested_by, approved_by from company_expenses")).rows.map((r) => [r.id, r]));
ok(ce.ce1.status === 'approved' && /Auto/.test(ce.ce1.approved_by) && ce.ce1.requested_by === 'Dinithi', 'a small expense is approved at once (whatever status was sent)');
ok(ce.ce2.status === 'pending' && ce.ce2.approved_by === null, 'one over the approval limit waits for Brian');
ok(!!(await as('fin2', () => tryQ("update company_expenses set status = 'approved' where id = 'ce2'"))), 'Finance cannot approve it');
ok(!!(await as('fin2', () => tryQ("select review_company_expense('ce2', true)"))), '…not even through the function');
ok(!!(await as('fin2', () => tryQ("update company_expenses set status = 'paid', account_id = 'acBank' where id = 'ce2'"))), 'an unapproved expense cannot be paid');
ok(!!(await as('boss', () => tryQ("select review_company_expense('ce2', false, '')"))), 'rejecting needs a reason');
await as('boss', () => db.query("select review_company_expense('ce2', true)"));
ok((await db.query("select status, approved_by from company_expenses where id='ce2'")).rows[0].approved_by === 'Brian', 'Brian approves it');
ok(!!(await as('fin2', () => tryQ("update company_expenses set amount = 1 where id = 'ce2'"))), 'an approved expense cannot be changed');
ok(!!(await as('fin2', () => tryQ("update company_expenses set status = 'paid' where id = 'ce2'"))), 'paying needs the account');
await as('fin2', () => db.query("update company_expenses set status = 'paid', account_id = 'acBank', paid_on = '2026-11-05' where id = 'ce2'"));
ce = (await db.query("select * from company_expenses where id='ce2'")).rows[0];
ok(ce.status === 'paid' && ce.paid_by === 'Dinithi' && ce.account_id === 'acBank', 'Finance pays it from the bank account');
ok(!!(await as('fin2', () => tryQ("update company_expenses set description = 'x' where id = 'ce2'"))), 'a paid expense is final for Finance');
ok((await as('fin2', () => db.query("delete from company_expenses where id = 'ce2' returning id"))).rows.length === 0 || !!(await as('fin2', () => tryQ("delete from company_expenses where id = 'ce2'"))), 'and cannot be deleted');
// private costs (salaries) are Brian's only
await as('boss', () => db.query("insert into company_expenses (id, date, category, amount, description, private) values ('ce3', '2026-11-06', 'Salaries', 90000, 'November salaries', true)"));
ok((await as('fin2', () => ids('select id from company_expenses'))).join() === 'ce1,ce2', 'Finance does not see private costs');
ok((await db.query("select status from company_expenses where id='ce3'")).rows[0].status === 'approved', "an admin's own expense is approved");
ok(!!(await as('fin2', () => tryQ("insert into company_expenses (id, date, category, amount, description, private) values ('ce4', '2026-11-06', 'Salaries', 1, 'x', true)"))), 'Finance cannot add private ones');
ok((await as('ops', () => ids('select id from company_expenses'))).length === 0, 'Operations sees no company expenses');

// transfers
await as('fin2', () => db.query("insert into account_transfers (id, date, from_account, to_account, amount, note) values ('t1', '2026-11-07', 'acCash', 'acBank', 5000, 'banked')"));
ok((await db.query("select by_name from account_transfers where id='t1'")).rows[0].by_name === 'Dinithi', 'Finance moves cash to the bank (recorded under their name)');
ok(!!(await as('fin2', () => tryQ("insert into account_transfers (id, date, from_account, to_account, amount) values ('t2', '2026-11-07', 'acCash', 'acCash', 5)"))), 'a transfer needs two different accounts');
ok((await as('fin2', () => db.query("delete from account_transfers where id = 't1' returning id"))).rows.length === 0, 'Finance cannot delete a transfer');

// month close
ok(!!(await as('fin2', () => tryQ("insert into month_closes (period, closed_by) values ('2026-11', 'x')"))), 'only an admin closes a month');
await as('boss', () => db.query("insert into month_closes (period, closed_by, summary) values ('2026-11', 'Brian', '{\"profit\": 1}')"));
ok(/month is closed/.test(await as('fin2', () => tryQ("insert into company_expenses (id, date, category, amount, description) values ('ce5', '2026-11-20', 'Fuel', 100, 'x')")) ?? ''), 'no new expense in a closed month');
ok(/month is closed/.test(await as('boss', () => tryQ("update company_expenses set description = 'y' where id = 'ce1'")) ?? ''), 'no changes in a closed month — even for an admin');
ok(/month is closed/.test(await as('fin2', () => tryQ("insert into account_transfers (id, date, from_account, to_account, amount) values ('t3', '2026-11-08', 'acCash', 'acBank', 5)")) ?? ''), 'no transfers in a closed month');
ok((await as('fin2', () => tryQ("insert into company_expenses (id, date, category, amount, description) values ('ce6', '2026-12-01', 'Fuel', 100, 'x')"))) === null, 'the next month is open');
await as('boss', () => db.query("delete from month_closes where period = '2026-11'"));
ok((await as('boss', () => tryQ("update company_expenses set description = 'y' where id = 'ce1'"))) === null, 'an admin can reopen a month');

// owner payout account
await db.exec("insert into owner_settlements (id, owner_id, period, status, lines, net) values ('stX', 'oA', '2026-11', 'paid', '[]', 100)");
ok(!!(await as('ops', () => tryQ("select set_settlement_account('stX', 'acBank')"))), 'Operations cannot set the payout account');
await as('fin2', () => db.query("select set_settlement_account('stX', 'acBank')"));
ok((await db.query("select pay_account_id from owner_settlements where id='stX'")).rows[0].pay_account_id === 'acBank', 'Finance records which account paid the owner');
await as('fin2', () => db.query("select set_settlement_account('stX', 'acCash')"));
ok((await db.query("select pay_account_id from owner_settlements where id='stX'")).rows[0].pay_account_id === 'acBank', '…once (it is not changed afterwards)');

await db.exec(sql('security/verify.sql'));
ok((await db.query("select count(*) n from security_check where result = 'FAIL'")).rows[0].n == 0, 'verify.sql still all PASS with 18');
await db.exec(sql('security/rollback/18_rollback_company_accounts.sql'));
ok((await db.query("select to_regprocedure('public.review_company_expense(text,boolean,text)') f")).rows[0].f === null
   && Number((await db.query('select count(*) n from company_expenses')).rows[0].n) >= 3, 'rollback removes the functions and keeps the records');

console.log('\nWEDDING CARS AS A KIND OF VEHICLE (20)');
await db.exec(sql('security/14_wedding_cars.sql'));
await db.exec(sql('security/20_wedding_vehicles.sql'));
await db.exec(sql('security/20_wedding_vehicles.sql'));   // safe to re-run
await db.exec("update vehicles set web_featured = true, web_wedding = false, wedding_only = false");
await db.exec(`update vehicles set web_wedding = true, wedding_only = true,
  wedding_details = '{"decoration":"included","packagePrice":25000,"hours":5,"extraHour":3000,"showPrice":true,"highlights":"White ribbons"}'
  where id = 'vB'`);
await db.exec(`update vehicles set web_wedding = true,
  wedding_details = '{"decoration":"extra","packagePrice":18000,"showPrice":false}' where id = 'vA'`);
const anonIds = (view) => as('anon', () => ids(`select id from ${view}`));
ok(JSON.stringify(await anonIds('catalog_vehicles')) === '["vA"]', 'a wedding-only car is not on the All Vehicles page');
ok(JSON.stringify(await anonIds('website_vehicles')) === '["vA"]', '…nor on the landing page, even when listed there');
ok(JSON.stringify(await anonIds('popular_vehicles')) === '["vA"]', '…nor in Popular Vehicles');
ok(JSON.stringify(await anonIds('wedding_vehicles')) === '["vA","vB"]', 'the Wedding Cars page shows both wedding cars');
const wedRows = Object.fromEntries((await as('anon', async () => (await db.query('select * from wedding_vehicles')).rows)).map((r) => [r.id, r]));
ok(wedRows.vB.wedding_decoration === 'included' && wedRows.vB.wedding_highlights === 'White ribbons'
   && Number(wedRows.vB.wedding_price) === 25000 && Number(wedRows.vB.wedding_hours) === 5, 'it shows the decoration, highlights, and the price when ticked');
ok(wedRows.vA.wedding_price === null && wedRows.vA.wedding_decoration === 'extra', 'no price when "show price" is off');
await db.exec("update vehicles set image_url = 'https://x/rental.png' where id in ('vA', 'vB')");
await db.exec(`update vehicles set wedding_details = wedding_details || '{"cutout":"https://x/decorated.png","photos":["https://x/w1.jpg","https://x/w2.jpg"]}' where id = 'vB'`);
const wedPics = Object.fromEntries((await as('anon', async () => (await db.query('select id, image_url, wedding_photos from wedding_vehicles')).rows)).map((r) => [r.id, r]));
ok(wedPics.vB.image_url === 'https://x/decorated.png' && JSON.stringify(wedPics.vB.wedding_photos) === '["https://x/w1.jpg","https://x/w2.jpg"]', 'the page gets the decorated cut-out and the wedding photos');
ok(wedPics.vA.image_url === 'https://x/rental.png' && JSON.stringify(wedPics.vA.wedding_photos) === '[]', 'without them, the car\'s own cut-out and no wedding photos');
ok(!['wedding_details', 'daily_rent', 'web_price', 'vehicle_number', 'owner_id'].some((c) => c in wedRows.vB), 'the extra-hour rate, plate and owner stay private');
ok(!!(await tryQ("update vehicles set web_wedding = false where id = 'vB'")), 'a wedding-only car cannot be taken off the Wedding Cars page');
await db.exec("update vehicles set wedding_details = '{\"showPrice\":true,\"packagePrice\":\"lots\"}' where id = 'vA'");
ok((await db.query("select wedding_price from wedding_vehicles where id = 'vA'")).rows[0].wedding_price === null, 'a bad price is ignored, not an error');
ok(!!(await as('anon', () => tryQ("update vehicles set wedding_only = false where id = 'vB'"))), 'visitors cannot change it');
// the team (16 is in place here): prices need "Edit prices", the rest "Edit vehicle details", the use is Brian's
await db.exec(sql('security/16_staff_roles.sql'));
await db.exec(sql('security/20_wedding_vehicles.sql'));
const wedD = async () => (await db.query("select wedding_only, wedding_details d from vehicles where id = 'vB'")).rows[0];
await db.exec(`update vehicles set wedding_details = '{"decoration":"included","packagePrice":25000,"hours":5,"extraHour":3000,"showPrice":true,"highlights":"White ribbons"}' where id = 'vB'`);
await as('veh', () => db.query(`update vehicles set wedding_only = false, wedding_details = '{"decoration":"extra","packagePrice":1,"hours":1,"extraHour":1,"showPrice":false,"highlights":"New"}' where id = 'vB'`));
let wd = await wedD();
ok(wd.wedding_only === true && wd.d.decoration === 'extra' && wd.d.highlights === 'New' && wd.d.packagePrice === 25000 && wd.d.extraHour === 3000 && wd.d.showPrice === true,
   'a vehicle editor changes the decoration and highlights, not the wedding prices or the car\'s use');
await as('prices', () => db.query(`update vehicles set wedding_details = '{"decoration":"none","packagePrice":30000,"hours":6,"extraHour":3500,"showPrice":false,"highlights":"x"}' where id = 'vB'`));
wd = await wedD();
ok(wd.d.packagePrice === 30000 && wd.d.hours === 6 && wd.d.extraHour === 3500 && wd.d.showPrice === false && wd.d.decoration === 'extra' && wd.d.highlights === 'New',
   'with "Edit prices" the wedding package prices change, nothing else');
await as('vehPrices', () => db.query(`update vehicles set wedding_details = '{"decoration":"included","packagePrice":32000,"highlights":"Both"}' where id = 'vB'`));
wd = await wedD();
ok(wd.d.packagePrice === 32000 && wd.d.decoration === 'included' && wd.d.highlights === 'Both', 'with both, everything changes');
await db.exec(sql('security/verify.sql'));
ok((await db.query("select count(*) n from security_check where result = 'FAIL'")).rows[0].n == 0, 'verify.sql still all PASS with 20');
await db.exec(sql('security/rollback/20_rollback_wedding_vehicles.sql'));
ok(JSON.stringify(await anonIds('catalog_vehicles')) === '["vA","vB"]'
   && (await db.query("select count(*) n from information_schema.columns where table_name = 'vehicles' and column_name in ('wedding_only', 'wedding_details')")).rows[0].n == 0
   && Number((await db.query('select count(*) n from vehicles where web_wedding')).rows[0].n) === 2, 'rollback puts every car back on the rental pages and keeps the wedding ticks');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
