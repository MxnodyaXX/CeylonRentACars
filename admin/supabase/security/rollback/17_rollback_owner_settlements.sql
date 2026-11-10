-- Undo 17_owner_settlements.sql — removes the approval / payment functions and the locks.
-- The settlements table and the new columns are KEPT (they hold payout history). To remove them too:
--   drop table public.owner_settlements;
--   alter table public.commissions drop column settlement_id;
--   alter table public.expenses drop column paid_by, drop column settlement_id;
--   alter table public.bookings drop column referral_settlement_id;
drop function if exists public.review_owner_settlement(text, boolean, text);
drop function if exists public.pay_owner_settlement(text, text, text, timestamptz, text);
drop function if exists public.confirm_owner_settlement(text, text);
drop trigger if exists guard_settled_rows on public.commissions;
drop trigger if exists guard_settled_rows on public.expenses;
drop trigger if exists guard_settlement on public.owner_settlements;
drop function if exists private.guard_settled_rows();
drop function if exists private.guard_settlement();
notify pgrst, 'reload schema';
