-- =============================================================================
-- 29 · The commission agreed with each owner (per car)
-- Run after 16_staff_roles.sql and 21_owner_fixed_terms.sql. Safe to re-run. Undo: rollback/29_rollback_owner_share_terms.sql
--
-- A car on "Share of each rental" can now carry the commission agreed with its owner, e.g.
-- 15% but at least Rs 1,000 a day, 12% of the rental, Rs 1,000 a day, or Rs 5,000 a trip. New bookings
-- on the car take it, and "Complete rental" offers it as the agreed rate. Empty = the company default
-- (Owner payouts → Company share), as before.
--
--   • vehicles.owner_share  { type: 'percent' | 'percent_min' | 'per_day' | 'fixed', value, min? } or null
--     Only admins and Finance (canViewFinance) change it — like owner_terms (21); anyone else's change
--     is silently kept as it was.
-- =============================================================================

alter table public.vehicles add column if not exists owner_share jsonb;

alter table public.vehicles drop constraint if exists vehicles_owner_share_check;
alter table public.vehicles add constraint vehicles_owner_share_check check (
  owner_share is null or (
    owner_share ->> 'type' in ('percent', 'percent_min', 'per_day', 'fixed')
    and jsonb_typeof(owner_share -> 'value') = 'number' and (owner_share ->> 'value')::numeric >= 0
    and (owner_share ->> 'type' not in ('percent', 'percent_min') or (owner_share ->> 'value')::numeric <= 100)
    and (owner_share ->> 'type' <> 'percent_min' or (jsonb_typeof(owner_share -> 'min') = 'number' and (owner_share ->> 'min')::numeric >= 0))
  )
);

create or replace function private.guard_owner_share() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user <> 'authenticated' or private.is_admin() then return new; end if;
  if to_regprocedure('private.is_staff()') is not null and private.is_staff() and private.staff_may('canViewFinance') then
    return new;
  end if;
  if tg_op = 'INSERT' then new.owner_share := null;
  else new.owner_share := old.owner_share;
  end if;
  return new;
end $$;

drop trigger if exists guard_owner_share on public.vehicles;
create trigger guard_owner_share before insert or update on public.vehicles
  for each row execute function private.guard_owner_share();

-- Finance (canViewFinance) without "Edit vehicle details" could not change how the owner is paid: 16's staff guard
-- kept every vehicle column but status, mileage and the prices. The same guard as in 16, now letting Finance set
-- owner_terms (21) and owner_share (this file). 16 carries the same fix, so running it again keeps it.
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

  elsif tg_table_name = 'vehicles' and tg_op = 'INSERT' then
    -- a new car (canAddVehicle): its owner and details as entered; not on the website, a rental car
    -- (Brian lists it and decides its use); its prices only with canEditPrices
    new := jsonb_populate_record(new, '{"web_featured": false, "web_order": null, "web_price": null, "web_badge": null,
      "web_location": null, "web_wedding": false, "wedding_only": false, "wedding_details": null}'::jsonb);
    if not private.staff_may('canEditPrices') then
      new := jsonb_populate_record(new, '{"daily_rent": 0, "extra_km_rate": null, "included_km_per_day": null}'::jsonb);
    end if;

  elsif tg_table_name = 'vehicles' then
    -- nobody on staff changes a car's owner or website listing (Brian does)
    new := private.keep_cols(new, old, array['id', 'owner_id',
      'web_price', 'web_badge', 'web_category', 'web_featured', 'web_location', 'web_order', 'web_wedding']);
    -- its fixed prices: only with canEditPrices (Finance)
    if not private.staff_may('canEditPrices') then
      new := private.keep_cols(new, old, array['daily_rent', 'extra_km_rate', 'included_km_per_day']);
    end if;
    if not private.staff_may('canEditVehicle') then
      new := private.only_cols(new, old, array['status', 'mileage', 'revenue', 'rent_count']
        || case when private.staff_may('canEditPrices') then array['daily_rent', 'extra_km_rate', 'included_km_per_day', 'wedding_details'] else '{}'::text[] end
        -- how the owner is paid (21) and the commission agreed with them (29): Finance's, checked again by their own guards
        || case when private.staff_may('canViewFinance') then array['owner_terms', 'owner_share'] else '{}'::text[] end);
      -- (wedding_details: file 20's guard_wedding_cols has already kept everything in it but the prices)
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

notify pgrst, 'reload schema';
