-- =====================================================================
-- SECURITY LOCKDOWN — run ONLY after the admin app is on Supabase logins
-- (see admin/supabase/SECURITY.md, steps 1–5). Running it earlier locks the
-- old admin out of every table.
--
-- Before: row-level security was OFF on every table, so the public key that
-- ships inside the website could read and change everything (customers,
-- bookings, logins with plain-text passwords…).
--
-- After:
--   • Every table in the public schema has row-level security ON.
--   • Signed-in staff (Supabase Auth users whose app_metadata.role is
--     'admin' or 'owner' — only the server can set that) can use all tables.
--   • The public key (website visitors) can't touch any table. The website
--     keeps working: it only uses the views + functions in website.sql,
--     which run with the database owner's rights and expose safe columns.
--   • Edge Functions use the service-role key and are not affected.
--   • Storage: customer documents are staff-only; vehicle photos and
--     receipts stay publicly viewable but only staff can upload/delete.
--   • The old public.users table (plain-text passwords) is dropped once
--     every login in it has been moved to Supabase Auth.
--
-- Safe to run more than once.
-- =====================================================================

-- ── Who is staff? (role comes from the login's app_metadata) ─────────────────
create or replace function public.is_staff() returns boolean
language sql stable set search_path = public as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') in ('admin', 'owner')
$$;
create or replace function public.is_admin() returns boolean
language sql stable set search_path = public as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin'
$$;

-- ── Every table: RLS on, any old rules removed, staff-only access ────────────
do $$
declare t record; p record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    -- old rules had no effect while RLS was off; remove them so none can let the public key in
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t.tablename loop
      execute format('drop policy %I on public.%I', p.policyname, t.tablename);
    end loop;
    execute format('alter table public.%I enable row level security', t.tablename);
    execute format(
      'create policy "staff full access" on public.%I for all to authenticated using (public.is_staff()) with check (public.is_staff())',
      t.tablename);
    -- the public key gets nothing directly (views/functions below are granted separately)
    execute format('revoke all on public.%I from anon', t.tablename);
  end loop;
end $$;

-- New tables created later should also start locked: remind the owner
comment on schema public is 'RLS is required on every table — see admin/supabase/security-lockdown.sql';

-- ── Website views + functions stay available to the public key ───────────────
-- (granted again in case the revoke above touched them)
do $$
declare v text;
begin
  foreach v in array array['website_vehicles', 'popular_vehicles', 'catalog_vehicles', 'vehicle_busy_dates',
                           'public_reviews', 'public_service_reviews', 'feedback_vehicles'] loop
    if exists (select 1 from pg_views where schemaname = 'public' and viewname = v) then
      execute format('grant select on public.%I to anon, authenticated', v);
    end if;
  end loop;
end $$;

-- ── Storage ─────────────────────────────────────────────────────────────────
-- Remove every existing storage rule (several were wide open) and recreate them.
do $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'storage' and tablename = 'objects' loop
    execute format('drop policy %I on storage.objects', p.policyname);
  end loop;
end $$;

-- Customer documents & handover photos: staff only, never public
update storage.buckets set public = false where id = 'booking-files';
create policy "staff read booking files"   on storage.objects for select to authenticated using (bucket_id = 'booking-files' and public.is_staff());
create policy "staff upload booking files" on storage.objects for insert to authenticated with check (bucket_id = 'booking-files' and public.is_staff());
create policy "staff update booking files" on storage.objects for update to authenticated using (bucket_id = 'booking-files' and public.is_staff());
create policy "staff delete booking files" on storage.objects for delete to authenticated using (bucket_id = 'booking-files' and public.is_staff());

-- Vehicle photos and receipts: anyone can VIEW (public buckets serve files by URL),
-- only staff can add, replace or remove them
create policy "staff upload public files" on storage.objects for insert to authenticated
  with check (bucket_id in ('vehicle-images', 'receipts') and public.is_staff());
create policy "staff update public files" on storage.objects for update to authenticated
  using (bucket_id in ('vehicle-images', 'receipts') and public.is_staff());
create policy "staff delete public files" on storage.objects for delete to authenticated
  using (bucket_id in ('vehicle-images', 'receipts') and public.is_staff());

-- ── Old plain-text logins ───────────────────────────────────────────────────
-- Dropped only when every login in it already exists in Supabase Auth
-- (Settings → "Move old logins" in the admin does that copy).
do $$
declare missing int;
begin
  if to_regclass('public.users') is null then
    raise notice 'public.users already removed';
    return;
  end if;
  execute $q$
    select count(*) from public.users u
    where not exists (
      select 1 from auth.users a
      where lower(a.email) = lower(regexp_replace(u.username, '[^a-zA-Z0-9._-]', '', 'g')) || '@staff.ceylonrentacars.com'
    )
  $q$ into missing;
  if missing = 0 then
    drop table public.users;
    raise notice 'Old public.users table (plain-text passwords) dropped.';
  else
    raise notice '% login(s) in public.users are not in Supabase Auth yet — table kept. Run "Move old logins" in the admin, then run this file again.', missing;
  end if;
end $$;

notify pgrst, 'reload schema';
