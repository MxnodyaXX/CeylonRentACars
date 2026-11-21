-- =============================================================================
-- 31 · What an owner's login can read — enforced in the database
-- Run after 01, 21, 28 and 30. Safe to re-run. Undo: rollback/31_rollback_owner_privacy.sql
-- If 01_scoped_access.sql is ever run again, run this file again after it (01 puts its wider owner rules back).
--
-- The admin app already shows owners the company's customers as first name + initials, and no amounts for
-- fixed-amount cars. Without this file the raw rows could still be read with the browser's developer tools.
--
--   bookings      an owner reads the full row only for their OWN customers (entered by them, or referred by them)
--                 on a car that is not on fixed terms. Every other booking on their car comes from
--                 public.owner_bookings(): the customer as first name + initials, no phone / e-mail / NIC /
--                 details / documents / agreement / notes / history — and on a fixed-amount car no amounts.
--                 Their changes (handovers, status …) go through public.owner_update_booking(), which can't
--                 touch what they can't see; history entries they add are appended, never replacing.
--   customers     only their own customers.
--   commissions   not the lines of fixed-amount bookings.
--   inquiries     none (the Customers / Inquiries / Messages pages are never an owner's).
--   files         booking files: the handover photos only (not ID documents), except their own customers'.
-- =============================================================================

-- ── helpers ─────────────────────────────────────────────────────────────────
-- the date a booking starts (start_date is text) — null when unreadable
create or replace function private.day_of(p text) returns date
language sql immutable set search_path = '' as $$
  select case when p ~ '^\d{4}-\d{2}-\d{2}' then left(p, 10)::date end
$$;

-- the car is on fixed terms (21) on that day
create or replace function private.fixed_on(p_vehicle_id text, p_day date) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_day is not null and exists (
    select 1 from public.vehicles v
    where v.id = p_vehicle_id and v.owner_terms ->> 'type' = 'fixed'
      and private.day_of(v.owner_terms ->> 'start') <= p_day
      and (coalesce(v.owner_terms ->> 'end', '') = '' or private.day_of(v.owner_terms ->> 'end') >= p_day))
$$;

-- one of the signed-in owner's own customers: they entered the booking (30) or referred it
create or replace function private.owner_own_customer(p_entered_by text, p_referral text) returns boolean
language sql stable security definer set search_path = '' as $$
  -- (coalesce: a missing value must count as "no", never as unknown — unknown would skip the masking)
  select coalesce(private.owner_id() is not null and (
    p_entered_by = private.owner_id()
    or (nullif(trim(p_referral), '') is not null
        and lower(regexp_replace(trim(p_referral), '\s+', ' ', 'g')) = lower(regexp_replace(trim(private.owner_name()), '\s+', ' ', 'g')))), false)
$$;

-- may the signed-in owner read this booking's whole row?
create or replace function private.owner_full_booking(p_id text) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.owner_id() is not null and exists (
    select 1 from public.bookings b
    where b.id = p_id and private.owner_own_customer(b.entered_by_owner, b.referral)
      and not private.fixed_on(b.vehicle_id, private.day_of(b.start_date)))
$$;

-- "Dushmantha niroshan" → "Dushmantha N." · "kasun lakmal perera" → "Kasun L. P."
create or replace function private.mask_name(p text) returns text
language plpgsql immutable set search_path = '' as $$
declare w text[]; out text; x text; i int;
begin
  w := regexp_split_to_array(trim(coalesce(p, '')), '\s+');
  if coalesce(w[1], '') = '' then return 'Customer'; end if;
  out := upper(left(w[1], 1)) || substr(w[1], 2);
  for i in 2 .. coalesce(array_length(w, 1), 1) loop
    x := regexp_replace(w[i], '[^[:alnum:]]', '', 'g');
    if x <> '' then out := out || ' ' || upper(left(x, 1)) || '.'; end if;
  end loop;
  return out;
end $$;

-- a booking as the signed-in owner may see it
create or replace function private.owner_view(b public.bookings) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare j jsonb := to_jsonb(b);
begin
  if not private.owner_own_customer(b.entered_by_owner, b.referral) then
    j := j || jsonb_build_object('customer_name', private.mask_name(b.customer_name), 'customer_phone', '',
      'customer_email', null, 'customer_nic', null, 'customer_info', null, 'documents', null, 'agreement', null,
      'activity', null, 'notes', null, 'internal_notes', null);
  end if;
  if private.fixed_on(b.vehicle_id, private.day_of(b.start_date)) then
    j := j || jsonb_build_object('total_amount', 0, 'paid_amount', 0, 'advance_amount', null, 'estimated_amount', null,
      'extra_charges', null, 'discount', null, 'payments', null, 'charges', null, 'credit_amount', null, 'bad_debt', null,
      'unit_rate', null, 'standard_rate', null, 'part_day_amount', null, 'quotation', null, 'payout_adjustments', null,
      'referral_fee', null, 'deposit_amount', null, 'deposit_returned', null, 'deposit_deduction', null,
      'company_share_type', null, 'company_share_value', null, 'company_share_min', null,
      'company_km_rate', null, 'company_km_km', null, 'company_km_charge', null);
  end if;
  return j;
end $$;

-- ── bookings ────────────────────────────────────────────────────────────────
drop policy if exists owner_select on public.bookings;
create policy owner_select on public.bookings for select to authenticated
  using (private.sees_booking(id) and private.owner_full_booking(id));

-- every other booking the owner may know about, without what they mustn't see
create or replace function public.owner_bookings() returns setof jsonb
language sql stable security definer set search_path = '' as $$
  select private.owner_view(b) from public.bookings b
  where private.owner_id() is not null and private.sees_booking(b.id) and not private.owner_full_booking(b.id)
$$;
revoke all on function public.owner_bookings() from public, anon;
grant execute on function public.owner_bookings() to authenticated;

-- an owner's change to a booking on their car: only what they may change, the rest kept as it was
create or replace function public.owner_update_booking(p_id text, p_patch jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  b public.bookings; patch jsonb := coalesce(p_patch, '{}'::jsonb); cols text;
  hidden text[] := array['customer_name', 'customer_phone', 'customer_email', 'customer_nic', 'customer_info',
    'documents', 'agreement', 'notes', 'internal_notes'];
  money text[] := array['total_amount', 'paid_amount', 'advance_amount', 'estimated_amount', 'extra_charges', 'discount',
    'payments', 'charges', 'credit_amount', 'bad_debt', 'unit_rate', 'standard_rate', 'part_day_amount', 'quotation',
    'payout_adjustments', 'referral_fee', 'deposit_amount', 'deposit_returned', 'deposit_deduction', 'company_share_type',
    'company_share_value', 'company_share_min', 'company_km_rate', 'company_km_km', 'company_km_charge'];
begin
  if private.owner_id() is null then raise exception 'Only an owner login uses this.'; end if;
  select * into b from public.bookings where id = p_id for update;
  if not found or not private.owns_vehicle(b.vehicle_id) then raise exception 'Booking not found.'; end if;
  patch := patch - array['id', 'vehicle_id', 'created_at', 'personal', 'entered_by_owner', 'customer_id'];
  if not private.owner_own_customer(b.entered_by_owner, b.referral) then
    patch := patch - hidden;
    -- the history they couldn't see: what they add goes on the end of it
    if patch ? 'activity' then
      patch := jsonb_set(patch, '{activity}', coalesce(to_jsonb(b.activity), '[]'::jsonb) || coalesce(patch -> 'activity', '[]'::jsonb));
    end if;
  end if;
  if private.fixed_on(b.vehicle_id, private.day_of(b.start_date)) then patch := patch - money; end if;

  select string_agg(format('%I = r.%I', c.column_name, c.column_name), ', ') into cols
  from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = 'bookings' and patch ? c.column_name;
  if cols is null then return; end if;
  execute format('update public.bookings t set %s from (select ($2::public.bookings).*) r where t.id = $1', cols)
    using p_id, jsonb_populate_record(b, to_jsonb(b) || patch);
end $$;
revoke all on function public.owner_update_booking(text, jsonb) from public, anon;
grant execute on function public.owner_update_booking(text, jsonb) to authenticated;

-- ── customers: only their own ───────────────────────────────────────────────
create or replace function private.sees_own_customer(p_customer_id text, p_phone text) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.owner_id() is not null and exists (
    select 1 from public.bookings b join public.vehicles v on v.id = b.vehicle_id
    where (v.owner_id = private.owner_id() or b.entered_by_owner = private.owner_id())
      and private.owner_own_customer(b.entered_by_owner, b.referral)
      and (b.customer_id = p_customer_id
           or (length(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')) >= 9
               and right(regexp_replace(b.customer_phone, '\D', '', 'g'), 9) = right(regexp_replace(p_phone, '\D', '', 'g'), 9))))
$$;
drop policy if exists owner_select on public.customers;
drop policy if exists owner_update on public.customers;
create policy owner_select on public.customers for select to authenticated using (private.sees_own_customer(id, phone));
create policy owner_update on public.customers for update to authenticated
  using (private.sees_own_customer(id, phone)) with check (private.sees_own_customer(id, phone));

-- ── commissions: not the lines of fixed-amount bookings ─────────────────────
-- (a helper that reads the booking itself — the owner's own booking rules would hide it from a plain query)
create or replace function private.fixed_booking(p_booking_id text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.bookings b where b.id = p_booking_id and private.fixed_on(b.vehicle_id, private.day_of(b.start_date)))
$$;

drop policy if exists owner_select on public.commissions;
create policy owner_select on public.commissions for select to authenticated
  using ((owner_id = private.owner_id() or private.owns_vehicle(vehicle_id) or private.sees_booking(booking_id))
         and not private.fixed_booking(booking_id));

-- ── inquiries: never an owner's ─────────────────────────────────────────────
drop policy if exists owner_permitted on public.inquiries;
drop policy if exists owner_permitted on public.inquiry_followups;

-- ── booking files: handover photos only, unless it's their own customer ─────
create or replace function private.owner_sees_file(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.owner_id() is not null and exists (
    select 1 from public.bookings b
    where b.id = (storage.foldername(p_name))[1] and private.owns_vehicle(b.vehicle_id)
      and (private.owner_own_customer(b.entered_by_owner, b.referral)
           or position(p_name in coalesce(b.checklists::text, '') || coalesce(b.exchanges::text, '')) > 0))
$$;
drop policy if exists private_files_select on storage.objects;
create policy private_files_select on storage.objects for select to authenticated
  using (bucket_id in ('booking-files', 'receipts') and (private.is_admin() or private.owner_sees_file(name)));

revoke all on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated;

notify pgrst, 'reload schema';
