-- =============================================================================
-- 15 · A vehicle with an active booking can't be deleted
-- Run after 01_scoped_access.sql. Safe to re-run. Undo: rollback/15_rollback_vehicle_delete_guard.sql
--
-- bookings.vehicle_id is "on delete set null", so deleting a car used to leave its confirmed or
-- ongoing bookings without a vehicle ("Vehicle removed" in the admin). Now the delete is refused
-- while any booking on the car is Confirmed or Ongoing. Completed and cancelled bookings still
-- keep their history (vehicle cleared) as before.
-- =============================================================================

create or replace function private.guard_vehicle_delete() returns trigger
language plpgsql set search_path = '' as $$
declare n int;
begin
  select count(*) into n from public.bookings b
  where b.vehicle_id = old.id and b.status in ('Confirmed', 'Ongoing');
  if n > 0 then
    raise exception 'This vehicle has % confirmed or ongoing booking(s). Complete or cancel them before deleting it.', n
      using errcode = 'P0001';
  end if;
  return old;
end $$;

drop trigger if exists guard_vehicle_delete on public.vehicles;
create trigger guard_vehicle_delete before delete on public.vehicles
  for each row execute function private.guard_vehicle_delete();

-- Bookings already left without a vehicle (active ones show "Vehicle removed" in the admin).
-- The admin can delete them from Bookings → the card's "Remove" button, or review them here:
--   select id, customer_name, status, start_date, end_date from public.bookings
--   where vehicle_id is null and status in ('Confirmed', 'Ongoing');
