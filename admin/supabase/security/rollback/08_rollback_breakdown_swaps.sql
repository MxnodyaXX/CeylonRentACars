-- Undo 08_breakdown_swaps.sql: the website calendar goes back to bookings only, and the swap
-- records are removed (export them first if you need them — this deletes the table).
create or replace view public.vehicle_busy_dates as
select vehicle_id, start_date, end_date
from public.bookings
where status in ('Confirmed', 'Ongoing') and vehicle_id is not null;
grant select on public.vehicle_busy_dates to anon, authenticated;

drop table if exists public.breakdown_vehicle_swaps;
drop function if exists private.bd_guard_swap();
notify pgrst, 'reload schema';
