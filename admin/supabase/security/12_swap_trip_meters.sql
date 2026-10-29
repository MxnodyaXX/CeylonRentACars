-- =====================================================================
-- 12 · READINGS FROM TRIP METERS (needs 08_breakdown_swaps.sql and 10_swap_mileage.sql)
--
-- A dashboard has the main odometer (ODO) and trip meters (Trip A / B / C) that the driver can
-- reset. Sometimes the only reading in the records is a trip meter — e.g. 24,708 km on Trip A at
-- the breakdown and 559 km on Trip B when the car went back to the customer. Those two can't be
-- compared, so the app records which meter each reading came from:
--
--   breakdown_vehicle_swaps.meters  {"originalOdometer": "A", "originalOdometerBack": "B"}
--   (a reading not listed is from the main odometer)
--
-- This file
--   • adds the meters column (only the values odo / A / B / C, only the four reading names)
--   • replaces the 10 rule "a reading can't go backwards" so it only compares readings taken
--     from the SAME meter — everything else in 10 stays the same
--
-- Pickup / return readings keep their meter in bookings.checklists (pickup.meter / return.meter,
-- jsonb) — nothing to change in the database for those.
--
-- Safe to re-run. Undo: rollback/12_rollback_swap_trip_meters.sql
-- =====================================================================

-- 1 · the column
alter table public.breakdown_vehicle_swaps add column if not exists meters jsonb;

create or replace function private.valid_swap_meters(m jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select m is null or (jsonb_typeof(m) = 'object' and not exists (
    select 1 from jsonb_each_text(m) e
     where e.key not in ('originalOdometer', 'replacementOdometerOut', 'replacementOdometerIn', 'originalOdometerBack')
        or e.value not in ('odo', 'A', 'B', 'C')))
$$;
alter table public.breakdown_vehicle_swaps drop constraint if exists breakdown_vehicle_swaps_meters_check;
alter table public.breakdown_vehicle_swaps add constraint breakdown_vehicle_swaps_meters_check check (private.valid_swap_meters(meters));

-- 2 · readings required (as in 10); "lower than" only between readings of the same meter
create or replace function private.bd_swap_readings() returns trigger
language plpgsql set search_path = '' as $$
declare
  after_replaced boolean;
  m_orig     text := coalesce(new.meters ->> 'originalOdometer', 'odo');
  m_out      text := coalesce(new.meters ->> 'replacementOdometerOut', 'odo');
  m_in       text := coalesce(new.meters ->> 'replacementOdometerIn', 'odo');
  m_back     text := coalesce(new.meters ->> 'originalOdometerBack', 'odo');
begin
  if tg_op = 'INSERT' then
    if new.replacement_odometer_out is null then
      raise exception 'Enter the odometer of the replacement as it goes to the customer.';
    end if;
    -- the booked car's reading is needed unless it is already at the garage (the previous swap was "replaced")
    select p.outcome = 'replaced' into after_replaced
      from public.breakdown_vehicle_swaps p
     where p.booking_id = new.booking_id and p.status = 'closed'
     order by p.back_at desc limit 1;
    if new.original_odometer is null and not coalesce(after_replaced, false) then
      raise exception 'Enter the odometer of the booked car at the breakdown.';
    end if;
  elsif old.status = 'active' and new.status = 'closed' then
    if new.replacement_odometer_in is null then
      raise exception 'Enter the odometer of the replacement as it comes back from the customer.';
    end if;
    if new.outcome = 'swapped_back' and new.original_odometer_back is null then
      raise exception 'Enter the odometer of the booked car as it goes back to the customer.';
    end if;
  end if;

  if tg_op = 'UPDATE' and (
       (old.original_odometer is not null and new.original_odometer is null)
    or (old.replacement_odometer_out is not null and new.replacement_odometer_out is null)
    or (old.replacement_odometer_in is not null and new.replacement_odometer_in is null)
    or (old.original_odometer_back is not null and new.original_odometer_back is null)) then
    raise exception 'An odometer reading of a vehicle swap cannot be removed.';
  end if;
  if m_in = m_out and new.replacement_odometer_in < new.replacement_odometer_out then
    raise exception 'The replacement''s reading when collected is lower than when it was handed over.';
  end if;
  if m_back = m_orig and new.original_odometer_back < new.original_odometer then
    raise exception 'The booked car''s reading going back to the customer is lower than at the breakdown.';
  end if;
  return new;
end $$;
drop trigger if exists bd_swap_readings on public.breakdown_vehicle_swaps;
create trigger bd_swap_readings before insert or update on public.breakdown_vehicle_swaps
  for each row execute function private.bd_swap_readings();

notify pgrst, 'reload schema';

-- 3 · check (read-only): swaps with a reading from a trip meter
select s.id, i.ref as breakdown, s.meters,
       s.original_odometer, s.replacement_odometer_out, s.replacement_odometer_in, s.original_odometer_back
from public.breakdown_vehicle_swaps s
join public.breakdown_incidents i on i.id = s.incident_id
where s.meters is not null and s.meters <> '{}'::jsonb
order by s.out_at;
