-- Undo 16_staff_roles.sql — staff logins lose all access (admins and owners are unaffected).
-- The staff logins themselves stay in Supabase Auth; disable them on the Permissions page if needed.
do $$
declare p record;
begin
  for p in select policyname, tablename from pg_policies
           where schemaname = 'public' and policyname in ('staff_select', 'staff_insert', 'staff_update', 'staff_delete') loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
  end loop;
end $$;

drop policy if exists staff_files_select on storage.objects;
drop policy if exists staff_files_insert on storage.objects;
drop policy if exists staff_files_update on storage.objects;
drop policy if exists staff_vehicle_images on storage.objects;
drop policy if exists staff_vehicle_images_update on storage.objects;

drop trigger if exists protect_staff_fields on public.bookings;
drop trigger if exists protect_staff_fields on public.vehicles;
drop trigger if exists protect_staff_fields on public.owners;
drop trigger if exists protect_staff_fields on public.commissions;
drop function if exists private.protect_staff_fields();
drop function if exists private.keep_cols(anyelement, anyelement, text[]);
drop function if exists private.only_cols(anyelement, anyelement, text[]);
drop function if exists private.staff_rule(text, text, text, text);

-- the owner trigger back to its 01 form (every non-admin login)
create or replace function private.protect_owner_fields() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user = 'authenticated' and not private.is_admin() then
    if tg_table_name = 'owners' then
      new.id := old.id; new.total_earnings := old.total_earnings; new.pending_payout := old.pending_payout;
      new.commission_rate := old.commission_rate;
    elsif tg_table_name = 'vehicles' then
      new.id := old.id; new.owner_id := old.owner_id;
    elsif tg_table_name = 'commissions' then
      if tg_op = 'INSERT' then
        new.status := 'Pending';
      else
        new.booking_id := old.booking_id; new.owner_id := old.owner_id; new.status := old.status;
        new.total_income := old.total_income; new.owner_payout := old.owner_payout;
        new.commission_amount := old.commission_amount; new.commission_rate := old.commission_rate;
        new.coordinator_fee := old.coordinator_fee;
      end if;
    end if;
  end if;
  return new;
end $$;

drop function if exists private.staff_may_any(text[]);
drop function if exists private.staff_may(text);
drop function if exists private.is_staff();

notify pgrst, 'reload schema';
