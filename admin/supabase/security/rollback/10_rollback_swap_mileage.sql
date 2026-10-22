-- Undo 10_swap_mileage.sql: readings are no longer required by the database (the readings already
-- saved stay). The 'replaced' outcome is removed only if no swap uses it — otherwise this stops,
-- because those rows would break the old rule.
drop trigger if exists bd_swap_readings on public.breakdown_vehicle_swaps;
drop function if exists private.bd_swap_readings();

do $$
begin
  if exists (select 1 from public.breakdown_vehicle_swaps where outcome = 'replaced') then
    raise exception 'Some swaps were changed for another car (outcome replaced) — keep 10, or update those rows first.';
  end if;
  alter table public.breakdown_vehicle_swaps drop constraint if exists breakdown_vehicle_swaps_outcome_check;
  alter table public.breakdown_vehicle_swaps add constraint breakdown_vehicle_swaps_outcome_check
    check (outcome in ('swapped_back', 'customer_kept'));
end $$;

notify pgrst, 'reload schema';
