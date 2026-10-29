-- Undo 12_swap_trip_meters.sql: back to the 10 rule (readings compared whatever meter they came from).
-- The meter tags are removed (the readings themselves stay).
-- Stops if a swap has a reading from a trip meter that the old rule would refuse — fix those first.
do $$
begin
  if exists (select 1 from public.breakdown_vehicle_swaps
              where replacement_odometer_in < replacement_odometer_out or original_odometer_back < original_odometer) then
    raise exception 'Some swaps have trip-meter readings lower than the reading before them — correct them in the app, or keep 12.';
  end if;
end $$;

-- the 10 trigger (a reading can't go backwards)
create or replace function private.bd_swap_readings() returns trigger
language plpgsql set search_path = '' as $$
declare
  after_replaced boolean;
begin
  if tg_op = 'INSERT' then
    if new.replacement_odometer_out is null then
      raise exception 'Enter the odometer of the replacement as it goes to the customer.';
    end if;
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
  if new.replacement_odometer_in < new.replacement_odometer_out then
    raise exception 'The replacement''s reading when collected is lower than when it was handed over.';
  end if;
  if new.original_odometer_back < new.original_odometer then
    raise exception 'The booked car''s reading going back to the customer is lower than at the breakdown.';
  end if;
  return new;
end $$;

alter table public.breakdown_vehicle_swaps drop constraint if exists breakdown_vehicle_swaps_meters_check;
drop function if exists private.valid_swap_meters(jsonb);
alter table public.breakdown_vehicle_swaps drop column if exists meters;

notify pgrst, 'reload schema';
