/*
 * Tests for 22_booking_eagreement.sql (Stage 3a) — real SQL on a local Postgres 16 (PGlite) set up like
 * Supabase. Nothing here touches production.   cd admin/supabase/security/tests && node eagreement.test.mjs
 *
 * Note: PGlite is a single connection, so "two people at once" is tested through the database rules that
 * make it safe (the exclusion constraints + per-vehicle lock) rather than with two live connections.
 */
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const sqlDir = join(here, '..', '..');
const sql = (f) => readFileSync(join(sqlDir, f), 'utf8');

let passed = 0, failed = 0;
const ok = (cond, msg, extra = '') => { if (cond) { passed++; console.log('  ✓', msg); } else { failed++; console.log('  ✗', msg, extra); } };
const db = new PGlite({ extensions: { btree_gist } });
const tryQ = async (q, params) => { try { if (params) await db.query(q, params); else await db.exec(q); return null; } catch (e) { return e.message; } };
const one = async (q, params) => (await db.query(q, params)).rows[0];

await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text unique, phone text,
                           raw_app_meta_data jsonb not null default '{}', banned_until timestamptz);
  create function auth.jwt() returns jsonb language sql stable as
    $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on all functions in schema auth to anon, authenticated, service_role;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean not null default false,
                                file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
  create function storage.foldername(name text) returns text[] language sql immutable as
    $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
  alter table storage.objects enable row level security;
  grant usage on schema storage to anon, authenticated, service_role;
  grant all on storage.objects, storage.buckets to anon, authenticated, service_role;
  create publication supabase_realtime;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`);
for (const f of ['schema.sql', 'sms-setup.sql', 'whatsapp.sql', 'website.sql', 'fix-missing-columns.sql']) await db.exec(sql(f));
await db.exec(`create table if not exists public.app_settings (key text primary key, value jsonb, updated_at timestamptz default now())`);

const now = new Date().toISOString();
const day = (d) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
await db.exec(`
  insert into owners (id, name, phone, email, total_earnings, pending_payout, created_at) values ('oA', 'Alice', '0771111111', 'a@x.lk', 0, 0, '${now}');
  insert into vehicles (id, vehicle_number, brand, model, year, owner_id, daily_rent, status, created_at) values
    ('vA', 'CAA-1111', 'Toyota', 'Aqua', 2018, 'oA', 6000, 'Available', '${now}'),
    ('vB', 'CBB-2222', 'Honda',  'Fit',  2019, 'oA', 7000, 'Available', '${now}');
  insert into inquiries (id, customer_name, customer_phone, requested_vehicle, referral, status, created_at, start_date, end_date) values
    ('inq1', 'First', '0711000001', 'Toyota Aqua', 'Website', 'Pending', '${now}', '${day(30)}', '${day(33)}'),
    ('inq2', 'Second', '0711000002', 'Toyota Aqua', 'Website', 'Pending', '${now}', '${day(31)}', '${day(34)}');
  -- two OLD bookings that already overlap on vB (the constraint must not be added over them)
  insert into bookings (id, vehicle_id, customer_id, customer_name, customer_phone, start_date, end_date, total_days, total_amount, paid_amount, status, referral, created_at) values
    ('old1', 'vB', 'c', 'Old One', '07', '${day(60)}', '${day(62)}', 3, 1, 0, 'Confirmed', 'Direct', '${now}'),
    ('old2', 'vB', 'c', 'Old Two', '07', '${day(61)}', '${day(63)}', 3, 1, 0, 'Confirmed', 'Direct', '${now}');
`);

const claims = {
  admin: { sub: '00000000-0000-0000-0000-00000000000a', role: 'authenticated', app_metadata: { role: 'admin' } },
  staff: { sub: '00000000-0000-0000-0000-00000000005a', role: 'authenticated', app_metadata: { role: 'staff', permissions: { canBook: true, canViewInquiries: true, canTakePayments: true } } },
  customer: { sub: '00000000-0000-0000-0000-0000000000c1', role: 'authenticated', phone: '94711000001', app_metadata: { role: 'customer' } },
};
async function as(who, fn) {
  await db.exec('reset role');
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [who === 'anon' ? '' : JSON.stringify(claims[who])]);
  await db.exec(`set role ${who === 'anon' ? 'anon' : 'authenticated'}`);
  try { return await fn(); } finally { await db.exec('reset role'); }
}

await db.exec(sql('security/01_scoped_access.sql'));
await db.exec(sql('security/02_public_functions.sql'));
await db.exec(sql('security/16_staff_roles.sql'));

console.log('\nMIGRATION');
let notices = [];
const r1 = await tryQ(sql('security/22_booking_eagreement.sql'));
ok(r1 === null, 'runs on the current schema', r1 ?? '');
ok(!(await one(`select 1 x from pg_constraint where conname = 'bookings_no_double_booking'`)), 'exclusion constraint NOT added while old bookings overlap');
const ov = (await db.query(`select * from public.eagreement_booking_overlaps()`)).rows;
ok(ov.length === 1 && ov[0].booking_a === 'old1' && ov[0].booking_b === 'old2', 'overlap report lists the old pair');
ok((await one(`select count(*)::int n from bookings where occupies is not null`)).n === 2, 'existing live bookings got their occupied time');
const rerun = await tryQ(sql('security/22_booking_eagreement.sql'));
ok(rerun === null, 'safe to run again', rerun ?? '');

console.log('\nOCCUPIED TIME (same rule as the admin app, Sri Lanka time)');
await db.exec(`insert into bookings (id, vehicle_id, customer_id, customer_name, customer_phone, start_date, end_date, start_time, end_time, total_days, total_amount, paid_amount, status, referral, created_at)
  values ('t1', 'vA', 'c', 'Timed', '07', '2031-03-10', '2031-03-12', '08:00', '17:30', 3, 1, 0, 'Confirmed', 'Direct', '${now}')`);
const t1b = await one(`select to_char(lower(occupies) at time zone 'Asia/Colombo', 'YYYY-MM-DD HH24:MI') s, to_char(upper(occupies) at time zone 'Asia/Colombo', 'YYYY-MM-DD HH24:MI') e from bookings where id = 't1'`);
ok(t1b.s === '2031-03-10 08:00' && t1b.e === '2031-03-12 17:30', `10 Mar 08:00 → 12 Mar 17:30 Colombo (${t1b.s} → ${t1b.e})`);
await db.exec(`insert into bookings (id, vehicle_id, customer_id, customer_name, customer_phone, start_date, end_date, total_days, total_amount, paid_amount, status, referral, created_at)
  values ('t2', 'vA', 'c', 'Dateonly', '07', '2031-04-01', '2031-04-02', 2, 1, 0, 'Confirmed', 'Direct', '${now}')`);
const t2 = await one(`select to_char(lower(occupies) at time zone 'Asia/Colombo', 'HH24:MI') s, to_char(upper(occupies) at time zone 'Asia/Colombo', 'HH24:MI') e from bookings where id = 't2'`);
ok(t2.s === '00:00' && t2.e === '23:59', 'no times = whole days (00:00 → 23:59)');

console.log('\nDOUBLE BOOKING');
const ins = (id, v, sd, ed, st = null, et = null, status = 'Confirmed') => tryQ(
  `insert into bookings (id, vehicle_id, customer_id, customer_name, customer_phone, start_date, end_date, start_time, end_time, total_days, total_amount, paid_amount, status, referral, created_at)
   values ($1, $2, 'c', 'X', '07', $3, $4, $5, $6, 1, 1, 0, $7, 'Direct', '${now}')`, [id, v, sd, ed, st, et, status]);
let e = await ins('c1', 'vA', '2031-03-12', '2031-03-13', '12:00', '12:00');
ok(e && /DOUBLE_BOOKING/.test(e) && /Timed/.test(e), 'overlapping booking refused with a clear message', e ?? '');
ok((await ins('c2', 'vA', '2031-03-12', '2031-03-13', '17:30', '10:00')) === null, 'starting exactly when the last one ends is allowed (same-day turnaround)');
ok((await ins('c3', 'vB', '2031-03-11', '2031-03-11')) === null, 'another car on the same dates is fine');
ok((await ins('c4', 'vA', '2031-03-11', '2031-03-11', null, null, 'Cancelled')) === null, 'a cancelled booking never blocks');
e = await tryQ(`update bookings set status = 'Confirmed' where id = 'c4'`);
ok(e && /DOUBLE_BOOKING/.test(e), 're-activating it over a live booking is refused');
ok((await tryQ(`update bookings set paid_amount = 500 where id = 'old1'`)) === null, 'old overlapping bookings can still take payments / notes (dates unchanged)');
e = await tryQ(`update bookings set end_date = '${day(64)}' where id = 'old2'`);
ok(e && /DOUBLE_BOOKING/.test(e), '…but moving one of them still has to be clash-free');
e = await as('staff', () => tryQ(`insert into bookings (id, vehicle_id, customer_id, customer_name, customer_phone, start_date, end_date, start_time, end_time, total_days, total_amount, paid_amount, status, referral, created_at)
   values ('s1', 'vA', 'c', 'X', '07', '2031-03-11', '2031-03-11', null, null, 1, 1, 0, 'Confirmed', 'Direct', '${now}')`));
ok(e && /DOUBLE_BOOKING/.test(e), 'staff login refused too (rule is in the database, not the app)');
// constraint after fixing the old pair
await db.exec(`update bookings set status = 'Cancelled' where id = 'old2'`);
await db.exec(sql('security/22_booking_eagreement.sql'));
ok(!!(await one(`select 1 x from pg_constraint where conname = 'bookings_no_double_booking'`)), 'once fixed, running 22 again adds the exclusion constraint');
await db.exec(`alter table bookings disable trigger zz_esign_booking_guard`);
// as if two saves passed the friendly check at the same moment: the row arrives with its occupied time
e = await tryQ(`insert into bookings (id, vehicle_id, customer_id, customer_name, customer_phone, start_date, end_date, total_days, total_amount, paid_amount, status, referral, created_at, occupies)
  values ('raw', 'vA', 'c', 'X', '07', '2031-03-11', '2031-03-11', 1, 1, 0, 'Confirmed', 'Direct', '${now}', private.booking_occupies('Confirmed', '2031-03-11', null, '2031-03-11', null))`);
await db.exec(`alter table bookings enable trigger zz_esign_booking_guard`);
ok(e && /bookings_no_double_booking|exclusion/.test(e), 'the constraint alone still stops a clash (the "two at once" safety net)', e ?? '');

console.log('\nPRIORITY HOLDS');
const q = await one(`insert into esign.quotations (reference, inquiry_id, version, vehicle_id, vehicle_label, pickup_at, return_at, total, advance_required, valid_until, created_by)
  values ('CRC-Q-T-1', 'inq1', 1, 'vA', 'Toyota Aqua', '2031-06-01 09:00+05:30', '2031-06-04 09:00+05:30', 18000, 5000, now() + interval '2 days', 'test') returning id`);
const hold = (inq, s, e2, status = 'ACTIVE') => tryQ(`insert into esign.priority_holds (inquiry_id, quotation_id, vehicle_id, requested_start, requested_end, hold_range, status, expires_at, created_by)
  values ($1, $2, 'vA', $3, $4, tstzrange($3::timestamptz, $4::timestamptz, '[)'), $5, now() + interval '1 day', 'test')`, [inq, q.id, s, e2, status]);
ok((await hold('inq1', '2031-06-01 09:00+05:30', '2031-06-04 09:00+05:30')) === null, 'first customer gets the hold');
e = await hold('inq2', '2031-06-03 09:00+05:30', '2031-06-05 09:00+05:30');
ok(e && /hold_no_overlap|exclusion/.test(e), 'a second, overlapping hold on the same car is refused');
e = await ins('h1', 'vA', '2031-06-02', '2031-06-02');
ok(e && /PRIORITY_HOLD/.test(e), 'a plain booking over the held time is refused');
e = await hold('inq2', '2031-03-11 09:00+05:30', '2031-03-11 18:00+05:30');
ok(e && /DOUBLE_BOOKING/.test(e), 'a hold over an existing booking is refused');
await db.exec(`update esign.priority_holds set status = 'RELEASED', released_at = now(), release_reason = 'test' where inquiry_id = 'inq1'`);
ok((await hold('inq2', '2031-06-03 09:00+05:30', '2031-06-05 09:00+05:30')) === null, 'after release the next customer can be held');
e = await tryQ(`update esign.priority_holds set status = 'ACTIVE' where inquiry_id = 'inq1'`);
ok(e && /BAD_STEP/.test(e), 'a released hold can\'t be revived');
e = await tryQ(`update esign.priority_holds set hold_range = tstzrange(now(), now() + interval '1 hour') where inquiry_id = 'inq2' and status = 'ACTIVE'`);
ok(e && /EVIDENCE_LOCKED/.test(e), 'a hold\'s period can\'t be moved');
ok(!!(await tryQ(`delete from esign.priority_holds`)), 'holds can\'t be deleted');

console.log('\nAGREEMENTS & EVIDENCE');
const tpl = await one(`insert into esign.agreement_templates (version, title, sections, acceptance_statement, created_by) values (1, 'Booking e-Agreement', '[]', 'I confirm…', 'it') returning id`);
e = await tryQ(`update esign.agreement_templates set status = 'APPROVED' where id = $1`, [tpl.id]);
ok(e && /approver/.test(e), 'a template can\'t be approved without an approver');
await db.query(`update esign.agreement_templates set status = 'APPROVED', approved_by = 'Brian', approved_at = now() where id = $1`, [tpl.id]);
e = await tryQ(`update esign.agreement_templates set acceptance_statement = 'changed' where id = $1`, [tpl.id]);
ok(e && /EVIDENCE_LOCKED/.test(e), 'an approved template\'s wording is frozen');
const ag = await one(`insert into esign.agreements (reference, inquiry_id, customer_phone_key, quotation_id, quotation_version, template_id, template_version, version, generated_by)
  values ('CRC-EA-T-1', 'inq1', '94711000001', $1, 1, $2, 1, 1, 'staff') returning id`, [q.id, tpl.id]);
e = await tryQ(`update esign.agreements set status = 'SENT' where id = $1`, [ag.id]);
ok(e && /BAD_STEP/.test(e), 'can\'t send without the document, hash and expiry');
await db.query(`update esign.agreements set snapshot = '{"total":18000}', rendered_html = '<p>x</p>', document_hash = 'abc', expires_at = now() + interval '1 day' where id = $1`, [ag.id]);
ok((await tryQ(`update esign.agreements set status = 'SENT', sent_at = now() where id = $1`, [ag.id])) === null, 'DRAFT → SENT with a document');
e = await tryQ(`update esign.agreements set snapshot = '{"total":1}' where id = $1`, [ag.id]);
ok(e && /EVIDENCE_LOCKED/.test(e), 'a sent agreement\'s document can\'t be edited');
e = await tryQ(`insert into esign.agreements (reference, inquiry_id, customer_phone_key, quotation_id, quotation_version, template_id, template_version, version, generated_by)
  values ('CRC-EA-T-2', 'inq1', '94711000001', $1, 1, $2, 1, 2, 'staff')`, [q.id, tpl.id]);
ok(e && /agreement_one_open_per_inquiry|duplicate/.test(e), 'only one open agreement per inquiry');
e = await tryQ(`update esign.agreements set status = 'ACCEPTED' where id = $1`, [ag.id]);
ok(e && /recorded decision/.test(e), 'ACCEPTED needs the customer\'s recorded decision');
await db.query(`insert into esign.acceptances (agreement_id, decision, verification_method, verified_phone_key, acceptance_statement, accepted_document_hash) values ($1, 'ACCEPTED', 'SMS_OTP_PORTAL_LOGIN', '94711000001', 'I confirm…', 'abc')`, [ag.id]);
ok((await tryQ(`update esign.agreements set status = 'ACCEPTED', decided_at = now() where id = $1`, [ag.id])) === null, 'accepted once the decision is recorded');
e = await tryQ(`insert into esign.acceptances (agreement_id, decision, verification_method) values ($1, 'ACCEPTED', 'SMS_OTP_PORTAL_LOGIN')`, [ag.id]);
ok(e && /duplicate|unique/.test(e), 'a second acceptance of the same agreement is refused (idempotent)');
ok(/EVIDENCE_LOCKED/.test(await tryQ(`update esign.acceptances set decision = 'DECLINED'`) ?? ''), 'acceptance evidence can\'t be changed');
ok(/EVIDENCE_LOCKED/.test(await tryQ(`delete from esign.acceptances`) ?? ''), 'acceptance evidence can\'t be deleted');
await db.query(`insert into esign.events (inquiry_id, agreement_id, event_type, actor_type) values ('inq1', $1, 'ACCEPTED', 'customer')`, [ag.id]);
ok(/EVIDENCE_LOCKED/.test(await tryQ(`delete from esign.events`) ?? ''), 'events can\'t be deleted');
e = await tryQ(`update esign.agreements set status = 'SENT' where id = $1`, [ag.id]);
ok(e && /BAD_STEP/.test(e), 'an accepted agreement can\'t go back to SENT');
ok((await tryQ(`update esign.agreements set status = 'SUPERSEDED' where id = $1`, [ag.id])) === null, 'ACCEPTED → SUPERSEDED (revision) keeps the record');
ok(/EVIDENCE_LOCKED/.test(await tryQ(`delete from esign.agreements where id = $1`, [ag.id]) ?? ''), 'a sent agreement can\'t be deleted');
e = await tryQ(`update esign.quotations set total = 1 where id = $1`, [q.id]);
ok(e && /EVIDENCE_LOCKED/.test(e), 'a sent quotation\'s price can\'t be edited');

console.log('\nNO DIRECT ACCESS (every login goes through the server functions)');
for (const who of ['anon', 'customer', 'staff', 'admin']) {
  const r = await as(who, () => tryQ(`select * from esign.agreements`));
  ok(r && /permission denied/.test(r), `${who} can't read esign tables directly`);
}
const w = await as('admin', () => tryQ(`insert into esign.acceptances (agreement_id, decision, verification_method) values (gen_random_uuid(), 'ACCEPTED', 'MANUAL_REVIEWED')`));
ok(w && /permission denied/.test(w), 'even an admin login can\'t write evidence directly');
await db.exec(sql('security/01_scoped_access.sql'));
const after01 = await as('admin', () => tryQ(`select * from esign.agreements`));
ok(after01 && /permission denied/.test(after01), 're-running 01 doesn\'t open the esign tables');
const ovStaff = await as('staff', () => tryQ(`select * from public.eagreement_booking_overlaps()`));
ok(ovStaff && /Admins only/.test(ovStaff), 'overlap report is admin-only');

console.log('\nBOOKING GATE (every new booking, once switched on)');
ok((await ins('g0', 'vA', '2031-08-01', '2031-08-02')) === null, 'gate off (no go-live date): bookings save as today');
await db.exec(`insert into bookings (id, vehicle_id, customer_id, customer_name, customer_phone, start_date, end_date, total_days, total_amount, paid_amount, status, referral, created_at)
  values ('leg', 'vA', 'c', 'Legacy', '07', '2031-09-01', '2031-09-02', 1, 1, 0, 'Cancelled', 'Direct', '2020-01-01T00:00:00Z')`);
await db.exec(`update app_settings set value = jsonb_set(value, '{enforce_from}', to_jsonb(now() - interval '1 minute')) where key = 'eagreement_policy'`);
e = await ins('g1', 'vA', '2031-08-10', '2031-08-11');
ok(e && /BOOKING_GATE/.test(e), 'gate on: a booking without an allocation is refused');
e = await as('admin', () => tryQ(`insert into bookings (id, vehicle_id, customer_id, customer_name, customer_phone, start_date, end_date, total_days, total_amount, paid_amount, status, referral, created_at)
   values ('g2', 'vA', 'c', 'X', '07', '2031-08-10', '2031-08-11', 1, 1, 0, 'Confirmed', 'Direct', '${now}')`));
ok(e && /BOOKING_GATE/.test(e), 'admins can\'t skip it either');
await db.exec(`insert into esign.booking_allocations (booking_id, inquiry_id, allocated_by) values ('g3', 'inq2', 'system')`);
const held2 = await one(`select to_char(lower(hold_range) at time zone 'Asia/Colombo', 'YYYY-MM-DD') d from esign.priority_holds where inquiry_id = 'inq2' and status = 'ACTIVE'`);
ok((await ins('g3', 'vA', '2031-06-03', '2031-06-04')) === null, `with its allocation, the held customer\'s own booking saves (inside their hold from ${held2.d})`);
ok(/EVIDENCE_LOCKED/.test(await tryQ(`delete from esign.booking_allocations`) ?? ''), 'allocations can\'t be removed');
ok((await tryQ(`update bookings set paid_amount = 100 where id = 'g0'`)) === null, 'existing bookings still update normally with the gate on');
e = await tryQ(`update bookings set status = 'Confirmed' where id = 'leg'`);
ok(e === null, 'a booking made BEFORE go-live can be re-activated (legacy)', e ?? '');
await db.exec(`update bookings set status = 'Cancelled' where id = 'g0'`);
e = await tryQ(`update bookings set status = 'Confirmed' where id = 'g0'`);
ok(e && /BOOKING_GATE/.test(e), 'a post-go-live booking without allocation can\'t be re-activated', e ?? '');
await db.exec(`update app_settings set value = jsonb_set(value, '{enforce_from}', 'null') where key = 'eagreement_policy'`);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
