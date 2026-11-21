-- Undo 29_owner_share_terms.sql: cars go back to the company default commission for new bookings.
-- Bookings already made keep the commission saved on them.
drop trigger if exists guard_owner_share on public.vehicles;
drop function if exists private.guard_owner_share();
alter table public.vehicles drop constraint if exists vehicles_owner_share_check;
alter table public.vehicles drop column if exists owner_share;

notify pgrst, 'reload schema';
