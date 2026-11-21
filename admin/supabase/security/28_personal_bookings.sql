-- =============================================================================
-- 28 · Personal bookings (not company business)
-- Run after 16_staff_roles.sql. Safe to re-run. Undo: rollback/28_rollback_personal_bookings.sql
--
-- A booking marked personal stays on record — it blocks the car on the calendar, keeps its handovers,
-- documents and its own payment log — but the admin app leaves it out of the company accounts,
-- revenue, commissions, owner payouts and credit.
--
--   • bookings.personal  boolean, default false
--   • only an admin can mark or unmark it: a team member's or owner's change is silently kept as it
--     was, and a booking they create is never personal
-- =============================================================================

alter table public.bookings add column if not exists personal boolean not null default false;

create or replace function private.guard_personal_booking() returns trigger
language plpgsql set search_path = '' as $$
begin
  if private.is_admin() then return new; end if;
  -- no signed-in login (SQL editor, server functions): leave it as written
  if coalesce(auth.jwt() ->> 'role', '') in ('', 'service_role') then return new; end if;
  if tg_op = 'INSERT' then
    new.personal := false;
  elsif new.personal is distinct from old.personal then
    new.personal := old.personal;
  end if;
  return new;
end $$;

drop trigger if exists guard_personal_booking on public.bookings;
create trigger guard_personal_booking before insert or update on public.bookings
  for each row execute function private.guard_personal_booking();

notify pgrst, 'reload schema';
