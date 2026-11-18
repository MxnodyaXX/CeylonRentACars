-- Undo 24_eagreement_delivery.sql — removes the delivery / PDF / reminder functions. Records and stored PDFs are KEPT
-- (the 'agreements' bucket stays; it is private). Also remove the timers: see ../../eagreement-cron.sql (cron.unschedule).
drop function if exists public.eag_agreement_contact(uuid);
drop function if exists public.eag_log_delivery(uuid, text, boolean, text, text, jsonb);
drop function if exists public.eag_deliveries(uuid);
drop function if exists public.eag_pdf_source(text, uuid);
drop function if exists public.eag_attach_pdf(uuid, text, text);
drop function if exists public.eag_due_reminders();
notify pgrst, 'reload schema';
