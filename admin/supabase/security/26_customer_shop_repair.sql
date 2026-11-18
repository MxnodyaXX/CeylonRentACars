-- =============================================================================
-- 26 · Breakdown solution "Customer fixes it at a shop"
-- Run after 06_breakdowns.sql. Safe to re-run. Undo: rollback/26_rollback_customer_shop_repair.sql
--
-- For small faults (a flat battery, a puncture, a bulb) the customer is asked to go to a nearby shop and
-- have it replaced. Either the company pays the shop, or the customer pays and the amount is taken off
-- their final bill.
--
--   • breakdown_solutions.kind        + 'customer_repair'
--   • breakdown_solutions.repair_pay_mode  'company'       — the company paid the shop (or will)
--                                          'customer_bill' — the customer paid; taken off the booking bill
--   • breakdown_solutions.bill_credit_ref  the booking payment line that took it off the bill
--     (a non-cash line "Paid at a repair shop" — it moves no money in the company accounts)
-- =============================================================================

alter table public.breakdown_solutions drop constraint if exists breakdown_solutions_kind_check;
alter table public.breakdown_solutions add constraint breakdown_solutions_kind_check check (
  kind in ('onsite_repair', 'replacement', 'partner_vehicle', 'towing_garage', 'alt_transport', 'termination', 'customer_repair')
);

alter table public.breakdown_solutions add column if not exists repair_pay_mode text;
alter table public.breakdown_solutions drop constraint if exists breakdown_solutions_repair_pay_mode_check;
alter table public.breakdown_solutions add constraint breakdown_solutions_repair_pay_mode_check check (
  repair_pay_mode is null or repair_pay_mode in ('company', 'customer_bill')
);
alter table public.breakdown_solutions add column if not exists bill_credit_ref text;

notify pgrst, 'reload schema';
