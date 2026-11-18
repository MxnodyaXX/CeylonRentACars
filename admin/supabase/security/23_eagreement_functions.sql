-- =====================================================================
-- 23 · BOOKING e-AGREEMENT — server functions (Stage 3b of admin/supabase/EAGREEMENT.md)
--
-- Every step of  INQUIRY → QUOTATION → PRIORITY HOLD → e-AGREEMENT → ACCEPTANCE → ADVANCE REQUEST
--                → FINANCE VERIFICATION → ALLOCATION → CONFIRMED BOOKING
-- is a function here. Each one checks who is calling and that the step is allowed right now, writes the
-- change, and adds an event to the inquiry's timeline — all in one transaction. The records themselves
-- (schema esign, file 22) can't be reached any other way.
--
-- Staff abilities used (set on the Permissions page, like file 16):
--   canSendAgreements   quotation versions, holds, generate / send / revoke agreements, manual acceptance
--   canRequestAdvance   issue the advance request (only when the gate is open)
--   canVerifyPayments   Finance: verify / reject / match payments
--   canTakePayments     record money that arrived (a receipt) — never verifies it
--   canBook             take the allocation ticket and save the booking
--   canViewInquiries    see an inquiry's e-Agreement panel
-- Admins can do all of these. While eagreement_policy.split_admin_approvals is off every admin is also a
-- "business approver" (templates, exceptions, payment verification); when it's on, only admins marked
-- business_approver are.
--
-- The booking form keeps working as it is: when everything checks out, eag_allocate() issues a one-time
-- ticket (a booking id). Saving the booking with that id is allowed only if its car, dates and bill match
-- the accepted agreement; the database then confirms the hold and links the booking.
--
-- Needs 01, 02, 05, 16, 18 (company_accounts) and 22. Safe to re-run.
-- Undo: rollback/23_rollback_eagreement_functions.sql
-- =====================================================================

-- ── Small additions to the file-22 tables ────────────────────────────────────
create sequence if not exists esign.ref_seq;
alter table esign.booking_allocations alter column inquiry_id drop not null;
alter table esign.booking_allocations
  add column if not exists vehicle_id     text,
  add column if not exists expected_range tstzrange,
  add column if not exists expected_total numeric(12,2);
alter table esign.exceptions add column if not exists details jsonb not null default '{}';
create index if not exists receipts_status on esign.payment_receipts (status);
create index if not exists agreements_status on esign.agreements (status, expires_at);
create index if not exists holds_active on esign.priority_holds (status, stage_deadline) where status = 'ACTIVE';
revoke all on all tables in schema esign from public, anon, authenticated;
revoke all on all sequences in schema esign from public, anon, authenticated;

-- A customer may report a payment again after a part payment or a late one
create or replace function private.esign_step_ok(p_kind text, p_from text, p_to text) returns boolean
language sql immutable set search_path = '' as $$
  select p_from = p_to or case p_kind
    when 'agreement' then (p_from, p_to) in (
      ('DRAFT','SENT'), ('DRAFT','REVOKED'), ('DRAFT','SUPERSEDED'),
      ('SENT','VIEWED'), ('SENT','ACCEPTED'), ('SENT','DECLINED'), ('SENT','EXPIRED'), ('SENT','REVOKED'), ('SENT','SUPERSEDED'),
      ('VIEWED','ACCEPTED'), ('VIEWED','DECLINED'), ('VIEWED','EXPIRED'), ('VIEWED','REVOKED'), ('VIEWED','SUPERSEDED'),
      ('ACCEPTED','SUPERSEDED'))
    when 'quotation' then (p_from, p_to) in (
      ('SENT','ACCEPTED'), ('SENT','SUPERSEDED'), ('SENT','EXPIRED'), ('SENT','WITHDRAWN'),
      ('ACCEPTED','SUPERSEDED'), ('ACCEPTED','EXPIRED'), ('ACCEPTED','WITHDRAWN'))
    when 'hold' then p_from = 'ACTIVE'
    when 'template' then (p_from, p_to) in (('DRAFT','APPROVED'), ('APPROVED','RETIRED'))
    when 'request' then (p_from, p_to) in (
      ('REQUESTED','REPORTED'), ('REQUESTED','VERIFIED'), ('REQUESTED','PARTIAL'), ('REQUESTED','LATE'), ('REQUESTED','CANCELLED'),
      ('REPORTED','VERIFIED'), ('REPORTED','PARTIAL'), ('REPORTED','REQUESTED'), ('REPORTED','LATE'), ('REPORTED','CANCELLED'),
      ('PARTIAL','REPORTED'), ('PARTIAL','VERIFIED'), ('PARTIAL','LATE'), ('PARTIAL','CANCELLED'),
      ('LATE','REPORTED'), ('LATE','VERIFIED'), ('LATE','CANCELLED'))
    when 'receipt' then (p_from, p_to) in (
      ('REPORTED','VERIFIED'), ('REPORTED','REJECTED'), ('REPORTED','DUPLICATE'), ('REPORTED','UNMATCHED'),
      ('UNMATCHED','VERIFIED'), ('UNMATCHED','REJECTED'), ('UNMATCHED','DUPLICATE'), ('UNMATCHED','REFUND_DUE'),
      ('VERIFIED','REFUND_DUE'), ('REFUND_DUE','REFUNDED'))
    when 'exception' then (p_from, p_to) in (('PENDING','APPROVED'), ('PENDING','REJECTED'), ('APPROVED','USED'))
    else false end
$$;

-- ── Helpers ──────────────────────────────────────────────────────────────────

-- Who is calling, for the records: the staff name / username, else the login id
create or replace function private.esign_actor() returns text
language sql stable set search_path = '' as $$
  select coalesce(nullif(auth.jwt() -> 'app_metadata' ->> 'name', ''), nullif(auth.jwt() -> 'app_metadata' ->> 'username', ''),
                  nullif(auth.jwt() ->> 'email', ''), nullif(auth.jwt() ->> 'sub', ''), 'system')
$$;

create or replace function private.esign_can(p_perm text) returns boolean
language sql stable set search_path = '' as $$
  select private.is_admin() or private.staff_may(p_perm)
$$;

create or replace function private.esign_can_verify() returns boolean
language sql stable set search_path = '' as $$
  select private.staff_may('canVerifyPayments') or private.is_business_approver()
$$;

create or replace function private.esign_need(p_ok boolean, p_code text, p_msg text) returns void
language plpgsql set search_path = '' as $$
begin
  if p_ok is not true then raise exception '%: %', p_code, p_msg using errcode = 'P0001'; end if;
end $$;

create or replace function private.esign_event(p_inquiry text, p_agreement uuid, p_type text, p_actor_type text, p_meta jsonb default '{}')
returns void language sql security definer set search_path = '' as $$
  insert into esign.events (inquiry_id, agreement_id, event_type, actor_type, actor_id, metadata)
  values (p_inquiry, p_agreement, p_type, p_actor_type,
          case when p_actor_type = 'staff' then private.esign_actor()
               when p_actor_type = 'customer' then coalesce(nullif(auth.jwt() ->> 'sub', ''), 'link') else 'system' end,
          coalesce(p_meta, '{}'))
$$;

-- A staff alert in the existing notifications list (the bell)
create or replace function private.esign_notify(p_title text, p_message text, p_related text) returns void
language sql security definer set search_path = '' as $$
  insert into public.notifications (id, type, title, message, related_id, read, created_at)
  values ('eag-' || replace(gen_random_uuid()::text, '-', ''), 'agreement', left(p_title, 120), left(p_message, 500), p_related, false,
          to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
$$;

create or replace function private.esign_policy_require(p_keys text[]) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare p jsonb := private.eag_policy(); missing text[];
begin
  select array_agg(k) into missing from unnest(p_keys) k where coalesce(p ->> k, '') = '';
  if missing is not null then
    raise exception 'POLICY_NOT_APPROVED: these company policy values are not set yet: % (Settings → e-Agreement policy, approved by the Managing Director)',
      array_to_string(missing, ', ') using errcode = 'P0001';
  end if;
  return p;
end $$;

create or replace function private.esign_hours(p jsonb, k text) returns interval
language sql immutable set search_path = '' as $$ select make_interval(secs => ((p ->> k)::numeric * 3600)::double precision) $$;

create or replace function private.esign_ref(p_prefix text) returns text
language sql security definer set search_path = '' as $$
  select p_prefix || '-' || to_char(now() at time zone 'Asia/Colombo', 'YYYY') || '-' || lpad(nextval('esign.ref_seq')::text, 6, '0')
$$;

create or replace function private.esign_html(p text) returns text
language sql immutable set search_path = '' as $$
  select replace(replace(replace(replace(coalesce(p, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;')
$$;

create or replace function private.esign_sha(p text) returns text
language sql immutable set search_path = '' as $$ select encode(sha256(convert_to(coalesce(p, ''), 'UTF8')), 'hex') $$;

create or replace function private.esign_lk(p timestamptz) returns text
language sql immutable set search_path = '' as $$ select to_char(p at time zone 'Asia/Colombo', 'DD Mon YYYY, HH24:MI') $$;

create or replace function private.esign_money(p numeric) returns text
language sql immutable set search_path = '' as $$ select 'LKR ' || to_char(round(coalesce(p, 0)), 'FM999,999,999,990') $$;

-- The advance the approved rule asks for: {"type":"percent"|"fixed","value":N,"by_category":{"Van":{…}}}
create or replace function private.esign_advance_for(p_total numeric, p_category text) returns numeric
language plpgsql stable security definer set search_path = '' as $$
declare r jsonb := private.eag_policy() -> 'advance_rule'; a numeric;
begin
  if r is null or jsonb_typeof(r) <> 'object' then return null; end if;
  if p_category is not null and r -> 'by_category' ? p_category then r := r -> 'by_category' -> p_category; end if;
  if r ->> 'type' = 'percent' then a := round(p_total * (r ->> 'value')::numeric / 100);
  elsif r ->> 'type' = 'fixed' then a := (r ->> 'value')::numeric;
  else return null; end if;
  return least(greatest(a, 0), p_total);
end $$;

-- The latest quotation version of an inquiry
create or replace function private.esign_current_quotation(p_inquiry text) returns esign.quotations
language sql stable security definer set search_path = '' as $$
  select * from esign.quotations where inquiry_id = p_inquiry order by version desc limit 1
$$;

-- Offer a freed period to the first customer waiting for it (staff decide — never automatic)
create or replace function private.esign_offer_waitlist(p_vehicle text, p_range tstzrange) returns void
language plpgsql security definer set search_path = '' as $$
declare w record;
begin
  for w in select * from esign.hold_waitlist
            where status = 'WAITING' and vehicle_id = p_vehicle and wanted && p_range
            order by created_at limit 1 loop
    update esign.hold_waitlist set status = 'OFFERED' where id = w.id;
    perform private.esign_event(w.inquiry_id, null, 'WAITLIST_OFFERED', 'system', jsonb_build_object('vehicle_id', p_vehicle));
    perform private.esign_notify('Car free for a waiting customer', 'A held period ended — offer it to inquiry ' || w.inquiry_id || ' (first in the waiting list).', w.inquiry_id);
  end loop;
end $$;

create or replace function private.esign_release_hold(p_hold uuid, p_status text, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare h esign.priority_holds;
begin
  update esign.priority_holds set status = p_status, released_at = now(), release_reason = p_reason
   where id = p_hold and status = 'ACTIVE' returning * into h;
  if h.id is null then return; end if;
  perform private.esign_event(h.inquiry_id, null, 'HOLD_' || p_status, case when private.esign_actor() = 'system' then 'system' else 'staff' end,
    jsonb_build_object('hold_id', h.id, 'reason', p_reason));
  perform private.esign_offer_waitlist(h.vehicle_id, h.hold_range);
end $$;

-- ── The gate: may an advance be requested / a booking be allocated? ──────────
-- Returns { state, problems[], ids… }. state: NO_QUOTATION | LOCKED | PRIORITY_EXPIRED | ELIGIBLE |
-- ADVANCE_REQUESTED | PAYMENT_REPORTED | PAYMENT_VERIFIED | CONFIRMED
create or replace function private.esign_gate(p_inquiry text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  i public.inquiries; q esign.quotations; a esign.agreements; h esign.priority_holds; r esign.payment_requests; v public.vehicles;
  pol jsonb := private.eag_policy(); probs text[] := '{}'; hold_probs text[] := '{}'; acc_id text; want numeric; state text;
begin
  select * into i from public.inquiries where id = p_inquiry;
  if i.id is null then raise exception 'NOT_FOUND: inquiry % not found', p_inquiry using errcode = 'P0001'; end if;
  if exists (select 1 from esign.booking_allocations ba join public.bookings b on b.id = ba.booking_id where ba.inquiry_id = p_inquiry and b.status <> 'Cancelled') then
    return jsonb_build_object('state', 'CONFIRMED', 'problems', '[]'::jsonb);
  end if;
  if length(private.phone_key(i.customer_phone)) not between 9 and 15 then probs := probs || 'The customer''s mobile number is missing or not valid.'::text; end if;
  q := private.esign_current_quotation(p_inquiry);
  if q.id is null then return jsonb_build_object('state', 'NO_QUOTATION', 'problems', to_jsonb(probs || 'No quotation has been sent yet.'::text)); end if;
  if q.status <> 'ACCEPTED' then probs := probs || ('The customer hasn''t accepted quotation v' || q.version || ' yet.'); end if;
  if q.valid_until <= now() then probs := probs || ('Quotation v' || q.version || ' expired on ' || private.esign_lk(q.valid_until) || '.'); end if;

  select * into a from esign.agreements where inquiry_id = p_inquiry order by version desc limit 1;
  if a.id is null or a.status <> 'ACCEPTED' then
    probs := probs || ('The e-Agreement ' || case when a.id is null then 'hasn''t been generated' else 'is ' || a.status end || ' — it must be ACCEPTED by the customer.');
  elsif a.quotation_id <> q.id or a.quotation_version <> q.version then
    probs := probs || 'The accepted e-Agreement is for an older quotation — send the revised agreement.'::text;
  elsif a.document_hash is distinct from private.esign_sha(a.snapshot::text || E'\n' || coalesce(a.rendered_html, '')) then
    probs := probs || 'The accepted document doesn''t match its fingerprint — contact IT.'::text;
  end if;

  select * into h from esign.priority_holds where inquiry_id = p_inquiry and quotation_id = q.id order by created_at desc limit 1;
  if h.id is null or h.status <> 'ACTIVE' then
    hold_probs := hold_probs || ('The priority hold ' || case when h.id is null then 'was never placed' else 'is ' || h.status || coalesce(' (' || h.release_reason || ')', '') end || '.');
  elsif h.expires_at <= now() or (h.stage <> 'ALLOCATING' and h.stage_deadline <= now()) then
    hold_probs := hold_probs || ('The priority hold ran out on ' || private.esign_lk(least(h.expires_at, h.stage_deadline)) || '.');
  end if;

  select * into v from public.vehicles where id = q.vehicle_id;
  if v.id is null then probs := probs || 'The quoted vehicle no longer exists.'::text;
  elsif v.status in ('Maintenance', 'Inactive') then probs := probs || ('The vehicle is ' || v.status || ' — offer an alternative.');
  end if;
  if exists (select 1 from public.bookings b where b.vehicle_id = q.vehicle_id and b.occupies && tstzrange(q.pickup_at, q.return_at, '[)')
               and not exists (select 1 from esign.booking_allocations ba where ba.booking_id = b.id and ba.inquiry_id = p_inquiry)) then
    probs := probs || 'The vehicle has been booked by someone else for these dates.'::text;
  end if;

  want := private.esign_advance_for(q.total, q.vehicle_category);
  if want is null then probs := probs || 'The advance rule (policy) isn''t set.'::text;
  elsif want <> q.advance_required then probs := probs || ('The advance on the quotation (' || private.esign_money(q.advance_required) || ') no longer follows the approved rule (' || private.esign_money(want) || ') — send a revised quotation.');
  end if;
  acc_id := pol ->> 'collection_account_id';
  if coalesce(acc_id, '') = '' or not exists (select 1 from public.company_accounts c where c.id = acc_id and c.active) then
    probs := probs || 'No approved collection account is set (policy).'::text;
  end if;

  select * into r from esign.payment_requests where inquiry_id = p_inquiry and status <> 'CANCELLED' order by created_at desc limit 1;

  state := case
    when cardinality(probs) = 0 and cardinality(hold_probs) = 0 then
      case when r.id is null then 'ELIGIBLE' when r.status = 'VERIFIED' then 'PAYMENT_VERIFIED'
           when r.status in ('REPORTED', 'PARTIAL') then 'PAYMENT_REPORTED' when r.status = 'LATE' then 'PRIORITY_EXPIRED' else 'ADVANCE_REQUESTED' end
    when cardinality(probs) = 0 then 'PRIORITY_EXPIRED'
    else 'LOCKED' end;
  return jsonb_build_object('state', state, 'problems', to_jsonb(probs || hold_probs),
    'quotation_id', q.id, 'quotation_version', q.version, 'agreement_id', a.id, 'agreement_status', a.status,
    'hold_id', h.id, 'hold_status', h.status, 'hold_stage', h.stage, 'stage_deadline', h.stage_deadline, 'hold_expires_at', h.expires_at,
    'request_id', r.id, 'request_status', r.status, 'advance', q.advance_required);
end $$;

-- ── 1. Quotation versions ────────────────────────────────────────────────────
-- p_q: { vehicle_id, pickup_date, pickup_time, return_date, return_time, pickup_location, return_location,
--        rental_type, rate, units, included_km, extra_km_rate, extras:[{label,amount}], discount, total, deposit,
--        conditions:{…}, alternatives }
create or replace function public.eag_freeze_quotation(p_inquiry_id text, p_q jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  i public.inquiries; v public.vehicles; prev esign.quotations; q esign.quotations; pol jsonb;
  s timestamptz; e timestamptz; extras numeric; total numeric; adv numeric; cat text;
begin
  perform private.esign_need(private.esign_can('canSendAgreements'), 'NOT_ALLOWED', 'you can''t send quotations');
  pol := private.esign_policy_require(array['quotation_valid_hours', 'advance_rule']);
  select * into i from public.inquiries where id = p_inquiry_id for update;
  perform private.esign_need(i.id is not null, 'NOT_FOUND', 'inquiry not found');
  perform private.esign_need(i.status = 'Pending', 'BAD_STEP', 'this inquiry is ' || i.status);
  select * into v from public.vehicles where id = p_q ->> 'vehicle_id';
  perform private.esign_need(v.id is not null, 'BAD_INPUT', 'choose the vehicle');
  s := private.lk_ts(p_q ->> 'pickup_date', p_q ->> 'pickup_time', '00:00');
  e := private.lk_ts(p_q ->> 'return_date', p_q ->> 'return_time', '23:59');
  perform private.esign_need(s is not null and e is not null and e > s, 'BAD_INPUT', 'the pickup and return dates aren''t valid');
  select coalesce(sum((x ->> 'amount')::numeric), 0) into extras from jsonb_array_elements(coalesce(p_q -> 'extras', '[]')) x;
  total := (p_q ->> 'total')::numeric;
  perform private.esign_need(total > 0, 'BAD_INPUT', 'the total must be more than 0');
  if p_q ? 'rate' and p_q ? 'units' then
    perform private.esign_need(abs((p_q ->> 'rate')::numeric * (p_q ->> 'units')::numeric + extras - coalesce((p_q ->> 'discount')::numeric, 0) - total) <= 1,
      'BAD_INPUT', 'rate × units + extras − discount doesn''t add up to the total');
  end if;
  cat := coalesce(nullif(p_q ->> 'category', ''), to_jsonb(v) ->> 'web_category');
  adv := private.esign_advance_for(total, cat);
  perform private.esign_need(adv is not null and adv > 0, 'POLICY_NOT_APPROVED', 'the advance rule gives no advance for this quotation');

  -- terms already paid against can't be revised until Finance resolves the money
  perform private.esign_need(not exists (select 1 from esign.payment_requests r where r.inquiry_id = p_inquiry_id and r.status in ('REPORTED', 'PARTIAL', 'VERIFIED', 'LATE')),
    'PAYMENT_IN_PROGRESS', 'money is already reported or verified against the current terms — Finance must resolve it (refund or move it) before the terms change');

  prev := private.esign_current_quotation(p_inquiry_id);
  if prev.id is not null and prev.status in ('SENT', 'ACCEPTED') then
    update esign.quotations set status = 'SUPERSEDED' where id = prev.id;
  end if;
  -- the revision rule: an open or accepted agreement for older terms is superseded, an unpaid request cancelled
  update esign.agreements set status = 'SUPERSEDED' where inquiry_id = p_inquiry_id and status in ('DRAFT', 'SENT', 'VIEWED', 'ACCEPTED');
  update esign.access_tokens t set revoked_at = now() from esign.agreements a
   where t.agreement_id = a.id and a.inquiry_id = p_inquiry_id and t.revoked_at is null;
  update esign.payment_requests set status = 'CANCELLED' where inquiry_id = p_inquiry_id and status = 'REQUESTED';

  insert into esign.quotations (reference, inquiry_id, version, vehicle_id, vehicle_label, vehicle_category, pickup_at, return_at,
    pickup_location, return_location, rental_type, rate, units, included_km, extra_km_rate, extras, discount, total,
    advance_required, deposit, conditions, valid_until, created_by)
  values (private.esign_ref('CRC-Q'), p_inquiry_id, coalesce(prev.version, 0) + 1, v.id, trim(coalesce(v.brand, '') || ' ' || coalesce(v.model, '')), cat, s, e,
    nullif(p_q ->> 'pickup_location', ''), nullif(p_q ->> 'return_location', ''), coalesce(nullif(p_q ->> 'rental_type', ''), 'Daily'),
    (p_q ->> 'rate')::numeric, (p_q ->> 'units')::numeric, (p_q ->> 'included_km')::numeric, (p_q ->> 'extra_km_rate')::numeric,
    coalesce(p_q -> 'extras', '[]'), coalesce((p_q ->> 'discount')::numeric, 0), total, adv, coalesce((p_q ->> 'deposit')::numeric, 0),
    coalesce(p_q -> 'conditions', '{}') || jsonb_build_object('alternatives', p_q -> 'alternatives'),
    now() + private.esign_hours(pol, 'quotation_valid_hours'), private.esign_actor())
  returning * into q;
  perform private.esign_event(p_inquiry_id, null, 'QUOTATION_SENT', 'staff', jsonb_build_object('quotation', q.reference, 'version', q.version, 'total', q.total, 'advance', q.advance_required));
  return jsonb_build_object('id', q.id, 'reference', q.reference, 'version', q.version, 'advance_required', q.advance_required, 'valid_until', q.valid_until);
end $$;

-- ── 2. The customer accepts the quotation → priority hold (or the waiting list) ──
create or replace function public.eag_accept_quotation(p_quotation_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare q esign.quotations; v public.vehicles; prev_h esign.priority_holds; h esign.priority_holds; pol jsonb; buf interval; cap timestamptz; msg text;
begin
  perform private.esign_need(private.esign_can('canSendAgreements'), 'NOT_ALLOWED', 'you can''t record quotation acceptance');
  pol := private.esign_policy_require(array['agreement_deadline_hours', 'hold_max_hours', 'turnaround_minutes']);
  select * into q from esign.quotations where id = p_quotation_id for update;
  perform private.esign_need(q.id is not null, 'NOT_FOUND', 'quotation not found');
  perform private.esign_need(q.id = (private.esign_current_quotation(q.inquiry_id)).id, 'BAD_STEP', 'a newer version of this quotation exists');
  perform private.esign_need(q.status in ('SENT', 'ACCEPTED'), 'BAD_STEP', 'this quotation is ' || q.status);
  perform private.esign_need(q.valid_until > now(), 'EXPIRED', 'this quotation expired on ' || private.esign_lk(q.valid_until) || ' — send a new version');
  select * into v from public.vehicles where id = q.vehicle_id;
  perform private.esign_need(v.status not in ('Maintenance', 'Inactive'), 'NOT_AVAILABLE', 'the vehicle is ' || v.status);

  select * into h from esign.priority_holds where quotation_id = q.id and status = 'ACTIVE';
  if h.id is not null then return jsonb_build_object('status', 'HELD', 'hold_id', h.id, 'expires_at', h.expires_at); end if;   -- already done

  update esign.quotations set status = 'ACCEPTED', accepted_at = coalesce(accepted_at, now()) where id = q.id;
  perform private.esign_event(q.inquiry_id, null, 'QUOTATION_ACCEPTED', 'staff', jsonb_build_object('quotation', q.reference, 'version', q.version));

  buf := make_interval(mins => (pol ->> 'turnaround_minutes')::int);
  cap := now() + private.esign_hours(pol, 'hold_max_hours');
  begin
    -- an older hold of this inquiry gives way to the new terms (undone if the new one can't be placed)
    select * into prev_h from esign.priority_holds where inquiry_id = q.inquiry_id and status = 'ACTIVE';
    if prev_h.id is not null then
      update esign.priority_holds set status = 'RELEASED', released_at = now(), release_reason = 'Replaced by quotation v' || q.version where id = prev_h.id;
    end if;
    insert into esign.priority_holds (inquiry_id, quotation_id, vehicle_id, requested_start, requested_end, hold_range, stage, stage_deadline, expires_at, created_by)
    values (q.inquiry_id, q.id, q.vehicle_id, q.pickup_at, q.return_at, tstzrange(q.pickup_at - buf, q.return_at + buf, '[)'),
            'AWAITING_AGREEMENT', least(now() + private.esign_hours(pol, 'agreement_deadline_hours'), cap), cap, private.esign_actor())
    returning * into h;
  exception when exclusion_violation then
    msg := sqlerrm;
    insert into esign.hold_waitlist (inquiry_id, vehicle_id, wanted, created_by)
    values (q.inquiry_id, q.vehicle_id, tstzrange(q.pickup_at, q.return_at, '[)'), private.esign_actor())
    on conflict do nothing;
    perform private.esign_event(q.inquiry_id, null, 'WAITLISTED', 'staff', jsonb_build_object('quotation', q.reference, 'why', msg));
    return jsonb_build_object('status', 'WAITLISTED',
      'reason', case when msg like 'DOUBLE_BOOKING%' then 'The car is already booked over part of this time.'
                     else 'Another customer holds this car for part of this time.' end,
      'kept_hold', prev_h.id is not null);   -- the older hold's release was undone with the failed insert
  end;
  if prev_h.id is not null then perform private.esign_event(q.inquiry_id, null, 'HOLD_RELEASED', 'staff', jsonb_build_object('hold_id', prev_h.id, 'reason', 'Replaced by quotation v' || q.version)); end if;
  update esign.hold_waitlist set status = 'DONE' where inquiry_id = q.inquiry_id and vehicle_id = q.vehicle_id and status in ('WAITING', 'OFFERED');
  perform private.esign_event(q.inquiry_id, null, 'PRIORITY_ASSIGNED', 'staff',
    jsonb_build_object('hold_id', h.id, 'stage_deadline', h.stage_deadline, 'expires_at', h.expires_at));
  return jsonb_build_object('status', 'HELD', 'hold_id', h.id, 'stage_deadline', h.stage_deadline, 'expires_at', h.expires_at);
end $$;

create or replace function public.eag_release_hold(p_inquiry_id text, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare h esign.priority_holds;
begin
  perform private.esign_need(private.esign_can('canSendAgreements'), 'NOT_ALLOWED', 'you can''t release holds');
  perform private.esign_need(length(trim(coalesce(p_reason, ''))) >= 3, 'BAD_INPUT', 'say why the hold is released');
  select * into h from esign.priority_holds where inquiry_id = p_inquiry_id and status = 'ACTIVE' for update;
  perform private.esign_need(h.id is not null, 'NOT_FOUND', 'no active hold');
  perform private.esign_need(h.stage <> 'ALLOCATING', 'PAYMENT_IN_PROGRESS', 'the advance is verified — allocate the booking or resolve the money first');
  perform private.esign_release_hold(h.id, 'RELEASED', trim(p_reason));
  update esign.payment_requests set status = 'CANCELLED' where hold_id = h.id and status = 'REQUESTED';
end $$;

-- ── 3. Generate the e-Agreement (CRC-AGR-003) ────────────────────────────────
create or replace function public.eag_generate_agreement(p_inquiry_id text, p_disclose_registration boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  i public.inquiries; q esign.quotations; h esign.priority_holds; t esign.agreement_templates; v public.vehicles;
  cur esign.agreements; a esign.agreements; pol jsonb; snap jsonb; flat jsonb; html text; body text; sec jsonb;
  k text; val text; ver int; ref text; expires timestamptz; email text; days numeric;
begin
  perform private.esign_need(private.esign_can('canSendAgreements'), 'NOT_ALLOWED', 'you can''t generate agreements');
  pol := private.esign_policy_require(array['link_valid_hours', 'advance_deadline_hours', 'cancellation_policy_version', 'cancellation_policy_text']);
  select * into i from public.inquiries where id = p_inquiry_id for update;
  perform private.esign_need(i.id is not null, 'NOT_FOUND', 'inquiry not found');
  perform private.esign_need(length(private.phone_key(i.customer_phone)) between 9 and 15, 'BAD_INPUT', 'the customer''s mobile number is missing or not valid');
  q := private.esign_current_quotation(p_inquiry_id);
  perform private.esign_need(q.id is not null and q.status = 'ACCEPTED', 'BAD_STEP', 'record the customer''s acceptance of the latest quotation first');
  perform private.esign_need(q.valid_until > now(), 'EXPIRED', 'the quotation has expired — send a new version');
  select * into h from esign.priority_holds where quotation_id = q.id and status = 'ACTIVE';
  perform private.esign_need(h.id is not null and h.stage = 'AWAITING_AGREEMENT' and h.stage_deadline > now(), 'NO_PRIORITY',
    'the customer has no active priority hold for these terms');
  select * into t from esign.agreement_templates where document_code = 'CRC-AGR-003' and status = 'APPROVED' and coalesce(effective_at, now()) <= now();
  perform private.esign_need(t.id is not null, 'POLICY_NOT_APPROVED', 'no approved CRC-AGR-003 wording yet (Agreement wording → Approve)');

  select * into cur from esign.agreements where inquiry_id = p_inquiry_id and status in ('DRAFT', 'SENT', 'VIEWED');
  if cur.id is not null and cur.quotation_id = q.id then
    if cur.status = 'DRAFT' then
      return jsonb_build_object('id', cur.id, 'reference', cur.reference, 'version', cur.version, 'status', cur.status, 'reused', true);
    end if;
    raise exception 'BAD_STEP: agreement % is already % — resend or revoke it', cur.reference, cur.status using errcode = 'P0001';
  end if;
  update esign.agreements set status = 'SUPERSEDED' where inquiry_id = p_inquiry_id and status in ('DRAFT', 'SENT', 'VIEWED', 'ACCEPTED');

  select * into v from public.vehicles where id = q.vehicle_id;
  select c.email into email from public.customers c where private.phone_key(c.phone) = private.phone_key(i.customer_phone) and nullif(trim(c.email), '') is not null order by c.created_at desc limit 1;
  select coalesce(max(version), 0) + 1 into ver from esign.agreements where inquiry_id = p_inquiry_id;
  ref := private.esign_ref('CRC-EA');
  expires := least(now() + private.esign_hours(pol, 'link_valid_hours'), q.valid_until, h.expires_at);
  days := ceil(extract(epoch from (q.return_at - q.pickup_at)) / 86400);

  snap := jsonb_build_object(
    'agreement', jsonb_build_object('reference', ref, 'document_code', 'CRC-AGR-003', 'title', t.title, 'version', ver,
                                    'template_version', t.version, 'generated_at', private.esign_lk(now()), 'expires_at', private.esign_lk(expires)),
    'ids', jsonb_build_object('inquiry', i.id, 'quotation', q.reference, 'quotation_version', q.version,
                              'customer', 'CUS-' || right(private.phone_key(i.customer_phone), 9)),
    'customer', jsonb_build_object('name', i.customer_name, 'mobile', '+' || private.phone_key(i.customer_phone), 'email', coalesce(email, '')),
    'vehicle', jsonb_build_object('make_model', q.vehicle_label, 'category', coalesce(q.vehicle_category, ''),
                                  'registration', case when p_disclose_registration then coalesce(v.vehicle_number, '') else 'Disclosed when the booking is confirmed' end,
                                  'alternatives', coalesce(q.conditions ->> 'alternatives', 'No substitution without the customer''s agreement')),
    'rental', jsonb_build_object('pickup', private.esign_lk(q.pickup_at), 'return', private.esign_lk(q.return_at),
                                 'pickup_location', coalesce(q.pickup_location, ''), 'return_location', coalesce(q.return_location, q.pickup_location, ''),
                                 'duration', case q.rental_type when 'Daily' then days || ' day' || case when days = 1 then '' else 's' end
                                                  else coalesce(q.units::text, '') || ' ' || lower(q.rental_type) end,
                                 'package', q.rental_type,
                                 'included_km', coalesce(to_char(q.included_km, 'FM999,999,990') || ' km', 'Not limited'),
                                 'extra_km_rate', coalesce(private.esign_money(q.extra_km_rate) || ' per km', '—'),
                                 'conditions', coalesce(q.conditions ->> 'specific', 'None')),
    'payment', jsonb_build_object('total', private.esign_money(q.total), 'advance', private.esign_money(q.advance_required),
                                  'balance', private.esign_money(q.total - q.advance_required),
                                  'deposit', case when q.deposit > 0 then private.esign_money(q.deposit) else 'None' end,
                                  'advance_deadline', 'Within ' || (pol ->> 'advance_deadline_hours') || ' hours of accepting this agreement',
                                  'instructions', 'Payment details are shown only after you accept and CRC issues the advance request.'),
    'policy', jsonb_build_object('cancellation_version', pol ->> 'cancellation_policy_version', 'cancellation', pol ->> 'cancellation_policy_text',
                                 'statement', t.acceptance_statement, 'statement_version', 'CRC-AGR-003 v' || t.version));

  -- every {{group.key}} the wording may use
  select jsonb_object_agg(g.key || '.' || f.key, f.value) into flat
    from jsonb_each(snap) g, jsonb_each_text(g.value) f;
  html := '<article class="crc-agreement" data-ref="' || private.esign_html(ref) || '">'
       || '<header><h1>' || private.esign_html(t.title) || '</h1><p>' || private.esign_html(ref) || ' · version ' || ver || '</p></header>';
  for sec in select value from jsonb_array_elements(t.sections) loop
    body := private.esign_html(sec ->> 'body');
    for k, val in select key, value from jsonb_each_text(flat) loop
      body := replace(body, '{{' || k || '}}', private.esign_html(val));
    end loop;
    html := html || '<section><h2>' || private.esign_html(sec ->> 'heading') || '</h2><p>' || replace(body, E'\n', '<br>') || '</p></section>';
  end loop;
  html := html || '<section class="acceptance"><h2>Customer acceptance</h2><p>' || private.esign_html(t.acceptance_statement) || '</p></section></article>';

  insert into esign.agreements (reference, inquiry_id, customer_phone_key, quotation_id, quotation_version, template_id, template_version,
    version, snapshot, rendered_html, document_hash, expires_at, generated_by)
  values (ref, p_inquiry_id, private.phone_key(i.customer_phone), q.id, q.version, t.id, t.version, ver, snap, html,
          private.esign_sha(snap::text || E'\n' || html), expires, private.esign_actor())
  returning * into a;
  update esign.agreements set superseded_by = a.id where inquiry_id = p_inquiry_id and status = 'SUPERSEDED' and superseded_by is null and id <> a.id;
  perform private.esign_event(p_inquiry_id, a.id, 'AGREEMENT_GENERATED', 'staff', jsonb_build_object('reference', ref, 'version', ver, 'quotation_version', q.version));
  return jsonb_build_object('id', a.id, 'reference', a.reference, 'version', a.version, 'status', a.status, 'expires_at', a.expires_at, 'reused', false);
end $$;

-- ── 4. Send / resend (a new link; older links stop working) ──────────────────
create or replace function public.eag_send_agreement(p_agreement_id uuid, p_channel text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a esign.agreements; q esign.quotations; h esign.priority_holds; token text; resend boolean;
begin
  perform private.esign_need(private.esign_can('canSendAgreements'), 'NOT_ALLOWED', 'you can''t send agreements');
  perform private.esign_need(p_channel in ('whatsapp_link', 'sms', 'copy', 'in_person'), 'BAD_INPUT', 'choose how it is sent');
  select * into a from esign.agreements where id = p_agreement_id for update;
  perform private.esign_need(a.id is not null, 'NOT_FOUND', 'agreement not found');
  perform private.esign_need(a.status in ('DRAFT', 'SENT', 'VIEWED'), 'BAD_STEP', 'this agreement is ' || a.status);
  perform private.esign_need(a.expires_at > now(), 'EXPIRED', 'this agreement has expired — generate a new one');
  q := private.esign_current_quotation(a.inquiry_id);
  perform private.esign_need(q.id = a.quotation_id, 'SUPERSEDED', 'the quotation changed — generate the revised agreement');
  select * into h from esign.priority_holds where quotation_id = q.id and status = 'ACTIVE';
  perform private.esign_need(h.id is not null, 'NO_PRIORITY', 'the priority hold has ended');
  resend := a.status <> 'DRAFT';
  update esign.access_tokens set revoked_at = now() where agreement_id = a.id and revoked_at is null;
  -- 256 bits from the database's strong random generator; only its SHA-256 is kept
  token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into esign.access_tokens (agreement_id, token_hash, expires_at, created_by)
  values (a.id, private.esign_sha(token), a.expires_at, private.esign_actor());
  if a.status = 'DRAFT' then update esign.agreements set status = 'SENT', sent_at = now() where id = a.id; end if;
  perform private.esign_event(a.inquiry_id, a.id, case when resend then 'AGREEMENT_RESENT' else 'AGREEMENT_SENT' end, 'staff',
    jsonb_build_object('channel', p_channel, 'note', case p_channel when 'whatsapp_link' then 'opened in WhatsApp by staff — delivery not confirmed'
                                                                     when 'copy' then 'link copied by staff' else null end));
  return jsonb_build_object('token', token, 'path', '/booking-agreement/' || token, 'expires_at', a.expires_at, 'reference', a.reference);
end $$;

create or replace function public.eag_revoke_agreement(p_agreement_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare a esign.agreements;
begin
  perform private.esign_need(private.esign_can('canSendAgreements'), 'NOT_ALLOWED', 'you can''t revoke agreements');
  perform private.esign_need(length(trim(coalesce(p_reason, ''))) >= 3, 'BAD_INPUT', 'say why it is revoked');
  select * into a from esign.agreements where id = p_agreement_id for update;
  perform private.esign_need(a.status in ('DRAFT', 'SENT', 'VIEWED'), 'BAD_STEP', 'only an agreement waiting for the customer can be revoked');
  update esign.agreements set status = 'REVOKED' where id = a.id;
  update esign.access_tokens set revoked_at = now() where agreement_id = a.id and revoked_at is null;
  perform private.esign_event(a.inquiry_id, a.id, 'AGREEMENT_REVOKED', 'staff', jsonb_build_object('reason', trim(p_reason)));
end $$;

-- ── 5. The customer's page ───────────────────────────────────────────────────

-- The agreement behind a link, or an error (wrong / revoked / expired link)
create or replace function private.esign_token_agreement(p_token text, p_for_update boolean default false) returns esign.agreements
language plpgsql security definer set search_path = '' as $$
declare tk esign.access_tokens; a esign.agreements; ip text := private.client_ip();
begin
  if not private.allow('eag:ip:' || ip, 120, interval '10 minutes') then
    raise exception 'RATE_LIMITED: too many attempts — please wait a few minutes' using errcode = 'P0001';
  end if;
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    raise exception 'LINK_INVALID: this link isn''t valid — ask CRC for a new one' using errcode = 'P0001';
  end if;
  update esign.access_tokens set access_attempt_count = access_attempt_count + 1, last_used_at = now()
   where token_hash = private.esign_sha(p_token) returning * into tk;
  if tk.id is null then raise exception 'LINK_INVALID: this link isn''t valid — ask CRC for a new one' using errcode = 'P0001'; end if;
  if tk.revoked_at is not null then raise exception 'LINK_REPLACED: this link was replaced or withdrawn — please use the latest link CRC sent you' using errcode = 'P0001'; end if;
  if p_for_update then select * into a from esign.agreements where id = tk.agreement_id for update;
  else select * into a from esign.agreements where id = tk.agreement_id; end if;
  if a.status in ('SENT', 'VIEWED') and a.expires_at <= now() then
    update esign.agreements set status = 'EXPIRED' where id = a.id returning * into a;
    perform private.esign_event(a.inquiry_id, a.id, 'AGREEMENT_EXPIRED', 'system');
  end if;
  return a;
end $$;

create or replace function public.eag_open(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a esign.agreements; acc_name text; acc_bank text; acc_no text; r esign.payment_requests; me text := private.customer_phone(); d esign.acceptances;
begin
  a := private.esign_token_agreement(p_token, true);
  if a.status = 'SENT' then
    update esign.agreements set status = 'VIEWED', first_viewed_at = now() where id = a.id returning * into a;
    perform private.esign_event(a.inquiry_id, a.id, 'AGREEMENT_VIEWED', 'customer', jsonb_build_object('first', true));
  end if;
  select * into d from esign.acceptances where agreement_id = a.id;
  -- bank details only once a valid advance request exists for this accepted agreement
  select * into r from esign.payment_requests where agreement_id = a.id and status in ('REQUESTED', 'REPORTED', 'PARTIAL') order by created_at desc limit 1;
  if r.id is not null then select c.name, c.bank_name, c.account_no into acc_name, acc_bank, acc_no from public.company_accounts c where c.id = r.collection_account_id; end if;
  return jsonb_build_object(
    'reference', a.reference, 'status', a.status, 'expires_at', a.expires_at, 'version', a.version,
    'document', a.snapshot, 'html', a.rendered_html, 'document_hash', a.document_hash,
    'statement', a.snapshot #>> '{policy,statement}', 'statement_version', a.snapshot #>> '{policy,statement_version}',
    'phone_hint', '+' || left(a.customer_phone_key, 2) || ' ••• ••• ' || right(a.customer_phone_key, 3),
    'signed_in_as_customer', me is not null and me = a.customer_phone_key,
    'signed_in_other_number', me is not null and me <> a.customer_phone_key,
    'can_decide', a.status in ('SENT', 'VIEWED') and a.expires_at > now(),
    'decision', case when d.id is null then null else jsonb_build_object('decision', d.decision, 'at', d.decided_at, 'method', d.verification_method) end,
    'payment', case when r.id is null then null else jsonb_build_object('amount', r.amount, 'deadline', r.deadline, 'status', r.status,
               'account_name', acc_name, 'bank', acc_bank, 'account_no', acc_no, 'reference', a.reference) end);
end $$;

-- After a recorded decision: move the agreement, the hold and notify (shared with the manual fallback)
create or replace function private.esign_after_decision(p_agreement uuid, p_decision text, p_actor_type text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a esign.agreements; h esign.priority_holds; pol jsonb := private.eag_policy(); eligible boolean := false;
begin
  update esign.agreements set status = p_decision, decided_at = now() where id = p_agreement returning * into a;
  update esign.access_tokens set last_used_at = now() where agreement_id = a.id;
  select * into h from esign.priority_holds where quotation_id = a.quotation_id and status = 'ACTIVE' for update;
  if p_decision = 'ACCEPTED' then
    perform private.esign_event(a.inquiry_id, a.id, 'AGREEMENT_ACCEPTED', p_actor_type);
    if h.id is not null and h.stage = 'AWAITING_AGREEMENT' and h.stage_deadline > now() and h.expires_at > now() then
      update esign.priority_holds set stage = 'AWAITING_ADVANCE',
             stage_deadline = least(now() + private.esign_hours(pol, 'advance_deadline_hours'), h.expires_at)
       where id = h.id;
      eligible := true;
    else
      -- accepted after the hold ended: the priority isn't restored automatically
      perform private.esign_event(a.inquiry_id, a.id, 'REVALIDATION_REQUIRED', 'system', jsonb_build_object('why', 'accepted after the priority hold ended'));
    end if;
    perform private.esign_notify('e-Agreement accepted', a.reference || ' was accepted' ||
      case when eligible then ' — the advance can now be requested.' else ' after the priority hold ended — recheck the car before asking for money.' end, a.inquiry_id);
  else
    perform private.esign_event(a.inquiry_id, a.id, 'AGREEMENT_DECLINED', p_actor_type);
    if h.id is not null then perform private.esign_release_hold(h.id, 'RELEASED', 'Customer declined the e-Agreement'); end if;
    perform private.esign_notify('e-Agreement declined', a.reference || ' was declined by the customer.', a.inquiry_id);
  end if;
  return jsonb_build_object('status', a.status, 'advance_eligible', eligible);
end $$;

create or replace function public.eag_decide(p_token text, p_decision text, p_statement_version text, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a esign.agreements; d esign.acceptances; me text := private.customer_phone(); q esign.quotations; hdr json;
begin
  perform private.esign_need(p_decision in ('ACCEPTED', 'DECLINED'), 'BAD_INPUT', 'choose accept or decline');
  a := private.esign_token_agreement(p_token, true);
  -- the same decision twice (double tap, retry) returns the first one
  select * into d from esign.acceptances where agreement_id = a.id;
  if d.id is not null then
    perform private.esign_need(d.decision = p_decision, 'ALREADY_DECIDED', 'you already ' || lower(d.decision) || ' this agreement');
    return jsonb_build_object('status', a.status, 'already', true);
  end if;
  perform private.esign_need(me is not null, 'SIGN_IN_REQUIRED', 'confirm your mobile number with the SMS code first');
  perform private.esign_need(me = a.customer_phone_key, 'WRONG_CUSTOMER', 'this agreement is for a different mobile number');
  perform private.esign_need(a.status in ('SENT', 'VIEWED'), 'BAD_STEP', 'this agreement is ' || lower(a.status) || ' and can''t be ' || lower(p_decision) || ' any more');
  perform private.esign_need(a.expires_at > now(), 'EXPIRED', 'this agreement has expired — ask CRC for a new one');
  q := private.esign_current_quotation(a.inquiry_id);
  perform private.esign_need(q.id = a.quotation_id, 'SUPERSEDED', 'CRC changed the booking terms — please wait for the revised agreement');
  if p_decision = 'ACCEPTED' then
    perform private.esign_need(p_statement_version = a.snapshot #>> '{policy,statement_version}', 'BAD_STEP', 'the page is out of date — reload it and read the agreement again');
  end if;
  hdr := nullif(current_setting('request.headers', true), '')::json;
  insert into esign.acceptances (agreement_id, decision, verification_method, verified_phone_key, auth_user_id, acceptance_statement,
    statement_version, accepted_document_hash, decline_reason, evidence)
  values (a.id, p_decision, 'SMS_OTP_PORTAL_LOGIN', me, auth.uid(),
    case when p_decision = 'ACCEPTED' then a.snapshot #>> '{policy,statement}' end,
    case when p_decision = 'ACCEPTED' then p_statement_version end,
    case when p_decision = 'ACCEPTED' then a.document_hash end,
    case when p_decision = 'DECLINED' then left(nullif(trim(p_reason), ''), 1000) end,
    jsonb_build_object('ip', private.client_ip(), 'user_agent', left(coalesce(hdr ->> 'user-agent', ''), 300),
                       'template_version', a.template_version, 'quotation_version', a.quotation_version))
  on conflict (agreement_id) do nothing;
  if not found then return jsonb_build_object('status', a.status, 'already', true); end if;
  perform private.esign_event(a.inquiry_id, a.id, 'IDENTITY_VERIFIED', 'customer', jsonb_build_object('method', 'SMS_OTP_PORTAL_LOGIN'));
  return private.esign_after_decision(a.id, p_decision, 'customer');
end $$;

create or replace function public.eag_clarify(p_token text, p_message text) returns void
language plpgsql security definer set search_path = '' as $$
declare a esign.agreements;
begin
  perform private.esign_need(length(trim(coalesce(p_message, ''))) between 2 and 1000, 'BAD_INPUT', 'write your question (up to 1000 characters)');
  a := private.esign_token_agreement(p_token);
  perform private.esign_need(private.allow('eag:clarify:' || a.id, 10, interval '1 day'), 'RATE_LIMITED', 'please wait for CRC to reply');
  perform private.esign_event(a.inquiry_id, a.id, 'CLARIFICATION_REQUESTED', 'customer', jsonb_build_object('message', trim(p_message)));
  perform private.esign_notify('Customer has a question', a.reference || ': ' || trim(p_message), a.inquiry_id);
end $$;

-- ── 6. Advance request (the gate) ────────────────────────────────────────────
create or replace function public.eag_gate_status(p_inquiry_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.esign_need(private.esign_can('canViewInquiries') or private.esign_can('canSendAgreements') or private.esign_can('canRequestAdvance')
    or private.esign_can_verify() or private.esign_can('canBook'), 'NOT_ALLOWED', 'you can''t see this');
  return private.esign_gate(p_inquiry_id);
end $$;

create or replace function public.eag_request_advance(p_inquiry_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare g jsonb; q esign.quotations; h esign.priority_holds; r esign.payment_requests;
begin
  perform private.esign_need(private.esign_can('canRequestAdvance'), 'NOT_ALLOWED', 'you can''t request advances');
  perform 1 from public.inquiries where id = p_inquiry_id for update;
  g := private.esign_gate(p_inquiry_id);
  perform private.esign_need(g ->> 'state' = 'ELIGIBLE', 'ADVANCE_LOCKED',
    case g ->> 'state' when 'ADVANCE_REQUESTED' then 'the advance was already requested'
      else coalesce((select string_agg(x, ' ') from jsonb_array_elements_text(g -> 'problems') x), g ->> 'state') end);
  select * into q from esign.quotations where id = (g ->> 'quotation_id')::uuid;
  select * into h from esign.priority_holds where id = (g ->> 'hold_id')::uuid for update;
  insert into esign.payment_requests (inquiry_id, agreement_id, quotation_id, hold_id, amount, collection_account_id, deadline, requested_by)
  values (p_inquiry_id, (g ->> 'agreement_id')::uuid, q.id, h.id, q.advance_required, private.eag_policy() ->> 'collection_account_id', h.stage_deadline, private.esign_actor())
  returning * into r;
  perform private.esign_event(p_inquiry_id, r.agreement_id, 'ADVANCE_REQUESTED', 'staff', jsonb_build_object('amount', r.amount, 'deadline', r.deadline));
  return jsonb_build_object('id', r.id, 'amount', r.amount, 'deadline', r.deadline);
end $$;

-- ── 7. Money in ──────────────────────────────────────────────────────────────

-- The customer says they paid (from the agreement page; must be signed in with the agreement's number)
create or replace function public.eag_report_payment(p_token text, p_amount numeric, p_reference text, p_paid_at timestamptz default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a esign.agreements; r esign.payment_requests; rc esign.payment_receipts; me text := private.customer_phone(); pol jsonb := private.eag_policy();
begin
  a := private.esign_token_agreement(p_token);
  perform private.esign_need(me is not null and me = a.customer_phone_key, 'SIGN_IN_REQUIRED', 'confirm your mobile number with the SMS code first');
  perform private.esign_need(p_amount > 0 and p_amount < 10000000, 'BAD_INPUT', 'enter the amount you paid');
  perform private.esign_need(length(trim(coalesce(p_reference, ''))) between 3 and 80, 'BAD_INPUT', 'enter the bank reference');
  perform private.esign_need(private.allow('eag:report:' || a.id, 10, interval '1 day'), 'RATE_LIMITED', 'please wait for CRC to check your payment');
  select * into r from esign.payment_requests where agreement_id = a.id and status in ('REQUESTED', 'PARTIAL', 'LATE') order by created_at desc limit 1 for update;
  perform private.esign_need(r.id is not null, 'NO_REQUEST', 'there is no advance to pay yet');
  insert into esign.payment_receipts (request_id, inquiry_id, amount, account_id, bank_reference, received_at, reported_by_customer, created_by)
  values (r.id, a.inquiry_id, p_amount, r.collection_account_id, trim(p_reference), p_paid_at, true, 'customer')
  returning * into rc;
  update esign.payment_requests set status = 'REPORTED' where id = r.id;
  update esign.priority_holds set stage = 'PAYMENT_REPORTED',
         stage_deadline = least(now() + coalesce(private.esign_hours(pol, 'verification_deadline_hours'), interval '24 hours'), expires_at)
   where id = r.hold_id and status = 'ACTIVE' and stage = 'AWAITING_ADVANCE';
  perform private.esign_event(a.inquiry_id, a.id, 'PAYMENT_REPORTED', 'customer', jsonb_build_object('amount', p_amount, 'reference', trim(p_reference)));
  perform private.esign_notify('Payment to verify', a.reference || ': the customer reports ' || private.esign_money(p_amount) || ' (ref ' || trim(p_reference) || ').', a.inquiry_id);
  return jsonb_build_object('receipt_id', rc.id, 'status', 'REPORTED');
end $$;

-- Staff record money that arrived (counter cash, a transfer seen in the bank, an unsolicited payment).
-- It is only REPORTED / UNMATCHED here — Finance verifies it, and it never confirms a booking by itself.
create or replace function public.eag_record_receipt(p_inquiry_id text, p_amount numeric, p_account_id text, p_reference text,
                                                     p_received_at timestamptz, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r esign.payment_requests; rc esign.payment_receipts; pol jsonb := private.eag_policy();
begin
  perform private.esign_need(private.esign_can('canTakePayments') or private.esign_can_verify(), 'NOT_ALLOWED', 'you can''t record payments');
  perform private.esign_need(p_amount > 0, 'BAD_INPUT', 'enter the amount');
  perform private.esign_need(exists (select 1 from public.company_accounts c where c.id = p_account_id), 'BAD_INPUT', 'choose the account the money went into');
  if p_inquiry_id is not null then
    perform private.esign_need(exists (select 1 from public.inquiries where id = p_inquiry_id), 'NOT_FOUND', 'inquiry not found');
    select * into r from esign.payment_requests where inquiry_id = p_inquiry_id and status in ('REQUESTED', 'REPORTED', 'PARTIAL', 'LATE')
     order by created_at desc limit 1 for update;
  end if;
  insert into esign.payment_receipts (request_id, inquiry_id, amount, account_id, bank_reference, received_at, status, note, created_by)
  values (r.id, p_inquiry_id, p_amount, p_account_id, nullif(trim(p_reference), ''), p_received_at,
          case when r.id is null then 'UNMATCHED' else 'REPORTED' end, nullif(trim(p_note), ''), private.esign_actor())
  returning * into rc;
  if r.id is not null then
    update esign.payment_requests set status = 'REPORTED' where id = r.id and status <> 'REPORTED';
    update esign.priority_holds set stage = 'PAYMENT_REPORTED',
           stage_deadline = least(now() + coalesce(private.esign_hours(pol, 'verification_deadline_hours'), interval '24 hours'), expires_at)
     where id = r.hold_id and status = 'ACTIVE' and stage = 'AWAITING_ADVANCE';
  end if;
  if p_inquiry_id is not null then
    perform private.esign_event(p_inquiry_id, r.agreement_id, case when r.id is null then 'UNSOLICITED_PAYMENT' else 'PAYMENT_REPORTED' end, 'staff',
      jsonb_build_object('amount', p_amount, 'receipt_id', rc.id));
  end if;
  perform private.esign_notify('Payment to verify', private.esign_money(p_amount) || case when r.id is null then ' arrived without an advance request — Finance to match it.' else ' recorded — Finance to verify.' end, p_inquiry_id);
  return jsonb_build_object('receipt_id', rc.id, 'status', rc.status);
end $$;

-- Finance checks the money against the bank / cash box. Someone else than the person who recorded it.
create or replace function public.eag_verify_receipt(p_receipt_id uuid, p_decision text, p_account_id text default null,
                                                     p_received_at timestamptz default null, p_note text default null, p_request_id uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare rc esign.payment_receipts; r esign.payment_requests; h esign.priority_holds; paid numeric; next_req text; who text := private.esign_actor();
begin
  perform private.esign_need(private.esign_can_verify(), 'NOT_ALLOWED', 'only Finance can verify payments');
  perform private.esign_need(p_decision in ('VERIFIED', 'REJECTED', 'DUPLICATE', 'UNMATCHED', 'REFUND_DUE', 'REFUNDED'), 'BAD_INPUT', 'choose a result');
  select * into rc from esign.payment_receipts where id = p_receipt_id for update;
  perform private.esign_need(rc.id is not null, 'NOT_FOUND', 'payment not found');
  perform private.esign_need(rc.created_by is distinct from who, 'SAME_PERSON', 'the person who recorded a payment can''t verify it');
  -- an unmatched payment can be matched to its request when it is verified
  if p_request_id is not null and rc.request_id is null then
    select * into r from esign.payment_requests where id = p_request_id for update;
    perform private.esign_need(r.id is not null and r.status in ('REQUESTED', 'REPORTED', 'PARTIAL', 'LATE'), 'BAD_INPUT', 'that advance request isn''t open');
    perform private.esign_need(rc.status = 'UNMATCHED' and (rc.inquiry_id is null or rc.inquiry_id = r.inquiry_id), 'BAD_INPUT', 'that request is for another inquiry');
    -- re-created rather than edited: the receipt's request link is part of the evidence
    update esign.payment_receipts set status = 'DUPLICATE', note = coalesce(note || ' · ', '') || 'matched to request ' || r.id, verified_by = who, verified_at = now() where id = rc.id;
    insert into esign.payment_receipts (request_id, inquiry_id, amount, account_id, bank_reference, received_at, status, note, created_by)
    values (r.id, r.inquiry_id, rc.amount, rc.account_id, rc.bank_reference, rc.received_at, 'REPORTED', 'matched from receipt ' || rc.id, rc.created_by)
    returning * into rc;
  elsif rc.request_id is not null then
    select * into r from esign.payment_requests where id = rc.request_id for update;
  end if;

  update esign.payment_receipts
     set status = p_decision, verified_by = who, verified_at = now(),
         account_id = coalesce(p_account_id, account_id), received_at = coalesce(p_received_at, received_at),
         note = coalesce(nullif(trim(p_note), ''), note)
   where id = rc.id returning * into rc;
  perform private.esign_event(coalesce(rc.inquiry_id, r.inquiry_id, '—'), r.agreement_id, 'PAYMENT_' || p_decision, 'staff', jsonb_build_object('amount', rc.amount, 'receipt_id', rc.id));

  if r.id is not null then
    select coalesce(sum(amount), 0) into paid from esign.payment_receipts where request_id = r.id and status = 'VERIFIED';
    select * into h from esign.priority_holds where id = r.hold_id for update;
    if paid >= r.amount then
      next_req := case when h.status = 'ACTIVE' then 'VERIFIED' else 'LATE' end;
    elsif paid > 0 then next_req := 'PARTIAL';
    else next_req := case when r.status = 'REPORTED' and not exists (select 1 from esign.payment_receipts where request_id = r.id and status = 'REPORTED') then 'REQUESTED' else r.status end;
    end if;
    if next_req <> r.status then update esign.payment_requests set status = next_req where id = r.id; end if;
    if next_req = 'VERIFIED' then
      update esign.priority_holds set stage = 'ALLOCATING' where id = h.id;
      perform private.esign_event(r.inquiry_id, r.agreement_id, 'ADVANCE_VERIFIED', 'staff', jsonb_build_object('paid', paid));
      perform private.esign_notify('Advance verified', 'The advance for inquiry ' || r.inquiry_id || ' is verified — allocate the booking.', r.inquiry_id);
    elsif next_req = 'LATE' then
      perform private.esign_event(r.inquiry_id, r.agreement_id, 'PAYMENT_AFTER_HOLD_ENDED', 'system', jsonb_build_object('paid', paid));
      perform private.esign_notify('Money arrived after the hold ended', 'Inquiry ' || r.inquiry_id || ': recheck the car, or arrange an alternative / refund.', r.inquiry_id);
    elsif next_req = 'REQUESTED' and h.status = 'ACTIVE' and h.stage = 'PAYMENT_REPORTED' then
      update esign.priority_holds set stage = 'AWAITING_ADVANCE' where id = h.id;
    end if;
  end if;
  return jsonb_build_object('receipt_id', rc.id, 'status', rc.status, 'request_status', coalesce(next_req, r.status));
end $$;

-- ── 8. Allocation → the booking ──────────────────────────────────────────────
-- Gives the one-time booking id the booking form must use. The booking is checked against it when saved.
create or replace function public.eag_allocate(p_inquiry_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare g jsonb; q esign.quotations; t esign.booking_allocations; rc uuid; bid text;
begin
  perform private.esign_need(private.esign_can('canBook'), 'NOT_ALLOWED', 'you can''t create bookings');
  perform 1 from public.inquiries where id = p_inquiry_id for update;
  select * into t from esign.booking_allocations where inquiry_id = p_inquiry_id
     and not exists (select 1 from public.bookings b where b.id = booking_id) order by allocated_at desc limit 1;
  g := private.esign_gate(p_inquiry_id);
  if g ->> 'state' = 'CONFIRMED' then raise exception 'BAD_STEP: this inquiry already has its booking' using errcode = 'P0001'; end if;
  perform private.esign_need(g ->> 'state' = 'PAYMENT_VERIFIED', 'NOT_READY',
    case when g ->> 'state' in ('ELIGIBLE', 'ADVANCE_REQUESTED', 'PAYMENT_REPORTED') then 'the advance isn''t verified by Finance yet'
      else coalesce((select string_agg(x, ' ') from jsonb_array_elements_text(g -> 'problems') x), g ->> 'state') end);
  select * into q from esign.quotations where id = (g ->> 'quotation_id')::uuid;
  if t.booking_id is null then
    select id into rc from esign.payment_receipts where request_id = (g ->> 'request_id')::uuid and status = 'VERIFIED' order by verified_at limit 1;
    bid := gen_random_uuid()::text;
    insert into esign.booking_allocations (booking_id, inquiry_id, agreement_id, hold_id, receipt_id, allocated_by, vehicle_id, expected_range, expected_total)
    values (bid, p_inquiry_id, (g ->> 'agreement_id')::uuid, (g ->> 'hold_id')::uuid, rc, private.esign_actor(), q.vehicle_id,
            tstzrange(q.pickup_at, q.return_at, '[)'), q.total)
    returning * into t;
    perform private.esign_event(p_inquiry_id, t.agreement_id, 'ALLOCATION_ISSUED', 'staff', jsonb_build_object('booking_id', bid));
  end if;
  return jsonb_build_object('booking_id', t.booking_id, 'vehicle_id', q.vehicle_id,
    'start_date', to_char(q.pickup_at at time zone 'Asia/Colombo', 'YYYY-MM-DD'), 'start_time', to_char(q.pickup_at at time zone 'Asia/Colombo', 'HH24:MI'),
    'end_date', to_char(q.return_at at time zone 'Asia/Colombo', 'YYYY-MM-DD'), 'end_time', to_char(q.return_at at time zone 'Asia/Colombo', 'HH24:MI'),
    'total', q.total, 'advance', q.advance_required, 'deposit', q.deposit, 'rental_type', q.rental_type,
    'pickup_location', q.pickup_location, 'return_location', q.return_location);
end $$;

-- The booking guard of file 22, plus: a booking saved with a ticket must match it
create or replace function private.esign_booking_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  clash record; held record;
  alloc esign.booking_allocations%rowtype;
  enforce_from timestamptz := private.try_ts(private.eag_policy() ->> 'enforce_from');
  becomes_live boolean; bill numeric;
begin
  new.occupies := private.booking_occupies(new.status, new.start_date, new.start_time, new.end_date, new.end_time);
  select * into alloc from esign.booking_allocations a where a.booking_id = new.id;

  becomes_live := new.occupies is not null and (tg_op = 'INSERT' or old.occupies is null);
  if becomes_live and enforce_from is not null and now() >= enforce_from and alloc.booking_id is null
     and (tg_op = 'INSERT' or coalesce(private.try_ts(new.created_at), now()) >= enforce_from) then
    raise exception 'BOOKING_GATE: a booking can only be confirmed after the customer accepts the e-Agreement, the advance is verified by Finance and the car is allocated (Inquiry → e-Agreement → Advance).'
      using errcode = 'P0001';
  end if;

  if tg_op = 'INSERT' and alloc.booking_id is not null then
    if alloc.vehicle_id is not null and new.vehicle_id is distinct from alloc.vehicle_id then
      raise exception 'ALLOCATION_MISMATCH: this booking must be for the car in the accepted agreement' using errcode = 'P0001';
    end if;
    if alloc.expected_range is not null and new.occupies is distinct from alloc.expected_range then
      raise exception 'ALLOCATION_MISMATCH: the pickup and return must be % → % as accepted', private.esign_lk(lower(alloc.expected_range)), private.esign_lk(upper(alloc.expected_range)) using errcode = 'P0001';
    end if;
    bill := coalesce(new.total_amount, 0) + coalesce((to_jsonb(new) ->> 'extra_charges')::numeric, 0) - coalesce((to_jsonb(new) ->> 'discount')::numeric, 0);
    if alloc.expected_total is not null and abs(bill - alloc.expected_total) > 0.5 then
      raise exception 'ALLOCATION_MISMATCH: the booking total must be % as accepted (it is %)', private.esign_money(alloc.expected_total), private.esign_money(bill) using errcode = 'P0001';
    end if;
  end if;

  if new.occupies is null or new.vehicle_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.occupies is not distinct from old.occupies and new.vehicle_id is not distinct from old.vehicle_id then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtext('esign:vehicle:' || new.vehicle_id));

  select b.id, b.customer_name, b.start_date, b.end_date into clash
    from public.bookings b
   where b.vehicle_id = new.vehicle_id and b.id <> new.id and b.occupies && new.occupies
   limit 1;
  if found then
    raise exception 'DOUBLE_BOOKING: this car is already booked for % from % to % — choose other dates or another car.',
      clash.customer_name, clash.start_date, clash.end_date using errcode = '23P01';
  end if;

  select h.inquiry_id, h.expires_at into held
    from esign.priority_holds h
   where h.status = 'ACTIVE' and h.vehicle_id = new.vehicle_id and h.hold_range && new.occupies
     and h.inquiry_id is distinct from alloc.inquiry_id
   limit 1;
  if found then
    raise exception 'PRIORITY_HOLD: this car is held for another customer''s accepted quotation (inquiry %) until % — it can''t be booked over that time.',
      held.inquiry_id, to_char(held.expires_at at time zone 'Asia/Colombo', 'DD Mon YYYY HH24:MI') using errcode = '23P01';
  end if;
  return new;
end $$;

-- Once the allocated booking is saved: the hold is confirmed and everything is linked
create or replace function private.esign_booking_allocated() returns trigger
language plpgsql security definer set search_path = '' as $$
declare t esign.booking_allocations;
begin
  select * into t from esign.booking_allocations where booking_id = new.id;
  if t.booking_id is null then return null; end if;
  if t.hold_id is not null then update esign.priority_holds set status = 'CONFIRMED', released_at = now(), release_reason = 'Booking ' || new.id where id = t.hold_id and status = 'ACTIVE'; end if;
  update esign.payment_receipts set booking_id = new.id where request_id in (select id from esign.payment_requests where hold_id = t.hold_id) and status = 'VERIFIED';
  update esign.exceptions set status = 'USED' where id = t.exception_id and status = 'APPROVED';
  if t.inquiry_id is not null then
    perform private.esign_event(t.inquiry_id, t.agreement_id, 'BOOKING_CONFIRMED', 'staff', jsonb_build_object('booking_id', new.id));
    perform private.esign_notify('Booking confirmed', 'Inquiry ' || t.inquiry_id || ' is now booking ' || new.id || '.', new.id);
  end if;
  return null;
end $$;
drop trigger if exists zz_esign_booking_allocated on public.bookings;
create trigger zz_esign_booking_allocated after insert on public.bookings for each row execute function private.esign_booking_allocated();

-- ── 9. Audited exceptions (decided by a business approver who didn't ask) ────
create or replace function public.eag_request_exception(p_kind text, p_inquiry_id text, p_booking_id text, p_reason text, p_details jsonb default '{}') returns uuid
language plpgsql security definer set search_path = '' as $$
declare x esign.exceptions;
begin
  perform private.esign_need(private.is_admin() or private.is_staff(), 'NOT_ALLOWED', 'staff only');
  perform private.esign_need(p_kind in ('CONFLICT_OVERRIDE', 'MANUAL_ACCEPTANCE', 'GATE_EXEMPT_BOOKING', 'OTHER'), 'BAD_INPUT', 'unknown exception');
  perform private.esign_need(length(trim(coalesce(p_reason, ''))) >= 10, 'BAD_INPUT', 'explain the reason (at least 10 characters)');
  if p_kind = 'GATE_EXEMPT_BOOKING' then
    perform private.esign_need(p_details ? 'vehicle_id' and p_details ? 'start_date' and p_details ? 'end_date' and p_details ? 'total',
      'BAD_INPUT', 'give the car, dates and total of the booking');
  end if;
  insert into esign.exceptions (kind, inquiry_id, booking_id, reason, requested_by, details)
  values (p_kind, p_inquiry_id, p_booking_id, trim(p_reason), private.esign_actor(), coalesce(p_details, '{}')) returning * into x;
  if p_inquiry_id is not null then perform private.esign_event(p_inquiry_id, null, 'EXCEPTION_REQUESTED', 'staff', jsonb_build_object('kind', p_kind, 'id', x.id)); end if;
  perform private.esign_notify('Exception to approve', p_kind || ': ' || trim(p_reason), coalesce(p_inquiry_id, p_booking_id));
  return x.id;
end $$;

create or replace function public.eag_decide_exception(p_id uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare x esign.exceptions;
begin
  perform private.esign_need(private.is_business_approver(), 'NOT_ALLOWED', 'only the business approver decides exceptions');
  select * into x from esign.exceptions where id = p_id for update;
  perform private.esign_need(x.status = 'PENDING', 'BAD_STEP', 'already decided');
  update esign.exceptions set status = case when p_approve then 'APPROVED' else 'REJECTED' end, decided_by = private.esign_actor(),
         decided_at = now(), decision_note = nullif(trim(p_note), '') where id = p_id;   -- the guard refuses the requester deciding
  if x.inquiry_id is not null then
    perform private.esign_event(x.inquiry_id, null, case when p_approve then 'EXCEPTION_APPROVED' else 'EXCEPTION_REJECTED' end, 'staff', jsonb_build_object('kind', x.kind, 'id', x.id));
  end if;
end $$;

-- A booking that can't go through an inquiry (e.g. the owner using their own car): approved exception → ticket
create or replace function public.eag_use_gate_exemption(p_exception_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare x esign.exceptions; t esign.booking_allocations; s timestamptz; e timestamptz;
begin
  perform private.esign_need(private.esign_can('canBook'), 'NOT_ALLOWED', 'you can''t create bookings');
  select * into x from esign.exceptions where id = p_exception_id for update;
  perform private.esign_need(x.kind = 'GATE_EXEMPT_BOOKING' and x.status = 'APPROVED', 'BAD_STEP', 'this exemption isn''t approved');
  select * into t from esign.booking_allocations where exception_id = x.id;
  if t.booking_id is null then
    s := private.lk_ts(x.details ->> 'start_date', x.details ->> 'start_time', '00:00');
    e := private.lk_ts(x.details ->> 'end_date', x.details ->> 'end_time', '23:59');
    insert into esign.booking_allocations (booking_id, inquiry_id, exception_id, allocated_by, vehicle_id, expected_range, expected_total)
    values (coalesce(x.booking_id, gen_random_uuid()::text), x.inquiry_id, x.id, private.esign_actor(), x.details ->> 'vehicle_id',
            tstzrange(s, e, '[)'), (x.details ->> 'total')::numeric)
    returning * into t;
  end if;
  return jsonb_build_object('booking_id', t.booking_id, 'vehicle_id', t.vehicle_id, 'details', x.details);
end $$;

-- The agreement service was down / the customer can't use a phone: an approved MANUAL_ACCEPTANCE exception
-- plus the evidence (e.g. a signed paper copy uploaded to the booking files) records an equivalent acceptance.
create or replace function public.eag_record_manual_acceptance(p_agreement_id uuid, p_exception_id uuid, p_evidence jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a esign.agreements; x esign.exceptions;
begin
  perform private.esign_need(private.esign_can('canSendAgreements'), 'NOT_ALLOWED', 'you can''t record acceptances');
  select * into a from esign.agreements where id = p_agreement_id for update;
  select * into x from esign.exceptions where id = p_exception_id for update;
  perform private.esign_need(x.kind = 'MANUAL_ACCEPTANCE' and x.status = 'APPROVED' and x.inquiry_id = a.inquiry_id, 'BAD_STEP', 'needs an approved manual-acceptance exception for this inquiry');
  perform private.esign_need(a.status in ('SENT', 'VIEWED') and a.expires_at > now(), 'BAD_STEP', 'the agreement must be sent and not expired');
  perform private.esign_need(length(coalesce(p_evidence ->> 'description', '')) >= 10, 'BAD_INPUT', 'describe the evidence (who, how, where it is kept)');
  insert into esign.acceptances (agreement_id, decision, verification_method, verified_phone_key, acceptance_statement, statement_version,
                                 accepted_document_hash, reviewed_by, evidence)
  values (a.id, 'ACCEPTED', 'MANUAL_REVIEWED', a.customer_phone_key, a.snapshot #>> '{policy,statement}', a.snapshot #>> '{policy,statement_version}',
          a.document_hash, x.decided_by, p_evidence || jsonb_build_object('exception_id', x.id, 'recorded_by', private.esign_actor()));
  update esign.exceptions set status = 'USED' where id = x.id;
  perform private.esign_event(a.inquiry_id, a.id, 'MANUAL_ACCEPTANCE_RECORDED', 'staff', jsonb_build_object('exception_id', x.id));
  return private.esign_after_decision(a.id, 'ACCEPTED', 'staff');
end $$;

-- ── 10. Wording (templates) ──────────────────────────────────────────────────
create or replace function public.eag_save_template(p_title text, p_sections jsonb, p_statement text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare t esign.agreement_templates; ver int;
begin
  perform private.esign_need(private.is_admin(), 'NOT_ALLOWED', 'admins only');
  perform private.esign_need(jsonb_typeof(p_sections) = 'array' and jsonb_array_length(p_sections) > 0, 'BAD_INPUT', 'add the sections');
  perform private.esign_need(length(trim(coalesce(p_statement, ''))) >= 20, 'BAD_INPUT', 'write the acceptance statement');
  select coalesce(max(version), 0) + 1 into ver from esign.agreement_templates where document_code = 'CRC-AGR-003';
  insert into esign.agreement_templates (version, title, sections, acceptance_statement, created_by)
  values (ver, trim(p_title), p_sections, trim(p_statement), private.esign_actor()) returning * into t;
  return jsonb_build_object('id', t.id, 'version', t.version, 'status', t.status);
end $$;

create or replace function public.eag_approve_template(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.esign_need(private.is_business_approver(), 'NOT_ALLOWED', 'only the business approver approves the wording');
  perform private.esign_need(exists (select 1 from esign.agreement_templates where id = p_id and status = 'DRAFT'), 'BAD_STEP', 'only a draft can be approved');
  update esign.agreement_templates set status = 'RETIRED' where document_code = 'CRC-AGR-003' and status = 'APPROVED';
  update esign.agreement_templates set status = 'APPROVED', approved_by = private.esign_actor(), approved_at = now(), effective_at = now() where id = p_id;
end $$;

-- ── 11. Expiry (pg_cron every 5 minutes — Stage 3c; admins can run it too) ───
create or replace function private.eag_expire_due() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a record; h record; n_a int := 0; n_h int := 0; n_r int := 0;
begin
  for a in update esign.agreements set status = 'EXPIRED' where status in ('DRAFT', 'SENT', 'VIEWED') and expires_at <= now() returning id, inquiry_id, reference loop
    n_a := n_a + 1;
    perform private.esign_event(a.inquiry_id, a.id, 'AGREEMENT_EXPIRED', 'system');
    perform private.esign_notify('e-Agreement expired', a.reference || ' expired without a decision.', a.inquiry_id);
  end loop;
  -- verified money (ALLOCATING) is never dropped automatically — staff allocate or resolve it
  for h in select id, inquiry_id from esign.priority_holds
            where status = 'ACTIVE' and stage <> 'ALLOCATING' and (stage_deadline <= now() or expires_at <= now()) loop
    n_h := n_h + 1;
    perform private.esign_release_hold(h.id, 'EXPIRED', 'Deadline passed');
    perform private.esign_notify('Priority hold expired', 'Inquiry ' || h.inquiry_id || ': the hold ended — the car is free again.', h.inquiry_id);
  end loop;
  update esign.payment_requests r set status = 'LATE' where status = 'REQUESTED' and deadline <= now();
  get diagnostics n_r = row_count;
  return jsonb_build_object('agreements_expired', n_a, 'holds_expired', n_h, 'requests_late', n_r);
end $$;

create or replace function public.eag_run_expiry() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.esign_need(private.is_admin() or coalesce(auth.jwt() ->> 'role', '') in ('', 'service_role'), 'NOT_ALLOWED', 'admins only');
  return private.eag_expire_due();
end $$;

-- ── 12. Reading ──────────────────────────────────────────────────────────────

-- Everything for the inquiry's e-Agreement / Advance tabs (no link tokens — they're never stored)
create or replace function public.eag_inquiry_overview(p_inquiry_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.esign_need(private.esign_can('canViewInquiries') or private.esign_can('canSendAgreements') or private.esign_can_verify(), 'NOT_ALLOWED', 'you can''t see this');
  return jsonb_build_object(
    'gate', private.esign_gate(p_inquiry_id),
    'quotations', coalesce((select jsonb_agg(to_jsonb(q) order by q.version desc) from esign.quotations q where q.inquiry_id = p_inquiry_id), '[]'),
    'holds', coalesce((select jsonb_agg(to_jsonb(h) order by h.created_at desc) from esign.priority_holds h where h.inquiry_id = p_inquiry_id), '[]'),
    'agreements', coalesce((select jsonb_agg(to_jsonb(a) || jsonb_build_object(
        'acceptance', (select to_jsonb(x) from esign.acceptances x where x.agreement_id = a.id),
        'links', (select count(*) from esign.access_tokens t where t.agreement_id = a.id),
        'opens', (select coalesce(sum(t.access_attempt_count), 0) from esign.access_tokens t where t.agreement_id = a.id)) order by a.version desc)
      from esign.agreements a where a.inquiry_id = p_inquiry_id), '[]'),
    'requests', coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc) from esign.payment_requests r where r.inquiry_id = p_inquiry_id), '[]'),
    'receipts', coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc) from esign.payment_receipts r where r.inquiry_id = p_inquiry_id), '[]'),
    'waitlist', coalesce((select jsonb_agg(to_jsonb(w) order by w.created_at) from esign.hold_waitlist w where w.inquiry_id = p_inquiry_id), '[]'),
    'exceptions', coalesce((select jsonb_agg(to_jsonb(x) order by x.requested_at desc) from esign.exceptions x where x.inquiry_id = p_inquiry_id), '[]'),
    'events', coalesce((select jsonb_agg(to_jsonb(e) order by e.at) from esign.events e where e.inquiry_id = p_inquiry_id), '[]'),
    'booking_id', (select ba.booking_id from esign.booking_allocations ba where ba.inquiry_id = p_inquiry_id order by ba.allocated_at desc limit 1));
end $$;

create or replace function public.eag_dashboard() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.esign_need(private.is_admin() or private.is_staff(), 'NOT_ALLOWED', 'staff only');
  return jsonb_build_object(
    'awaiting_acceptance', (select count(*) from esign.agreements where status in ('SENT', 'VIEWED') and expires_at > now()),
    'accepted_awaiting_advance', (select count(*) from esign.priority_holds where status = 'ACTIVE' and stage = 'AWAITING_ADVANCE'),
    'expiring_soon', (select count(*) from esign.agreements where status in ('SENT', 'VIEWED') and expires_at between now() and now() + interval '24 hours'),
    'declined_30d', (select count(*) from esign.agreements where status = 'DECLINED' and decided_at > now() - interval '30 days'),
    'expired_30d', (select count(*) from esign.agreements where status = 'EXPIRED' and coalesce(sent_at, created_at) > now() - interval '30 days'),
    'holds_near_expiry', (select count(*) from esign.priority_holds where status = 'ACTIVE' and least(stage_deadline, expires_at) between now() and now() + interval '12 hours'),
    'payments_to_verify', (select count(*) from esign.payment_receipts where status in ('REPORTED', 'UNMATCHED')),
    'exceptions_pending', (select count(*) from esign.exceptions where status = 'PENDING'));
end $$;

create or replace function public.eag_receipts_to_verify() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.esign_need(private.esign_can_verify() or private.esign_can('canTakePayments'), 'NOT_ALLOWED', 'Finance only');
  return coalesce((select jsonb_agg(to_jsonb(r) || jsonb_build_object(
      'customer', i.customer_name, 'request_amount', q.amount, 'request_deadline', q.deadline,
      'account', (select c.name from public.company_accounts c where c.id = r.account_id)) order by r.created_at)
    from esign.payment_receipts r left join public.inquiries i on i.id = r.inquiry_id left join esign.payment_requests q on q.id = r.request_id
    where r.status in ('REPORTED', 'UNMATCHED', 'REFUND_DUE')), '[]');
end $$;

-- The customer portal: "My Agreements" (only their own number; no staff fields)
create or replace function public.my_agreements() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'reference', a.reference, 'document_code', a.document_code, 'title', a.snapshot #>> '{agreement,title}', 'version', a.version,
      'status', a.status, 'sent_at', a.sent_at, 'expires_at', a.expires_at, 'decided_at', a.decided_at,
      'decision_method', x.verification_method, 'document_hash', a.document_hash, 'summary', a.snapshot - 'policy',
      'html', a.rendered_html,
      'booking_status', (select b.status from esign.booking_allocations ba join public.bookings b on b.id = ba.booking_id where ba.agreement_id = a.id limit 1),
      'booking_reference', (select 'MRAC-' || upper(left(ba.booking_id, 8)) from esign.booking_allocations ba where ba.agreement_id = a.id and exists (select 1 from public.bookings b where b.id = ba.booking_id) limit 1),
      'history', (select coalesce(jsonb_agg(jsonb_build_object('event', e.event_type, 'at', e.at) order by e.at), '[]') from esign.events e
                   where e.agreement_id = a.id and e.event_type in ('AGREEMENT_SENT', 'AGREEMENT_RESENT', 'AGREEMENT_VIEWED', 'AGREEMENT_ACCEPTED',
                                                                    'AGREEMENT_DECLINED', 'AGREEMENT_EXPIRED', 'AGREEMENT_REVOKED', 'PAYMENT_REPORTED', 'ADVANCE_VERIFIED', 'BOOKING_CONFIRMED')))
    order by a.created_at desc), '[]'::jsonb)
  from esign.agreements a left join esign.acceptances x on x.agreement_id = a.id
  where private.customer_phone() is not null and a.customer_phone_key = private.customer_phone() and a.status <> 'DRAFT'
$$;

-- ── Grants ───────────────────────────────────────────────────────────────────
do $$
declare f text;
begin
  -- internal helpers: never called directly
  foreach f in array array['private.esign_actor()', 'private.esign_can(text)', 'private.esign_can_verify()', 'private.esign_need(boolean, text, text)',
    'private.esign_event(text, uuid, text, text, jsonb)', 'private.esign_notify(text, text, text)', 'private.esign_policy_require(text[])',
    'private.esign_hours(jsonb, text)', 'private.esign_ref(text)', 'private.esign_html(text)', 'private.esign_sha(text)', 'private.esign_lk(timestamptz)',
    'private.esign_money(numeric)', 'private.esign_advance_for(numeric, text)', 'private.esign_current_quotation(text)',
    'private.esign_offer_waitlist(text, tstzrange)', 'private.esign_release_hold(uuid, text, text)', 'private.esign_gate(text)',
    'private.esign_token_agreement(text, boolean)', 'private.esign_after_decision(uuid, text, text)', 'private.eag_expire_due()',
    'private.esign_booking_allocated()', 'private.esign_step_ok(text, text, text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  -- logged-in staff / customers (each function checks who may do what)
  foreach f in array array['public.eag_freeze_quotation(text, jsonb)', 'public.eag_accept_quotation(uuid)', 'public.eag_release_hold(text, text)',
    'public.eag_generate_agreement(text, boolean)', 'public.eag_send_agreement(uuid, text)', 'public.eag_revoke_agreement(uuid, text)',
    'public.eag_gate_status(text)', 'public.eag_request_advance(text)',
    'public.eag_record_receipt(text, numeric, text, text, timestamptz, text)', 'public.eag_verify_receipt(uuid, text, text, timestamptz, text, uuid)',
    'public.eag_allocate(text)', 'public.eag_request_exception(text, text, text, text, jsonb)', 'public.eag_decide_exception(uuid, boolean, text)',
    'public.eag_use_gate_exemption(uuid)', 'public.eag_record_manual_acceptance(uuid, uuid, jsonb)', 'public.eag_save_template(text, jsonb, text)',
    'public.eag_approve_template(uuid)', 'public.eag_run_expiry()', 'public.eag_inquiry_overview(text)', 'public.eag_dashboard()',
    'public.eag_receipts_to_verify()', 'public.my_agreements()'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  -- the agreement page (before signing in too): open the link, ask a question; deciding and reporting a payment
  -- check the SMS-code sign-in themselves, so a visitor gets a clear 'sign in first' instead of an error
  foreach f in array array['public.eag_open(text)', 'public.eag_clarify(text, text)', 'public.eag_decide(text, text, text, text)',
                           'public.eag_report_payment(text, numeric, text, timestamptz)'] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
