-- Undo 07_breakdown_holds.sql. The hold columns (history) are kept; the rules stop applying,
-- so vehicles can again be moved out of 'Maintenance' by hand.
drop function if exists public.breakdown_mark_vehicle_ready(text, text, boolean, text, timestamptz, text);
drop trigger if exists bd_keep_maintenance on public.vehicles;
drop trigger if exists bd_guard_hold on public.breakdown_incidents;
drop trigger if exists bd_place_hold on public.breakdown_incidents;
drop function if exists private.bd_keep_maintenance();
drop function if exists private.bd_guard_hold();
drop function if exists private.bd_place_hold();
drop index if exists public.breakdown_one_active_hold;
notify pgrst, 'reload schema';
