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

drop policy if exists "admin app reads booking files"   on storage.objects;
drop policy if exists "admin app uploads booking files" on storage.objects;
drop policy if exists "admin app deletes booking files" on storage.objects;
create policy "admin app reads booking files"   on storage.objects for select using (bucket_id = 'booking-files');
create policy "admin app uploads booking files" on storage.objects for insert with check (bucket_id = 'booking-files');
create policy "admin app deletes booking files" on storage.objects for delete using (bucket_id = 'booking-files');

notify pgrst, 'reload schema';
