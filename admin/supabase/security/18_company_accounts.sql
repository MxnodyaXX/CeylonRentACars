-- =============================================================================
-- 18 · Company accounts: cash & bank accounts, company running costs, transfers, month close
-- Run after 17_owner_settlements.sql. Safe to re-run. Undo: rollback/18_rollback_company_accounts.sql
-- IMPORTANT: 01_scoped_access.sql removes every rule when re-run — run 16, 17 and this file again after it.
--
--   company_accounts   the company's cash box and bank accounts, each with an opening balance
--   company_expenses   running costs not tied to a car (rent, electricity, salaries, ads…).
--                      Above the approval amount (app_settings company_finance.approval_above,
--                      default Rs 25,000) an expense waits for an admin (Brian); below it is approved
--                      at once. Then it is marked paid from an account. "Private" ones (e.g. salaries)
--                      are seen by admins only.
--   account_transfers  money moved between accounts (e.g. cash banked)
--   month_closes       a month checked and closed by an admin: its company expenses and transfers
--                      can no longer be added or changed
-- Who: admins everything; Finance (canViewFinance) reads, adds expenses and transfers, pays approved
-- expenses; nobody else on the team.
-- =============================================================================

create table if not exists public.company_accounts (
  id              text primary key,
  name            text not null,
  kind            text not null default 'bank' check (kind in ('cash', 'bank', 'card', 'online')),
  bank_name       text,
  account_no      text,
  opening_balance numeric(12,2) not null default 0,
  opening_date    date not null default '2026-10-01',
  active          boolean not null default true,
  created_at      timestamptz not null default now()
);

create table if not exists public.company_expenses (
  id           text primary key,
  date         date not null,
  category     text not null,
  amount       numeric(12,2) not null check (amount > 0),
  description  text not null,
  account_id   text references public.company_accounts(id) on delete set null,
  receipt_path text,
  private      boolean not null default false,
  status       text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'paid')),
  requested_by text,
  approved_by  text,
  approved_at  timestamptz,
  review_note  text,
  paid_on      date,
  paid_by      text,
  created_at   timestamptz not null default now()
);

create table if not exists public.account_transfers (
  id           text primary key,
  date         date not null,
  from_account text not null references public.company_accounts(id),
  to_account   text not null references public.company_accounts(id),
  amount       numeric(12,2) not null check (amount > 0),
  note         text,
  by_name      text,
  created_at   timestamptz not null default now(),
  check (from_account <> to_account)
);

create table if not exists public.month_closes (
  period     text primary key check (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  closed_by  text,
  closed_at  timestamptz not null default now(),
  summary    jsonb not null default '{}'::jsonb,
  note       text
);

-- which account an owner payout was paid from (set once, after paying)
alter table public.owner_settlements add column if not exists pay_account_id text;

insert into public.app_settings (key, value) values ('company_finance', '{"approval_above": 25000}'::jsonb) on conflict (key) do nothing;

-- ── Access ───────────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['company_accounts', 'company_expenses', 'account_transfers', 'month_closes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('drop policy if exists admin_all on public.%I', t);
    execute format('create policy admin_all on public.%I for all to authenticated using (private.is_admin()) with check (private.is_admin())', t);
    execute format('drop policy if exists staff_select on public.%I', t);
    execute format('drop policy if exists staff_insert on public.%I', t);
    execute format('drop policy if exists staff_update on public.%I', t);
    execute format('drop policy if exists staff_delete on public.%I', t);
  end loop;
end $$;
create policy staff_select on public.company_accounts  for select to authenticated using (private.staff_may('canViewFinance'));
create policy staff_select on public.month_closes      for select to authenticated using (private.staff_may('canViewFinance'));
create policy staff_select on public.account_transfers for select to authenticated using (private.staff_may('canViewFinance'));
create policy staff_insert on public.account_transfers for insert to authenticated with check (private.staff_may('canViewFinance'));
-- private costs (e.g. salaries) are the admins' only
create policy staff_select on public.company_expenses for select to authenticated using (private.staff_may('canViewFinance') and not private);
create policy staff_insert on public.company_expenses for insert to authenticated with check (private.staff_may('canViewFinance') and not private);
create policy staff_update on public.company_expenses for update to authenticated
  using (private.staff_may('canViewFinance') and not private) with check (private.staff_may('canViewFinance') and not private);
create policy staff_delete on public.company_expenses for delete to authenticated
  using (private.staff_may('canViewFinance') and not private and status in ('pending', 'rejected'));

-- ── Rules ────────────────────────────────────────────────────────────────────
create or replace function private.month_closed(p_date date) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_date is not null and exists (select 1 from public.month_closes where period = to_char(p_date, 'YYYY-MM'))
$$;

create or replace function private.guard_company_expense() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_limit numeric := coalesce((select (value ->> 'approval_above')::numeric from public.app_settings where key = 'company_finance'), 25000);
  v_name  text := coalesce(nullif(auth.jwt() -> 'app_metadata' ->> 'name', ''), 'Staff');
  v_admin boolean := private.is_admin();
begin
  if current_user <> 'authenticated' or coalesce(current_setting('ceylon.expense', true), '') = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  -- a closed month is final
  if tg_op <> 'INSERT' and private.month_closed(old.date) then raise exception 'That month is closed — record a correction in an open month.'; end if;
  if tg_op <> 'DELETE' and private.month_closed(new.date) then raise exception 'That month is closed — use a date in an open month.'; end if;
  if tg_op = 'DELETE' then
    if not v_admin and old.status not in ('pending', 'rejected') then raise exception 'An approved or paid expense can''t be deleted.'; end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    new.requested_by := v_name;
    new.approved_by := null; new.approved_at := null; new.review_note := null; new.paid_on := null; new.paid_by := null;
    -- small costs are approved at once; bigger ones wait for an admin (an admin's own are approved)
    if v_admin or new.amount <= v_limit then
      new.status := 'approved'; new.approved_by := case when v_admin then v_name else 'Auto (under the approval limit)' end; new.approved_at := now();
    else
      new.status := 'pending';
    end if;
    return new;
  end if;
  -- UPDATE
  if old.status = 'paid' and not v_admin then raise exception 'A paid expense can''t be changed.'; end if;
  if not v_admin then
    if new.status is distinct from old.status and not (old.status = 'approved' and new.status = 'paid') then
      raise exception 'Only an admin approves or rejects company expenses.';
    end if;
    if old.status in ('approved', 'paid') and (new.amount is distinct from old.amount or new.category is distinct from old.category
       or new.date is distinct from old.date) then
      raise exception 'An approved expense can''t be changed — reject it and add a new one.';
    end if;
    if old.status = 'pending' and new.amount is distinct from old.amount and new.amount > v_limit then
      new.status := 'pending';
    end if;
    new.approved_by := old.approved_by; new.approved_at := old.approved_at; new.review_note := old.review_note; new.requested_by := old.requested_by;
  end if;
  if new.status = 'paid' and old.status <> 'paid' then
    if new.account_id is null then raise exception 'Choose the account it was paid from.'; end if;
    new.paid_on := coalesce(new.paid_on, current_date); new.paid_by := v_name;
  end if;
  return new;
end $$;
drop trigger if exists guard_company_expense on public.company_expenses;
create trigger guard_company_expense before insert or update or delete on public.company_expenses
  for each row execute function private.guard_company_expense();

create or replace function private.guard_transfer() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user <> 'authenticated' then return case when tg_op = 'DELETE' then old else new end; end if;
  if tg_op <> 'INSERT' and private.month_closed(old.date) then raise exception 'That month is closed.'; end if;
  if tg_op <> 'DELETE' and private.month_closed(new.date) then raise exception 'That month is closed — use a date in an open month.'; end if;
  if tg_op = 'INSERT' then new.by_name := coalesce(nullif(auth.jwt() -> 'app_metadata' ->> 'name', ''), 'Staff'); end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists guard_transfer on public.account_transfers;
create trigger guard_transfer before insert or update or delete on public.account_transfers
  for each row execute function private.guard_transfer();

-- ── Approve / reject (admin) ─────────────────────────────────────────────────
create or replace function public.review_company_expense(p_id text, p_approve boolean, p_note text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare e public.company_expenses%rowtype;
begin
  if not private.is_admin() then raise exception 'Only an admin approves company expenses.'; end if;
  select * into e from public.company_expenses where id = p_id for update;
  if not found then raise exception 'Expense not found.'; end if;
  if e.status <> 'pending' then raise exception 'This expense is %, not waiting for approval.', e.status; end if;
  if not p_approve and nullif(trim(coalesce(p_note, '')), '') is null then raise exception 'Say why it is rejected.'; end if;
  perform set_config('ceylon.expense', 'on', true);
  update public.company_expenses set status = case when p_approve then 'approved' else 'rejected' end,
    approved_by = coalesce(nullif(auth.jwt() -> 'app_metadata' ->> 'name', ''), 'Admin'), approved_at = now(),
    review_note = nullif(trim(coalesce(p_note, '')), '') where id = p_id;
  perform set_config('ceylon.expense', '', true);
  return case when p_approve then 'approved' else 'rejected' end;
end $$;

-- ── Which account an owner payout was paid from (once, after paying) ─────────
create or replace function public.set_settlement_account(p_id text, p_account text)
returns text language plpgsql security definer set search_path = '' as $$
begin
  if not (private.is_admin() or private.staff_may('canViewFinance')) then raise exception 'Only Finance or an admin.'; end if;
  if not exists (select 1 from public.company_accounts where id = p_account) then raise exception 'Account not found.'; end if;
  perform set_config('ceylon.settle', 'on', true);
  update public.owner_settlements set pay_account_id = p_account
   where id = p_id and status in ('paid', 'confirmed') and pay_account_id is null;
  perform set_config('ceylon.settle', '', true);
  return 'ok';
end $$;

revoke all on function public.review_company_expense(text, boolean, text), public.set_settlement_account(text, text) from public, anon;
grant execute on function public.review_company_expense(text, boolean, text), public.set_settlement_account(text, text) to authenticated;
revoke all on function private.month_closed(date) from public, anon;
grant execute on function private.month_closed(date) to authenticated;

do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['company_accounts', 'company_expenses', 'account_transfers', 'month_closes'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

notify pgrst, 'reload schema';
