-- =============================================================================
-- CRC — Booking e-Agreement timers (run in the SQL Editor after security/24 and after deploying agreement-notify)
-- =============================================================================
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Every 5 minutes: expire agreements past their date, release holds past their deadline (never one whose advance
-- Finance has verified), mark unpaid advance requests LATE, offer freed cars to the waiting list. Runs inside the
-- database — no web call, no secret.
select cron.unschedule(jobid) from cron.job where jobname = 'crc-eagreement-expiry';
select cron.schedule('crc-eagreement-expiry', '*/5 * * * *', $$ select private.eag_expire_due(); $$);

-- Every 15 minutes: SMS reminders before the agreement / advance deadlines (eagreement_policy.reminders,
-- e.g. {"agreement":[24,2],"advance":[6]} = hours before). Replace <PROJECT_REF> and <CRON_SECRET>.
-- Leave this one out until Brian has approved the reminder times and wording.
select cron.unschedule(jobid) from cron.job where jobname = 'crc-eagreement-reminders';
select cron.schedule('crc-eagreement-reminders', '*/15 * * * *', $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/agreement-notify?run=reminders&key=<CRON_SECRET>',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body    := '{}'::jsonb);
$$);

-- Check / remove:  select * from cron.job;   select * from cron.job_run_details order by start_time desc limit 20;
--                  select cron.unschedule('crc-eagreement-expiry');  select cron.unschedule('crc-eagreement-reminders');
