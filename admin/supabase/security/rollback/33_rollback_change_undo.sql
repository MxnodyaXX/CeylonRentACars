-- Undo 33_change_undo.sql: stops logging changes and removes the Undo function.
-- The change_log table is KEPT (it holds the history so far). To delete it too, also run:
--   drop table if exists public.change_log;
do $$
declare r record;
begin
  for r in select event_object_table as t from information_schema.triggers
           where trigger_schema = 'public' and trigger_name = 'change_log' group by event_object_table loop
    execute format('drop trigger if exists change_log on public.%I', r.t);
  end loop;
end $$;
drop function if exists public.undo_change(bigint, boolean);
drop function if exists private.log_change();
drop function if exists private.change_key(text);
drop function if exists private.change_actor();
notify pgrst, 'reload schema';
