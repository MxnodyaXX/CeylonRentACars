-- Undo 26_customer_shop_repair.sql. Refused while any "Customer fixes it at a shop" solution exists
-- (breakdown records are never deleted) — cancel-and-keep is not enough; leave 26 in place instead.
do $$
begin
  if exists (select 1 from public.breakdown_solutions where kind = 'customer_repair') then
    raise exception 'Some breakdowns use "Customer fixes it at a shop" — 26 cannot be undone without losing them.';
  end if;
end $$;

alter table public.breakdown_solutions drop constraint if exists breakdown_solutions_repair_pay_mode_check;
alter table public.breakdown_solutions drop column if exists repair_pay_mode;
alter table public.breakdown_solutions drop column if exists bill_credit_ref;
alter table public.breakdown_solutions drop constraint if exists breakdown_solutions_kind_check;
alter table public.breakdown_solutions add constraint breakdown_solutions_kind_check check (
  kind in ('onsite_repair', 'replacement', 'partner_vehicle', 'towing_garage', 'alt_transport', 'termination')
);

notify pgrst, 'reload schema';
