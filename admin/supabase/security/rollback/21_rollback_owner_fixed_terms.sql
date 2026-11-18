-- Undo 21_owner_fixed_terms.sql: cars go back to a share of each rental, and company-carried
-- expenses become "company paid" again (so they come off the owner's next payout — check them first).
drop trigger if exists guard_owner_terms on public.vehicles;
drop function if exists private.guard_owner_terms();
alter table public.vehicles drop constraint if exists vehicles_owner_terms_check;
alter table public.vehicles drop column if exists owner_terms;

update public.expenses set paid_by = 'company' where paid_by = 'company_cost';
alter table public.expenses drop constraint if exists expenses_paid_by_check;
alter table public.expenses add constraint expenses_paid_by_check check (paid_by is null or paid_by in ('company', 'owner'));
