-- =====================================================================
-- 10 · MILEAGE ON EVERY BREAKDOWN SWAP (needs 08_breakdown_swaps.sql)
--
-- The final bill counts the km of every car the customer drove. For that, each breakdown swap
-- must carry its odometer readings:
--
--   handed over   replacement_odometer_out   (+ original_odometer: the booked car at the breakdown)
--   collected     replacement_odometer_in    (+ original_odometer_back when the booked car goes back)
--
-- This file
--   • allows outcome 'replaced': the replacement is changed for another fleet car (it broke down
--     too, or a better car came free) — the next swap row continues the same breakdown
--   • refuses NEW swaps / closings without those readings, and readings that go backwards
--   • never touches existing rows: older swaps with missing readings stay as they are and are
--     filled in from the app (Breakdown → Replacement, or the booking's Vehicle tab)
--
-- Safe to re-run. Undo: rollback/10_rollback_swap_mileage.sql
-- =====================================================================

-- 1 · the new outcome
alter table public.breakdown_vehicle_swaps drop constraint if exists breakdown_vehicle_swaps_outcome_check;
alter table public.breakdown_vehicle_swaps add constraint breakdown_vehicle_swaps_outcome_check
  check (outcome in ('swapped_back', 'customer_kept', 'replaced'));

-- 2 · readings required from now on (checked when a row is created or closed, so old rows still save)
create or replace function private.bd_swap_readings() returns trigger
language plpgsql set search_path = '' as $$
declare
  after_replaced boolean;
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
  if new.replacement_odometer_in < new.replacement_odometer_out then
    raise exception 'The replacement''s reading when collected is lower than when it was handed over.';
  end if;
  if new.original_odometer_back < new.original_odometer then
    raise exception 'The booked car''s reading going back to the customer is lower than at the breakdown.';
  end if;
  return new;
end $$;
drop trigger if exists bd_swap_readings on public.breakdown_vehicle_swaps;
create trigger bd_swap_readings before insert or update on public.breakdown_vehicle_swaps
  for each row execute function private.bd_swap_readings();

notify pgrst, 'reload schema';

-- 3 · what is still missing on older swaps (read-only — fill these in from the app)
select s.id, i.ref as breakdown, b.id as booking, s.status, s.outcome,
       s.original_odometer is null as no_original_at_breakdown,
       s.replacement_odometer_out is null as no_replacement_out,
       (s.status = 'closed' and s.replacement_odometer_in is null) as no_replacement_in,
       (s.outcome = 'swapped_back' and s.original_odometer_back is null) as no_original_back
from public.breakdown_vehicle_swaps s
join public.breakdown_incidents i on i.id = s.incident_id
join public.bookings b on b.id = s.booking_id
where s.replacement_odometer_out is null or s.original_odometer is null
   or (s.status = 'closed' and s.replacement_odometer_in is null)
   or (s.outcome = 'swapped_back' and s.original_odometer_back is null)
order by s.out_at;
