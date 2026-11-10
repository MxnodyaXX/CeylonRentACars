-- =============================================================================
-- 17 · Monthly owner settlements
-- Run after 16_staff_roles.sql. Safe to re-run. Undo: rollback/17_rollback_owner_settlements.sql
-- IMPORTANT: 01_scoped_access.sql removes every rule when re-run — run 16 and then this file again after it.
--
-- Every booking is paid to the company; once a month the company pays each owner for the rentals
-- COMPLETED that month (whether or not the customer has paid in full — the company chases that):
--   their share of each rental  − amounts they owe back  − expenses the company paid on their cars
--   + referral fees they earned  = net payout
--
--   1. Finance prepares an owner's month   → status pending_approval (every line is kept with it)
--   2. An admin (Brian) approves it          → approved      (or sends it back with a note → returned)
--   3. Finance records the bank transfer     → paid          (lines locked: payout lines Paid, expenses
--                                                             and referral fees marked as settled)
--   4. The owner confirms in their login     → confirmed
-- Steps 2–4 only happen through the functions below; a paid month can't be edited, only corrected
-- with a new adjustment line in a later month.
-- =============================================================================

alter table public.commissions add column if not exists settlement_id text;
alter table public.expenses   add column if not exists paid_by text;
alter table public.expenses   add column if not exists settlement_id text;
alter table public.bookings   add column if not exists referral_settlement_id text;

do $$ begin
  alter table public.expenses add constraint expenses_paid_by_check check (paid_by is null or paid_by in ('company', 'owner'));
exception when duplicate_object then null; end $$;

create table if not exists public.owner_settlements (
  id            text primary key,
  owner_id      text not null references public.owners(id) on delete restrict,
  period        text not null check (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  status        text not null default 'pending_approval'
                check (status in ('pending_approval', 'returned', 'approved', 'paid', 'confirmed')),
  lines         jsonb not null default '[]'::jsonb,       -- every line behind the figure, as prepared
  rentals       numeric(12,2) not null default 0,         -- owner's share of the rentals
  deductions    numeric(12,2) not null default 0,         -- amounts they owe back (≤ 0)
  expenses      numeric(12,2) not null default 0,         -- company-paid expenses on their cars (≥ 0, taken off)
  referral_fees numeric(12,2) not null default 0,         -- fees for customers they referred
  net           numeric(12,2) not null,
  prepared_by   text,
  prepared_at   timestamptz not null default now(),
  review_note   text,
  approved_by   text,
  approved_at   timestamptz,
  paid_by       text,
  paid_at       timestamptz,
  pay_method    text,
  pay_ref       text,
  slip_path     text,
  owner_confirmed_at timestamptz,
  owner_note    text,
  created_at    timestamptz not null default now(),
  unique (owner_id, period)
);
create index if not exists commissions_settlement_idx on public.commissions(settlement_id);
create index if not exists expenses_settlement_idx on public.expenses(settlement_id);

alter table public.owner_settlements enable row level security;
revoke all on public.owner_settlements from anon;
grant select, insert, update, delete on public.owner_settlements to authenticated;

drop policy if exists admin_all on public.owner_settlements;
create policy admin_all on public.owner_settlements for all to authenticated
  using (private.is_admin()) with check (private.is_admin());
-- Finance prepares, re-prepares and withdraws (not once approved — the trigger below)
drop policy if exists staff_select on public.owner_settlements;
drop policy if exists staff_insert on public.owner_settlements;
drop policy if exists staff_update on public.owner_settlements;
drop policy if exists staff_delete on public.owner_settlements;
create policy staff_select on public.owner_settlements for select to authenticated using (private.staff_may('canViewFinance'));
create policy staff_insert on public.owner_settlements for insert to authenticated with check (private.staff_may('canViewFinance'));
create policy staff_update on public.owner_settlements for update to authenticated
  using (private.staff_may('canViewFinance') and status in ('pending_approval', 'returned'))
  with check (private.staff_may('canViewFinance') and status = 'pending_approval');
create policy staff_delete on public.owner_settlements for delete to authenticated
  using (private.staff_may('canViewFinance') and status in ('pending_approval', 'returned'));
-- owners see their own statements once paid
drop policy if exists owner_select on public.owner_settlements;
create policy owner_select on public.owner_settlements for select to authenticated
  using (owner_id = private.owner_id() and status in ('paid', 'confirmed'));

-- ── Guards ───────────────────────────────────────────────────────────────────
-- Signed-in users only prepare (pending_approval); approving, paying and confirming go through the
-- functions below, which switch this guard off for their own change.
create or replace function private.guard_settlement() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user <> 'authenticated' or coalesce(current_setting('ceylon.settle', true), '') = 'on' then return new; end if;
  if tg_op = 'UPDATE' and old.status not in ('pending_approval', 'returned') then
    raise exception 'This settlement is % — it can''t be changed.', old.status;
  end if;
  if tg_op = 'UPDATE' and (new.owner_id is distinct from old.owner_id or new.period is distinct from old.period) then
    raise exception 'The owner and month of a settlement can''t be changed.';
  end if;
  new.status := 'pending_approval';
  new.approved_by := null; new.approved_at := null;
  new.paid_by := null; new.paid_at := null; new.pay_method := null; new.pay_ref := null; new.slip_path := null;
  new.owner_confirmed_at := null; new.owner_note := null;
  new.prepared_by := coalesce(nullif(auth.jwt() -> 'app_metadata' ->> 'name', ''), new.prepared_by);
  new.prepared_at := now();
  return new;
end $$;
drop trigger if exists guard_settlement on public.owner_settlements;
create trigger guard_settlement before insert or update on public.owner_settlements
  for each row execute function private.guard_settlement();

-- A settled payout line or expense is history: corrections are new lines, never edits
create or replace function private.guard_settled_rows() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user <> 'authenticated' or coalesce(current_setting('ceylon.settle', true), '') = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if old.settlement_id is not null then
    if tg_op = 'DELETE' then raise exception 'This was settled with the owner — it can''t be deleted. Add a correction instead.'; end if;
    -- (one table per branch: PL/pgSQL looks up every column named in a condition)
    if tg_table_name = 'commissions' then
      if new.owner_payout is distinct from old.owner_payout or new.total_income is distinct from old.total_income
         or new.status is distinct from old.status or new.owner_id is distinct from old.owner_id
         or new.settlement_id is distinct from old.settlement_id then
        raise exception 'This payout was settled with the owner — add an adjustment line instead of changing it.';
      end if;
    else
      if new.amount is distinct from old.amount or new.vehicle_id is distinct from old.vehicle_id
         or new.paid_by is distinct from old.paid_by or new.date is distinct from old.date
         or new.settlement_id is distinct from old.settlement_id then
        raise exception 'This expense was settled with the owner — add a correction instead of changing it.';
      end if;
    end if;
  elsif tg_op = 'UPDATE' and new.settlement_id is not null then
    raise exception 'Lines are settled by recording the payment on the Owner Settlements page.';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists guard_settled_rows on public.commissions;
create trigger guard_settled_rows before update or delete on public.commissions
  for each row execute function private.guard_settled_rows();
drop trigger if exists guard_settled_rows on public.expenses;
create trigger guard_settled_rows before update or delete on public.expenses
  for each row execute function private.guard_settled_rows();

-- ── 2 · Approve or send back (admin) ─────────────────────────────────────────
create or replace function public.review_owner_settlement(p_id text, p_approve boolean, p_note text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare
  s public.owner_settlements%rowtype;
  v_by text := coalesce(nullif(auth.jwt() -> 'app_metadata' ->> 'name', ''), 'Admin');
begin
  if not private.is_admin() then raise exception 'Only an admin can approve owner payouts.'; end if;
  select * into s from public.owner_settlements where id = p_id for update;
  if not found then raise exception 'Settlement not found.'; end if;
  if s.status <> 'pending_approval' then raise exception 'This settlement is %, not waiting for approval.', s.status; end if;
  if not p_approve and nullif(trim(coalesce(p_note, '')), '') is null then raise exception 'Say why it is sent back.'; end if;
  perform set_config('ceylon.settle', 'on', true);
  update public.owner_settlements set
    status = case when p_approve then 'approved' else 'returned' end,
    review_note = nullif(trim(coalesce(p_note, '')), ''),
    approved_by = case when p_approve then v_by end,
    approved_at = case when p_approve then now() end
  where id = p_id;
  perform set_config('ceylon.settle', '', true);
  return case when p_approve then 'approved' else 'returned' end;
end $$;

-- ── 3 · Record the payment (Finance or admin) ────────────────────────────────
create or replace function public.pay_owner_settlement(p_id text, p_method text, p_ref text, p_paid_at timestamptz default null, p_slip text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare
  s public.owner_settlements%rowtype;
  l jsonb;
  v_by text := coalesce(nullif(auth.jwt() -> 'app_metadata' ->> 'name', ''), 'Admin');
  v_amt numeric; v_pending numeric := 0; n int;
begin
  if not (private.is_admin() or private.staff_may('canViewFinance')) then raise exception 'Only Finance or an admin can record owner payouts.'; end if;
  select * into s from public.owner_settlements where id = p_id for update;
  if not found then raise exception 'Settlement not found.'; end if;
  if s.status <> 'approved' then raise exception 'Only an approved settlement can be paid (this one is %).', s.status; end if;
  if nullif(trim(coalesce(p_method, '')), '') is null then raise exception 'Choose how it was paid.'; end if;
  if s.net > 0 and nullif(trim(coalesce(p_ref, '')), '') is null then raise exception 'Enter the bank transfer / receipt reference.'; end if;

  perform set_config('ceylon.settle', 'on', true);
  for l in select * from jsonb_array_elements(s.lines) loop
    v_amt := (l ->> 'amount')::numeric;
    if l ->> 'kind' in ('rental', 'deduction') then
      update public.commissions set status = 'Paid', settlement_id = s.id
       where id = l ->> 'id' and owner_id = s.owner_id and status <> 'Paid' and settlement_id is null
         and owner_payout = v_amt;
      get diagnostics n = row_count;
      if n = 0 then raise exception 'A payout line changed after it was prepared (%). Send it back and prepare the month again.', l ->> 'label'; end if;
      v_pending := v_pending + v_amt;
    elsif l ->> 'kind' = 'expense' then
      update public.expenses e set settlement_id = s.id
       where e.id = l ->> 'id' and e.settlement_id is null and e.paid_by = 'company' and -e.amount = v_amt
         and exists (select 1 from public.vehicles v where v.id = e.vehicle_id and v.owner_id = s.owner_id);
      get diagnostics n = row_count;
      if n = 0 then raise exception 'An expense changed after it was prepared (%). Send it back and prepare the month again.', l ->> 'label'; end if;
    elsif l ->> 'kind' = 'referral' then
      update public.bookings set referral_paid = true, referral_paid_at = now()::text, referral_settlement_id = s.id
       where id = l ->> 'id' and coalesce(referral_paid, false) = false and referral_fee = v_amt;
      get diagnostics n = row_count;
      if n = 0 then raise exception 'A referral fee changed after it was prepared (%). Send it back and prepare the month again.', l ->> 'label'; end if;
      v_pending := v_pending + v_amt;
    end if;
  end loop;
  -- the owner's running "pending payout" drops by what was paid through it (rentals, owed-back, referral fees)
  update public.owners set pending_payout = greatest(0, pending_payout - v_pending) where id = s.owner_id;
  update public.owner_settlements set status = 'paid', paid_by = v_by, paid_at = coalesce(p_paid_at, now()),
    pay_method = trim(p_method), pay_ref = nullif(trim(coalesce(p_ref, '')), ''), slip_path = nullif(trim(coalesce(p_slip, '')), '')
  where id = p_id;
  perform set_config('ceylon.settle', '', true);
  return 'paid';
end $$;

-- ── 4 · The owner confirms they received it ──────────────────────────────────
create or replace function public.confirm_owner_settlement(p_id text, p_note text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare s public.owner_settlements%rowtype;
begin
  select * into s from public.owner_settlements where id = p_id for update;
  if not found or s.owner_id is distinct from private.owner_id() then raise exception 'Settlement not found.'; end if;
  if s.status <> 'paid' then raise exception 'Only a paid settlement can be confirmed (this one is %).', s.status; end if;
  perform set_config('ceylon.settle', 'on', true);
  update public.owner_settlements set status = 'confirmed', owner_confirmed_at = now(),
    owner_note = nullif(left(trim(coalesce(p_note, '')), 500), '') where id = p_id;
  perform set_config('ceylon.settle', '', true);
  return 'confirmed';
end $$;

revoke all on function public.review_owner_settlement(text, boolean, text), public.pay_owner_settlement(text, text, text, timestamptz, text),
                       public.confirm_owner_settlement(text, text) from public, anon;
grant execute on function public.review_owner_settlement(text, boolean, text), public.pay_owner_settlement(text, text, text, timestamptz, text),
                          public.confirm_owner_settlement(text, text) to authenticated;

-- the payout day of the month (Finance gets a reminder from that day) — Settlements page, admin only
-- and the first day included (rentals completed before it were settled the old way)
insert into public.app_settings (key, value) values ('owner_payouts', '{"day": 5, "from": "2026-10-01"}'::jsonb) on conflict (key) do nothing;
update public.app_settings set value = value || '{"from": "2026-10-01"}'::jsonb where key = 'owner_payouts' and not (value ? 'from');

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'owner_settlements') then
    execute 'alter publication supabase_realtime add table public.owner_settlements';
  end if;
end $$;

notify pgrst, 'reload schema';
