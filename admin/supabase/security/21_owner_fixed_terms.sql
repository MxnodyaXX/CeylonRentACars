-- =============================================================================
-- 21 · Fixed-amount cars (owner terms) and company-carried car expenses
-- Run after 17_owner_settlements.sql. Safe to re-run. Undo: rollback/21_rollback_owner_fixed_terms.sql
--
-- Some owners give their car to the company for a fixed amount: the owner is paid that amount (every month,
-- or once at the end of the term) whether the car is rented or not, and the company keeps every rental in
-- full — no commission split. Set on Vehicles → Edit → "How the owner is paid".
--
--   • vehicles.owner_terms — null = a share of each rental (as before), or
--                            { type: 'fixed', schedule: 'monthly' | 'term', amount, start, end, note }
--                            Only admins and Finance (canViewFinance) change it; owners and the rest of the
--                            team can't (their change is silently put back).
--   • expenses.paid_by     — + 'company_cost': the company paid and carries it (nothing taken off the owner)
--   • Owner settlements    — a fixed amount is a line of kind 'fixed' (no row to lock: the approved
--                            settlement itself is the record that the month was paid)
-- =============================================================================

alter table public.vehicles add column if not exists owner_terms jsonb;

alter table public.vehicles drop constraint if exists vehicles_owner_terms_check;
alter table public.vehicles add constraint vehicles_owner_terms_check check (
  owner_terms is null or (
    owner_terms ->> 'type' = 'fixed'
    and owner_terms ->> 'schedule' in ('monthly', 'term')
    and jsonb_typeof(owner_terms -> 'amount') = 'number' and (owner_terms ->> 'amount')::numeric > 0
    and (owner_terms ->> 'start') ~ '^\d{4}-\d{2}-\d{2}$'
    and (owner_terms ->> 'schedule' = 'monthly' or (owner_terms ->> 'end') ~ '^\d{4}-\d{2}-\d{2}$')
  )
);

-- who may change how the owner is paid: admins and Finance only
create or replace function private.guard_owner_terms() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user <> 'authenticated' or private.is_admin() then return new; end if;
  if to_regprocedure('private.is_staff()') is not null and private.is_staff() and private.staff_may('canViewFinance') then
    return new;
  end if;
  if tg_op = 'INSERT' then new.owner_terms := null;
  else new.owner_terms := old.owner_terms;
  end if;
  return new;
end $$;

drop trigger if exists guard_owner_terms on public.vehicles;
create trigger guard_owner_terms before insert or update on public.vehicles
  for each row execute function private.guard_owner_terms();

-- expenses: who paid it
alter table public.expenses drop constraint if exists expenses_paid_by_check;
alter table public.expenses add constraint expenses_paid_by_check
  check (paid_by is null or paid_by in ('company', 'company_cost', 'owner'));
