-- =============================================================================
-- EMRAC — schedule the daily SMS reminder run (pickup / return / overdue / summary)
-- Run this in the Supabase SQL Editor AFTER deploying the send-reminders function.
-- =============================================================================

-- Enable the scheduler + HTTP extensions (one-time).
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Replace <PROJECT_REF> and <CRON_SECRET> with your values.
-- 03:00 UTC = 08:30 Sri Lanka time (a sensible, non-quiet-hours send window).
select cron.schedule(
  'emrac-daily-sms',
  '0 3 * * *',
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/send-reminders?key=<CRON_SECRET>',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);

-- To inspect or remove later:
--   select * from cron.job;
--   select cron.unschedule('emrac-daily-sms');
