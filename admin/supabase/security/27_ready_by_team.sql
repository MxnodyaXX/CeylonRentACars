-- =============================================================================
-- 27 · "Mark vehicle as ready" for chosen team members
-- Run after 07_breakdown_holds.sql and 16_staff_roles.sql. Safe to re-run.
-- If 07 is ever run again, run this file again after it (07 puts the admin-only check back).
-- Undo: rollback/27_rollback_ready_by_team.sql
--
-- Until now only an admin could return a vehicle under a breakdown hold to service. A team member
-- may now do it too when the admin ticks "Return cars to service" for them (Permissions → Team).
-- It needs "Breakdowns" as well (the app switches both together). Everything else stays the same:
-- an outcome and a safety confirmation are required, and the approval records who gave it.
-- =============================================================================

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
  if not (private.is_admin()
          or (private.staff_may('canMarkVehicleReady') and private.staff_may('canManageBreakdowns'))) then
    raise exception 'Only an admin, or a team member allowed to return cars to service, can do this.';
  end if;
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
