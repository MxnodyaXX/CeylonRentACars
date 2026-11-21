-- Undo 27_ready_by_team.sql: only an admin can mark a vehicle as ready again.
-- 27 only replaced one function, so the undo is to run 07_breakdown_holds.sql again (safe to re-run) —
-- it puts back its admin-only version of public.breakdown_mark_vehicle_ready.
select 'Now run 07_breakdown_holds.sql again to finish undoing 27.' as next_step;
