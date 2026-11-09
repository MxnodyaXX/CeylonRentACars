-- Undo 15_vehicle_delete_guard.sql — vehicles can be deleted again whatever their bookings.
drop trigger if exists guard_vehicle_delete on public.vehicles;
drop function if exists private.guard_vehicle_delete();
