-- =============================================================================
-- 33 · Change log + Undo: every change to the main tables is written down (who, when, what it was before),
--      and an admin can put any one of them back from the admin app (Undo changes page).
-- Run after 32. Safe to re-run. Undo: rollback/33_rollback_change_undo.sql
--
--   public.change_log        one line per insert / update / delete — filled ONLY by the trigger below.
--                            UPDATE: just the columns that changed (before and after). INSERT: the new row.
--                            DELETE: the whole removed row (so it can be put back).
--                            Only an admin can read it. Nobody can write, change or delete lines by hand.
--   public.undo_change(id)   admin only. Puts the record back as it was before that change:
--                              update → the changed columns get their old values
--                              insert → the added record is removed
--                              delete → the removed record comes back
--                            If the same record was changed again afterwards, it answers {ok:false, conflict}
--                            first; the admin can then undo anyway (p_force) or undo the later change first.
--                            The undo itself is logged too (undo_of), so an undo can be undone.
--   Bookings keep their History: an undo adds an "Undid …" line instead of rolling the History back.
-- Lines older than a year are pruned now and then.
-- =============================================================================

create table if not exists public.change_log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  table_name  text not null,
  row_key     text not null,
  op          text not null check (op in ('INSERT', 'UPDATE', 'DELETE')),
  label       text,
  old_values  jsonb,
  new_values  jsonb,
  by_id       uuid,
  by_name     text,
  by_role     text,
  undo_of     bigint,
  undone_at   timestamptz,
  undone_by   text,
  undone_in   bigint
);
create index if not exists change_log_at on public.change_log (at desc);
create index if not exists change_log_row on public.change_log (table_name, row_key, id desc);

alter table public.change_log enable row level security;
revoke all on public.change_log from public, anon, authenticated;
grant select on public.change_log to authenticated;
drop policy if exists admin_select on public.change_log;
create policy admin_select on public.change_log for select to authenticated using (private.is_admin());

-- ── who is making the change ────────────────────────────────────────────────
create or replace function private.change_actor() returns text
language sql stable set search_path = '' as $$
  select coalesce(
    nullif(auth.jwt() -> 'app_metadata' ->> 'name', ''),
    nullif(auth.jwt() -> 'app_metadata' ->> 'username', ''),
    nullif(split_part(coalesce(auth.jwt() ->> 'email', ''), '@', 1), ''),
    case when auth.uid() is null then 'System' else 'Unknown' end)
$$;

-- the single-column primary key of a public table (id for most, key for app_settings)
create or replace function private.change_key(p_table text) returns text
language sql stable set search_path = '' as $$
  select a.attname::text from pg_index i
  join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
  where i.indrelid = to_regclass('public.' || quote_ident(p_table)) and i.indisprimary and i.indnatts = 1
$$;

-- ── the trigger ─────────────────────────────────────────────────────────────
create or replace function private.log_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_row jsonb;
  o jsonb := '{}'::jsonb;
  n jsonb := '{}'::jsonb;
  k text;
  v_label text;
begin
  v_row := coalesce(v_new, v_old);
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(v_new) loop
      if k <> 'updated_at' and (v_old -> k) is distinct from (v_new -> k) then
        o := o || jsonb_build_object(k, v_old -> k);
        n := n || jsonb_build_object(k, v_new -> k);
      end if;
    end loop;
    if n = '{}'::jsonb then return null; end if;   -- nothing really changed
  elsif tg_op = 'INSERT' then o := null; n := v_new;
  else o := v_old; n := null;
  end if;

  v_label := left(coalesce(
    nullif(v_row ->> 'customer_name', ''), nullif(v_row ->> 'name', ''),
    nullif(trim(concat_ws(' ', v_row ->> 'brand', v_row ->> 'model', v_row ->> 'vehicle_number')), ''),
    nullif(v_row ->> 'title', ''), nullif(v_row ->> 'description', ''), nullif(v_row ->> 'note', '')), 120);

  insert into public.change_log (table_name, row_key, op, label, old_values, new_values, by_id, by_name, by_role, undo_of)
  values (tg_table_name, v_row ->> tg_argv[0], tg_op, v_label, o, n, auth.uid(), private.change_actor(),
          coalesce(nullif(auth.jwt() -> 'app_metadata' ->> 'role', ''), case when auth.uid() is null then 'system' else 'user' end),
          nullif(current_setting('crc.undo_of', true), '')::bigint);

  if random() < 0.002 then delete from public.change_log where at < now() - interval '1 year'; end if;
  return null;
end $$;
revoke all on function private.log_change() from public, anon, authenticated;

-- the main tables (skipped quietly if one doesn't exist; noisy ones — notifications, SMS / WhatsApp logs — aren't logged)
do $$
declare t text; v_key text;
begin
  foreach t in array array[
    'bookings', 'customers', 'vehicles', 'owners', 'commissions', 'expenses', 'drivers', 'handovers', 'inquiries',
    'breakdown_incidents', 'breakdown_events', 'breakdown_solutions', 'breakdown_expenses', 'breakdown_allocations',
    'breakdown_payments', 'breakdown_documents', 'breakdown_vehicle_swaps',
    'owner_settlements', 'company_accounts', 'company_expenses', 'account_transfers', 'month_closes',
    'partner_applications', 'vehicle_reviews', 'service_reviews', 'inquiry_followups', 'app_settings'
  ] loop
    v_key := private.change_key(t);
    if v_key is null then
      if to_regclass('public.' || quote_ident(t)) is not null then raise notice 'change log: % skipped (no single-column primary key)', t; end if;
      continue;
    end if;
    execute format('drop trigger if exists change_log on public.%I', t);
    execute format('create trigger change_log after insert or update or delete on public.%I for each row execute function private.log_change(%L)', t, v_key);
  end loop;
end $$;

-- ── undo ────────────────────────────────────────────────────────────────────
create or replace function public.undo_change(p_id bigint, p_force boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c        public.change_log%rowtype;
  v_key    text;
  v_rel    regclass;
  v_cur    jsonb;
  v_skip   text[];
  v_cols   text[];
  v_later  public.change_log%rowtype;
  v_me     text := private.change_actor();
  v_new_id bigint;
  k        text;
begin
  if not private.is_admin() then raise exception 'Only an admin can undo changes.' using errcode = '42501'; end if;
  select * into c from public.change_log where id = p_id for update;
  if not found then raise exception 'That change was not found.'; end if;
  if c.undone_at is not null then raise exception 'This change was already undone by % on %.', c.undone_by, to_char(c.undone_at at time zone 'Asia/Colombo', 'DD Mon YYYY HH24:MI'); end if;

  v_key := private.change_key(c.table_name);
  v_rel := to_regclass('public.' || quote_ident(c.table_name));
  if v_key is null or v_rel is null then raise exception 'The table % can no longer be changed this way.', c.table_name; end if;
  execute format('select to_jsonb(t) from public.%I t where t.%I::text = $1', c.table_name, v_key) into v_cur using c.row_key;
  -- a booking's History is kept as it is (an "Undid …" line is added below)
  v_skip := case when c.table_name = 'bookings' then array['activity'] else array[]::text[] end;

  -- the record was changed again after this change → say so first (unless told to go ahead)
  select * into v_later from public.change_log l
   where l.table_name = c.table_name and l.row_key = c.row_key and l.id > c.id and l.undone_at is null
   order by l.id desc limit 1;
  if not p_force then
    if c.op = 'UPDATE' and v_cur is null then
      return jsonb_build_object('ok', false, 'conflict', 'This record has since been deleted. Undo that delete first.');
    elsif c.op = 'DELETE' and v_cur is not null then
      return jsonb_build_object('ok', false, 'conflict', 'This record exists again, so it can''t be put back a second time.');
    elsif v_later.id is not null and (c.op <> 'UPDATE' or exists (
        select 1 from jsonb_object_keys(c.new_values) kk
         where kk <> all (v_skip) and (v_cur -> kk) is distinct from (c.new_values -> kk))) then
      return jsonb_build_object('ok', false, 'later_id', v_later.id,
        'conflict', format('%s changed this record again on %s. Undoing this older change may overwrite that.',
                           coalesce(v_later.by_name, 'Someone'), to_char(v_later.at at time zone 'Asia/Colombo', 'DD Mon YYYY HH24:MI')));
    end if;
  end if;

  perform set_config('crc.undo_of', p_id::text, true);

  if c.op = 'UPDATE' then
    if v_cur is null then raise exception 'This record has since been deleted. Undo that delete first.'; end if;
    select array_agg(kk) into v_cols from jsonb_object_keys(c.old_values) kk
     where kk <> all (v_skip) and exists (select 1 from pg_attribute a where a.attrelid = v_rel and a.attname = kk
                                            and a.attnum > 0 and not a.attisdropped and a.attgenerated = '');
    if v_cols is not null then
      execute format('update public.%I t set (%s) = (select %s from jsonb_populate_record(null::public.%I, $1) r) where t.%I::text = $2',
        c.table_name,
        (select string_agg(format('%I', x), ', ') from unnest(v_cols) x),
        (select string_agg(format('r.%I', x), ', ') from unnest(v_cols) x),
        c.table_name, v_key)
      using c.old_values, c.row_key;
    end if;
  elsif c.op = 'INSERT' then
    execute format('delete from public.%I t where t.%I::text = $1', c.table_name, v_key) using c.row_key;
  else -- DELETE → put the row back
    if v_cur is not null then raise exception 'This record exists again, so it can''t be put back a second time.'; end if;
    select array_agg(a.attname::text) into v_cols from pg_attribute a
     where a.attrelid = v_rel and a.attnum > 0 and not a.attisdropped and a.attgenerated = '' and a.attidentity <> 'a'
       and c.old_values ? a.attname;
    execute format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1) r',
      c.table_name,
      (select string_agg(format('%I', x), ', ') from unnest(v_cols) x),
      (select string_agg(format('r.%I', x), ', ') from unnest(v_cols) x),
      c.table_name)
    using c.old_values;
  end if;

  -- a booking: say in its History what was put back
  if c.table_name = 'bookings' and c.op = 'UPDATE' then
    update public.bookings set activity = coalesce(activity, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'by', v_me, 'type', 'Edited',
      'text', format('Undid %s''s change of %s (%s put back)', coalesce(c.by_name, 'someone'),
                     to_char(c.at at time zone 'Asia/Colombo', 'DD Mon YYYY HH24:MI'),
                     (select string_agg(replace(x, '_', ' '), ', ') from jsonb_object_keys(c.old_values) x where x <> all (v_skip)))))
     where id::text = c.row_key;
  end if;

  perform set_config('crc.undo_of', '', true);
  select min(id) into v_new_id from public.change_log where undo_of = p_id;
  update public.change_log set undone_at = now(), undone_by = v_me, undone_in = v_new_id where id = p_id;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.undo_change(bigint, boolean) from public, anon;
grant execute on function public.undo_change(bigint, boolean) to authenticated;

notify pgrst, 'reload schema';
