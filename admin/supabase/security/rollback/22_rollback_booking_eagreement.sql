-- Undo 22_booking_eagreement.sql — removes the booking gate, the double-booking guard and the helper
-- functions. The esign schema and every record in it (quotation versions, holds, agreements, acceptance
-- evidence, events, payments) are KEPT, so no legal history is lost. bookings.occupies is kept too.
-- To remove the records as well (only if nothing was ever sent to a customer):
--   drop schema esign cascade;  alter table public.bookings drop column occupies;
--   delete from public.app_settings where key = 'eagreement_policy';
drop trigger if exists zz_esign_booking_guard on public.bookings;
alter table public.bookings drop constraint if exists bookings_no_double_booking;
drop index if exists public.bookings_occupies;
drop function if exists public.eagreement_booking_overlaps();
drop trigger if exists hold_vs_bookings on esign.priority_holds;
drop function if exists private.esign_booking_guard();
drop function if exists private.esign_hold_guard();
notify pgrst, 'reload schema';
