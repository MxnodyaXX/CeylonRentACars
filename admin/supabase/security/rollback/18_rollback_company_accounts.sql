-- Undo 18_company_accounts.sql — removes the rules and functions. The tables and their records
-- (accounts, company expenses, transfers, closed months) are KEPT. To remove them too:
--   drop table public.account_transfers; drop table public.company_expenses;
--   drop table public.month_closes; drop table public.company_accounts;
--   alter table public.owner_settlements drop column pay_account_id;
drop function if exists public.review_company_expense(text, boolean, text);
drop function if exists public.set_settlement_account(text, text);
drop trigger if exists guard_company_expense on public.company_expenses;
drop trigger if exists guard_transfer on public.account_transfers;
drop function if exists private.guard_company_expense();
drop function if exists private.guard_transfer();
drop function if exists private.month_closed(date);
notify pgrst, 'reload schema';
