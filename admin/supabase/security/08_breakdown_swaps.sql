-- =====================================================================
-- 08 · BREAKDOWN VEHICLE SWAPS (needs 06_breakdowns.sql and 07_breakdown_holds.sql)
--
-- A breakdown replacement is recorded here — NOT in bookings.exchanges (that is the separate
-- "Exchange vehicle" feature). One row per replacement period:
--
--   out   the customer's broken car is collected and a replacement handed over
--         (a car from our fleet, or a partner's car)
--   back  either the repaired original goes back to the customer (swapped_back) or the trip
--         ended in the replacement (customer_kept). A fleet car returns to the fleet; a partner
--         car returns to the partner.
--
-- The booking itself stays on the original car the whole time. While a fleet replacement is out
-- it is shown as busy on the website (vehicle_busy_dates) until the end of the booking.
--
--   • at most one active swap per booking, and a fleet car can be out on only one swap
--   • a closed swap cannot be re-opened; history is never deleted
--   • owners can read the swaps of their own cars (original or replacement); only admins change them
--
-- Safe to re-run. Undo: rollback/08_rollback_breakdown_swaps.sql
-- =====================================================================

create table if not exists public.breakdown_vehicle_swaps (
  id                        text primary key,
  incident_id               text not null references public.breakdown_incidents(id) on delete restrict,
  solution_id               text not null references public.breakdown_solutions(id) on delete restrict,
  booking_id                text not null references public.bookings(id) on delete restrict,
  original_vehicle_id       text references public.vehicles(id) on delete set null,
  source                    text not null check (source in ('fleet', 'partner')),
  replacement_vehicle_id    text references public.vehicles(id) on delete set null,
  partner_name              text,
  partner_vehicle           text,
  partner_reg               text,
  status                    text not null default 'active' check (status in ('active', 'closed')),
  -- handover out
  out_at                    timestamptz not null,
  out_by                    text not null,
  out_location              text,
  original_odometer         integer check (original_odometer >= 0),
  original_fuel             text,
  replacement_odometer_out  integer check (replacement_odometer_out >= 0),
  replacement_fuel_out      text,
  replacement_rate          numeric(12, 2) check (replacement_rate >= 0),
  out_notes                 text,
  -- back
  outcome                   text check (outcome in ('swapped_back', 'customer_kept')),
  back_at                   timestamptz,
  back_by                   text,
  back_location             text,
  replacement_odometer_in   integer check (replacement_odometer_in >= 0),
  replacement_fuel_in       text,
  original_odometer_back    integer check (original_odometer_back >= 0),
  original_fuel_back        text,
  replacement_to            text,
  days                      integer check (days >= 0),
  replacement_payout        numeric(12, 2) check (replacement_payout >= 0),
  original_deduction        numeric(12, 2) check (original_deduction >= 0),
  commission_id             text,
  adjustment_id             text,
  back_notes                text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  check (source = 'partner' or replacement_vehicle_id is not null),
  check (status = 'active' or (outcome is not null and back_at is not null and back_by is not null)),
  check (back_at is null or back_at >= out_at)
);

create unique index if not exists breakdown_swaps_one_active_per_booking
  on public.breakdown_vehicle_swaps (booking_id) where status = 'active';
create unique index if not exists breakdown_swaps_one_active_per_car
  on public.breakdown_vehicle_swaps (replacement_vehicle_id) where status = 'active' and replacement_vehicle_id is not null;
create index if not exists breakdown_swaps_incident on public.breakdown_vehicle_swaps (incident_id, out_at);

drop trigger if exists touch_breakdown_vehicle_swaps on public.breakdown_vehicle_swaps;
create trigger touch_breakdown_vehicle_swaps before update on public.breakdown_vehicle_swaps
  for each row execute function private.touch_updated_at();

-- A closed swap is final: it can't be re-opened or re-pointed
create or replace function private.bd_guard_swap() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.status = 'closed' and new.status <> 'closed' then
    raise exception 'A finished vehicle swap cannot be re-opened — record a new one.';
  end if;
  if new.booking_id is distinct from old.booking_id or new.incident_id is distinct from old.incident_id
     or new.original_vehicle_id is distinct from old.original_vehicle_id
     or new.replacement_vehicle_id is distinct from old.replacement_vehicle_id or new.source is distinct from old.source then
    raise exception 'The cars and booking of a vehicle swap cannot be changed.';
  end if;
  return new;
end $$;
drop trigger if exists bd_guard_swap on public.breakdown_vehicle_swaps;
create trigger bd_guard_swap before update on public.breakdown_vehicle_swaps for each row execute function private.bd_guard_swap();

-- Access: admins everything; owners read swaps involving their cars; nobody deletes
alter table public.breakdown_vehicle_swaps enable row level security;
revoke all on public.breakdown_vehicle_swaps from anon;
grant select, insert, update on public.breakdown_vehicle_swaps to authenticated;
revoke delete on public.breakdown_vehicle_swaps from authenticated;
drop policy if exists admin_all on public.breakdown_vehicle_swaps;
create policy admin_all on public.breakdown_vehicle_swaps for all to authenticated
  using (private.is_admin()) with check (private.is_admin());
drop policy if exists owner_select on public.breakdown_vehicle_swaps;
create policy owner_select on public.breakdown_vehicle_swaps for select to authenticated
  using (private.is_owner() and (private.sees_incident(incident_id) or private.owns_vehicle(replacement_vehicle_id)));

-- Website calendar: a fleet replacement that is out is busy until the end of the booking
create or replace view public.vehicle_busy_dates as
select vehicle_id, start_date, end_date
from public.bookings
where status in ('Confirmed', 'Ongoing') and vehicle_id is not null
union all
select s.replacement_vehicle_id, to_char((s.out_at at time zone 'Asia/Colombo')::date, 'YYYY-MM-DD'), b.end_date
from public.breakdown_vehicle_swaps s
join public.bookings b on b.id = s.booking_id
where s.status = 'active' and s.source = 'fleet' and s.replacement_vehicle_id is not null
  and b.status in ('Confirmed', 'Ongoing');
grant select on public.vehicle_busy_dates to anon, authenticated;

notify pgrst, 'reload schema';
