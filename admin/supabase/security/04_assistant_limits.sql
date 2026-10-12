-- =====================================================================
-- 04 · LIMITS FOR THE WEBSITE AI CHAT (vehicle-assistant)
-- Every chat message costs money (Claude API). The function's own limit lived in memory and
-- reset whenever Supabase restarted it; these limits live in the database instead:
--   • 25 messages per 10 minutes per visitor   (a real customer never gets near this)
--   • 80 messages per day per visitor
--   • 1500 messages per day for the whole website — hard ceiling on the daily AI bill
-- Only the vehicle-assistant function (service role) may call it — website visitors can't.
-- Needs private.allow() from 02_public_functions.sql. Safe to re-run.
-- Reversible: rollback/04_rollback_assistant_limits.sql
-- =====================================================================

create or replace function public.assistant_allow(p_ip text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_ip text := coalesce(nullif(left(trim(coalesce(p_ip, '')), 64), ''), 'unknown');
begin
  -- checked in this order, so a visitor who is already over their limit doesn't use up the site-wide one
  return private.allow('assistant:ip:' || v_ip, 25, interval '10 minutes')
     and private.allow('assistant:ipday:' || v_ip, 80, interval '1 day')
     and private.allow('assistant:all', 1500, interval '1 day');
end $$;

revoke all on function public.assistant_allow(text) from public, anon, authenticated;
grant execute on function public.assistant_allow(text) to service_role;

notify pgrst, 'reload schema';
