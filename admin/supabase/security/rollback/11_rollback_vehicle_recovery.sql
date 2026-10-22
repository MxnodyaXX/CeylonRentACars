-- Undo 11_vehicle_recovery.sql
-- Removes the view, the admin-only rule, the checks and the two database-filled columns.
-- The data stays: the recovery record (checklists), credit_amount, credit_settled, bad_debt and
-- the customers' do-not-rent flags are all left exactly as they are.

drop view if exists public.vehicle_recoveries;
drop trigger if exists protect_recovery on public.bookings;
drop function if exists private.protect_recovery();
alter table public.bookings drop constraint if exists bookings_bad_debt_not_negative;
alter table public.bookings drop constraint if exists bookings_credit_not_negative;
drop index if exists public.bookings_recovered_idx;
alter table public.bookings drop column if exists recovery_reason;
alter table public.bookings drop column if exists recovered;

notify pgrst, 'reload schema';
