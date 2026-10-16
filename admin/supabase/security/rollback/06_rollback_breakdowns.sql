-- Undo 06_breakdowns.sql. ⚠ Deletes every breakdown incident and its records — export them first
-- (Table Editor → each breakdown_* table → Export to CSV) if you want to keep them.
drop table if exists public.breakdown_documents;
drop table if exists public.breakdown_payments;
drop table if exists public.breakdown_allocations;
drop table if exists public.breakdown_expenses;
drop table if exists public.breakdown_solutions;
drop table if exists public.breakdown_events;
drop table if exists public.breakdown_incidents;
drop function if exists private.sees_incident(text);
drop function if exists private.touch_updated_at();
notify pgrst, 'reload schema';
