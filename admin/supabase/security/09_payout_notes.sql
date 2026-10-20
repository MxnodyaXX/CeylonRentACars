-- =====================================================================
-- 09 · PAYOUT NOTES (needs 08_breakdown_swaps.sql)
--
-- A reason on an owner payout row (commissions.note), shown to the owner in their Commissions
-- page — e.g. "Breakdown replacement: your CBU-0649 replaced CBU-0745 … 2 days × Rs 5,000".
-- Breakdown payout rows (ids "sw-…") get their reason filled in here; new ones are written by the app.
-- Only admins / server code can set or change a note (owners can't edit their own payout reasons).
--
-- Safe to re-run. Undo: rollback/09_rollback_payout_notes.sql
-- =====================================================================

alter table public.commissions add column if not exists note text;

-- owners keep read access to their rows, but the reason stays as the admin wrote it
create or replace function private.protect_commission_note() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user = 'authenticated' and not private.is_admin() then
    if tg_op = 'INSERT' then new.note := null; else new.note := old.note; end if;
  end if;
  return new;
end $$;
drop trigger if exists protect_commission_note on public.commissions;
create trigger protect_commission_note before insert or update on public.commissions
  for each row execute function private.protect_commission_note();

-- Reasons for the breakdown payout rows recorded before this (only where none is set yet)
update public.commissions c
   set note = 'Breakdown replacement: ' || coalesce(r.vehicle_number, 'your vehicle') || ' replaced ' || coalesce(o.vehicle_number, 'a broken-down car')
           || coalesce(' (' || i.ref || ')', '') || ' — '
           || to_char(s.out_at at time zone 'Asia/Colombo', 'DD Mon') || ' to ' || to_char(s.back_at at time zone 'Asia/Colombo', 'DD Mon')
           || ', ' || s.days || ' day' || case when s.days = 1 then '' else 's' end || ' × Rs ' || to_char(s.replacement_rate, 'FM999,999,990')
  from public.breakdown_vehicle_swaps s
  left join public.vehicles r on r.id = s.replacement_vehicle_id
  left join public.vehicles o on o.id = s.original_vehicle_id
  left join public.breakdown_incidents i on i.id = s.incident_id
 where c.id = s.commission_id and c.note is null and s.status = 'closed';

update public.commissions c
   set note = 'Owes back: breakdown' || coalesce(' ' || i.ref, '') || ' — ' || coalesce(o.vehicle_number, 'your vehicle') || ' was off the road ' || s.days
           || ' day' || case when s.days = 1 then '' else 's' end || ' (payout for this booking was already paid)'
  from public.breakdown_vehicle_swaps s
  left join public.vehicles o on o.id = s.original_vehicle_id
  left join public.breakdown_incidents i on i.id = s.incident_id
 where c.id = s.adjustment_id and c.note is null and s.status = 'closed';

-- Tell those owners once (an alert in their account)
insert into public.notifications (id, type, title, message, related_id, owner_id, read, created_at)
select 'n-' || c.id, 'General',
       case when c.owner_payout >= 0 then 'Payout added: Rs ' || to_char(c.owner_payout, 'FM999,999,990')
            else 'Payout adjustment: −Rs ' || to_char(-c.owner_payout, 'FM999,999,990') end,
       c.note, 'payout:' || c.id, c.owner_id, false, to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  from public.commissions c
 where c.id like 'sw-%' and c.note is not null and c.owner_id is not null
on conflict (id) do nothing;

notify pgrst, 'reload schema';
