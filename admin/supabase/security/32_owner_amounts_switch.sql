-- =============================================================================
-- 32 · Settings → "Show rental amounts to owners" — enforced in the database
-- Run after 31. Safe to re-run. Undo: rollback/32_rollback_owner_amounts_switch.sql
-- If 31_owner_privacy.sql is ever run again, run this file again after it.
--
-- The switch lives in app_settings ('owner_amounts' → {"show": true|false}); only an admin can change it
-- (owners and the team can only read app_settings). Missing row → shown, as before.
--
-- When it is OFF, an owner login is "payouts only":
--   commissions   their payout lines come from public.owner_commissions(): what they're paid (owner_payout),
--                 the status and the note — not the rental total, the rate or the company commission.
--   bookings, handovers, booking files, expenses — none: nothing to read, nothing to change.
--   (their cars, payout statements, notifications and settings stay as they are)
-- The money helpers below (owner_money_hidden …) also cover a fixed-amount car (31) while it's ON.
-- Turning it back ON gives everything back at once: nothing is deleted or changed.
-- =============================================================================

insert into public.app_settings (key, value) values ('owner_amounts', '{"show": true}'::jsonb) on conflict (key) do nothing;

-- ── the switch ──────────────────────────────────────────────────────────────
create or replace function private.owner_amounts_shown() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select (value ->> 'show')::boolean from public.app_settings where key = 'owner_amounts'), true)
$$;

-- an owner may not see this booking's amounts: a fixed-amount car (31), or amounts switched off
create or replace function private.owner_money_hidden(p_vehicle_id text, p_start_date text) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.fixed_on(p_vehicle_id, private.day_of(p_start_date)) or not private.owner_amounts_shown()
$$;

-- ── bookings (31's helpers, now with the switch) ────────────────────────────
create or replace function private.owner_full_booking(p_id text) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.owner_id() is not null and exists (
    select 1 from public.bookings b
    where b.id = p_id and private.owner_own_customer(b.entered_by_owner, b.referral)
      and not private.owner_money_hidden(b.vehicle_id, b.start_date))
$$;

create or replace function private.owner_view(b public.bookings) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare j jsonb := to_jsonb(b);
begin
  if not private.owner_own_customer(b.entered_by_owner, b.referral) then
    j := j || jsonb_build_object('customer_name', private.mask_name(b.customer_name), 'customer_phone', '',
      'customer_email', null, 'customer_nic', null, 'customer_info', null, 'documents', null, 'agreement', null,
      'activity', null, 'notes', null, 'internal_notes', null);
  end if;
  if private.owner_money_hidden(b.vehicle_id, b.start_date) then
    j := j || jsonb_build_object('total_amount', 0, 'paid_amount', 0, 'advance_amount', null, 'estimated_amount', null,
      'extra_charges', null, 'discount', null, 'payments', null, 'charges', null, 'credit_amount', null, 'bad_debt', null,
      'unit_rate', null, 'standard_rate', null, 'part_day_amount', null, 'quotation', null, 'payout_adjustments', null,
      'referral_fee', null, 'deposit_amount', null, 'deposit_returned', null, 'deposit_deduction', null,
      'company_share_type', null, 'company_share_value', null, 'company_share_min', null,
      'company_km_rate', null, 'company_km_km', null, 'company_km_charge', null);
  end if;
  return j;
end $$;

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
  if private.owner_money_hidden(b.vehicle_id, b.start_date) then patch := patch - money; end if;

  select string_agg(format('%I = r.%I', c.column_name, c.column_name), ', ') into cols
  from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = 'bookings' and patch ? c.column_name;
  if cols is null then return; end if;
  execute format('update public.bookings t set %s from (select ($2::public.bookings).*) r where t.id = $1', cols)
    using p_id, jsonb_populate_record(b, to_jsonb(b) || patch);
end $$;
revoke all on function public.owner_update_booking(text, jsonb) from public, anon;
grant execute on function public.owner_update_booking(text, jsonb) to authenticated;

-- ── commissions: switched off → payouts only, through owner_commissions() ───
drop policy if exists owner_select on public.commissions;
create policy owner_select on public.commissions for select to authenticated
  using ((owner_id = private.owner_id() or private.owns_vehicle(vehicle_id) or private.sees_booking(booking_id))
         and not private.fixed_booking(booking_id) and private.owner_amounts_shown());

create or replace function public.owner_commissions() returns setof jsonb
language sql stable security definer set search_path = '' as $$
  select to_jsonb(c) || jsonb_build_object('total_income', 0, 'commission_rate', 0, 'commission_amount', 0)
  from public.commissions c
  where private.owner_id() is not null and not private.owner_amounts_shown()
    and (c.owner_id = private.owner_id() or private.owns_vehicle(c.vehicle_id) or private.sees_booking(c.booking_id))
    and not private.fixed_booking(c.booking_id)
$$;
revoke all on function public.owner_commissions() from public, anon;
grant execute on function public.owner_commissions() to authenticated;

-- ── payouts only: no bookings, handovers, booking files or expenses ─────────
-- (the bookings table already gives them nothing: owner_full_booking() is false while it's off)
create or replace function public.owner_bookings() returns setof jsonb
language sql stable security definer set search_path = '' as $$
  select private.owner_view(b) from public.bookings b
  where private.owner_id() is not null and private.owner_amounts_shown()
    and private.sees_booking(b.id) and not private.owner_full_booking(b.id)
$$;
revoke all on function public.owner_bookings() from public, anon;
grant execute on function public.owner_bookings() to authenticated;

-- stop owner changes to bookings while it's off
create or replace function private.owner_portal_open() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.owner_id() is null or private.owner_amounts_shown()
$$;

create or replace function private.owner_update_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not private.owner_portal_open() then raise exception 'Bookings are not open to owner logins.'; end if;
  return coalesce(new, old);
end $$;
drop trigger if exists owner_portal_guard on public.bookings;
create trigger owner_portal_guard before insert or update on public.bookings
  for each row execute function private.owner_update_guard();

do $$ begin
  if to_regclass('public.handovers') is not null then
    drop policy if exists owner_select on public.handovers;
    drop policy if exists owner_insert on public.handovers;
    drop policy if exists owner_update on public.handovers;
    create policy owner_select on public.handovers for select to authenticated
      using (private.owns_vehicle(vehicle_id) and private.owner_amounts_shown());
    create policy owner_insert on public.handovers for insert to authenticated
      with check (private.owns_vehicle(vehicle_id) and private.owner_amounts_shown());
    create policy owner_update on public.handovers for update to authenticated
      using (private.owns_vehicle(vehicle_id) and private.owner_amounts_shown())
      with check (private.owns_vehicle(vehicle_id) and private.owner_amounts_shown());
  end if;
  if to_regclass('public.expenses') is not null then
    drop policy if exists owner_all on public.expenses;
    create policy owner_all on public.expenses for all to authenticated
      using (private.owns_vehicle(vehicle_id) and private.owner_amounts_shown())
      with check (private.owns_vehicle(vehicle_id) and private.owner_amounts_shown());
  end if;
end $$;

-- booking files (handover photos): none while it's off
create or replace function private.owner_sees_file(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.owner_id() is not null and private.owner_amounts_shown() and exists (
    select 1 from public.bookings b
    where b.id = (storage.foldername(p_name))[1] and private.owns_vehicle(b.vehicle_id)
      and (private.owner_own_customer(b.entered_by_owner, b.referral)
           or position(p_name in coalesce(b.checklists::text, '') || coalesce(b.exchanges::text, '')) > 0))
$$;

revoke all on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated;

notify pgrst, 'reload schema';
