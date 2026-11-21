-- Undo 31_owner_privacy.sql: owners read their bookings, customers, payout lines and files as 01 allows
-- (the admin app still hides contact details and fixed-car amounts on screen).
-- Run 01_scoped_access.sql again afterwards to put back its owner rules for inquiries (owner_permitted).
drop function if exists public.owner_bookings();
drop function if exists public.owner_update_booking(text, jsonb);

drop policy if exists owner_select on public.bookings;
create policy owner_select on public.bookings for select to authenticated using (private.sees_booking(id));

drop policy if exists owner_select on public.customers;
drop policy if exists owner_update on public.customers;
create policy owner_select on public.customers for select to authenticated using (private.sees_customer(id, phone));
create policy owner_update on public.customers for update to authenticated
  using (private.sees_customer(id, phone)) with check (private.sees_customer(id, phone));

drop policy if exists owner_select on public.commissions;
create policy owner_select on public.commissions for select to authenticated
  using (owner_id = private.owner_id() or private.owns_vehicle(vehicle_id) or private.sees_booking(booking_id));

drop policy if exists private_files_select on storage.objects;
create policy private_files_select on storage.objects for select to authenticated
  using (bucket_id in ('booking-files', 'receipts') and (private.is_admin() or private.owns_booking((storage.foldername(name))[1])));

drop function if exists private.owner_sees_file(text);
drop function if exists private.fixed_booking(text);
drop function if exists private.sees_own_customer(text, text);
drop function if exists private.owner_view(public.bookings);
drop function if exists private.owner_full_booking(text);
drop function if exists private.owner_own_customer(text, text);
drop function if exists private.mask_name(text);
drop function if exists private.fixed_on(text, date);
drop function if exists private.day_of(text);

notify pgrst, 'reload schema';
