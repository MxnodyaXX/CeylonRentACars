/*
 * End-to-end tests for 23_eagreement_functions.sql (Stage 3b): the whole journey
 *   inquiry → quotation → priority hold → e-Agreement → acceptance → advance → Finance → allocation → booking
 * and the exceptions, through the real functions, as the real kinds of login. Local Postgres (PGlite) only.
 *   cd admin/supabase/security/tests && node eagreement-flow.test.mjs
 * Numbers in [brackets] are the brief's Module 16 test scenarios.
 */
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const sql = (f) => readFileSync(join(here, '..', '..', f), 'utf8');
let passed = 0, failed = 0;
const ok = (cond, msg, extra = '') => { if (cond) { passed++; console.log('  ✓', msg); } else { failed++; console.log('  ✗', msg, extra); } };
const db = new PGlite({ extensions: { btree_gist } });

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
  create table storage.buckets (id text primary key, name text, public boolean not null default false, file_size_limit bigint, allowed_mime_types text[]);
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
for (const f of ['01_scoped_access', '02_public_functions', '05_customer_portal', '16_staff_roles', '17_owner_settlements', '18_company_accounts',
                 '22_booking_eagreement', '23_eagreement_functions', '24_eagreement_delivery', '25_eagreement_screens']) {
  try { await db.exec(sql(`security/${f}.sql`)); } catch (e) { console.log(`  ✗ loading ${f}: ${e.message}`); failed++; }
}
ok(true, 'files 01, 02, 05, 16, 17, 18, 22–25 load');
ok((await db.exec(sql('security/23_eagreement_functions.sql')).then(() => true, () => false)), 'file 23 is safe to run again');

const now = new Date().toISOString();
await db.exec(`
  insert into owners (id, name, phone, email, total_earnings, pending_payout, created_at) values ('oA', 'Alice', '0771111111', 'a@x.lk', 0, 0, '${now}');
  insert into vehicles (id, vehicle_number, brand, model, year, owner_id, daily_rent, status, created_at) values
    ('vA', 'CAA-1111', 'Toyota', 'Aqua', 2018, 'oA', 6000, 'Available', '${now}'),
    ('vB', 'CBB-2222', 'Honda',  'Fit',  2019, 'oA', 7000, 'Available', '${now}');
  insert into customers (id, name, phone, email, created_at) values ('c1', 'Nimal Perera', '0711000001', 'nimal@x.lk', '${now}');
  insert into company_accounts (id, name, kind, bank_name, account_no) values ('acc-boc', 'BOC current', 'bank', 'Bank of Ceylon', '0001234567'),
    ('acc-cash', 'Cash box', 'cash', null, null);
`);
const inq = (id, name, phone) => db.exec(`insert into inquiries (id, customer_name, customer_phone, requested_vehicle, referral, status, created_at)
  values ('${id}', '${name}', '${phone}', 'Car', 'Website', 'Pending', '${now}')`);
await inq('inq1', 'Nimal Perera', '071 100 0001');
await inq('inq2', 'Kamal Silva', '0711000002');
for (const n of [3, 4, 5, 6]) await inq(`inq${n}`, `Customer ${n}`, `071100000${n}`);

const staff = (name, perms) => ({ sub: crypto.randomUUID(), role: 'authenticated', app_metadata: { role: 'staff', name, permissions: perms } });
const claims = {
  admin: { sub: '00000000-0000-0000-0000-00000000000a', role: 'authenticated', app_metadata: { role: 'admin', name: 'Manodya' } },
  brian: { sub: '00000000-0000-0000-0000-00000000000b', role: 'authenticated', app_metadata: { role: 'admin', name: 'Brian', business_approver: true } },
  res: staff('Buddhi', { canSendAgreements: true, canRequestAdvance: true, canViewInquiries: true, canBook: true, canTakePayments: true }),
  finance: staff('Dinithi', { canVerifyPayments: true }),
  viewer: staff('Viewer', { canViewInquiries: true }),
  cust1: { sub: '00000000-0000-0000-0000-0000000000c1', role: 'authenticated', phone: '94711000001', app_metadata: { role: 'customer' } },
  cust2: { sub: '00000000-0000-0000-0000-0000000000c2', role: 'authenticated', phone: '94711000002', app_metadata: { role: 'customer' } },
  cust3: { sub: '00000000-0000-0000-0000-0000000000c3', role: 'authenticated', phone: '94711000003', app_metadata: { role: 'customer' } },
  cust4: { sub: '00000000-0000-0000-0000-0000000000c4', role: 'authenticated', phone: '94711000004', app_metadata: { role: 'customer' } },
  cust5: { sub: '00000000-0000-0000-0000-0000000000c5', role: 'authenticated', phone: '94711000005', app_metadata: { role: 'customer' } },
  cust6: { sub: '00000000-0000-0000-0000-0000000000c6', role: 'authenticated', phone: '94711000006', app_metadata: { role: 'customer' } },
};
async function as(who, fn) {
  await db.exec('reset role');
  await db.query(`select set_config('request.jwt.claims', $1, false), set_config('request.headers', $2, false)`,
    [who === 'anon' ? '' : who === 'service' ? JSON.stringify({ role: 'service_role' }) : JSON.stringify(claims[who]),
     JSON.stringify({ 'x-forwarded-for': '10.0.0.9', 'user-agent': 'test-browser' })]);
  await db.exec(`set role ${who === 'anon' ? 'anon' : who === 'service' ? 'service_role' : 'authenticated'}`);
  try { return await fn(); } finally { await db.exec('reset role'); }
}
/** call public.<fn>(args…) as someone → { r, e } */
async function rpc(who, fn, ...args) {
  const ph = args.map((_, i) => `$${i + 1}`).join(', ');
  try { const res = await as(who, () => db.query(`select public.${fn}(${ph}) as r`, args)); return { r: res.rows[0]?.r, e: null }; }
  catch (e) { return { r: null, e: e.message }; }
}
const one = async (q, p) => (await db.query(q, p)).rows[0];
const setPolicy = (patch) => db.query(`update app_settings set value = value || $1::jsonb where key = 'eagreement_policy'`, [JSON.stringify(patch)]);
const quote = (vehicle, from, to, total, extra = {}) => JSON.stringify({ vehicle_id: vehicle, pickup_date: from, pickup_time: '09:00', return_date: to, return_time: '09:00',
  pickup_location: 'Panadura office', return_location: 'Panadura office', rental_type: 'Daily', rate: total / 3, units: 3, included_km: 300, extra_km_rate: 50, total, deposit: 25000, ...extra });

console.log('\nPOLICY & PERMISSIONS');
let x = await rpc('res', 'eag_freeze_quotation', 'inq1', quote('vA', '2031-06-01', '2031-06-04', 18000));
ok(/POLICY_NOT_APPROVED/.test(x.e ?? ''), 'nothing can be sent while the policy is blank', x.e ?? '');
await setPolicy({ link_valid_hours: 48, agreement_deadline_hours: 24, advance_deadline_hours: 24, verification_deadline_hours: 12, hold_max_hours: 120,
  turnaround_minutes: 120, quotation_valid_hours: 72, advance_rule: { type: 'percent', value: 25 }, collection_account_id: 'acc-boc',
  cancellation_policy_version: 'CP-1', cancellation_policy_text: 'As approved by CRC (test wording).' });
x = await rpc('viewer', 'eag_freeze_quotation', 'inq1', quote('vA', '2031-06-01', '2031-06-04', 18000));
ok(/NOT_ALLOWED/.test(x.e ?? ''), '[27] staff without the ability can\'t send quotations');

console.log('\nQUOTATION & PRIORITY');
x = await rpc('res', 'eag_freeze_quotation', 'inq1', quote('vA', '2031-06-01', '2031-06-04', 18000, { rate: 5000 }));
ok(/doesn't add up/.test(x.e ?? ''), 'a quotation whose sums don\'t add up is refused');
const q1 = (await rpc('res', 'eag_freeze_quotation', 'inq1', quote('vA', '2031-06-01', '2031-06-04', 18000))).r;
ok(q1?.version === 1 && Number(q1.advance_required) === 4500, `[2] quotation v1 frozen; advance from the approved rule = 25% (${q1?.advance_required})`);
const q2 = (await rpc('res', 'eag_freeze_quotation', 'inq2', quote('vA', '2031-06-02', '2031-06-05', 18000))).r;
x = await rpc('res', 'eag_accept_quotation', q1.id);
ok(x.r?.status === 'HELD', '[3] first customer to accept gets the priority hold', x.e ?? '');
x = await rpc('res', 'eag_accept_quotation', q2.id);
ok(x.r?.status === 'WAITLISTED', '[22] a second customer for an overlapping time goes on the waiting list, not a second hold', JSON.stringify(x));
ok((await one(`select count(*)::int n from esign.priority_holds where vehicle_id = 'vA' and status = 'ACTIVE'`)).n === 1, 'only one active hold on the car');

console.log('\nGATE BEFORE ACCEPTANCE');
x = await rpc('res', 'eag_gate_status', 'inq1');
ok(x.r?.state === 'LOCKED', `[14] advance locked before the e-Agreement (${x.r?.state})`);
x = await rpc('res', 'eag_request_advance', 'inq1');
ok(/ADVANCE_LOCKED/.test(x.e ?? ''), '[14] requesting the advance is refused by the server');

console.log('\nWORDING & GENERATION');
x = await rpc('res', 'eag_generate_agreement', 'inq1', false);
ok(/POLICY_NOT_APPROVED/.test(x.e ?? ''), 'no agreement without approved wording');
const sections = JSON.stringify([
  { heading: 'Booking', body: 'Agreement {{agreement.reference}} for {{customer.name}} ({{customer.mobile}}).\nVehicle: {{vehicle.make_model}}, {{vehicle.registration}}.' },
  { heading: 'Rental', body: 'From {{rental.pickup}} to {{rental.return}} at {{rental.pickup_location}}. Included {{rental.included_km}}, extra {{rental.extra_km_rate}}.' },
  { heading: 'Payment', body: 'Total {{payment.total}}, advance {{payment.advance}}, balance {{payment.balance}}, deposit {{payment.deposit}}. {{payment.instructions}}' },
  { heading: 'Cancellation & refunds', body: '{{policy.cancellation}} (policy {{policy.cancellation_version}})' },
]);
const statement = 'I confirm that I have reviewed the booking details, rental charges, advance payment requirements, cancellation and refund conditions, and applicable terms.';
x = await rpc('res', 'eag_save_template', 'Booking Acceptance & Advance Payment e-Agreement', sections, statement);
ok(/NOT_ALLOWED/.test(x.e ?? ''), 'only admins draft the wording');
const tpl = (await rpc('admin', 'eag_save_template', 'Booking Acceptance & Advance Payment e-Agreement', sections, statement)).r;
x = await rpc('res', 'eag_approve_template', tpl.id);
ok(/NOT_ALLOWED/.test(x.e ?? ''), 'staff can\'t approve the wording');
ok(!(await rpc('brian', 'eag_approve_template', tpl.id)).e, 'the business approver approves it');
const ag1 = (await rpc('res', 'eag_generate_agreement', 'inq1', false)).r;
ok(ag1?.reference?.startsWith('CRC-EA-'), `[4] agreement generated (${ag1?.reference})`);
const doc = await one(`select snapshot, rendered_html from esign.agreements where id = $1`, [ag1.id]);
ok(doc.snapshot.payment.total === 'LKR 18,000' && doc.snapshot.payment.advance === 'LKR 4,500' && doc.snapshot.customer.name === 'Nimal Perera'
   && doc.snapshot.customer.email === 'nimal@x.lk' && doc.snapshot.rental.pickup === '01 Jun 2031, 09:00', '[4] filled from the quotation, the inquiry and the customer record');
ok(!doc.rendered_html.includes('{{') && doc.rendered_html.includes('LKR 4,500') && doc.rendered_html.includes('Disclosed when the booking is confirmed'),
   '[4] the wording has every field filled; the plate number stays hidden until confirmed');
x = await rpc('res', 'eag_generate_agreement', 'inq1', false);
ok(x.r?.reused === true, 'generating again returns the same draft (no duplicates)');

console.log('\nLINK & CUSTOMER PAGE');
const sent = (await rpc('res', 'eag_send_agreement', ag1.id, 'whatsapp_link')).r;
ok(/^[0-9a-f]{64}$/.test(sent?.token ?? '') && sent.path === `/booking-agreement/${sent.token}`, '[5] a long random link is made');
ok(!(await one(`select count(*)::int n from esign.access_tokens where token_hash = $1`, [sent.token])).n, 'the link itself is not stored, only its fingerprint');
x = await rpc('anon', 'eag_open', 'f'.repeat(64));
ok(/LINK_INVALID/.test(x.e ?? ''), '[6] a made-up link shows nothing');
const page = (await rpc('anon', 'eag_open', sent.token)).r;
ok(page?.status === 'VIEWED' && page.can_decide && page.payment === null && page.phone_hint.endsWith('001') && !page.phone_hint.includes('71100'),
   '[7] the customer sees the full terms; phone masked; no bank details yet');
ok(!JSON.stringify(page).includes('Kamal'), '[6] nothing about other customers');
x = await rpc('anon', 'eag_decide', sent.token, 'ACCEPTED', page.statement_version, null);
ok(/SIGN_IN_REQUIRED/.test(x.e ?? ''), '[9] accepting needs the SMS-code sign-in');
x = await rpc('cust2', 'eag_decide', sent.token, 'ACCEPTED', page.statement_version, null);
ok(/WRONG_CUSTOMER/.test(x.e ?? ''), '[6] a forwarded link can\'t be accepted from another number');
ok(!(await rpc('anon', 'eag_clarify', sent.token, 'Can I pick up at 8?')).e, 'the customer can ask CRC a question');
x = await rpc('cust1', 'eag_decide', sent.token, 'ACCEPTED', 'old-version', null);
ok(/out of date/.test(x.e ?? ''), 'acceptance of an out-of-date page is refused');
x = await rpc('cust1', 'eag_decide', sent.token, 'ACCEPTED', page.statement_version, null);
ok(x.r?.status === 'ACCEPTED' && x.r.advance_eligible === true, '[9][10] accepted after identity verification', x.e ?? '');
x = await rpc('cust1', 'eag_decide', sent.token, 'ACCEPTED', page.statement_version, null);
ok(x.r?.already === true, '[23] a second tap returns the first acceptance');
x = await rpc('cust1', 'eag_decide', sent.token, 'DECLINED', page.statement_version, 'changed my mind');
ok(/ALREADY_DECIDED/.test(x.e ?? ''), 'an accepted agreement can\'t be declined afterwards');
const acc = await one(`select count(*)::int n, max(verified_phone_key) p, max(accepted_document_hash) h, max(evidence->>'ip') ip from esign.acceptances where agreement_id = $1`, [ag1.id]);
ok(acc.n === 1 && acc.p === '94711000001' && acc.h?.length === 64 && acc.ip === '10.0.0.9', '[10] one evidence record: verified number, document fingerprint, IP');

console.log('\nADMIN & PORTAL VIEW');
const ov = (await rpc('viewer', 'eag_inquiry_overview', 'inq1')).r;
const types = ov?.events?.map((e) => e.event_type) ?? [];
ok(['QUOTATION_SENT', 'QUOTATION_ACCEPTED', 'PRIORITY_ASSIGNED', 'AGREEMENT_GENERATED', 'AGREEMENT_SENT', 'AGREEMENT_VIEWED', 'CLARIFICATION_REQUESTED', 'IDENTITY_VERIFIED', 'AGREEMENT_ACCEPTED']
   .every((t) => types.includes(t)), '[11][26] the inquiry timeline shows every step', types.join(','));
ok(ov.agreements[0].acceptance?.verification_method === 'SMS_OTP_PORTAL_LOGIN', '[11] the panel shows how the customer was verified');
ok(/NOT_ALLOWED/.test((await rpc('cust1', 'eag_inquiry_overview', 'inq1')).e ?? ''), 'customers can\'t open the staff panel');
const mine = (await rpc('cust1', 'my_agreements')).r;
ok(mine?.length === 1 && mine[0].status === 'ACCEPTED', '[12] My Agreements shows it as ACCEPTED');
ok((await rpc('cust2', 'my_agreements')).r.length === 0, '[12] another customer sees none of it');
ok((await one(`select count(*)::int n from notifications where type = 'agreement'`)).n >= 2, 'staff are notified (question, acceptance)');

console.log('\nADVANCE & FINANCE');
x = await rpc('res', 'eag_gate_status', 'inq1');
ok(x.r?.state === 'ELIGIBLE', `[15] after acceptance: eligible for the advance request (${x.r?.state} ${JSON.stringify(x.r?.problems)})`);
ok(/NOT_ALLOWED/.test((await rpc('viewer', 'eag_request_advance', 'inq1')).e ?? ''), '[27] staff without the ability can\'t request money');
x = await rpc('res', 'eag_request_advance', 'inq1');
ok(Number(x.r?.amount) === 4500, '[15] advance requested (Rs 4,500)', x.e ?? '');
ok(/already requested/.test((await rpc('res', 'eag_request_advance', 'inq1')).e ?? ''), 'not twice');
const page2 = (await rpc('anon', 'eag_open', sent.token)).r;
ok(page2.payment?.account_no === '0001234567' && Number(page2.payment.amount) === 4500, 'bank details appear on the page only now');
await setPolicy({ enforce_from: new Date(Date.now() - 60000).toISOString() });
x = await rpc('cust1', 'eag_report_payment', sent.token, 4500, 'BOC-778899', null);
ok(x.r?.status === 'REPORTED', 'the customer reports the transfer', x.e ?? '');
x = await rpc('res', 'eag_allocate', 'inq1');
ok(/isn't verified/.test(x.e ?? ''), '[20] a reported payment (or screenshot) is not enough to book');
const bookingSql = (id, start, end, total, vehicle = 'vA') => `insert into bookings (id, vehicle_id, customer_id, customer_name, customer_phone, start_date, end_date, start_time, end_time,
   total_days, total_amount, paid_amount, status, referral, created_at) values ('${id}', '${vehicle}', 'c1', 'Nimal Perera', '0711000001', '${start}', '${end}', '09:00', '09:00', 3, ${total}, 4500, 'Confirmed', 'Website', '${now}')`;
x = await as('res', () => db.query(bookingSql('sneaky', '2031-06-01', '2031-06-04', 18000)).then(() => null, (e) => e.message));
ok(/BOOKING_GATE/.test(x ?? ''), '[20][27] the booking form can\'t save it either');
const rc = (await one(`select id from esign.payment_receipts where inquiry_id = 'inq1'`)).id;
ok(/NOT_ALLOWED/.test((await rpc('res', 'eag_verify_receipt', rc, 'VERIFIED', 'acc-boc', now, null, null)).e ?? ''), 'only Finance verifies');
x = await rpc('finance', 'eag_verify_receipt', rc, 'VERIFIED', null, null, null, null);
ok(/when the money arrived/.test(x.e ?? ''), '[19] verifying needs the date the money actually arrived');
x = await rpc('finance', 'eag_verify_receipt', rc, 'VERIFIED', 'acc-boc', now, 'seen in BOC statement', null);
ok(x.r?.request_status === 'VERIFIED', '[19] Finance verifies the funds → advance verified', x.e ?? '');
ok((await rpc('res', 'eag_gate_status', 'inq1')).r.state === 'PAYMENT_VERIFIED', 'gate: payment verified');

console.log('\nALLOCATION & BOOKING');
const t = (await rpc('res', 'eag_allocate', 'inq1')).r;
ok(!!t?.booking_id && t.start_date === '2031-06-01' && t.start_time === '09:00', 'allocation ticket issued with the accepted dates');
ok((await rpc('res', 'eag_allocate', 'inq1')).r.booking_id === t.booking_id, 'asking again gives the same ticket');
x = await as('res', () => db.query(bookingSql(t.booking_id, '2031-06-01', '2031-06-04', 15000)).then(() => null, (e) => e.message));
ok(/ALLOCATION_MISMATCH.*total/.test(x ?? ''), 'a booking with a different price is refused');
x = await as('res', () => db.query(bookingSql(t.booking_id, '2031-06-01', '2031-06-04', 18000, 'vB')).then(() => null, (e) => e.message));
ok(/ALLOCATION_MISMATCH.*car/.test(x ?? ''), 'a booking for another car is refused');
x = await as('res', () => db.query(bookingSql(t.booking_id, '2031-06-01', '2031-06-04', 18000)).then(() => null, (e) => e.message));
ok(x === null, '[Def. of done] the booking saves with its ticket', x ?? '');
ok((await rpc('res', 'eag_gate_status', 'inq1')).r.state === 'CONFIRMED', 'gate: confirmed');
ok((await one(`select status from esign.priority_holds where inquiry_id = 'inq1' order by created_at desc limit 1`)).status === 'CONFIRMED', 'the hold is confirmed');
ok((await rpc('cust1', 'my_agreements')).r[0].booking_status === 'Confirmed', '[12] the portal shows booking CONFIRMED next to the ACCEPTED agreement');
x = await as('res', () => db.query(bookingSql('dup', '2031-06-02', '2031-06-03', 1)).then(() => null, (e) => e.message));
ok(/BOOKING_GATE|DOUBLE_BOOKING/.test(x ?? ''), '[21] no second booking over it');

console.log('\nDECLINE  [8]');
const q3 = (await rpc('res', 'eag_freeze_quotation', 'inq3', quote('vB', '2031-07-01', '2031-07-04', 21000))).r;
await rpc('res', 'eag_accept_quotation', q3.id);
const a3 = (await rpc('res', 'eag_generate_agreement', 'inq3', false)).r;
const s3 = (await rpc('res', 'eag_send_agreement', a3.id, 'sms')).r;
const p3 = (await rpc('cust3', 'eag_open', s3.token)).r;
ok(p3.signed_in_as_customer === true, 'the page knows the signed-in number matches');
x = await rpc('cust3', 'eag_decide', s3.token, 'DECLINED', p3.statement_version, 'Found a cheaper car');
ok(x.r?.status === 'DECLINED', '[8] the customer can decline with a reason');
ok((await one(`select status, release_reason from esign.priority_holds where inquiry_id = 'inq3'`)).status === 'RELEASED', '[8] the car is released');
ok((await rpc('res', 'eag_gate_status', 'inq3')).r.state === 'LOCKED', '[8] and no advance can be asked');
ok((await one(`select decline_reason from esign.acceptances where agreement_id = $1`, [a3.id])).decline_reason === 'Found a cheaper car', 'the reason is kept');

console.log('\nEXPIRY  [16][17]');
const q4 = (await rpc('res', 'eag_freeze_quotation', 'inq4', quote('vB', '2031-08-01', '2031-08-04', 21000))).r;
await rpc('res', 'eag_accept_quotation', q4.id);
const a4 = (await rpc('res', 'eag_generate_agreement', 'inq4', false)).r;
const s4 = (await rpc('res', 'eag_send_agreement', a4.id, 'copy')).r;
await db.query(`update esign.agreements set expires_at = now() - interval '1 minute' where id = $1`, [a4.id]);
const p4 = (await rpc('cust4', 'eag_open', s4.token)).r;
ok(p4.status === 'EXPIRED' && p4.can_decide === false, 'the page says it has expired');
x = await rpc('cust4', 'eag_decide', s4.token, 'ACCEPTED', p4.statement_version, null);
ok(/expired/.test(x.e ?? ''), '[16] an expired agreement can\'t be accepted');

const q6 = (await rpc('res', 'eag_freeze_quotation', 'inq6', quote('vB', '2031-09-01', '2031-09-04', 21000))).r;
await rpc('res', 'eag_accept_quotation', q6.id);
const a6 = (await rpc('res', 'eag_generate_agreement', 'inq6', false)).r;
const s6 = (await rpc('res', 'eag_send_agreement', a6.id, 'sms')).r;
await db.query(`update esign.priority_holds set stage_deadline = now() - interval '1 minute' where inquiry_id = 'inq6' and status = 'ACTIVE'`);
x = await rpc('admin', 'eag_run_expiry');
ok(x.r?.holds_expired >= 1, 'the expiry job releases a hold past its deadline', JSON.stringify(x));
const p6 = (await rpc('cust6', 'eag_open', s6.token)).r;
x = await rpc('cust6', 'eag_decide', s6.token, 'ACCEPTED', p6.statement_version, null);
ok(x.r?.status === 'ACCEPTED' && x.r.advance_eligible === false, 'accepting after the hold ended is recorded, but priority isn\'t restored');
x = await rpc('res', 'eag_gate_status', 'inq6');
ok(x.r?.state === 'PRIORITY_EXPIRED', `[17] gate: "Priority expired — revalidation required" (${x.r?.state})`);
ok(/ADVANCE_LOCKED/.test((await rpc('res', 'eag_request_advance', 'inq6')).e ?? ''), '[17] an expired hold can\'t be used to ask for money');
ok((await rpc('res', 'eag_overview_missing', 'x')).e !== null, '(unknown functions don\'t exist)');

console.log('\nREVISION  [18]');
const q5 = (await rpc('res', 'eag_freeze_quotation', 'inq5', quote('vB', '2031-10-01', '2031-10-04', 21000))).r;
await rpc('res', 'eag_accept_quotation', q5.id);
const a5 = (await rpc('res', 'eag_generate_agreement', 'inq5', false)).r;
const s5 = (await rpc('res', 'eag_send_agreement', a5.id, 'sms')).r;
const p5 = (await rpc('cust5', 'eag_open', s5.token)).r;
await rpc('cust5', 'eag_decide', s5.token, 'ACCEPTED', p5.statement_version, null);
await rpc('res', 'eag_request_advance', 'inq5');
await rpc('cust5', 'eag_report_payment', s5.token, 5250, 'HNB-1', null);
x = await rpc('res', 'eag_freeze_quotation', 'inq5', quote('vB', '2031-10-01', '2031-10-05', 28000, { units: 4, rate: 7000 }));
ok(/PAYMENT_IN_PROGRESS/.test(x.e ?? ''), 'terms can\'t change while money is reported against them');
const rc5 = (await one(`select id from esign.payment_receipts where inquiry_id = 'inq5'`)).id;
await rpc('finance', 'eag_verify_receipt', rc5, 'REJECTED', null, null, 'not in the bank', null);
x = await rpc('res', 'eag_freeze_quotation', 'inq5', quote('vB', '2031-10-01', '2031-10-05', 28000, { units: 4, rate: 7000 }));
ok(x.r?.version === 2, 'after Finance rejects it, a revised quotation (v2, an extra day) can be sent', x.e ?? '');
ok((await one(`select status from esign.agreements where id = $1`, [a5.id])).status === 'SUPERSEDED', '[18] the accepted v1 agreement is superseded, not deleted');
ok((await one(`select count(*)::int n from esign.acceptances where agreement_id = $1`, [a5.id])).n === 1, '[18] its acceptance evidence is kept');
ok(/LINK_REPLACED/.test((await rpc('cust5', 'eag_open', s5.token)).e ?? ''), 'the old link stops working');
x = await rpc('res', 'eag_gate_status', 'inq5');
ok(x.r?.state === 'LOCKED', '[18] the advance is locked again until the new terms are accepted');

console.log('\nUNSOLICITED MONEY  [24]');
x = await rpc('res', 'eag_record_receipt', null, 10000, 'acc-boc', 'BOC-UNKNOWN', now, 'transfer without a request');
ok(x.r?.status === 'UNMATCHED', '[24] money without a request is recorded as UNMATCHED');
ok(/SAME_PERSON|NOT_ALLOWED/.test((await rpc('res', 'eag_verify_receipt', x.r.receipt_id, 'VERIFIED', 'acc-boc', now, null, null)).e ?? ''), 'the person who recorded it can\'t verify it');
x = await rpc('finance', 'eag_verify_receipt', x.r.receipt_id, 'REFUND_DUE', null, null, 'not ours to keep', null);
ok(x.r?.status === 'REFUND_DUE', '[24] Finance marks it for refund — no booking is touched');

console.log('\nEXCEPTIONS (audited)');
const exId = (await rpc('res', 'eag_request_exception', 'GATE_EXEMPT_BOOKING', null, null, 'Owner Alice uses her own car for a family trip',
  JSON.stringify({ vehicle_id: 'vB', start_date: '2031-11-01', end_date: '2031-11-02', total: 0 }))).r;
ok(/NOT_ALLOWED/.test((await rpc('res', 'eag_decide_exception', exId, true, null)).e ?? ''), 'staff can\'t approve exceptions');
const exAdmin = (await rpc('admin', 'eag_request_exception', 'OTHER', null, null, 'Testing that the asker cannot approve', '{}')).r;
ok(/someone other/.test((await rpc('admin', 'eag_decide_exception', exAdmin, true, null)).e ?? ''), 'whoever asked can\'t approve their own exception');
ok(!(await rpc('brian', 'eag_decide_exception', exId, true, 'ok — owner use')).e, 'the business approver approves it');
const tk = (await rpc('res', 'eag_use_gate_exemption', exId)).r;
x = await as('res', () => db.query(`insert into bookings (id, vehicle_id, customer_id, customer_name, customer_phone, start_date, end_date, total_days, total_amount, paid_amount, status, referral, created_at)
  values ('${tk.booking_id}', 'vB', 'o', 'Alice (owner)', '0771111111', '2031-11-01', '2031-11-02', 2, 0, 0, 'Confirmed', 'Owner', '${now}')`).then(() => null, (e) => e.message));
ok(x === null, 'with the approved exemption the booking saves (still clash-checked)', x ?? '');
await setPolicy({ split_admin_approvals: true });
const exB = (await rpc('res', 'eag_request_exception', 'OTHER', null, null, 'Checking the admin split switch', '{}')).r;
ok(/NOT_ALLOWED/.test((await rpc('admin', 'eag_decide_exception', exB, true, null)).e ?? ''), 'with the split on, IT admin can no longer approve');
ok(!(await rpc('brian', 'eag_decide_exception', exB, true, null)).e, '…the Managing Director still can');
await setPolicy({ split_admin_approvals: false, enforce_from: null });

console.log('\nDASHBOARD & EXISTING DATA');
const dash = (await rpc('res', 'eag_dashboard')).r;
ok(dash && 'awaiting_acceptance' in dash && dash.declined_30d >= 1 && dash.payments_to_verify >= 0, 'dashboard counts', JSON.stringify(dash));
x = await as('res', () => db.query(`insert into bookings (id, vehicle_id, customer_id, customer_name, customer_phone, start_date, end_date, total_days, total_amount, paid_amount, status, referral, created_at)
  values ('walkin', 'vB', 'c', 'Walk in', '07', '2031-12-01', '2031-12-02', 2, 1, 0, 'Confirmed', 'Direct', '${now}')`).then(() => null, (e) => e.message));
ok(x === null, '[28] with the gate off (before go-live), the booking form works as today');
ok(/permission denied|does not exist/.test((await rpc('anon', 'eag_request_advance', 'inq1')).e ?? ''), 'website visitors can\'t call staff functions');
ok(/permission denied/.test(await as('res', () => db.query(`select private.eag_expire_due()`).then(() => '', (e) => e.message))), 'helpers can\'t be called directly');

console.log('\nDELIVERY, PDF & REMINDERS (file 24)');
x = await rpc('res', 'eag_agreement_contact', ag1.id);
ok(x.r?.phone === '94711000001' && x.r.reference === ag1.reference, 'staff get the number to text the link to');
ok(/NOT_ALLOWED/.test((await rpc('viewer', 'eag_agreement_contact', ag1.id)).e ?? ''), 'not without the send ability');
ok(/permission denied/.test((await rpc('res', 'eag_log_delivery', ag1.id, 'link', true, 'uid-1', null, '{}')).e ?? ''), 'only the server can log a delivery');
ok(!(await rpc('service', 'eag_log_delivery', ag1.id, 'link', true, 'uid-1', null, '{}')).e, 'the server logs "SMS sent"');
ok((await one(`select count(*)::int n from esign.events where agreement_id = $1 and event_type = 'SMS_SENT'`, [ag1.id])).n === 1, '…on the timeline, marked as sent (not delivered)');
await db.query(`insert into sms_log (recipient, message, category, related_id, status) values ('94711000001', 'x', 'eagreementLink', $1, 'delivered')`, ['eag:' + ag1.id]);
ok((await rpc('viewer', 'eag_deliveries', ag1.id)).r?.[0]?.status === 'delivered', 'staff see the real delivery status from the SMS report');

const src = (await rpc('anon', 'eag_pdf_source', sent.token, null)).r;
ok(src?.status === 'ACCEPTED' && src.acceptance?.phone === '+94 ••• ••• 001' && !JSON.stringify(src.acceptance).includes('94711000001'),
   'the PDF source through the link: accepted, number masked');
ok(/LINK_INVALID/.test((await rpc('anon', 'eag_pdf_source', 'a'.repeat(64), null)).e ?? ''), 'no PDF for a made-up link');
ok(/NOT_ALLOWED/.test((await rpc('cust2', 'eag_pdf_source', null, ag1.id)).e ?? ''), 'no PDF by id for a customer (only with their link)');
ok((await rpc('viewer', 'eag_pdf_source', null, ag1.id)).r?.reference === ag1.reference, 'staff can get it by id');

const PDFLib = await import('pdf-lib');
const { buildAgreementPdf } = await import('../../functions/_shared/agreementPdf.ts');
const pdf1 = await buildAgreementPdf(PDFLib, src), pdf2 = await buildAgreementPdf(PDFLib, src);
const hex = (b) => Buffer.from(b).toString('hex');
const { createHash } = await import('node:crypto');
const sha = (b) => createHash('sha256').update(b).digest('hex');
ok(Buffer.from(pdf1.slice(0, 5)).toString() === '%PDF-', `[13] the agreement PDF is made (${Math.round(pdf1.length / 1024)} KB)`);
ok(sha(pdf1) === sha(pdf2), '[13] the same accepted document always gives the identical file (stable fingerprint)');
const loaded = await PDFLib.PDFDocument.load(pdf1);
const zlib = await import('node:zlib');
const pageText = (bytes) => [...Buffer.from(bytes).toString('latin1').matchAll(/stream\r?\n([\s\S]*?)endstream/g)]
  .map((m) => { try { return zlib.inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1'); } catch { return m[1]; } }).join('');
const raw = pageText(pdf1);
const has = (t, r = raw) => r.includes(Buffer.from(t, 'latin1').toString('hex').toUpperCase()) || r.includes(t);
ok(loaded.getPageCount() >= 1 && has('ACCEPTANCE RECORD') && has(ag1.reference) && has('LKR 4,500'), 'it carries the reference, the amounts and the acceptance record');
const src3 = (await rpc('viewer', 'eag_pdf_source', null, a3.id)).r;
const raw3 = pageText(await buildAgreementPdf(PDFLib, src3));
ok(has('DECLINED', raw3), 'a declined agreement\'s PDF says DECLINED');
const fs = await import('node:fs');
fs.writeFileSync(new URL('./out-agreement.pdf', import.meta.url), pdf1);

const h = sha(pdf1);
ok(/permission denied/.test((await rpc('res', 'eag_attach_pdf', ag1.id, `accepted/${ag1.id}.pdf`, h)).e ?? ''), 'only the server stores the accepted PDF');
x = await rpc('service', 'eag_attach_pdf', ag1.id, `accepted/${ag1.id}.pdf`, h);
ok(x.r?.already === false, '[13] the accepted PDF\'s path + SHA-256 are recorded');
x = await rpc('service', 'eag_attach_pdf', ag1.id, `accepted/${ag1.id}-other.pdf`, 'f'.repeat(64));
ok(x.r?.already === true && x.r.hash === h, '[13] a second, different PDF can\'t replace it');
ok(/EVIDENCE_LOCKED/.test(await db.query(`update esign.agreements set pdf_hash = 'x' where id = $1`, [ag1.id]).then(() => '', (e) => e.message)), '[13] not even directly in the database');
ok(/BAD_STEP/.test((await rpc('service', 'eag_attach_pdf', a3.id, `accepted/${a3.id}.pdf`, h)).e ?? ''), 'only accepted agreements get a stored PDF');

// reminders: a fresh agreement waiting for the customer
const q5b = await one(`select id from esign.quotations where inquiry_id = 'inq5' order by version desc limit 1`);
await rpc('res', 'eag_accept_quotation', q5b.id);
const a5b = (await rpc('res', 'eag_generate_agreement', 'inq5', false)).r;
await rpc('res', 'eag_send_agreement', a5b.id, 'sms');
await setPolicy({ reminders: { agreement: [72, 2], advance: [6] } });
ok(/permission denied/.test((await rpc('res', 'eag_due_reminders')).e ?? ''), 'only the server lists reminders');
let due = (await rpc('service', 'eag_due_reminders')).r ?? [];
ok(due.length === 1 && due[0].reference === a5b.reference && due[0].kind === 'agreement' && Number(due[0].hours) === 72,
   'a reminder is due for the agreement 72 h before it expires (the 2 h one isn\'t due yet)', JSON.stringify(due));
await rpc('service', 'eag_log_delivery', a5b.id, 'reminder', true, 'uid-r', null, JSON.stringify({ kind: 'agreement', hours: 72 }));
due = (await rpc('service', 'eag_due_reminders')).r ?? [];
ok(due.length === 0, 'once sent, the same reminder isn\'t sent again');

console.log('\nSCREENS (file 25)');
x = await rpc('cust5', 'my_agreement_link', a5b.reference);
ok(/^\/booking-agreement\/[0-9a-f]{64}$/.test(x.r?.path ?? ''), '[Portal] a signed-in customer gets a personal link to their pending agreement', x.e ?? '');
const pPortal = (await rpc('cust5', 'eag_open', x.r.path.split('/').pop())).r;
ok(pPortal?.reference === a5b.reference && pPortal.signed_in_as_customer, '…which opens it, recognising them');
ok(/NOT_FOUND/.test((await rpc('cust2', 'my_agreement_link', a5b.reference)).e ?? ''), '[6] another customer can\'t get a link to it');
ok(/SIGN_IN_REQUIRED|permission denied/.test((await rpc('anon', 'my_agreement_link', a5b.reference)).e ?? ''), 'not without signing in');
ok(/BAD_STEP/.test((await rpc('cust3', 'my_agreement_link', a3.reference)).e ?? ''), 'no link for a declined agreement');
ok((await rpc('admin', 'eag_templates')).r?.[0]?.status === 'APPROVED', 'admins see the wording versions');
ok(/NOT_ALLOWED/.test((await rpc('res', 'eag_templates')).e ?? ''), '…staff don\'t');
ok(((await rpc('res', 'eag_exceptions')).r ?? []).length >= 3, 'staff see the exceptions list');
ok(Array.isArray((await rpc('finance', 'eag_open_requests')).r), 'Finance sees the open advance requests');
ok(((await rpc('res', 'eag_accounts')).r ?? []).some((a) => a.id === 'acc-boc' && !('opening_balance' in a)), 'payment takers see account names only');
ok(/NOT_ALLOWED/.test((await rpc('viewer', 'eag_accounts')).e ?? ''), '…others don\'t');
ok(/NOT_ALLOWED/.test((await rpc('viewer', 'eag_open_requests')).e ?? ''), '…others don\'t');
ok(((await rpc('viewer', 'eag_recent', 10)).r ?? []).length >= 3, 'recent agreements for the dashboard');
ok(/NOT_ALLOWED/.test((await rpc('res', 'eag_save_policy', JSON.stringify({ link_valid_hours: 1 }))).e ?? ''), 'staff can\'t change the policy');
ok(/must be a number/.test((await rpc('brian', 'eag_save_policy', JSON.stringify({ link_valid_hours: 'soon' }))).e ?? ''), 'policy numbers are checked');
ok(/unknown policy value/.test((await rpc('brian', 'eag_save_policy', JSON.stringify({ evil: 1 }))).e ?? ''), 'unknown policy values are refused');
ok(/active company account/.test((await rpc('brian', 'eag_save_policy', JSON.stringify({ collection_account_id: 'nope' }))).e ?? ''), 'the collection account must exist');
x = await rpc('brian', 'eag_save_policy', JSON.stringify({ link_valid_hours: 36 }));
ok(x.r?.link_valid_hours === 36 && x.r.advance_rule?.value === 25, 'the approver saves a value; the others are kept');
ok((await one(`select metadata from esign.events where event_type = 'POLICY_UPDATED' order by id desc limit 1`)).metadata.changes.link_valid_hours.from === 48,
   'the change is on the record (from 48 to 36)');

console.log('\nVERIFY.SQL (what you run on the live database)');
await db.exec(`insert into storage.buckets (id, name, public) values ('vehicle-images','vehicle-images',true), ('receipts','receipts',true) on conflict do nothing`);
await db.exec(sql('security/verify.sql'));
const vrows = (await db.query(`select check_name, result, detail from security_check where area = 'e-agreement' order by n`)).rows;
ok(vrows.length >= 25, `verify.sql reports the e-Agreement checks (${vrows.length} rows)`);
const vfails = vrows.filter((x) => x.result === 'FAIL');
ok(vfails.length === 0, 'verify.sql: no FAIL for the e-Agreement', JSON.stringify(vfails));
ok(vrows.some((x) => x.check_name === 'booking gate (go-live)' && /OFF/.test(x.detail)), 'verify.sql shows the gate is OFF');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
