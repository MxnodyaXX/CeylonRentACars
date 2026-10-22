-- =====================================================================
-- 11 · VEHICLE RECOVERY, CREDIT AND BAD DEBT (needs 01_scoped_access.sql)
--
-- "Recover vehicle" in the admin: the company takes a car back before the rental ends
-- (non-payment, fraud…). The app saves it on the booking's return record
-- (bookings.checklists → return → recovery: reason, details, police ref) and closes the
-- booking as Completed; what's still owed is kept as credit (credit_amount) and/or written
-- off (bad_debt), and the customer can be flagged do-not-rent.
--
-- This file
--   • makes sure every column the app writes exists (no-ops where they already do)
--   • adds recovered / recovery_reason columns, filled in by the database from the return
--     record, so recoveries can be listed and counted in SQL
--   • refuses negative credit / bad-debt amounts (new rows; old rows are left as they are)
--   • only admins can record a recovery or write money off — owners (who can edit their own
--     cars' bookings) can't add, change or remove either
--   • a vehicle_recoveries view (rows each signed-in user is allowed to see)
--
-- Safe to re-run. Undo: rollback/11_rollback_vehicle_recovery.sql
-- =====================================================================

-- 1 · the columns the app writes (all already in schema.sql / fix-missing-columns.sql)
alter table public.bookings  add column if not exists checklists         jsonb;
alter table public.bookings  add column if not exists activity           jsonb;
alter table public.bookings  add column if not exists credit_amount      numeric(12,2);
alter table public.bookings  add column if not exists credit_settled     boolean default false;
alter table public.bookings  add column if not exists bad_debt           numeric(12,2);
alter table public.customers add column if not exists do_not_rent        boolean not null default false;
alter table public.customers add column if not exists do_not_rent_reason text;

-- 2 · recovered bookings, readable in SQL (kept in step with the return record by the database)
alter table public.bookings add column if not exists recovered boolean
  generated always as ((checklists -> 'return' -> 'recovery') is not null) stored;
alter table public.bookings add column if not exists recovery_reason text
  generated always as (checklists #>> '{return,recovery,reason}') stored;
create index if not exists bookings_recovered_idx on public.bookings (recovered) where recovered;

-- 3 · amounts can't go below zero (NOT VALID: checked on new and changed rows only)
alter table public.bookings drop constraint if exists bookings_bad_debt_not_negative;
alter table public.bookings add constraint bookings_bad_debt_not_negative check (bad_debt is null or bad_debt >= 0) not valid;
alter table public.bookings drop constraint if exists bookings_credit_not_negative;
alter table public.bookings add constraint bookings_credit_not_negative check (credit_amount is null or credit_amount >= 0) not valid;

-- 4 · recording a recovery and writing money off are admin decisions
create or replace function private.protect_recovery() returns trigger
language plpgsql set search_path = '' as $$
declare
  old_rec jsonb := case when tg_op = 'UPDATE' then old.checklists -> 'return' -> 'recovery' end;
  old_bad numeric := case when tg_op = 'UPDATE' then coalesce(old.bad_debt, 0) else 0 end;
begin
  if current_user = 'authenticated' and not private.is_admin() then
    if (new.checklists -> 'return' -> 'recovery') is distinct from old_rec then
      raise exception 'Only an admin can record or change a vehicle recovery.';
    end if;
    if coalesce(new.bad_debt, 0) <> old_bad then
      raise exception 'Only an admin can write off an amount as bad debt.';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists protect_recovery on public.bookings;
create trigger protect_recovery before insert or update on public.bookings
  for each row execute function private.protect_recovery();

-- 5 · every recovery with what it left owed (security_invoker: each user sees only the
--     bookings they can already see — admins all, owners their own cars')
create or replace view public.vehicle_recoveries with (security_invoker = true) as
select b.id as booking_id,
       'CRC-' || coalesce(nullif(left(b.created_at::text, 4), ''), '0000') || '-'
         || lpad(upper(right(regexp_replace(b.id, '[^a-zA-Z0-9]', '', 'g'), 4)), 4, '0') as booking_ref,
       b.customer_name, b.customer_phone, b.customer_id,
       v.vehicle_number, b.vehicle_id,
       b.checklists #>> '{return,at}'                 as recovered_at,
       b.checklists #>> '{return,by}'                 as recovered_by,
       b.recovery_reason                               as reason,
       b.checklists #>> '{return,recovery,details}'   as details,
       b.checklists #>> '{return,recovery,policeRef}' as police_ref,
       b.start_date, b.end_date as ended_on,
       b.total_amount                                  as rent,
       coalesce(b.extra_charges, 0)                    as extra_charges,
       coalesce(b.discount, 0)                         as discount,
       b.paid_amount + coalesce(b.advance_amount, 0)   as paid,
       case when coalesce(b.credit_settled, false) then 0 else coalesce(b.credit_amount, 0) end as credit_outstanding,
       coalesce(b.bad_debt, 0)                         as bad_debt,
       coalesce(c.do_not_rent, false)                  as customer_do_not_rent
from public.bookings b
left join public.vehicles  v on v.id = b.vehicle_id
left join public.customers c on c.id = b.customer_id
where b.recovered;

revoke all on public.vehicle_recoveries from anon;
grant select on public.vehicle_recoveries to authenticated;

notify pgrst, 'reload schema';

-- 6 · check (read-only): recoveries recorded so far
select booking_ref, customer_name, vehicle_number, recovered_at, reason, rent, paid, credit_outstanding, bad_debt, customer_do_not_rent
from public.vehicle_recoveries
order by recovered_at desc;
