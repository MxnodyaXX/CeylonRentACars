-- =====================================================================
-- 22 · BOOKING e-AGREEMENT — foundation (Stage 3a of admin/supabase/EAGREEMENT.md)
--
-- What this file does
--   • a private schema `esign` for the new records: quotation versions, priority holds, waiting list,
--     agreement templates, agreements, access links, acceptance evidence, events, advance requests,
--     payment receipts, booking allocations and audited exceptions.
--     No login (anon, staff, owner, customer, admin) can read or write it directly — re-running
--     01_scoped_access.sql does not change that (01 only touches the public schema). Everything goes
--     through security-definer functions (Stage 3b).
--   • evidence is append-only: acceptances, events and allocations can never be changed or deleted;
--     a sent agreement's document, a quotation's terms and an approved template are frozen; statuses
--     can only move forward along the allowed steps.
--   • a DATABASE double-booking guard (until now this was checked only in the admin app):
--       bookings.occupies = the time the car is tied up (Confirmed / Ongoing), the same rule as
--       admin/src/lib/availability.ts — no start time = 00:00, no end time = 23:59, Sri Lanka time,
--       touching ends don't clash. Saving an overlapping booking is refused with a clear message, and
--       an exclusion constraint makes it safe when two people save at once.
--       Priority holds use the same kind of constraint, and holds and bookings check each other.
--   • the booking gate — "no accepted e-Agreement + verified advance + allocation = no booking" —
--     for EVERY new booking. It is OFF until eagreement_policy.enforce_from is set (go-live), so
--     running this file changes nothing for staff today.
--   • policy settings (all blank = not approved yet; nothing can be sent while blank).
--
-- Existing data: nothing is changed or removed. If existing bookings already overlap, the exclusion
-- constraint is NOT added (a NOTICE says so); see them with  select * from public.eagreement_booking_overlaps();
-- fix them, then run this file again.
--
-- Needs 01, 02 and 16. Safe to re-run. Undo: rollback/22_rollback_booking_eagreement.sql
-- =====================================================================

create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;

create schema if not exists esign;
revoke all on schema esign from public, anon, authenticated;
alter default privileges in schema esign revoke all on tables from public, anon, authenticated;

-- ── Policy (Brian approves the values; blank = not approved) ─────────────────
insert into public.app_settings (key, value) values ('eagreement_policy', jsonb_build_object(
  'enforce_from', null,                    -- go-live (ISO time): from then every new booking needs the gate
  'split_admin_approvals', false,          -- true = only admins marked business_approver may approve (Module 15)
  'link_valid_hours', null,                -- how long an agreement link works
  'agreement_deadline_hours', null,        -- hold stage A: time to accept the agreement
  'advance_deadline_hours', null,          -- hold stage B: time to pay the advance after accepting
  'verification_deadline_hours', null,     -- hold stage C: Finance's time to verify a reported payment
  'hold_max_hours', null,                  -- the whole priority entitlement can't run longer than this
  'turnaround_minutes', null,              -- buffer around a held period
  'quotation_valid_hours', null,
  'advance_rule', null,                    -- e.g. {"type":"percent","value":…} or {"type":"fixed","value":…}
  'collection_account_id', null,           -- company_accounts.id customers pay the advance into
  'cancellation_policy_version', null,
  'cancellation_policy_text', null,
  'acceptance_statement_version', null,
  'acceptance_statement', null,
  'reminders', null                        -- e.g. {"agreement":[…hours before deadline], "advance":[…]}
)) on conflict (key) do nothing;

create or replace function private.eag_policy() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce((select value from public.app_settings where key = 'eagreement_policy'), '{}'::jsonb)
$$;

-- Admin who may approve business decisions (policy, templates, exceptions, payment verification override).
-- While split_admin_approvals is off every admin may; when on, only admins with app_metadata.business_approver.
create or replace function private.is_business_approver() returns boolean
language sql stable set search_path = '' as $$
  select private.is_admin() and (
    not coalesce((private.eag_policy() ->> 'split_admin_approvals')::boolean, false)
    or coalesce((auth.jwt() -> 'app_metadata' ->> 'business_approver')::boolean, false))
$$;

-- yyyy-MM-dd + HH:mm (Sri Lanka) → timestamptz; a missing / odd time uses the fallback; a bad date → null
create or replace function private.lk_ts(p_date text, p_time text, p_fallback text) returns timestamptz
language sql stable set search_path = '' as $$
  select case when p_date ~ '^\d{4}-\d{2}-\d{2}$' then
    (p_date || ' ' || case when p_time ~ '^\d{1,2}:\d{2}$' then lpad(p_time, 5, '0') else p_fallback end)::timestamp
      at time zone 'Asia/Colombo'
  end
$$;

-- The time a booking ties up its car (null when it doesn't: Completed / Cancelled / bad dates)
create or replace function private.booking_occupies(p_status text, p_sd text, p_st text, p_ed text, p_et text) returns tstzrange
language sql stable set search_path = '' as $$
  select case when p_status in ('Confirmed', 'Ongoing') and s is not null and e is not null and e > s
              then tstzrange(s, e, '[)') end
  from (select private.lk_ts(p_sd, p_st, '00:00') s, private.lk_ts(p_ed, p_et, '23:59') e) x
$$;

create or replace function private.try_ts(p text) returns timestamptz
language plpgsql stable set search_path = '' as $$
begin return p::timestamptz; exception when others then return null; end $$;

revoke all on function private.eag_policy(), private.lk_ts(text, text, text), private.booking_occupies(text, text, text, text, text), private.try_ts(text) from public, anon;
grant execute on function private.eag_policy(), private.is_business_approver() to authenticated;   -- the policy isn't secret (staff can read app_settings)

-- ── Tables ───────────────────────────────────────────────────────────────────

-- A quote as it was SENT to the customer (inquiries.quote stays the working copy)
create table if not exists esign.quotations (
  id                uuid primary key default gen_random_uuid(),
  reference         text not null unique,                  -- CRC-Q-2026-000123
  inquiry_id        text not null references public.inquiries(id) on delete restrict,
  version           int  not null check (version > 0),
  vehicle_id        text references public.vehicles(id) on delete restrict,
  vehicle_label     text not null,
  vehicle_category  text,
  pickup_at         timestamptz not null,
  return_at         timestamptz not null,
  pickup_location   text,
  return_location   text,
  rental_type       text not null default 'Daily' check (rental_type in ('Hourly', 'Daily', 'Monthly')),
  rate              numeric(12,2),
  units             numeric(10,2),
  included_km       numeric(10,2),
  extra_km_rate     numeric(10,2),
  extras            jsonb not null default '[]',
  discount          numeric(12,2) not null default 0,
  total             numeric(12,2) not null check (total >= 0),
  advance_required  numeric(12,2) not null check (advance_required >= 0),
  deposit           numeric(12,2) not null default 0 check (deposit >= 0),
  conditions        jsonb not null default '{}',             -- vehicle-specific conditions, alternatives allowed…
  valid_until       timestamptz not null,
  status            text not null default 'SENT' check (status in ('SENT', 'ACCEPTED', 'SUPERSEDED', 'EXPIRED', 'WITHDRAWN')),
  accepted_at       timestamptz,
  created_by        text not null,
  created_at        timestamptz not null default now(),
  unique (inquiry_id, version),
  check (return_at > pickup_at)
);

-- One priority entitlement per inquiry, moving through stages (Module 02)
create table if not exists esign.priority_holds (
  id               uuid primary key default gen_random_uuid(),
  inquiry_id       text not null references public.inquiries(id) on delete restrict,
  quotation_id     uuid references esign.quotations(id) on delete restrict,
  vehicle_id       text not null references public.vehicles(id) on delete restrict,
  requested_start  timestamptz not null,
  requested_end    timestamptz not null,
  hold_range       tstzrange not null,                       -- requested period + turnaround buffer
  status           text not null default 'ACTIVE' check (status in ('ACTIVE', 'CONFIRMED', 'EXPIRED', 'RELEASED', 'CANCELLED')),
  stage            text not null default 'AWAITING_AGREEMENT'
                   check (stage in ('AWAITING_AGREEMENT', 'AWAITING_ADVANCE', 'PAYMENT_REPORTED', 'ALLOCATING')),
  stage_deadline   timestamptz,
  expires_at       timestamptz not null,
  released_at      timestamptz,
  release_reason   text,
  created_by       text not null,
  created_at       timestamptz not null default now(),
  check (requested_end > requested_start),
  constraint hold_no_overlap exclude using gist (vehicle_id with =, hold_range with &&) where (status = 'ACTIVE')
);
create unique index if not exists hold_one_active_per_inquiry on esign.priority_holds (inquiry_id) where status = 'ACTIVE';

create table if not exists esign.hold_waitlist (
  id          uuid primary key default gen_random_uuid(),
  inquiry_id  text not null references public.inquiries(id) on delete restrict,
  vehicle_id  text not null references public.vehicles(id) on delete restrict,
  wanted      tstzrange not null,
  status      text not null default 'WAITING' check (status in ('WAITING', 'OFFERED', 'WITHDRAWN', 'DONE')),
  created_by  text not null,
  created_at  timestamptz not null default now()
);
create unique index if not exists waitlist_one_per_inquiry_vehicle on esign.hold_waitlist (inquiry_id, vehicle_id) where status in ('WAITING', 'OFFERED');

create table if not exists esign.agreement_templates (
  id                    uuid primary key default gen_random_uuid(),
  document_code         text not null default 'CRC-AGR-003',
  version               int  not null check (version > 0),
  title                 text not null,
  sections              jsonb not null default '[]',        -- [{ heading, body (may hold {{fields}}) }]
  acceptance_statement  text not null,
  status                text not null default 'DRAFT' check (status in ('DRAFT', 'APPROVED', 'RETIRED')),
  effective_at          timestamptz,
  approved_by           text,
  approved_at           timestamptz,
  created_by            text not null,
  created_at            timestamptz not null default now(),
  unique (document_code, version)
);
create unique index if not exists template_one_approved on esign.agreement_templates (document_code) where status = 'APPROVED';

create table if not exists esign.agreements (
  id                  uuid primary key default gen_random_uuid(),
  reference           text not null unique,                 -- CRC-EA-2026-000123
  document_code       text not null default 'CRC-AGR-003',
  inquiry_id          text not null references public.inquiries(id) on delete restrict,
  customer_phone_key  text not null,                        -- private.phone_key of the verified contact
  quotation_id        uuid not null references esign.quotations(id) on delete restrict,
  quotation_version   int  not null,
  template_id         uuid not null references esign.agreement_templates(id) on delete restrict,
  template_version    int  not null,
  version             int  not null check (version > 0),    -- 1, 2… for this inquiry
  snapshot            jsonb not null default '{}',          -- every value shown to the customer
  rendered_html       text,
  document_hash       text,                                 -- SHA-256 (hex) of the canonical document
  pdf_path            text,
  pdf_hash            text,
  status              text not null default 'DRAFT'
                      check (status in ('DRAFT', 'SENT', 'VIEWED', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'SUPERSEDED', 'REVOKED')),
  expires_at          timestamptz,
  sent_at             timestamptz,
  first_viewed_at     timestamptz,
  decided_at          timestamptz,
  superseded_by       uuid references esign.agreements(id),
  generated_by        text not null,
  created_at          timestamptz not null default now(),
  unique (inquiry_id, version)
);
create unique index if not exists agreement_one_open_per_inquiry on esign.agreements (inquiry_id) where status in ('DRAFT', 'SENT', 'VIEWED');

create table if not exists esign.access_tokens (
  id                    uuid primary key default gen_random_uuid(),
  agreement_id          uuid not null references esign.agreements(id) on delete restrict,
  token_hash            text not null unique,               -- SHA-256 (hex) of the link token; the token itself is never stored
  expires_at            timestamptz not null,
  revoked_at            timestamptz,
  last_used_at          timestamptz,
  access_attempt_count  int not null default 0,
  created_by            text not null,
  created_at            timestamptz not null default now()
);

create table if not exists esign.acceptances (
  id                      uuid primary key default gen_random_uuid(),
  agreement_id            uuid not null unique references esign.agreements(id) on delete restrict,   -- one decision per agreement (idempotent)
  decision                text not null check (decision in ('ACCEPTED', 'DECLINED')),
  decided_at              timestamptz not null default now(),
  verification_method     text not null check (verification_method in ('SMS_OTP_PORTAL_LOGIN', 'MANUAL_REVIEWED')),
  verified_phone_key      text,
  auth_user_id            uuid,
  acceptance_statement    text,
  statement_version       text,
  accepted_document_hash  text,
  decline_reason          text,
  reviewed_by             text,                              -- MANUAL_REVIEWED: the approver
  evidence                jsonb not null default '{}'        -- ip, user agent, token id… never codes or secrets
);

-- The inquiry's e-Agreement / priority / payment timeline (Modules 06, 12, 14)
create table if not exists esign.events (
  id            bigint generated always as identity primary key,
  inquiry_id    text not null,
  agreement_id  uuid references esign.agreements(id) on delete restrict,
  event_type    text not null,
  actor_type    text not null check (actor_type in ('staff', 'customer', 'system')),
  actor_id      text,
  at            timestamptz not null default now(),
  metadata      jsonb not null default '{}'
);
create index if not exists events_inquiry on esign.events (inquiry_id, at);
create index if not exists events_agreement on esign.events (agreement_id, at);

create table if not exists esign.payment_requests (
  id                     uuid primary key default gen_random_uuid(),
  inquiry_id             text not null references public.inquiries(id) on delete restrict,
  agreement_id           uuid not null references esign.agreements(id) on delete restrict,
  quotation_id           uuid not null references esign.quotations(id) on delete restrict,
  hold_id                uuid not null references esign.priority_holds(id) on delete restrict,
  amount                 numeric(12,2) not null check (amount > 0),
  collection_account_id  text not null,
  deadline               timestamptz not null,
  status                 text not null default 'REQUESTED' check (status in ('REQUESTED', 'REPORTED', 'VERIFIED', 'PARTIAL', 'LATE', 'CANCELLED')),
  requested_by           text not null,
  created_at             timestamptz not null default now()
);
create unique index if not exists payment_request_one_open on esign.payment_requests (inquiry_id) where status in ('REQUESTED', 'REPORTED', 'PARTIAL');

-- Money Finance has to look at — reported by a customer, matched to a request, or unsolicited
create table if not exists esign.payment_receipts (
  id                   uuid primary key default gen_random_uuid(),
  request_id           uuid references esign.payment_requests(id) on delete restrict,
  inquiry_id           text references public.inquiries(id) on delete restrict,
  booking_id           text,
  amount               numeric(12,2) not null check (amount > 0),
  account_id           text,
  bank_reference       text,
  received_at          timestamptz,
  reported_by_customer boolean not null default false,
  evidence_path        text,                                  -- a screenshot is supporting evidence only
  status               text not null default 'REPORTED' check (status in ('REPORTED', 'VERIFIED', 'REJECTED', 'DUPLICATE', 'UNMATCHED', 'REFUND_DUE', 'REFUNDED')),
  verified_by          text,
  verified_at          timestamptz,
  note                 text,
  created_by           text,
  created_at           timestamptz not null default now()
);

-- The ticket that lets a booking be created under the gate (written by the allocation function only)
create table if not exists esign.booking_allocations (
  booking_id    text primary key,
  inquiry_id    text not null references public.inquiries(id) on delete restrict,
  agreement_id  uuid references esign.agreements(id) on delete restrict,
  hold_id       uuid references esign.priority_holds(id) on delete restrict,
  receipt_id    uuid references esign.payment_receipts(id) on delete restrict,
  exception_id  uuid,
  allocated_by  text not null,
  allocated_at  timestamptz not null default now()
);

-- Audited exceptions (conflict override, manual acceptance fallback…) — need a business approver
create table if not exists esign.exceptions (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null check (kind in ('CONFLICT_OVERRIDE', 'MANUAL_ACCEPTANCE', 'GATE_EXEMPT_BOOKING', 'OTHER')),
  inquiry_id    text,
  booking_id    text,
  reason        text not null,
  requested_by  text not null,
  requested_at  timestamptz not null default now(),
  status        text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED', 'USED')),
  decided_by    text,
  decided_at    timestamptz,
  decision_note text
);

revoke all on all tables in schema esign from public, anon, authenticated;

-- ── Integrity: append-only and forward-only ──────────────────────────────────

create or replace function private.esign_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'EVIDENCE_LOCKED: % records can''t be changed or deleted', tg_table_name using errcode = 'P0001';
end $$;

do $$
declare t text;
begin
  foreach t in array array['acceptances', 'events', 'booking_allocations'] loop
    execute format('drop trigger if exists append_only on esign.%I', t);
    execute format('create trigger append_only before update or delete on esign.%I for each row execute function private.esign_append_only()', t);
  end loop;
end $$;

-- Allowed status steps
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
      ('PARTIAL','VERIFIED'), ('PARTIAL','LATE'), ('PARTIAL','CANCELLED'), ('LATE','VERIFIED'), ('LATE','CANCELLED'))
    when 'receipt' then (p_from, p_to) in (
      ('REPORTED','VERIFIED'), ('REPORTED','REJECTED'), ('REPORTED','DUPLICATE'), ('REPORTED','UNMATCHED'),
      ('UNMATCHED','VERIFIED'), ('UNMATCHED','REJECTED'), ('UNMATCHED','DUPLICATE'), ('UNMATCHED','REFUND_DUE'),
      ('VERIFIED','REFUND_DUE'), ('REFUND_DUE','REFUNDED'))
    when 'exception' then (p_from, p_to) in (('PENDING','APPROVED'), ('PENDING','REJECTED'), ('APPROVED','USED'))
    else false end
$$;

create or replace function private.esign_guard() returns trigger
language plpgsql set search_path = '' as $$
declare kind text := tg_argv[0];
begin
  if tg_op = 'DELETE' then
    if kind = 'agreement' and old.status = 'DRAFT' then return old; end if;
    if kind = 'template' and old.status = 'DRAFT' then return old; end if;
    if kind = 'waitlist' then return old; end if;
    raise exception 'EVIDENCE_LOCKED: % % can''t be deleted', kind, old.id using errcode = 'P0001';
  end if;
  if kind = 'waitlist' then return new; end if;

  if not private.esign_step_ok(kind, old.status, new.status) then
    raise exception 'BAD_STEP: % can''t go from % to %', kind, old.status, new.status using errcode = 'P0001';
  end if;

  if kind = 'agreement' then
    if old.status <> 'DRAFT' and (
         new.snapshot is distinct from old.snapshot or new.rendered_html is distinct from old.rendered_html
      or new.document_hash is distinct from old.document_hash or new.quotation_id is distinct from old.quotation_id
      or new.quotation_version is distinct from old.quotation_version or new.template_id is distinct from old.template_id
      or new.template_version is distinct from old.template_version or new.customer_phone_key is distinct from old.customer_phone_key
      or new.inquiry_id is distinct from old.inquiry_id or new.reference is distinct from old.reference or new.version is distinct from old.version
      or (old.pdf_hash is not null and (new.pdf_hash is distinct from old.pdf_hash or new.pdf_path is distinct from old.pdf_path))) then
      raise exception 'EVIDENCE_LOCKED: agreement % was sent — its document can''t change; issue a revised agreement', old.reference using errcode = 'P0001';
    end if;
    if new.status = 'SENT' and old.status = 'DRAFT' and (coalesce(new.document_hash, '') = '' or new.snapshot = '{}'::jsonb or new.expires_at is null) then
      raise exception 'BAD_STEP: an agreement needs its document, hash and expiry before it is sent' using errcode = 'P0001';
    end if;
    if new.status in ('ACCEPTED', 'DECLINED') and old.status <> new.status
       and not exists (select 1 from esign.acceptances a where a.agreement_id = new.id and a.decision = new.status) then
      raise exception 'BAD_STEP: % needs the customer''s recorded decision', new.status using errcode = 'P0001';
    end if;
  elsif kind = 'quotation' then
    if (to_jsonb(new) - array['status', 'accepted_at']) is distinct from (to_jsonb(old) - array['status', 'accepted_at']) then
      raise exception 'EVIDENCE_LOCKED: quotation % was sent — make a new version instead', old.reference using errcode = 'P0001';
    end if;
  elsif kind = 'template' then
    if old.status <> 'DRAFT' and (to_jsonb(new) - array['status']) is distinct from (to_jsonb(old) - array['status']) then
      raise exception 'EVIDENCE_LOCKED: an approved template can''t change — make a new version' using errcode = 'P0001';
    end if;
    if new.status = 'APPROVED' and (new.approved_by is null or new.approved_at is null) then
      raise exception 'BAD_STEP: approving a template needs the approver' using errcode = 'P0001';
    end if;
  elsif kind = 'hold' then
    if new.vehicle_id is distinct from old.vehicle_id or new.hold_range is distinct from old.hold_range
       or new.inquiry_id is distinct from old.inquiry_id or new.requested_start is distinct from old.requested_start
       or new.requested_end is distinct from old.requested_end then
      raise exception 'EVIDENCE_LOCKED: a hold''s car and period can''t change — release it and place a new one' using errcode = 'P0001';
    end if;
  elsif kind = 'request' then
    if (to_jsonb(new) - array['status']) is distinct from (to_jsonb(old) - array['status']) then
      raise exception 'EVIDENCE_LOCKED: an advance request can''t change — cancel it and issue a new one' using errcode = 'P0001';
    end if;
  elsif kind = 'receipt' then
    if new.amount is distinct from old.amount or new.account_id is distinct from old.account_id
       or new.bank_reference is distinct from old.bank_reference or new.received_at is distinct from old.received_at
       or new.created_at is distinct from old.created_at then
      if old.status <> 'REPORTED' then
        raise exception 'EVIDENCE_LOCKED: a checked payment''s amount, account and reference can''t change' using errcode = 'P0001';
      end if;
    end if;
    if new.status = 'VERIFIED' and old.status <> 'VERIFIED' and (new.verified_by is null or new.verified_at is null or new.account_id is null or new.received_at is null) then
      raise exception 'BAD_STEP: verifying a payment needs who verified it, the account and when the money arrived' using errcode = 'P0001';
    end if;
  elsif kind = 'exception' then
    if new.status in ('APPROVED', 'REJECTED') and old.status = 'PENDING' and (new.decided_by is null or new.decided_by = old.requested_by) then
      raise exception 'BAD_STEP: an exception must be decided by someone other than the person who asked' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

do $$
declare r record;
begin
  for r in select * from (values ('agreements', 'agreement'), ('quotations', 'quotation'), ('priority_holds', 'hold'),
                                 ('agreement_templates', 'template'), ('payment_requests', 'request'),
                                 ('payment_receipts', 'receipt'), ('exceptions', 'exception'), ('hold_waitlist', 'waitlist')) v(t, k) loop
    execute format('drop trigger if exists guard on esign.%I', r.t);
    execute format('create trigger guard before update or delete on esign.%I for each row execute function private.esign_guard(%L)', r.t, r.k);
  end loop;
end $$;

-- ── Double-booking guard ─────────────────────────────────────────────────────

alter table public.bookings add column if not exists occupies tstzrange;

-- Fill in existing bookings without running their other triggers (nothing else changes)
alter table public.bookings disable trigger user;
update public.bookings
   set occupies = private.booking_occupies(status, start_date, start_time, end_date, end_time)
 where occupies is distinct from private.booking_occupies(status, start_date, start_time, end_date, end_time);
alter table public.bookings enable trigger user;

create index if not exists bookings_occupies on public.bookings using gist (vehicle_id, occupies) where occupies is not null;

-- Bookings that already overlap (admins only) — must be fixed before the constraint can be added
create or replace function public.eagreement_booking_overlaps()
returns table (vehicle_id text, booking_a text, booking_b text, a_from timestamptz, a_to timestamptz, b_from timestamptz, b_to timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  -- admins, or the SQL editor / server (no login at all); never staff, owners, customers or visitors
  if not (private.is_admin() or coalesce(auth.jwt() ->> 'role', '') in ('', 'service_role')) then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  return query
    select a.vehicle_id, a.id, b.id, lower(a.occupies), upper(a.occupies), lower(b.occupies), upper(b.occupies)
      from public.bookings a join public.bookings b
        on a.vehicle_id = b.vehicle_id and a.id < b.id and a.occupies && b.occupies
     order by a.vehicle_id, lower(a.occupies);
end $$;
revoke all on function public.eagreement_booking_overlaps() from public, anon;
grant execute on function public.eagreement_booking_overlaps() to authenticated;

do $$
declare n int;
begin
  if exists (select 1 from pg_constraint where conname = 'bookings_no_double_booking') then return; end if;
  select count(*) into n from public.bookings a join public.bookings b
    on a.vehicle_id = b.vehicle_id and a.id < b.id and a.occupies && b.occupies;
  if n > 0 then
    raise notice 'NOT ADDED: % pairs of existing bookings overlap — see select * from public.eagreement_booking_overlaps(); fix them and run 22 again. New overlaps are still refused by the trigger.', n;
  else
    alter table public.bookings add constraint bookings_no_double_booking
      exclude using gist (vehicle_id with =, occupies with &&) where (occupies is not null and vehicle_id is not null);
  end if;
end $$;

-- Every booking save: work out `occupies`, refuse clashes with clear words, and apply the gate
create or replace function private.esign_booking_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  clash record; held record;
  alloc esign.booking_allocations%rowtype;
  enforce_from timestamptz := private.try_ts(private.eag_policy() ->> 'enforce_from');
  becomes_live boolean;
begin
  new.occupies := private.booking_occupies(new.status, new.start_date, new.start_time, new.end_date, new.end_time);
  select * into alloc from esign.booking_allocations a where a.booking_id = new.id;

  -- the gate: a new booking (or a cancelled / finished one made live again) needs an allocation
  becomes_live := new.occupies is not null and (tg_op = 'INSERT' or old.occupies is null);
  if becomes_live and enforce_from is not null and now() >= enforce_from and alloc.booking_id is null
     and (tg_op = 'INSERT' or coalesce(private.try_ts(new.created_at), now()) >= enforce_from) then
    raise exception 'BOOKING_GATE: a booking can only be confirmed after the customer accepts the e-Agreement, the advance is verified by Finance and the car is allocated (Inquiry → e-Agreement → Advance).'
      using errcode = 'P0001';
  end if;

  if new.occupies is null or new.vehicle_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.occupies is not distinct from old.occupies and new.vehicle_id is not distinct from old.vehicle_id then
    return new;   -- dates and car unchanged (a payment, a note…): nothing to check
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

drop trigger if exists zz_esign_booking_guard on public.bookings;
create trigger zz_esign_booking_guard before insert or update on public.bookings
  for each row execute function private.esign_booking_guard();

-- A hold can't cover a time the car is already booked
create or replace function private.esign_hold_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare clash record;
begin
  if new.status <> 'ACTIVE' then return new; end if;
  perform pg_advisory_xact_lock(hashtext('esign:vehicle:' || new.vehicle_id));
  select b.id, b.start_date, b.end_date into clash
    from public.bookings b
   where b.vehicle_id = new.vehicle_id and b.occupies && new.hold_range
     and not exists (select 1 from esign.booking_allocations a where a.booking_id = b.id and a.inquiry_id = new.inquiry_id)
   limit 1;
  if found then
    raise exception 'DOUBLE_BOOKING: the car is already booked from % to % (booking %) — it can''t be held over that time.',
      clash.start_date, clash.end_date, clash.id using errcode = '23P01';
  end if;
  return new;
end $$;

drop trigger if exists hold_vs_bookings on esign.priority_holds;
create trigger hold_vs_bookings before insert or update on esign.priority_holds
  for each row execute function private.esign_hold_guard();

revoke all on function private.esign_append_only(), private.esign_step_ok(text, text, text), private.esign_guard(),
  private.esign_booking_guard(), private.esign_hold_guard() from public, anon;

notify pgrst, 'reload schema';
