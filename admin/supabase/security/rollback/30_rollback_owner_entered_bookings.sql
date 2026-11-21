-- Undo 30_owner_entered_bookings.sql: owners then see their own entries masked too (as any other booking),
-- except the ones they referred.
drop trigger if exists guard_entered_by_owner on public.bookings;
drop function if exists private.guard_entered_by_owner();
alter table public.bookings drop column if exists entered_by_owner;

notify pgrst, 'reload schema';
