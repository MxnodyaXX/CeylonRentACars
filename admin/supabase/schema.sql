-- =============================================================================
-- EMRAC Management System — Supabase Schema
-- Run this entire file in the Supabase SQL Editor before starting the app.
-- =============================================================================

-- ── Migration: add deposit type columns (run once on existing databases) ─────
alter table if exists bookings add column if not exists deposit_type              text;
alter table if exists bookings add column if not exists deposit_asset_description text;

-- ── Tables ───────────────────────────────────────────────────────────────────

create table if not exists owners (
  id               text primary key,
  name             text not null,
  phone            text not null,
  email            text not null,
  address          text,
  bank_account     text,
  nic              text,
  username         text,
  commission_rate  numeric(5,2)  not null default 15,
  total_earnings   numeric(12,2) not null default 0,
  pending_payout   numeric(12,2) not null default 0,
  sms_opt_in       boolean       not null default true,
  created_at       text not null
);

create table if not exists vehicles (
  id                    text primary key,
  vehicle_number        text not null,
  brand                 text not null,
  model                 text not null,
  year                  integer not null,
  owner_id              text references owners(id) on delete set null,
  daily_rent            numeric(10,2) not null,
  extra_km_rate         numeric(10,2),
  included_km_per_day   integer,
  status                text not null default 'Available',
  insurance             jsonb not null default '{}',
  revenue               numeric(12,2) not null default 0,
  rent_count            integer not null default 0,
  image_url             text,
  color                 text,
  seats                 integer,
  fuel_type             text,
  transmission          text,
  mileage               integer,
  created_at            text not null
);

create table if not exists bookings (
  id                text primary key,
  vehicle_id        text references vehicles(id) on delete set null,
  customer_id       text not null,
  customer_name     text not null,
  customer_phone    text not null,
  customer_email    text,
  customer_nic      text,
  start_date        text not null,
  end_date          text not null,
  total_days        integer not null,
  total_amount      numeric(12,2) not null,
  estimated_amount  numeric(12,2),
  paid_amount       numeric(12,2) not null default 0,
  status            text not null default 'Confirmed',
  referral          text,
  notes             text,
  pickup_location   text,
  drop_location     text,
  driver_id         text,
  quotation         jsonb,
  deposit_type              text,
  deposit_asset_description text,
  deposit_amount            numeric(12,2),
  deposit_returned           numeric(12,2),
  deposit_deduction          numeric(12,2),
  deposit_notes              text,
  referral_fee      numeric(10,2),
  referral_paid     boolean not null default false,
  referral_paid_at  text,
  created_at        text not null
);

create table if not exists inquiries (
  id                text primary key,
  customer_name     text not null,
  customer_phone    text not null,
  requested_vehicle text not null,
  preferred_brand   text,
  start_date        text,
  end_date          text,
  referral          text not null,
  status            text not null default 'Pending',
  lost_reason       text,
  notes             text,
  created_at        text not null
);

create table if not exists commissions (
  id                text primary key,
  booking_id        text references bookings(id) on delete cascade,
  vehicle_id        text references vehicles(id) on delete set null,
  owner_id          text references owners(id) on delete set null,
  referral          text not null,
  total_income      numeric(12,2) not null,
  commission_rate   numeric(5,2)  not null,
  commission_amount numeric(12,2) not null,
  owner_payout      numeric(12,2) not null,
  coordinator_fee   numeric(12,2),
  status            text not null default 'Pending',
  created_at        text not null
);

create table if not exists expenses (
  id          text primary key,
  vehicle_id  text references vehicles(id) on delete set null,
  category    text not null,
  amount      numeric(12,2) not null,
  description text not null,
  date        text not null,
  receipt     text,
  created_at  text not null
);

create table if not exists drivers (
  id                  text primary key,
  name                text not null,
  phone               text not null,
  license_number      text not null,
  license_expiry      text not null,
  status              text not null default 'Available',
  daily_rate          numeric(10,2) not null,
  total_earnings      numeric(12,2) not null default 0,
  current_booking_id  text,
  joined_at           text not null,
  address             text,
  nic                 text
);

create table if not exists notifications (
  id          text primary key,
  type        text not null,
  title       text not null,
  message     text not null,
  related_id  text,
  read        boolean not null default false,
  created_at  text not null
);

create table if not exists handovers (
  id              text primary key,
  booking_id      text references bookings(id) on delete cascade,
  vehicle_id      text references vehicles(id) on delete set null,
  type            text not null,
  location        text not null,
  date_time       text not null,
  mileage         integer not null,
  fuel_level      text not null,
  notes           text,
  extra_km        integer,
  extra_km_charge numeric(10,2),
  final_amount    numeric(12,2),
  created_at      text not null
);

create table if not exists customers (
  id          text primary key,
  name        text not null,
  phone       text not null,
  email       text,
  nic         text,
  address     text,
  notes       text,
  sms_opt_in  boolean not null default true,
  created_at  text not null
);

-- App login profiles (admin + owner logins). NOTE: password stored as-is to match
-- the client-side auth model — acceptable only for a private internal tool. For a
-- public deployment, switch to Supabase Auth or store a password hash instead.
create table if not exists users (
  id          text primary key,
  username    text not null unique,
  password    text not null,
  name        text not null,
  role        text not null default 'owner',
  owner_id    text references owners(id) on delete cascade,
  email       text,
  nic         text,
  created_at  text not null
);

-- Owner-targeted notifications (referral payout alerts addressed to a specific owner)
alter table notifications add column if not exists owner_id text;

-- sms_opt_in on owners (added after initial schema)
alter table owners add column if not exists sms_opt_in boolean not null default true;

-- Login-profile details saved onto the owner record (added after initial schema)
alter table owners add column if not exists nic      text;
alter table owners add column if not exists username text;

-- Referral settlement tracking on bookings (added after initial schema)
alter table bookings add column if not exists referral_fee     numeric(10,2);
alter table bookings add column if not exists referral_paid    boolean not null default false;
alter table bookings add column if not exists referral_paid_at text;

-- Scheduled pickup / return times on bookings — enable same-day turnaround availability
alter table bookings add column if not exists start_time            text;
alter table bookings add column if not exists end_time              text;

-- Owner-approved: don't bill a partial day past a whole 24h multiple (toggle set at pickup)
alter table bookings add column if not exists waive_extra_day       boolean not null default false;

-- Return / payment / credit details on bookings (added after initial schema)
alter table bookings add column if not exists pickup_at             text;
alter table bookings add column if not exists return_at             text;
alter table bookings add column if not exists advance_amount        numeric(12,2);
alter table bookings add column if not exists discount              numeric(12,2);
alter table bookings add column if not exists extra_charges         numeric(12,2);
alter table bookings add column if not exists payment_method        text;
alter table bookings add column if not exists credit_amount         numeric(12,2);
alter table bookings add column if not exists credit_settled        boolean default false;
alter table bookings add column if not exists credit_responsibility text;

-- ── Disable RLS (private internal app — no public access) ────────────────────

alter table owners        disable row level security;
alter table vehicles      disable row level security;
alter table bookings      disable row level security;
alter table inquiries     disable row level security;
alter table commissions   disable row level security;
alter table expenses      disable row level security;
alter table drivers       disable row level security;
alter table notifications disable row level security;
alter table handovers     disable row level security;
alter table customers     disable row level security;
alter table users         disable row level security;

-- ── Enable real-time for all tables ──────────────────────────────────────────
-- Idempotent: only adds a table to the publication if it isn't already a member,
-- so this whole schema file can be re-run safely (Postgres has no
-- "alter publication ... add table if not exists").

do $$
declare t text;
begin
  foreach t in array array[
    'owners','vehicles','bookings','inquiries','commissions','expenses',
    'drivers','notifications','handovers','customers','users'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table %I', t);
    end if;
  end loop;
end $$;
