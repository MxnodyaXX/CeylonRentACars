-- Undo 28_personal_bookings.sql: personal bookings count as company bookings again
-- (their money goes back into the accounts, revenue and owner payouts — check them first).
drop trigger if exists guard_personal_booking on public.bookings;
drop function if exists private.guard_personal_booking();
alter table public.bookings drop column if exists personal;

notify pgrst, 'reload schema';
