-- =====================================================================
-- ROLLBACK for 01_scoped_access.sql — WITHOUT switching security off.
-- Use only if owner-scoped rules break something urgent. Afterwards:
--   • row-level security stays ON, website visitors still get no table access;
--   • any signed-in admin OR owner gets full access to every table (the broader
--     rule from before), so owners could again see each other's data;
--   • owner field protection triggers are removed.
-- Fix the problem, then run 01_scoped_access.sql again.
-- =====================================================================

do $$
declare t record; p record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t.tablename loop
      execute format('drop policy %I on public.%I', p.policyname, t.tablename);
    end loop;
    execute format('alter table public.%I enable row level security', t.tablename);   -- stays on
    execute format(
      'create policy staff_all on public.%I for all to authenticated using (private.jwt_role() in (''admin'', ''owner'')) with check (private.jwt_role() in (''admin'', ''owner''))',
      t.tablename);
  end loop;
end $$;

do $$
begin
  if to_regclass('public.owners') is not null then drop trigger if exists protect_owner_fields on public.owners; end if;
  if to_regclass('public.vehicles') is not null then drop trigger if exists protect_owner_fields on public.vehicles; end if;
  if to_regclass('public.commissions') is not null then drop trigger if exists protect_owner_fields on public.commissions; end if;
end $$;

-- Storage: back to "any staff" for the three buckets (receipts / booking-files stay private)
do $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'storage' and tablename = 'objects' loop
    execute format('drop policy %I on storage.objects', p.policyname);
  end loop;
end $$;
create policy staff_files_all on storage.objects for all to authenticated
  using (bucket_id in ('vehicle-images', 'booking-files', 'receipts') and private.jwt_role() in ('admin', 'owner'))
  with check (bucket_id in ('vehicle-images', 'booking-files', 'receipts') and private.jwt_role() in ('admin', 'owner'));

notify pgrst, 'reload schema';
