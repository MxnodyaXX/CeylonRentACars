-- =============================================================================
-- EMRAC — SMS infrastructure
-- Run this in the Supabase SQL Editor after schema.sql.
-- =============================================================================

-- ── Delivery / audit log — one row per SMS attempt ──────────────────────────
create table if not exists sms_log (
  id             uuid primary key default gen_random_uuid(),
  recipient      text not null,                 -- 94XXXXXXXXX
  message        text not null,
  category       text,                          -- template key, e.g. bookingConfirmation
  recipient_role text,                          -- customer | owner | referrer | driver | admin
  related_id     text,                          -- booking id, owner id, etc.
  status         text not null default 'queued',-- queued | sent | delivered | failed | skipped
  provider_uid   text,                          -- Text.lk message uid (for delivery matching)
  cost           numeric,                       -- units charged
  error          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists sms_log_provider_uid_idx on sms_log (provider_uid);
create index if not exists sms_log_created_at_idx    on sms_log (created_at desc);

-- ── Consent flags (staff-set, per record) ──────────────────────────────────
alter table customers add column if not exists sms_opt_in boolean not null default true;
alter table owners    add column if not exists sms_opt_in boolean not null default true;

-- ── Authoritative opt-out list (recipient-initiated STOP) ───────────────────
-- send-sms checks this before every send; sms-inbound adds/removes phones here.
create table if not exists sms_opt_out (
  phone      text primary key,   -- 94XXXXXXXXX
  created_at timestamptz not null default now()
);

-- ── Referral columns the app writes (kept in sync for Supabase backends) ─────
alter table bookings add column if not exists referral_fee       numeric(12,2);
alter table bookings add column if not exists referral_fee_type  text;
alter table bookings add column if not exists referral_fee_value numeric(12,2);
alter table bookings add column if not exists referral_paid      boolean default false;
alter table bookings add column if not exists referral_paid_at   text;
