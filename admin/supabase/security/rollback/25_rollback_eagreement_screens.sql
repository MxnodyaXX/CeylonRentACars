-- Undo 25_eagreement_screens.sql — removes the helper functions the screens use. No records are touched.
drop function if exists public.my_agreement_link(text);
drop function if exists public.eag_templates();
drop function if exists public.eag_exceptions();
drop function if exists public.eag_open_requests();
drop function if exists public.eag_recent(int);
drop function if exists public.eag_save_policy(jsonb);
notify pgrst, 'reload schema';
drop function if exists public.eag_accounts();
