-- =============================================================================
-- 30 · Bookings an owner entered themselves (their own customers)
-- Run after 01_scoped_access.sql. Safe to re-run. Undo: rollback/30_rollback_owner_entered_bookings.sql
--
-- Owners see the customers of their car's bookings only as first name + initials, without phone, NIC,
-- address or documents (the customer is the company's). A booking the owner entered themselves is their own
-- customer, so they keep the full details — this column records who entered it.
--
--   • bookings.entered_by_owner  the owner id, set when an owner login records the booking
--     — an owner can only put their OWN id on a booking they add; nobody but an admin changes it later.
-- =============================================================================

alter table public.bookings add column if not exists entered_by_owner text;

create or replace function private.guard_entered_by_owner() returns trigger
language plpgsql set search_path = '' as $$
begin
  if private.is_admin() then return new; end if;
  -- no signed-in login (SQL editor, server functions): leave it as written
  if coalesce(auth.jwt() ->> 'role', '') in ('', 'service_role') then return new; end if;
  if tg_op = 'INSERT' then
    -- only the owner who is signed in, and only their own id
    new.entered_by_owner := case when private.owner_id() is not null and new.entered_by_owner = private.owner_id()
                                 then new.entered_by_owner end;
  elsif new.entered_by_owner is distinct from old.entered_by_owner then
    new.entered_by_owner := old.entered_by_owner;
  end if;
  return new;
end $$;

drop trigger if exists guard_entered_by_owner on public.bookings;
create trigger guard_entered_by_owner before insert or update on public.bookings
  for each row execute function private.guard_entered_by_owner();

notify pgrst, 'reload schema';
