-- =====================================================================
-- 01 · SCOPED ACCESS (row-level security for admins and owners)
-- Run AFTER the admin app is on Supabase Auth (DEPLOY-CHECKLIST.md steps 1–4).
-- Reversible: rollback/01_rollback_scoped_access.sql (keeps RLS on).
-- Safe to run more than once.
--
-- Who can do what (role comes from the login's app_metadata, set only by the server):
--   anon (website visitors) ...... no table access. Website views + 3 RPCs only (website.sql, 02_*).
--   admin ........................ everything.
--   owner (app_metadata.owner_id)  only rows tied to THEIR vehicles:
--       vehicles (read/update own), bookings on own vehicles (+ read bookings they referred),
--       commissions on own vehicles (+ read the referral ones), expenses, handovers,
--       vehicle reviews, customers who booked their vehicles, their own owner row,
--       their own notifications, drivers (read), app settings (read),
--       inquiries only if the admin gave them "Inquiries Page" permission.
--   Owners can never change earnings / payouts / commission status / vehicle ownership
--   (database triggers keep those values — only admins and server functions can).
-- =====================================================================

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

-- ── Who is calling ──────────────────────────────────────────────────────────
create or replace function private.jwt_role() returns text
language sql stable set search_path = '' as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '')
$$;

create or replace function private.is_admin() returns boolean
language sql stable set search_path = '' as $$
  select private.jwt_role() = 'admin'
$$;

create or replace function private.owner_id() returns text
language sql stable set search_path = '' as $$
  select case when private.jwt_role() = 'owner'
              then nullif(auth.jwt() -> 'app_metadata' ->> 'owner_id', '') end
$$;

create or replace function private.is_owner() returns boolean
language sql stable set search_path = '' as $$
  select private.owner_id() is not null
$$;

-- An owner permission granted by the admin (Permissions page), e.g. 'canViewInquiries'
create or replace function private.owner_may(p_perm text) returns boolean
language sql stable set search_path = '' as $$
  select private.is_owner()
     and coalesce((auth.jwt() -> 'app_metadata' -> 'permissions' ->> p_perm)::boolean, false)
$$;

-- The rest look at tables, so they run with the definer's rights (no RLS recursion)
-- and only ever answer about the calling owner.
create or replace function private.owner_name() returns text
language sql stable security definer set search_path = '' as $$
  select o.name from public.owners o where o.id = private.owner_id()
$$;

create or replace function private.owns_vehicle(p_vehicle_id text) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.owner_id() is not null and exists (
    select 1 from public.vehicles v where v.id = p_vehicle_id and v.owner_id = private.owner_id())
$$;

-- Booking on one of my vehicles
create or replace function private.owns_booking(p_booking_id text) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.owner_id() is not null and exists (
    select 1 from public.bookings b join public.vehicles v on v.id = b.vehicle_id
    where b.id = p_booking_id and v.owner_id = private.owner_id())
$$;

-- Booking I may READ: on my vehicle, or one I referred (referral holds the referrer's name)
create or replace function private.sees_booking(p_booking_id text) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.owner_id() is not null and exists (
    select 1 from public.bookings b
    left join public.vehicles v on v.id = b.vehicle_id
    where b.id = p_booking_id
      and (v.owner_id = private.owner_id()
           or (nullif(trim(b.referral), '') is not null
               and lower(trim(b.referral)) = lower(trim(private.owner_name())))))
$$;

-- Customer who booked one of my vehicles (matched by customer id or phone)
create or replace function private.sees_customer(p_customer_id text, p_phone text) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.owner_id() is not null and exists (
    select 1 from public.bookings b join public.vehicles v on v.id = b.vehicle_id
    where v.owner_id = private.owner_id()
      and (b.customer_id = p_customer_id
           or (length(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')) >= 9
               and right(regexp_replace(b.customer_phone, '\D', '', 'g'), 9) = right(regexp_replace(p_phone, '\D', '', 'g'), 9))))
$$;

revoke all on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated;

-- ── 1. Every table: RLS on, old rules removed, admin full access, no anon ────
do $$
declare t record; p record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t.tablename loop
      execute format('drop policy %I on public.%I', p.policyname, t.tablename);
    end loop;
    execute format('alter table public.%I enable row level security', t.tablename);
    execute format('create policy admin_all on public.%I for all to authenticated using (private.is_admin()) with check (private.is_admin())', t.tablename);
    execute format('revoke all on public.%I from anon', t.tablename);
  end loop;
end $$;

-- Tables created later: no automatic access for website visitors
alter default privileges in schema public revoke all on tables from anon;

-- ── 2. Owner rules (only for tables that exist) ──────────────────────────────
do $$
begin
  -- owners: own row only
  if to_regclass('public.owners') is not null then
    create policy owner_select on public.owners for select to authenticated using (id = private.owner_id());
    create policy owner_update on public.owners for update to authenticated using (id = private.owner_id()) with check (id = private.owner_id());
  end if;

  -- vehicles: own vehicles, can't be given away
  if to_regclass('public.vehicles') is not null then
    create policy owner_select on public.vehicles for select to authenticated using (owner_id = private.owner_id());
    create policy owner_update on public.vehicles for update to authenticated using (owner_id = private.owner_id()) with check (owner_id = private.owner_id());
  end if;

  -- bookings: own vehicles (read + write), referred bookings (read only)
  if to_regclass('public.bookings') is not null then
    create policy owner_select on public.bookings for select to authenticated using (private.sees_booking(id));
    create policy owner_insert on public.bookings for insert to authenticated with check (private.owns_vehicle(vehicle_id));
    create policy owner_update on public.bookings for update to authenticated using (private.owns_vehicle(vehicle_id)) with check (private.owns_vehicle(vehicle_id));
  end if;

  -- commissions: own vehicles (read + add), referral ones (read)
  if to_regclass('public.commissions') is not null then
    create policy owner_select on public.commissions for select to authenticated
      using (owner_id = private.owner_id() or private.owns_vehicle(vehicle_id) or private.sees_booking(booking_id));
    create policy owner_insert on public.commissions for insert to authenticated
      with check (private.owns_vehicle(vehicle_id) and coalesce(owner_id, private.owner_id()) = private.owner_id());
    create policy owner_update on public.commissions for update to authenticated
      using (private.owns_vehicle(vehicle_id)) with check (private.owns_vehicle(vehicle_id));
  end if;

  -- expenses / handovers / vehicle reviews: own vehicles
  if to_regclass('public.expenses') is not null then
    create policy owner_all on public.expenses for all to authenticated
      using (private.owns_vehicle(vehicle_id)) with check (private.owns_vehicle(vehicle_id));
  end if;
  if to_regclass('public.handovers') is not null then
    create policy owner_select on public.handovers for select to authenticated using (private.owns_vehicle(vehicle_id));
    create policy owner_insert on public.handovers for insert to authenticated with check (private.owns_vehicle(vehicle_id));
    create policy owner_update on public.handovers for update to authenticated using (private.owns_vehicle(vehicle_id)) with check (private.owns_vehicle(vehicle_id));
  end if;
  if to_regclass('public.vehicle_reviews') is not null then
    create policy owner_select on public.vehicle_reviews for select to authenticated using (private.owns_vehicle(vehicle_id));
  end if;

  -- customers: only those who booked my vehicles; owners may add new ones (manual bookings)
  if to_regclass('public.customers') is not null then
    create policy owner_select on public.customers for select to authenticated using (private.sees_customer(id, phone));
    create policy owner_insert on public.customers for insert to authenticated with check (private.is_owner());
    create policy owner_update on public.customers for update to authenticated using (private.sees_customer(id, phone)) with check (private.sees_customer(id, phone));
  end if;

  -- notifications: only the ones addressed to me; I may add unaddressed or my own
  if to_regclass('public.notifications') is not null then
    create policy owner_select on public.notifications for select to authenticated using (owner_id = private.owner_id());
    create policy owner_update on public.notifications for update to authenticated using (owner_id = private.owner_id()) with check (owner_id = private.owner_id());
    create policy owner_insert on public.notifications for insert to authenticated
      with check (private.is_owner() and (owner_id is null or owner_id = private.owner_id()));
  end if;

  -- drivers: read (to assign), app settings: read
  if to_regclass('public.drivers') is not null then
    create policy owner_select on public.drivers for select to authenticated using (private.is_owner());
  end if;
  if to_regclass('public.app_settings') is not null then
    create policy owner_select on public.app_settings for select to authenticated using (private.is_owner());
  end if;

  -- inquiries (company leads): only owners the admin gave the Inquiries permission
  if to_regclass('public.inquiries') is not null then
    create policy owner_permitted on public.inquiries for all to authenticated
      using (private.owner_may('canViewInquiries')) with check (private.owner_may('canViewInquiries'));
  end if;
  if to_regclass('public.inquiry_followups') is not null then
    create policy owner_permitted on public.inquiry_followups for all to authenticated
      using (private.owner_may('canViewInquiries')) with check (private.owner_may('canViewInquiries'));
  end if;
  -- everything else (users, sms_log, sms_opt_out, whatsapp_*, service_reviews, …): admin only
end $$;

-- ── 3. Values owners must never change (silently kept as they were) ──────────
-- Only applies to signed-in owners; admins, Edge Functions (service_role) and the SQL editor are unaffected.
create or replace function private.protect_owner_fields() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user = 'authenticated' and not private.is_admin() then
    if tg_table_name = 'owners' then
      new.id := old.id; new.total_earnings := old.total_earnings; new.pending_payout := old.pending_payout;
      new.commission_rate := old.commission_rate;
    elsif tg_table_name = 'vehicles' then
      new.id := old.id; new.owner_id := old.owner_id;
    elsif tg_table_name = 'commissions' then
      if tg_op = 'INSERT' then
        new.status := 'Pending';                       -- only the admin settles payouts
      else
        new.booking_id := old.booking_id; new.owner_id := old.owner_id; new.status := old.status;
        new.total_income := old.total_income; new.owner_payout := old.owner_payout;
        new.commission_amount := old.commission_amount; new.commission_rate := old.commission_rate;
        new.coordinator_fee := old.coordinator_fee;
      end if;
    end if;
  end if;
  return new;
end $$;

do $$
begin
  if to_regclass('public.owners') is not null then
    drop trigger if exists protect_owner_fields on public.owners;
    create trigger protect_owner_fields before update on public.owners for each row execute function private.protect_owner_fields();
  end if;
  if to_regclass('public.vehicles') is not null then
    drop trigger if exists protect_owner_fields on public.vehicles;
    create trigger protect_owner_fields before update on public.vehicles for each row execute function private.protect_owner_fields();
  end if;
  if to_regclass('public.commissions') is not null then
    drop trigger if exists protect_owner_fields on public.commissions;
    create trigger protect_owner_fields before insert or update on public.commissions for each row execute function private.protect_owner_fields();
  end if;
end $$;

-- ── 4. Functions: website visitors may only call the website ones ────────────
revoke execute on all functions in schema public from anon;
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('submit_booking_request', 'submit_feedback', 'choose_alternative') loop
    execute format('grant execute on function %s to anon, authenticated', f.sig);
  end loop;
end $$;
alter default privileges in schema public revoke execute on functions from anon;

-- Website views stay readable by visitors (they expose listing-safe columns only)
do $$
declare v text;
begin
  foreach v in array array['website_vehicles', 'popular_vehicles', 'catalog_vehicles', 'vehicle_busy_dates',
                           'public_reviews', 'public_service_reviews', 'feedback_vehicles'] loop
    if to_regclass('public.' || v) is not null then
      execute format('grant select on public.%I to anon, authenticated', v);
    end if;
  end loop;
end $$;

-- ── 5. Storage ──────────────────────────────────────────────────────────────
-- Remove every existing storage rule (some were wide open), then:
--   vehicle-images  public to VIEW; admin + the vehicle's owner may change (path: <vehicleId>/…)
--   booking-files   private; admin + the booking's vehicle owner (path: <bookingId>/…)
--   receipts        private now (customer details); admin + the booking's vehicle owner
--                   (path: <bookingId>/…; customers get a time-limited signed link)
do $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'storage' and tablename = 'objects' loop
    execute format('drop policy %I on storage.objects', p.policyname);
  end loop;
end $$;

update storage.buckets set public = false where id in ('booking-files', 'receipts');
update storage.buckets set public = true  where id = 'vehicle-images';

create policy vehicle_images_write on storage.objects for insert to authenticated
  with check (bucket_id = 'vehicle-images' and (private.is_admin() or private.owns_vehicle((storage.foldername(name))[1])));
create policy vehicle_images_update on storage.objects for update to authenticated
  using (bucket_id = 'vehicle-images' and (private.is_admin() or private.owns_vehicle((storage.foldername(name))[1])));
create policy vehicle_images_delete on storage.objects for delete to authenticated
  using (bucket_id = 'vehicle-images' and (private.is_admin() or private.owns_vehicle((storage.foldername(name))[1])));

create policy private_files_select on storage.objects for select to authenticated
  using (bucket_id in ('booking-files', 'receipts') and (private.is_admin() or private.owns_booking((storage.foldername(name))[1])));
create policy private_files_insert on storage.objects for insert to authenticated
  with check (bucket_id in ('booking-files', 'receipts') and (private.is_admin() or private.owns_booking((storage.foldername(name))[1])));
create policy private_files_update on storage.objects for update to authenticated
  using (bucket_id in ('booking-files', 'receipts') and (private.is_admin() or private.owns_booking((storage.foldername(name))[1])));
create policy private_files_delete on storage.objects for delete to authenticated
  using (bucket_id in ('booking-files', 'receipts') and (private.is_admin() or private.owns_booking((storage.foldername(name))[1])));

notify pgrst, 'reload schema';
