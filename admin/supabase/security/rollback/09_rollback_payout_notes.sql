-- Undo 09_payout_notes.sql: removes the reason column and its protection (payout amounts are untouched).
drop trigger if exists protect_commission_note on public.commissions;
drop function if exists private.protect_commission_note();
alter table public.commissions drop column if exists note;
notify pgrst, 'reload schema';
