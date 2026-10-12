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
const custA = await mine('custA', 'my_bookings');
ok(custA.length === 1 && custA[0].id === 'bA', 'customer sees their own booking (phone typed 0711000001, login +94711000001)');
ok(custA[0].reference === 'MRAC-BA' && custA[0].vehicle === 'Toyota Aqua' && Number(custA[0].balance) === 12000, 'with reference, car and balance');
ok(!('internal_notes' in custA[0]) && !('notes' in custA[0]) && !('referral' in custA[0]), 'no staff notes or referral details');
ok(custA[0].payments.length === 1 && custA[0].payments[0].amount === 5000 && custA[0].payments[0].receipt_no === 'R-1', 'payments listed (amount, method, receipt no)');
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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
