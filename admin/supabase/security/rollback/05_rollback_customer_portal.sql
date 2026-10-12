-- Undo 05_customer_portal.sql — the "My bookings" page then shows nothing (customers can still
-- sign in, but see no data). Also switch off the Send SMS hook in Authentication → Hooks.
drop function if exists public.my_profile();
drop function if exists public.my_bookings();
drop function if exists public.my_requests();
drop function if exists public.portal_phone_status(text, text);
drop function if exists public.portal_sms_allow(text);
drop function if exists private.customer_phone();
drop function if exists private.phone_key(text);
notify pgrst, 'reload schema';
