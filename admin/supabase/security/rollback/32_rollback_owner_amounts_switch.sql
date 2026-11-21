-- Undo 32_owner_amounts_switch.sql: owners see their bookings, handovers, expenses and amounts again (31 as it was).
-- FIRST run 31_owner_privacy.sql again (it puts back its own owner_full_booking / owner_view / owner_update_booking /
-- owner_bookings / owner_sees_file and the commissions rule), THEN run this file.
drop function if exists public.owner_commissions();

drop trigger if exists owner_portal_guard on public.bookings;
drop function if exists private.owner_update_guard();
drop function if exists private.owner_portal_open();

drop policy if exists owner_select on public.commissions;
create policy owner_select on public.commissions for select to authenticated
  using ((owner_id = private.owner_id() or private.owns_vehicle(vehicle_id) or private.sees_booking(booking_id))
         and not private.fixed_booking(booking_id));

do $$ begin
  if to_regclass('public.handovers') is not null then
    drop policy if exists owner_select on public.handovers;
    drop policy if exists owner_insert on public.handovers;
    drop policy if exists owner_update on public.handovers;
    create policy owner_select on public.handovers for select to authenticated using (private.owns_vehicle(vehicle_id));
    create policy owner_insert on public.handovers for insert to authenticated with check (private.owns_vehicle(vehicle_id));
    create policy owner_update on public.handovers for update to authenticated using (private.owns_vehicle(vehicle_id)) with check (private.owns_vehicle(vehicle_id));
  end if;
  if to_regclass('public.expenses') is not null then
    drop policy if exists owner_all on public.expenses;
    create policy owner_all on public.expenses for all to authenticated
      using (private.owns_vehicle(vehicle_id)) with check (private.owns_vehicle(vehicle_id));
  end if;
end $$;

drop function if exists private.owner_money_hidden(text, text);
drop function if exists private.owner_amounts_shown();

notify pgrst, 'reload schema';
