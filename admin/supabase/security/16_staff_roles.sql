-- =============================================================================
-- 16 · Staff roles: one login per employee, each with the abilities of their job
-- Run after 01–15. Safe to re-run. Undo: rollback/16_rollback_staff_roles.sql
-- IMPORTANT: 01_scoped_access.sql removes every rule when it is re-run — run this file again after it.
--
-- A staff login has app_metadata { role: 'staff', job, permissions: { canBook: true, … } },
-- set only by the staff-users Edge Function (admins choose them on the Permissions page).
-- Admins (Brian, IT) are unchanged: they keep full access through the admin_all rules.
--
-- Abilities (same names the admin app uses):
--   canBook              create / edit bookings, swap a car before the trip
--   canChangeStatus      change a vehicle's or booking's status
--   canViewHandovers     start and complete rentals (pickup / return checklists, odometer)
--   canTakePayments      record payments, refunds, deposits, discounts, credit
--   canViewFinance       commissions, owner payouts, referral fees, credit page
--   canViewExpenses      Expenses page (view + add + edit)        canAddExpenses  add an expense
--   canEditVehicle       vehicle details (never its owner, prices or website listing)
--   canViewCustomers     Customers page                            canViewInquiries  Inquiries + Messages
--   canViewDrivers       Drivers page (manage)                     canManageBreakdowns  Breakdowns
--   canViewOwners        Owners page (view)                        canViewFeedback  Feedback page
--   canViewReferrals     Referrals page                            canViewIncomplete  Incomplete page
--
-- Nobody but an admin deletes bookings, payments, handovers, expenses or breakdown records.
-- =============================================================================

create or replace function private.is_staff() returns boolean
language sql stable set search_path = '' as $$
  select private.jwt_role() = 'staff'
$$;

-- A staff ability, e.g. private.staff_may('canTakePayments')
create or replace function private.staff_may(p_perm text) returns boolean
language sql stable set search_path = '' as $$
  select private.is_staff()
     and coalesce((auth.jwt() -> 'app_metadata' -> 'permissions' ->> p_perm)::boolean, false)
$$;

create or replace function private.staff_may_any(p_perms text[]) returns boolean
language sql stable set search_path = '' as $$
  select private.is_staff() and exists (
    select 1 from unnest(p_perms) p
    where coalesce((auth.jwt() -> 'app_metadata' -> 'permissions' ->> p)::boolean, false))
$$;

revoke all on function private.is_staff(), private.staff_may(text), private.staff_may_any(text[]) from public, anon;
grant execute on function private.is_staff(), private.staff_may(text), private.staff_may_any(text[]) to authenticated;

-- ── Rules per table ──────────────────────────────────────────────────────────
-- p(table, command, using, check) — drops and re-creates one staff rule
create or replace function private.staff_rule(p_table text, p_cmd text, p_using text, p_check text default null)
returns void language plpgsql set search_path = '' as $$
declare v_name text := 'staff_' || lower(p_cmd);
begin
  if to_regclass('public.' || p_table) is null then return; end if;
  execute format('drop policy if exists %I on public.%I', v_name, p_table);
  if p_cmd = 'INSERT' then
    execute format('create policy %I on public.%I for insert to authenticated with check (%s)', v_name, p_table, coalesce(p_check, p_using));
  elsif p_cmd = 'UPDATE' then
    execute format('create policy %I on public.%I for update to authenticated using (%s) with check (%s)', v_name, p_table, p_using, coalesce(p_check, p_using));
  else
    execute format('create policy %I on public.%I for %s to authenticated using (%s)', v_name, p_table, lower(p_cmd), p_using);
  end if;
end $$;
revoke all on function private.staff_rule(text, text, text, text) from public, anon, authenticated;

do $$
declare
  any_staff   constant text := 'private.is_staff()';
  t text;
begin
  -- bookings: everyone on the team sees the schedule; who may change it depends on the job
  perform private.staff_rule('bookings', 'SELECT', any_staff);
  perform private.staff_rule('bookings', 'INSERT', $q$private.staff_may('canBook')$q$);
  perform private.staff_rule('bookings', 'UPDATE', $q$private.staff_may_any(array['canBook','canViewHandovers','canTakePayments','canChangeStatus','canManageBreakdowns'])$q$);

  perform private.staff_rule('customers', 'SELECT', any_staff);
  perform private.staff_rule('customers', 'INSERT', $q$private.staff_may_any(array['canBook','canViewCustomers','canViewInquiries'])$q$);
  perform private.staff_rule('customers', 'UPDATE', $q$private.staff_may_any(array['canBook','canViewCustomers','canViewInquiries','canTakePayments'])$q$);

  perform private.staff_rule('vehicles', 'SELECT', any_staff);
  perform private.staff_rule('vehicles', 'UPDATE', $q$private.staff_may_any(array['canEditVehicle','canChangeStatus','canViewHandovers','canBook','canManageBreakdowns'])$q$);

  perform private.staff_rule('owners', 'SELECT', any_staff);
  perform private.staff_rule('owners', 'UPDATE', $q$private.staff_may('canViewFinance')$q$);

  perform private.staff_rule('commissions', 'SELECT', $q$private.staff_may_any(array['canViewFinance','canBook','canTakePayments','canViewHandovers','canManageBreakdowns'])$q$);
  perform private.staff_rule('commissions', 'INSERT', $q$private.staff_may_any(array['canViewFinance','canBook','canTakePayments','canViewHandovers','canManageBreakdowns'])$q$);
  perform private.staff_rule('commissions', 'UPDATE', $q$private.staff_may_any(array['canViewFinance','canBook','canTakePayments','canViewHandovers','canManageBreakdowns'])$q$);

  perform private.staff_rule('expenses', 'SELECT', $q$private.staff_may_any(array['canViewExpenses','canViewFinance'])$q$);
  perform private.staff_rule('expenses', 'INSERT', $q$private.staff_may_any(array['canViewExpenses','canAddExpenses'])$q$);
  perform private.staff_rule('expenses', 'UPDATE', $q$private.staff_may('canViewExpenses')$q$);

  perform private.staff_rule('handovers', 'SELECT', any_staff);
  perform private.staff_rule('handovers', 'INSERT', $q$private.staff_may('canViewHandovers')$q$);
  perform private.staff_rule('handovers', 'UPDATE', $q$private.staff_may('canViewHandovers')$q$);

  perform private.staff_rule('drivers', 'SELECT', any_staff);
  perform private.staff_rule('drivers', 'INSERT', $q$private.staff_may('canViewDrivers')$q$);
  perform private.staff_rule('drivers', 'UPDATE', $q$private.staff_may_any(array['canViewDrivers','canBook','canViewHandovers'])$q$);

  perform private.staff_rule('app_settings', 'SELECT', any_staff);

  -- company alerts (not addressed to an owner); staff may also send one to an owner
  perform private.staff_rule('notifications', 'SELECT', $q$private.is_staff() and owner_id is null$q$);
  perform private.staff_rule('notifications', 'INSERT', any_staff);
  perform private.staff_rule('notifications', 'UPDATE', $q$private.is_staff() and owner_id is null$q$);

  perform private.staff_rule('inquiries', 'SELECT', $q$private.staff_may_any(array['canViewInquiries','canBook'])$q$);
  perform private.staff_rule('inquiries', 'INSERT', $q$private.staff_may('canViewInquiries')$q$);
  perform private.staff_rule('inquiries', 'UPDATE', $q$private.staff_may_any(array['canViewInquiries','canBook'])$q$);
  perform private.staff_rule('inquiry_followups', 'SELECT', $q$private.staff_may('canViewInquiries')$q$);
  perform private.staff_rule('inquiry_followups', 'INSERT', $q$private.staff_may('canViewInquiries')$q$);
  perform private.staff_rule('inquiry_followups', 'UPDATE', $q$private.staff_may('canViewInquiries')$q$);
  perform private.staff_rule('inquiry_followups', 'DELETE', $q$private.staff_may('canViewInquiries')$q$);

  foreach t in array array['sms_log', 'whatsapp_chats', 'whatsapp_messages'] loop
    perform private.staff_rule(t, 'SELECT', $q$private.staff_may('canViewInquiries')$q$);
  end loop;
  foreach t in array array['whatsapp_chats', 'whatsapp_messages'] loop
    perform private.staff_rule(t, 'INSERT', $q$private.staff_may('canViewInquiries')$q$);
    perform private.staff_rule(t, 'UPDATE', $q$private.staff_may('canViewInquiries')$q$);
  end loop;

  perform private.staff_rule('vehicle_reviews', 'SELECT', any_staff);
  perform private.staff_rule('vehicle_reviews', 'UPDATE', $q$private.staff_may('canViewFeedback')$q$);
  perform private.staff_rule('vehicle_reviews', 'DELETE', $q$private.staff_may('canViewFeedback')$q$);
  perform private.staff_rule('service_reviews', 'SELECT', $q$private.staff_may('canViewFeedback')$q$);
  perform private.staff_rule('service_reviews', 'UPDATE', $q$private.staff_may('canViewFeedback')$q$);
  perform private.staff_rule('service_reviews', 'DELETE', $q$private.staff_may('canViewFeedback')$q$);

  -- breakdowns: everyone sees them (the booking shows its breakdowns); Breakdowns staff handle them
  foreach t in array array['breakdown_incidents', 'breakdown_solutions', 'breakdown_events', 'breakdown_documents',
                           'breakdown_expenses', 'breakdown_allocations', 'breakdown_vehicle_swaps'] loop
    perform private.staff_rule(t, 'SELECT', any_staff);
    perform private.staff_rule(t, 'INSERT', $q$private.staff_may('canManageBreakdowns')$q$);
    perform private.staff_rule(t, 'UPDATE', $q$private.staff_may('canManageBreakdowns')$q$);
  end loop;
  perform private.staff_rule('breakdown_payments', 'SELECT', any_staff);
  perform private.staff_rule('breakdown_payments', 'INSERT', $q$private.staff_may_any(array['canManageBreakdowns','canTakePayments'])$q$);
  perform private.staff_rule('breakdown_payments', 'UPDATE', $q$private.staff_may_any(array['canManageBreakdowns','canTakePayments'])$q$);
  -- users, sms_opt_out, partner_applications: admin only (no staff rule)
end $$;

-- ── Values staff can't change (silently kept as they were, like the owner rules in 01) ──
-- The owner trigger from 01 now skips staff logins (their own trigger below), so Finance can settle payouts.
create or replace function private.protect_owner_fields() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user = 'authenticated' and not private.is_admin() and not private.is_staff() then
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

-- keep(new, old, keys): new row with those columns put back to the old values
create or replace function private.keep_cols(p_new anyelement, p_old anyelement, p_keys text[]) returns anyelement
language plpgsql immutable set search_path = '' as $$
declare j jsonb := to_jsonb(p_new); o jsonb := to_jsonb(p_old); k text;
begin
  foreach k in array p_keys loop
    if o ? k then j := jsonb_set(j, array[k], o -> k); end if;
  end loop;
  return jsonb_populate_record(p_new, j);
end $$;

-- only these columns may change (everything else is put back)
create or replace function private.only_cols(p_new anyelement, p_old anyelement, p_keys text[]) returns anyelement
language plpgsql immutable set search_path = '' as $$
declare j jsonb := to_jsonb(p_old); n jsonb := to_jsonb(p_new); k text;
begin
  foreach k in array p_keys loop
    if n ? k then j := jsonb_set(j, array[k], n -> k); end if;
  end loop;
  return jsonb_populate_record(p_new, j);
end $$;

create or replace function private.protect_staff_fields() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user <> 'authenticated' or not private.is_staff() then return new; end if;

  if tg_table_name = 'bookings' and tg_op = 'UPDATE' then
    -- money on a booking is Finance's (canTakePayments); referral fees too
    if not private.staff_may('canTakePayments') then
      new := private.keep_cols(new, old, array['paid_amount', 'payments', 'discount', 'bad_debt', 'credit_amount', 'credit_settled',
        'credit_responsibility', 'deposit_returned', 'deposit_deduction', 'advance_amount', 'payment_method']);
    end if;
    if not private.staff_may('canViewFinance') then
      new := private.keep_cols(new, old, array['referral_paid', 'referral_paid_at', 'payout_adjustments']);
    end if;

  elsif tg_table_name = 'vehicles' then
    -- nobody on staff changes a car's owner, prices or website listing (Brian does)
    new := private.keep_cols(new, old, array['id', 'owner_id', 'daily_rent', 'extra_km_rate', 'included_km_per_day',
      'web_price', 'web_badge', 'web_category', 'web_featured', 'web_location', 'web_order', 'web_wedding']);
    if not private.staff_may('canEditVehicle') then
      new := private.only_cols(new, old, array['status', 'mileage', 'revenue', 'rent_count']);
    end if;

  elsif tg_table_name = 'owners' then
    -- Finance records payouts; the owner's details, bank account and commission rate stay Brian's
    new := private.only_cols(new, old, array['pending_payout', 'total_earnings']);

  elsif tg_table_name = 'commissions' then
    if not private.staff_may('canViewFinance') then
      if tg_op = 'INSERT' then new.status := 'Pending';
      else new := private.keep_cols(new, old, array['status', 'commission_rate']);
      end if;
    end if;
  end if;
  return new;
end $$;

do $$
begin
  drop trigger if exists protect_staff_fields on public.bookings;
  create trigger protect_staff_fields before update on public.bookings for each row execute function private.protect_staff_fields();
  drop trigger if exists protect_staff_fields on public.vehicles;
  create trigger protect_staff_fields before update on public.vehicles for each row execute function private.protect_staff_fields();
  drop trigger if exists protect_staff_fields on public.owners;
  create trigger protect_staff_fields before update on public.owners for each row execute function private.protect_staff_fields();
  drop trigger if exists protect_staff_fields on public.commissions;
  create trigger protect_staff_fields before insert or update on public.commissions for each row execute function private.protect_staff_fields();
end $$;

-- ── Files ────────────────────────────────────────────────────────────────────
-- booking-files / receipts: the team sees them; booking, return and payment staff add them; only admins delete
drop policy if exists staff_files_select on storage.objects;
drop policy if exists staff_files_insert on storage.objects;
drop policy if exists staff_files_update on storage.objects;
drop policy if exists staff_vehicle_images on storage.objects;
drop policy if exists staff_vehicle_images_update on storage.objects;
create policy staff_files_select on storage.objects for select to authenticated
  using (bucket_id in ('booking-files', 'receipts') and private.is_staff());
create policy staff_files_insert on storage.objects for insert to authenticated
  with check (bucket_id in ('booking-files', 'receipts')
              and private.staff_may_any(array['canBook', 'canViewHandovers', 'canTakePayments', 'canManageBreakdowns']));
create policy staff_files_update on storage.objects for update to authenticated
  using (bucket_id in ('booking-files', 'receipts')
         and private.staff_may_any(array['canBook', 'canViewHandovers', 'canTakePayments', 'canManageBreakdowns']));
create policy staff_vehicle_images on storage.objects for insert to authenticated
  with check (bucket_id = 'vehicle-images' and private.staff_may('canEditVehicle'));
create policy staff_vehicle_images_update on storage.objects for update to authenticated
  using (bucket_id = 'vehicle-images' and private.staff_may('canEditVehicle'));

notify pgrst, 'reload schema';
