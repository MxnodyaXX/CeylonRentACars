-- =====================================================================
-- 03 · REMOVE THE OLD PLAIN-TEXT LOGINS (final step — NOT reversible)
-- Run LAST, only after:
--   • every owner login was moved (Settings → Move old logins) and
--   • each owner has signed in with their new password (Permissions shows "Last signed in").
--
-- The table is only dropped when every row in public.users has exactly one matching
-- Supabase Auth login: same username, role 'owner', same owner_id. Otherwise this stops
-- with the list of problems and changes nothing.
-- (The old table's role column is never trusted: admin rows are reported, not moved.)
-- =====================================================================

do $$
declare
  problems text[] := '{}';
  r record;
begin
  if to_regclass('public.users') is null then
    raise notice 'public.users is already gone — nothing to do.';
    return;
  end if;

  for r in
    select u.username, u.role, u.owner_id,
           lower(regexp_replace(u.username, '[^a-zA-Z0-9._-]', '', 'g')) || '@staff.ceylonrentacars.com' as login_email
    from public.users u
  loop
    if r.role = 'admin' then
      problems := problems || format('%s: legacy ADMIN row — admins are created in the dashboard; delete this row by hand after checking', r.username);
      continue;
    end if;
    if (select count(*) from auth.users a where lower(a.email) = r.login_email) <> 1 then
      problems := problems || format('%s: no secure login found (%s)', r.username, r.login_email);
      continue;
    end if;
    if not exists (
      select 1 from auth.users a
      where lower(a.email) = r.login_email
        and a.raw_app_meta_data ->> 'role' = 'owner'
        and a.raw_app_meta_data ->> 'owner_id' is not distinct from r.owner_id
    ) then
      problems := problems || format('%s: secure login exists but its role/owner does not match (owner %s)', r.username, coalesce(r.owner_id, '—'));
    end if;
  end loop;

  -- two logins pointing at the same owner?
  for r in
    select a.raw_app_meta_data ->> 'owner_id' as owner_id, count(*) as n
    from auth.users a where a.raw_app_meta_data ->> 'role' = 'owner'
    group by 1 having count(*) > 1
  loop
    problems := problems || format('owner %s has %s secure logins — keep one', r.owner_id, r.n);
  end loop;

  if array_length(problems, 1) > 0 then
    raise exception E'Old logins NOT removed:\n  - %', array_to_string(problems, E'\n  - ');
  end if;

  drop table public.users;
  raise notice 'public.users (plain-text passwords) removed.';
end $$;

notify pgrst, 'reload schema';
