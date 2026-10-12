-- =====================================================================
-- VERIFY (read-only) — run in the Supabase SQL Editor after 01 + 02.
-- Changes nothing: it only reads, acting as a website visitor, an admin and two of
-- your real owners. Shows one row per check; every row should say PASS.
-- (Write rules — owners can't edit each other's data, earnings are protected, rate
-- limits — are covered by the local test suite: security/tests, `npm test`.)
-- =====================================================================

drop table if exists pg_temp.security_check;
create temp table security_check (n serial, area text, check_name text, result text, detail text);
grant all on pg_temp.security_check to anon, authenticated;
grant usage, select on sequence pg_temp.security_check_n_seq to anon, authenticated;

do $$
declare
  t record; v text; f text;
  bad int; total int; seen int;
  oa text; ob text; oa_name text;
  rec record;
  -- run a query as a role with given JWT claims and return the single integer it selects
  procedure_dummy int;
begin
  ---------------------------------------------------------------- structure
  for t in select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' order by 1 loop
    insert into security_check (area, check_name, result, detail)
    values ('structure', 'RLS on ' || t.relname, case when t.relrowsecurity then 'PASS' else 'FAIL' end, null);
    insert into security_check (area, check_name, result, detail)
    values ('anon', 'no table access: ' || t.relname,
            case when has_table_privilege('anon', format('public.%I', t.relname), 'SELECT,INSERT,UPDATE,DELETE') then 'FAIL' else 'PASS' end, null);
  end loop;

  foreach v in array array['website_vehicles', 'popular_vehicles', 'catalog_vehicles', 'vehicle_busy_dates', 'public_reviews', 'public_service_reviews', 'feedback_vehicles'] loop
    if to_regclass('public.' || v) is not null then
      insert into security_check (area, check_name, result, detail)
      values ('anon', 'website view readable: ' || v, case when has_table_privilege('anon', 'public.' || v, 'SELECT') then 'PASS' else 'FAIL' end, null);
    end if;
  end loop;

  for rec in select p.oid::regprocedure::text as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' loop
    if rec.proname in ('submit_booking_request', 'submit_feedback', 'choose_alternative') then
      insert into security_check (area, check_name, result, detail)
      values ('anon', 'may call ' || rec.sig, case when has_function_privilege('anon', rec.sig, 'EXECUTE') then 'PASS' else 'FAIL' end, null);
    elsif has_function_privilege('anon', rec.sig, 'EXECUTE') then
      insert into security_check (area, check_name, result, detail)
      values ('anon', 'may NOT call ' || rec.sig, 'FAIL', 'website visitors can run this function');
    end if;
  end loop;

  select count(*) into bad from pg_policies where schemaname in ('public', 'storage')
    and (roles @> array['anon']::name[] or roles @> array['public']::name[]);
  insert into security_check (area, check_name, result, detail)
  values ('structure', 'no rules for anon/public roles', case when bad = 0 then 'PASS' else 'FAIL' end, bad || ' rule(s)');

  for rec in select id, public from storage.buckets where id in ('vehicle-images', 'booking-files', 'receipts') loop
    insert into security_check (area, check_name, result, detail)
    values ('storage', 'bucket ' || rec.id || (case when rec.id = 'vehicle-images' then ' public' else ' private' end),
            case when rec.public = (rec.id = 'vehicle-images') then 'PASS' else 'FAIL' end, null);
  end loop;

  ---------------------------------------------------------------- two real owners
  select owner_id into oa from public.vehicles where owner_id is not null group by owner_id order by count(*) desc, owner_id limit 1;
  select owner_id into ob from public.vehicles where owner_id is not null and owner_id <> oa group by owner_id order by count(*) desc, owner_id limit 1;
  select name into oa_name from public.owners where id = oa;
  insert into security_check (area, check_name, result, detail)
  values ('owners', 'two owners with vehicles to test', case when oa is not null and ob is not null then 'PASS' else 'SKIP' end, coalesce(oa, '—') || ' / ' || coalesce(ob, '—'));

  ---------------------------------------------------------------- admin sees everything
  select count(*) into total from public.bookings;
  perform set_config('request.jwt.claims', '{"role":"authenticated","app_metadata":{"role":"admin"}}', true);
  execute 'set local role authenticated';
  select count(*) into seen from public.bookings;
  execute 'reset role';
  insert into security_check (area, check_name, result, detail)
  values ('admin', 'sees every booking', case when seen = total then 'PASS' else 'FAIL' end, seen || ' of ' || total);

  ---------------------------------------------------------------- each owner sees only their own
  for rec in select x.oid_ as owner_id from (select oa as oid_ union all select ob) x where x.oid_ is not null loop
    perform set_config('request.jwt.claims',
      json_build_object('role', 'authenticated', 'app_metadata', json_build_object('role', 'owner', 'owner_id', rec.owner_id))::text, true);
    execute 'set local role authenticated';

    select count(*) into bad from public.vehicles where owner_id is distinct from rec.owner_id;
    select count(*) into seen from public.vehicles;
    execute 'reset role';
    insert into security_check (area, check_name, result, detail)
    values ('owner ' || rec.owner_id, 'vehicles: only own', case when bad = 0 then 'PASS' else 'FAIL' end, seen || ' visible, ' || bad || ' foreign');

    execute 'set local role authenticated';
    select count(*) into bad from public.owners where id <> rec.owner_id;
    execute 'reset role';
    insert into security_check (area, check_name, result, detail)
    values ('owner ' || rec.owner_id, 'owners: only own row', case when bad = 0 then 'PASS' else 'FAIL' end, bad || ' other owner row(s)');

    execute 'set local role authenticated';
    select count(*) into seen from public.bookings;
    select count(*) into bad from public.bookings b
      where not exists (select 1 from public.vehicles v where v.id = b.vehicle_id)                 -- not one of my vehicles…
        and lower(trim(coalesce(b.referral, ''))) <> lower(trim(coalesce((select name from public.owners where id = rec.owner_id), '#')));  -- …and not referred by me
    execute 'reset role';
    insert into security_check (area, check_name, result, detail)
    values ('owner ' || rec.owner_id, 'bookings: own vehicles or referred by them', case when bad = 0 then 'PASS' else 'FAIL' end, seen || ' visible, ' || bad || ' unexplained');

    execute 'set local role authenticated';
    select count(*) into bad from public.notifications where owner_id is distinct from rec.owner_id;
    execute 'reset role';
    insert into security_check (area, check_name, result, detail)
    values ('owner ' || rec.owner_id, 'notifications: only own', case when bad = 0 then 'PASS' else 'FAIL' end, bad || ' other');

    execute 'set local role authenticated';
    select count(*) into bad from public.commissions c
      where not exists (select 1 from public.vehicles v where v.id = c.vehicle_id)
        and not exists (select 1 from public.bookings b where b.id = c.booking_id);
    select count(*) into seen from public.customers;
    execute 'reset role';
    insert into security_check (area, check_name, result, detail)
    values ('owner ' || rec.owner_id, 'commissions: own vehicles or referred bookings', case when bad = 0 then 'PASS' else 'FAIL' end, bad || ' unexplained');
    insert into security_check (area, check_name, result, detail)
    values ('owner ' || rec.owner_id, 'customers visible (only their own vehicles'' customers)', 'INFO', seen || ' of ' || (select count(*) from public.customers));
  end loop;

  -- owner A must not see any of owner B's vehicles / bookings
  if oa is not null and ob is not null then
    perform set_config('request.jwt.claims',
      json_build_object('role', 'authenticated', 'app_metadata', json_build_object('role', 'owner', 'owner_id', oa))::text, true);
    execute 'set local role authenticated';
    select count(*) into bad from public.vehicles where owner_id = ob;
    execute 'reset role';
    insert into security_check (area, check_name, result, detail)
    values ('owners', oa || ' cannot see ' || ob || '''s vehicles', case when bad = 0 then 'PASS' else 'FAIL' end, bad || ' visible');
  end if;

  perform set_config('request.jwt.claims', '', true);
end $$;

select area, check_name, result, detail from security_check order by (result = 'PASS'), n;
