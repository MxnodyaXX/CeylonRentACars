-- =====================================================================
-- 07 · MAINTENANCE HOLDS FOR BREAKDOWNS (needs 06_breakdowns.sql)
--
-- Reporting a breakdown places a maintenance hold on the vehicle: it becomes 'Maintenance'
-- (UNDER_MAINTENANCE — no new bookings, not "available" on the website) and stays there until an
-- admin explicitly confirms it is safe — completing a repair or a replacement does NOT clear it.
--
--   • at most ONE active hold per vehicle (a second breakdown while held is linked to the same hold)
--   • while a hold is active, any change of the vehicle's status is kept at 'Maintenance'
--   • a hold is cleared ONLY by public.breakdown_mark_vehicle_ready(…): admin only, needs the
--     repair / inspection outcome and a safety confirmation; clears the hold, records who approved
--     it and when, sets the vehicle back to Ongoing / Reserved / Available from its bookings, and
--     writes the timeline entry — all in one transaction
--   • a cleared hold can't be re-opened or moved; a new breakdown creates a new hold
--
-- Safe to re-run. Undo: rollback/07_rollback_breakdown_holds.sql
-- =====================================================================

alter table public.breakdown_incidents
  add column if not exists hold_vehicle_id      text references public.vehicles(id) on delete set null,
  add column if not exists hold_placed_at       timestamptz,
  add column if not exists hold_cleared_at      timestamptz,
  add column if not exists hold_cleared_by      text,
  add column if not exists ready_outcome        text,
  add column if not exists ready_safe_confirmed boolean,
  add column if not exists ready_comments       text,
  add column if not exists ready_approved_at    timestamptz;

create unique index if not exists breakdown_one_active_hold
  on public.breakdown_incidents (hold_vehicle_id)
  where hold_vehicle_id is not null and hold_cleared_at is null;
create index if not exists breakdown_incidents_hold on public.breakdown_incidents (hold_vehicle_id);

-- Placing a hold puts the vehicle under maintenance (same transaction as the incident insert)
create or replace function private.bd_place_hold() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.hold_vehicle_id is not null and new.hold_cleared_at is null then
    update public.vehicles set status = 'Maintenance' where id = new.hold_vehicle_id and status <> 'Maintenance';
  end if;
  return new;
end $$;
drop trigger if exists bd_place_hold on public.breakdown_incidents;
create trigger bd_place_hold after insert on public.breakdown_incidents for each row execute function private.bd_place_hold();

-- Holds can only be cleared by the ready function; a cleared hold can't be re-opened or moved
create or replace function private.bd_guard_hold() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.hold_vehicle_id is not null and new.hold_vehicle_id is distinct from old.hold_vehicle_id then
    raise exception 'A maintenance hold cannot be moved to another vehicle.';
  end if;
  if old.hold_vehicle_id is null and new.hold_vehicle_id is not null then
    raise exception 'A maintenance hold is placed when the breakdown is reported.';
  end if;
  if old.hold_cleared_at is not null and new.hold_cleared_at is distinct from old.hold_cleared_at then
    raise exception 'A cleared maintenance hold cannot be re-opened — report a new breakdown.';
  end if;
  if old.hold_cleared_at is null and new.hold_cleared_at is not null
     and coalesce(current_setting('ceylon.bd_ready', true), '') <> 'on' then
    raise exception 'Use "Mark vehicle as ready" to return a vehicle to service.';
  end if;
  return new;
end $$;
drop trigger if exists bd_guard_hold on public.breakdown_incidents;
create trigger bd_guard_hold before update on public.breakdown_incidents for each row execute function private.bd_guard_hold();

-- While a hold is active the vehicle stays under maintenance (any other status change is undone)
create or replace function private.bd_keep_maintenance() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status is distinct from 'Maintenance' and exists (
    select 1 from public.breakdown_incidents i
    where i.hold_vehicle_id = new.id and i.hold_cleared_at is null
  ) then
    new.status := 'Maintenance';
  end if;
  return new;
end $$;
drop trigger if exists bd_keep_maintenance on public.vehicles;
create trigger bd_keep_maintenance before update of status on public.vehicles for each row execute function private.bd_keep_maintenance();

-- ── Mark vehicle as ready (server-side checks; one transaction) ─────────────
create or replace function public.breakdown_mark_vehicle_ready(
  p_incident_id text, p_outcome text, p_safe boolean, p_comments text default null, p_approved_at timestamptz default null, p_by text default null
) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_inc     public.breakdown_incidents%rowtype;
  v_by      text := coalesce(nullif(auth.jwt() -> 'app_metadata' ->> 'name', ''), nullif(trim(p_by), ''), 'Admin');
  v_status  text;
  v_at      timestamptz := coalesce(p_approved_at, now());
begin
  if not private.is_admin() then raise exception 'Only an admin can return a vehicle to service.'; end if;
  select * into v_inc from public.breakdown_incidents where id = p_incident_id for update;
  if not found then raise exception 'Breakdown not found.'; end if;
  if v_inc.hold_vehicle_id is null or v_inc.hold_cleared_at is not null then
    raise exception 'This breakdown has no active maintenance hold.';
  end if;
  if coalesce(trim(p_outcome), '') = '' then raise exception 'Record the repair or inspection outcome.'; end if;
  if p_safe is not true then raise exception 'Confirm the vehicle is safe for rental.'; end if;
  if v_at > now() + interval '5 minutes' then raise exception 'The approval time cannot be in the future.'; end if;

  perform set_config('ceylon.bd_ready', 'on', true);
  update public.breakdown_incidents set
    hold_cleared_at = now(), hold_cleared_by = v_by, ready_outcome = left(trim(p_outcome), 500),
    ready_safe_confirmed = true, ready_comments = nullif(left(trim(coalesce(p_comments, '')), 2000), ''), ready_approved_at = v_at
  where id = p_incident_id;
  perform set_config('ceylon.bd_ready', '', true);

  -- availability comes back only if nothing else holds the vehicle; otherwise from its live bookings
  if exists (select 1 from public.breakdown_incidents i where i.hold_vehicle_id = v_inc.hold_vehicle_id and i.hold_cleared_at is null) then
    v_status := 'Maintenance';
  elsif exists (select 1 from public.bookings b where b.vehicle_id = v_inc.hold_vehicle_id and b.status = 'Ongoing') then
    v_status := 'Ongoing';
  elsif exists (select 1 from public.bookings b where b.vehicle_id = v_inc.hold_vehicle_id and b.status = 'Confirmed') then
    v_status := 'Reserved';
  else
    v_status := 'Available';
  end if;
  update public.vehicles set status = v_status where id = v_inc.hold_vehicle_id;

  insert into public.breakdown_events (id, incident_id, by, type, text)
  values ('ev' || replace(gen_random_uuid()::text, '-', ''), p_incident_id, v_by, 'ready',
          'Vehicle confirmed safe and returned to service (' || v_status || ') — ' || left(trim(p_outcome), 200));
  return v_status;
end $$;
revoke all on function public.breakdown_mark_vehicle_ready(text, text, boolean, text, timestamptz, text) from public, anon;
grant execute on function public.breakdown_mark_vehicle_ready(text, text, boolean, text, timestamptz, text) to authenticated;

notify pgrst, 'reload schema';
