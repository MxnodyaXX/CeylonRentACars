-- =====================================================================
-- 06 · BREAKDOWN MANAGEMENT (admin → Breakdowns, Booking details → Breakdowns tab)
--
--   breakdown_incidents    one breakdown on a booking (a booking can have several)
--   breakdown_events       timeline / audit trail of everything done on an incident
--   breakdown_solutions    each resolution attempt — on-site repair, replacement, partner vehicle,
--                          towing & garage, alternative transport, termination & refund — one row
--                          per attempt with typed columns for that kind (attempts are never deleted)
--   breakdown_expenses     cost line items (call-out, labour, parts, towing…), voided — never deleted
--   breakdown_allocations  who is responsible for the incident cost (owner / customer / company /
--                          insurance), percent or amount, with the reason; superseded — never deleted
--   breakdown_payments     money actually moving: vendor payments, reimbursements, owner offsets,
--                          customer charges, refunds — reversed, never deleted; one-time keys
--   breakdown_documents    photos, receipts, reports, agreements (files in the private booking-files
--                          bucket under <booking id>/breakdowns/…, opened with signed links)
--
-- Vehicle assignments during a booking use the existing mid-trip exchange record
-- (bookings.exchanges — see admin/src/lib/exchange.ts); a replacement solution links to it.
--
-- Access: admins everything; an owner can READ incidents (and their records) on their own
-- vehicles' bookings; website visitors and customers nothing.
-- Needs 01_scoped_access.sql (private.is_admin / owns_booking / owns_vehicle). Safe to re-run.
-- Undo: rollback/06_rollback_breakdowns.sql
-- =====================================================================

create or replace function private.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;

-- ── Incidents ────────────────────────────────────────────────────────────────
create table if not exists public.breakdown_incidents (
  id               text primary key,
  ref              text not null unique,                  -- BD-YYMMDD-XXXX
  booking_id       text not null references public.bookings(id) on delete restrict,
  vehicle_id       text references public.vehicles(id) on delete set null,
  owner_id         text references public.owners(id) on delete set null,   -- vehicle owner at the time
  reported_at      timestamptz not null default now(),
  occurred_at      timestamptz,
  location         text,
  lat              double precision,
  lng              double precision,
  reported_by      text not null default 'customer' check (reported_by in ('customer', 'owner', 'admin', 'driver')),
  contact_phone    text,
  mileage          integer check (mileage is null or mileage >= 0),
  fuel             text,
  category         text not null check (category in ('mechanical', 'electrical', 'battery', 'tyre', 'overheating', 'accident', 'fuel', 'other')),
  description      text not null,
  driveable        text not null default 'unknown' check (driveable in ('yes', 'limited', 'no', 'unknown')),
  passengers_safe  text not null default 'unknown' check (passengers_safe in ('safe', 'at_risk', 'unknown')),
  urgency          text not null default 'normal' check (urgency in ('low', 'normal', 'high', 'emergency')),
  cause_status     text not null default 'pending' check (cause_status in ('pending', 'assessed')),
  cause            text,
  status           text not null default 'open' check (status in ('open', 'resolved', 'closed', 'disputed', 'cancelled')),
  assigned_to      text,
  resolution       text,
  resolved_at      timestamptz,
  closed_at        timestamptz,
  notes            text,
  created_by       text not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists breakdown_incidents_booking on public.breakdown_incidents (booking_id);
create index if not exists breakdown_incidents_vehicle on public.breakdown_incidents (vehicle_id);
create index if not exists breakdown_incidents_status  on public.breakdown_incidents (status, reported_at desc);

-- ── Timeline ────────────────────────────────────────────────────────────────
create table if not exists public.breakdown_events (
  id           text primary key,
  incident_id  text not null references public.breakdown_incidents(id) on delete restrict,
  at           timestamptz not null default now(),
  by           text not null,
  type         text not null,                  -- created / status / solution / expense / payment / allocation / document / message / note / approval
  text         text not null,
  data         jsonb                           -- small extra details (ids, before/after) — not business data
);
create index if not exists breakdown_events_incident on public.breakdown_events (incident_id, at);

-- ── Solutions (one row per attempt; typed columns per kind) ─────────────────
create table if not exists public.breakdown_solutions (
  id                    text primary key,
  incident_id           text not null references public.breakdown_incidents(id) on delete restrict,
  kind                  text not null check (kind in ('onsite_repair', 'replacement', 'partner_vehicle', 'towing_garage', 'alt_transport', 'termination')),
  status                text not null default 'planned' check (status in ('planned', 'in_progress', 'completed', 'failed', 'cancelled')),
  result                text,
  started_at            timestamptz,
  completed_at          timestamptz,
  notes                 text,
  created_by            text not null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  -- service provider (technician / tow company / garage / transport / partner)
  provider_name         text,
  provider_company      text,
  provider_phone        text,
  provider_area         text,
  assigned_by           text,
  assigned_at           timestamptz,
  acceptance            text check (acceptance is null or acceptance in ('pending', 'accepted', 'declined')),
  -- visit / job times
  depart_at             timestamptz,
  arrive_at             timestamptz,
  work_start_at         timestamptz,
  work_end_at           timestamptz,
  travel_km             numeric(10,1) check (travel_km is null or travel_km >= 0),
  -- on-site repair
  repair_location       text,
  diagnosis             text,
  work_done             text,
  parts_replaced        text,
  remarks               text,
  repair_result         text check (repair_result is null or repair_result in ('repaired', 'partial', 'unsuccessful', 'unsafe', 'inspection_needed', 'needs_tow_or_replacement')),
  clearance_by          text,
  clearance_at          timestamptz,
  customer_confirmed_by text,
  customer_confirmed_at timestamptz,
  -- towing & garage
  pickup_location       text,
  destination           text,
  garage_name           text,
  garage_contact        text,
  mechanic              text,
  inspection_report     text,
  quote_amount          numeric(12,2) check (quote_amount is null or quote_amount >= 0),
  quote_approved_by     text,
  quote_approved_at     timestamptz,
  est_completion        date,
  invoice_amount        numeric(12,2) check (invoice_amount is null or invoice_amount >= 0),
  roadworthy_by         text,
  roadworthy_at         timestamptz,
  dispatch_at           timestamptz,
  collected_at          timestamptz,
  delivered_at          timestamptz,
  -- vehicle replacement (internal) — the car change itself is the booking's exchange record
  exchange_id           text,
  from_vehicle_id       text references public.vehicles(id) on delete set null,
  to_vehicle_id         text references public.vehicles(id) on delete set null,
  rate_scenario         text check (rate_scenario is null or rate_scenario in ('same', 'higher', 'lower')),
  rate_difference       numeric(12,2),
  customer_adjustment   numeric(12,2),                -- approved change to the customer's price (+ charge / − credit)
  adjustment_approved_by text,
  adjustment_approved_at timestamptz,
  delivery_driver       text,
  delivery_driver_phone text,
  delivery_location     text,
  delivery_at           timestamptz,
  collection_person     text,
  collection_location   text,
  collection_at         timestamptz,
  insurance_checked     boolean,
  driver_checked        boolean,
  customer_ack_at       timestamptz,
  -- partner vehicle
  partner_vehicle       text,
  partner_reg           text,
  partner_category      text,
  period_start          timestamptz,
  period_end            timestamptz,
  quoted_amount         numeric(12,2) check (quoted_amount is null or quoted_amount >= 0),
  agreed_amount         numeric(12,2) check (agreed_amount is null or agreed_amount >= 0),
  deposit_amount        numeric(12,2) check (deposit_amount is null or deposit_amount >= 0),
  owner_share_adjustment numeric(12,2),               -- reduction of the original owner's payout for days not served
  company_subsidy       numeric(12,2),
  -- alternative transport
  transport_type        text,
  passengers            integer check (passengers is null or passengers >= 0),
  fare                  numeric(12,2) check (fare is null or fare >= 0),
  -- termination & refund
  terminate_at          timestamptz,
  termination_reason    text,
  customer_agreed_at    timestamptz,
  used_days             integer check (used_days is null or used_days >= 0),
  unused_days           integer check (unused_days is null or unused_days >= 0),
  original_total        numeric(12,2),
  previously_paid       numeric(12,2),
  deductions            numeric(12,2) check (deductions is null or deductions >= 0),
  deductions_note       text,
  credits               numeric(12,2) check (credits is null or credits >= 0),
  refund_proposed       numeric(12,2),
  refund_approved       numeric(12,2) check (refund_approved is null or refund_approved >= 0),
  refund_approved_by    text,
  refund_approved_at    timestamptz,
  refund_status         text check (refund_status is null or refund_status in ('not_required', 'pending_approval', 'approved', 'paid')),
  refund_method         text,
  refund_reference      text,
  refund_paid_at        timestamptz,
  refund_paid_by        text,
  booking_amended_at    timestamptz,                  -- the booking was shortened to the used period
  recovery_status       text check (recovery_status is null or recovery_status in ('pending', 'in_progress', 'recovered'))
);
create index if not exists breakdown_solutions_incident on public.breakdown_solutions (incident_id, created_at);

-- ── Expenses (line items) ────────────────────────────────────────────────────
create table if not exists public.breakdown_expenses (
  id           text primary key,
  incident_id  text not null references public.breakdown_incidents(id) on delete restrict,
  solution_id  text references public.breakdown_solutions(id) on delete restrict,
  category     text not null check (category in ('callout', 'labour', 'parts', 'transport', 'towing', 'garage', 'replacement', 'partner', 'alt_transport', 'tax', 'discount', 'other')),
  description  text not null,
  quantity     numeric(10,2) not null default 1 check (quantity > 0),
  unit_cost    numeric(12,2) not null check (unit_cost >= 0),
  amount       numeric(12,2) not null,                -- quantity × unit cost; negative only for a discount
  vendor       text,
  created_by   text not null,
  created_at   timestamptz not null default now(),
  voided_at    timestamptz,
  voided_by    text,
  void_reason  text,
  check ((category = 'discount') = (amount <= 0)),
  check (abs(amount - round(quantity * unit_cost * case when category = 'discount' then -1 else 1 end, 2)) < 0.01)
);
create index if not exists breakdown_expenses_incident on public.breakdown_expenses (incident_id);

-- ── Responsibility for the incident cost ─────────────────────────────────────
create table if not exists public.breakdown_allocations (
  id                 text primary key,
  incident_id        text not null references public.breakdown_incidents(id) on delete restrict,
  party              text not null check (party in ('owner', 'customer', 'company', 'insurance')),
  mode               text not null check (mode in ('percent', 'amount')),
  value              numeric(12,2) not null check (value >= 0),
  amount             numeric(12,2) not null check (amount >= 0),   -- resolved amount at decision time
  reason             text not null,
  decided_by         text not null,
  decided_at         timestamptz not null default now(),
  superseded_at      timestamptz,                  -- a newer decision replaced this one
  customer_charge_id text,                          -- booking charge created from a customer share (once)
  check (mode <> 'percent' or value <= 100)
);
create index if not exists breakdown_allocations_incident on public.breakdown_allocations (incident_id);

-- ── Money that actually moved ────────────────────────────────────────────────
create table if not exists public.breakdown_payments (
  id               text primary key,
  incident_id      text not null references public.breakdown_incidents(id) on delete restrict,
  expense_id       text references public.breakdown_expenses(id) on delete restrict,
  kind             text not null check (kind in ('vendor_payment', 'reimbursement', 'owner_offset', 'customer_charge', 'refund')),
  payer            text not null check (payer in ('owner', 'customer', 'company', 'insurance')),
  payee            text not null,                -- vendor name, 'company', 'customer', 'owner'
  amount           numeric(12,2) not null check (amount > 0),
  method           text,
  reference        text,
  receipt_path     text,
  paid_at          timestamptz not null default now(),
  status           text not null default 'posted' check (status in ('posted', 'reversed')),
  reversed_by      text,
  reversed_at      timestamptz,
  reverse_reason   text,
  idempotency_key  text not null unique,         -- one per submitted form: a double click can't post twice
  booking_ref      text,                         -- booking charge / payment id it created (customer charge, refund, offset)
  created_by       text not null,
  created_at       timestamptz not null default now()
);
create index if not exists breakdown_payments_incident on public.breakdown_payments (incident_id);

-- ── Documents & evidence ─────────────────────────────────────────────────────
create table if not exists public.breakdown_documents (
  id           text primary key,
  incident_id  text not null references public.breakdown_incidents(id) on delete restrict,
  solution_id  text references public.breakdown_solutions(id) on delete restrict,
  kind         text not null check (kind in ('photo', 'video', 'receipt', 'report', 'agreement', 'other')),
  name         text not null,
  path         text not null,                  -- booking-files bucket: <booking id>/breakdowns/<incident id>/…
  uploaded_by  text not null,
  uploaded_at  timestamptz not null default now()
);
create index if not exists breakdown_documents_incident on public.breakdown_documents (incident_id);

-- ── updated_at ───────────────────────────────────────────────────────────────
drop trigger if exists touch_breakdown_incidents on public.breakdown_incidents;
create trigger touch_breakdown_incidents before update on public.breakdown_incidents for each row execute function private.touch_updated_at();
drop trigger if exists touch_breakdown_solutions on public.breakdown_solutions;
create trigger touch_breakdown_solutions before update on public.breakdown_solutions for each row execute function private.touch_updated_at();

-- ── Row-level security ───────────────────────────────────────────────────────
-- An owner sees an incident when it is on one of their vehicles or their vehicle's booking
create or replace function private.sees_incident(p_incident_id text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.breakdown_incidents i
                 where i.id = p_incident_id and (private.owns_vehicle(i.vehicle_id) or private.owns_booking(i.booking_id)))
$$;
revoke all on function private.sees_incident(text) from public, anon;
grant execute on function private.sees_incident(text) to authenticated;

do $$
declare t text;
begin
  foreach t in array array['breakdown_incidents', 'breakdown_events', 'breakdown_solutions', 'breakdown_expenses',
                           'breakdown_allocations', 'breakdown_payments', 'breakdown_documents'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update on public.%I to authenticated', t);   -- no deletes: history is kept
    execute format('drop policy if exists admin_all on public.%I', t);
    execute format('create policy admin_all on public.%I for all to authenticated using (private.is_admin()) with check (private.is_admin())', t);
    execute format('drop policy if exists owner_select on public.%I', t);
    if t = 'breakdown_incidents' then
      execute 'create policy owner_select on public.breakdown_incidents for select to authenticated using (private.is_owner() and (private.owns_vehicle(vehicle_id) or private.owns_booking(booking_id)))';
    else
      execute format('create policy owner_select on public.%I for select to authenticated using (private.is_owner() and private.sees_incident(incident_id))', t);
    end if;
  end loop;
end $$;
revoke delete on public.breakdown_incidents, public.breakdown_events, public.breakdown_solutions, public.breakdown_expenses,
                 public.breakdown_allocations, public.breakdown_payments, public.breakdown_documents from authenticated;

notify pgrst, 'reload schema';
