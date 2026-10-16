-- =====================================================================
-- Columns the admin app writes that were missing from the live database.
-- Without them Supabase rejects the WHOLE row, so the save fails:
--   bookings.waive_extra_day  → a booking with "Waive extra day" ticked was never saved
--   bookings.bad_debt         → a payment with a written-off amount was never saved
-- Safe to run more than once (adds a column only if it isn't there).
-- Run in Supabase → SQL Editor.
-- =====================================================================

alter table bookings add column if not exists waive_extra_day boolean not null default false;
alter table bookings add column if not exists bad_debt        numeric(12,2);

-- Make the API see the new columns immediately
notify pgrst, 'reload schema';

-- Hourly / daily / monthly rentals (a booking without a type is Daily)
alter table bookings add column if not exists rental_type  text;           -- 'Hourly' | 'Daily' | 'Monthly'
alter table bookings add column if not exists rental_units numeric(10,2);  -- hours or calendar months
alter table bookings add column if not exists unit_rate    numeric(12,2);  -- price per hour / per month

notify pgrst, 'reload schema';

-- ── Full booking record ───────────────────────────────────────────────────────
alter table bookings add column if not exists payments       jsonb;   -- payment / refund / deposit ledger
alter table bookings add column if not exists customer_info  jsonb;   -- licence, nationality, emergency contact
alter table bookings add column if not exists documents      jsonb;   -- uploaded licence / ID / agreement photos
alter table bookings add column if not exists checklists     jsonb;   -- pickup & return handover checklists
alter table bookings add column if not exists charges        jsonb;   -- fines, tolls, damage after the rental
alter table bookings add column if not exists agreement      jsonb;   -- rental agreement printed / signed
alter table bookings add column if not exists activity       jsonb;   -- history of everything done to the booking
alter table bookings add column if not exists internal_notes text;    -- staff-only notes

-- Customers who should not be rented to again
alter table customers add column if not exists do_not_rent        boolean not null default false;
alter table customers add column if not exists do_not_rent_reason text;

-- Private bucket for customer documents & handover photos (NOT public — files are opened
-- with short-lived signed links from the admin app)
insert into storage.buckets (id, name, public)
values ('booking-files', 'booking-files', false)
on conflict (id) do nothing;

-- Open file rules — only until the security lockdown is applied. After it, security/01 owns
-- the storage rules, so re-running this file must not put the open ones back.
do $$
begin
  if to_regprocedure('private.is_admin()') is null then
    drop policy if exists "admin app reads booking files"   on storage.objects;
    drop policy if exists "admin app uploads booking files" on storage.objects;
    drop policy if exists "admin app deletes booking files" on storage.objects;
    create policy "admin app reads booking files"   on storage.objects for select using (bucket_id = 'booking-files');
    create policy "admin app uploads booking files" on storage.objects for insert with check (bucket_id = 'booking-files');
    create policy "admin app deletes booking files" on storage.objects for delete using (bucket_id = 'booking-files');
  end if;
end $$;

notify pgrst, 'reload schema';

-- ── App-wide settings (e.g. pause all SMS) ────────────────────────────────────
-- One row per setting. 'sms' = { "enabled": true|false, "note": "...", "updated_by": "..." }.
-- The send-sms Edge Function checks it before every message, so pausing here stops
-- texts from the admin app AND the scheduled reminder run.
create table if not exists app_settings (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
-- Row-level security is left as it is: off on an old database, on (admin-only write) after the lockdown.
insert into app_settings (key, value) values ('sms', '{"enabled": true}'::jsonb)
on conflict (key) do nothing;

notify pgrst, 'reload schema';

-- ── Secret for the alternatives link ─────────────────────────────────────────
-- The admin saves a random token with each "alternatives" message; the website must send it
-- back before it may change that inquiry (checked by security/02_public_functions.sql).
alter table inquiries add column if not exists alt_token text;

notify pgrst, 'reload schema';

-- ── Mid-trip vehicle exchanges (Booking → Exchange vehicle) ─────────────────
-- Each exchange: which car was taken back, when, its days / share / owner payout, damage notes.
alter table bookings add column if not exists exchanges jsonb;

notify pgrst, 'reload schema';

-- ── Up to 3 hero images per vehicle (Vehicles → Edit → Hero images) ──────────
-- hero_images holds the choices; hero_image_url stays the one the website shows.
alter table vehicles add column if not exists hero_images jsonb not null default '[]'::jsonb;
update vehicles set hero_images = jsonb_build_array(hero_image_url)
where hero_image_url is not null and hero_images = '[]'::jsonb;

notify pgrst, 'reload schema';

-- ── Owner payout adjustments (e.g. owner's share of a breakdown repair, deducted from the payout) ──
alter table bookings add column if not exists payout_adjustments jsonb;

notify pgrst, 'reload schema';
