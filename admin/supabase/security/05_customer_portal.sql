-- =====================================================================
-- 05 · CUSTOMER PORTAL (website → "My bookings")
-- Customers sign in with their phone number + an SMS code (Supabase Auth phone login; the code
-- is delivered through Text.lk by the Edge Function portal-sms). They get NO table access —
-- row-level security from 01 still gives a non-staff login nothing. Instead they call:
--   my_profile()   → their name, email and "customer since" (from their bookings / requests)
--   my_bookings()  → their bookings (car, photo, dates, places, status, amounts, payments) — no staff notes
--   my_requests()  → their website booking requests and where each one stands
-- "Their" = the phone number they proved with the SMS code matches the booking / request phone.
-- The two portal_* functions are for the Edge Functions only (who may get a code, SMS limits).
-- Needs private.allow() from 02. Safe to re-run. Undo: rollback/05_rollback_customer_portal.sql
-- =====================================================================

-- Mid-trip vehicle exchanges (also in fix-missing-columns.sql) — needed by my_bookings below
alter table public.bookings add column if not exists exchanges jsonb;

-- One form for every way a phone gets typed: 077 123 4567 / +94771234567 / 0094 77… → 94771234567
create or replace function private.phone_key(p text) returns text
language sql immutable set search_path = '' as $$
  select case
    when d like '00%'                       then substr(d, 3)
    when length(d) = 10 and d like '0%'     then '94' || substr(d, 2)
    when length(d) = 9  and d like '7%'     then '94' || d
    else d end
  from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) x
$$;

-- The signed-in customer's verified phone (from their login), or null (visitor / staff / no phone)
create or replace function private.customer_phone() returns text
language sql stable set search_path = '' as $$
  select case
    when coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') in ('admin', 'owner') then null
    when length(private.phone_key(auth.jwt() ->> 'phone')) between 9 and 15 then private.phone_key(auth.jwt() ->> 'phone')
    else null end
$$;
revoke all on function private.phone_key(text) from public, anon, authenticated;
revoke all on function private.customer_phone() from public, anon, authenticated;

-- ── What a customer sees ─────────────────────────────────────────────────────
drop function if exists public.my_profile();
create function public.my_profile() returns table (name text, email text, customer_since text, phone text)
language sql stable security definer set search_path = '' as $$
  with me as (select private.customer_phone() as p),
  names as (
    select c.name, c.email, c.created_at as at, 1 as rank from public.customers c, me where private.phone_key(c.phone) = me.p
    union all
    select b.customer_name, b.customer_email, b.created_at, 2 from public.bookings b, me where private.phone_key(b.customer_phone) = me.p
    union all
    select i.customer_name, null, i.created_at, 3 from public.inquiries i, me where private.phone_key(i.customer_phone) = me.p
  )
  select (select n.name from names n where nullif(trim(n.name), '') is not null order by n.rank, n.at desc limit 1),
         (select n.email from names n where nullif(trim(n.email), '') is not null order by n.rank, n.at desc limit 1),
         (select min(n.at) from names n),
         (select '+' || me.p from me)
  from me where me.p is not null
$$;

drop function if exists public.my_bookings();
create function public.my_bookings() returns table (
  id text, reference text, vehicle_id text, vehicle text, vehicle_number text, image_url text,
  start_date text, end_date text, start_time text, end_time text, total_days int, rental_type text,
  status text, total_amount numeric, paid_amount numeric, balance numeric, deposit_amount numeric,
  pickup_location text, drop_location text, payments jsonb, vehicle_changes jsonb, created_at text
)
language sql stable security definer set search_path = '' as $$
  select b.id,
         'MRAC-' || upper(left(b.id, 8)),                       -- same reference as the receipt
         b.vehicle_id,
         nullif(trim(coalesce(v.brand, '') || ' ' || coalesce(v.model, '')), ''),
         v.vehicle_number,
         coalesce(v.photo_urls ->> 0, v.hero_image_url, v.image_url),   -- same cover photo as the website
         b.start_date, b.end_date, b.start_time, b.end_time, b.total_days, b.rental_type,
         b.status, b.total_amount, b.paid_amount,
         greatest(0, coalesce(b.total_amount, 0) - coalesce(b.paid_amount, 0)),
         b.deposit_amount,
         b.pickup_location, b.drop_location,
         -- the payment ledger without staff fields (who entered it, internal notes)
         coalesce((select jsonb_agg(jsonb_build_object(
                     'at', p ->> 'at', 'kind', p ->> 'kind', 'amount', (p ->> 'amount')::numeric,
                     'method', p ->> 'method', 'receipt_no', p ->> 'receiptNo') order by p ->> 'at')
                   from jsonb_array_elements(case when jsonb_typeof(b.payments) = 'array' then b.payments else '[]'::jsonb end) p),
                  '[]'::jsonb),
         -- cars exchanged mid-trip: only which car and when (no payouts, damage costs or staff notes)
         coalesce((select jsonb_agg(jsonb_build_object(
                     'at', e ->> 'at',
                     'from', (select trim(coalesce(f.brand, '') || ' ' || coalesce(f.model, '')) from public.vehicles f where f.id = e ->> 'fromVehicleId'),
                     'to', (select trim(coalesce(t.brand, '') || ' ' || coalesce(t.model, '')) from public.vehicles t where t.id = e ->> 'toVehicleId'),
                     'to_number', (select t.vehicle_number from public.vehicles t where t.id = e ->> 'toVehicleId')) order by e ->> 'at')
                   from jsonb_array_elements(case when jsonb_typeof(b.exchanges) = 'array' then b.exchanges else '[]'::jsonb end) e),
                  '[]'::jsonb),
         b.created_at
  from public.bookings b
  left join public.vehicles v on v.id = b.vehicle_id
  left join public.customers c on c.id = b.customer_id
  where private.customer_phone() is not null
    and (private.phone_key(b.customer_phone) = private.customer_phone()
         or private.phone_key(c.phone) = private.customer_phone())
  order by b.start_date desc, b.created_at desc
$$;

drop function if exists public.my_requests();
create function public.my_requests() returns table (
  id text, reference text, vehicle text, start_date text, end_date text, status text, stage text, created_at text
)
language sql stable security definer set search_path = '' as $$
  select i.id,
         substring(i.notes from 'CRC-[A-Z0-9]+'),
         i.requested_vehicle, i.start_date, i.end_date, i.status, i.stage, i.created_at
  from public.inquiries i
  where private.customer_phone() is not null
    and private.phone_key(i.customer_phone) = private.customer_phone()
  order by i.created_at desc
  limit 50
$$;

revoke all on function public.my_profile() from public, anon;
grant execute on function public.my_profile() to authenticated;
revoke all on function public.my_bookings() from public, anon;
revoke all on function public.my_requests() from public, anon;
grant execute on function public.my_bookings() to authenticated;
grant execute on function public.my_requests() to authenticated;

-- ── For the Edge Functions only ──────────────────────────────────────────────
-- portal-login: may this number get a code? 'ok' | 'invalid' | 'limited' | 'unknown'.
-- Limits are counted BEFORE the lookup, so nobody can test thousands of numbers.
create or replace function public.portal_phone_status(p_phone text, p_ip text) returns text
language plpgsql security definer set search_path = '' as $$
declare v_key text := private.phone_key(p_phone);
begin
  if length(v_key) not between 9 and 15 then return 'invalid'; end if;
  if not private.allow('portal:ip:' || coalesce(nullif(left(trim(coalesce(p_ip, '')), 64), ''), 'unknown'), 10, interval '1 hour')
     or not private.allow('portal:phone:' || v_key, 5, interval '1 hour') then
    return 'limited';
  end if;
  if exists (select 1 from public.bookings b where private.phone_key(b.customer_phone) = v_key)
     or exists (select 1 from public.customers c where private.phone_key(c.phone) = v_key)
     or exists (select 1 from public.inquiries i where private.phone_key(i.customer_phone) = v_key) then
    return 'ok';
  end if;
  return 'unknown';
end $$;

-- portal-sms (the Auth "Send SMS" hook): at most 8 codes a day per number, whoever asks
create or replace function public.portal_sms_allow(p_phone text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  return private.allow('portal:sms:' || private.phone_key(p_phone), 8, interval '1 day');
end $$;

revoke all on function public.portal_phone_status(text, text) from public, anon, authenticated;
revoke all on function public.portal_sms_allow(text) from public, anon, authenticated;
grant execute on function public.portal_phone_status(text, text) to service_role;
grant execute on function public.portal_sms_allow(text) to service_role;

notify pgrst, 'reload schema';
