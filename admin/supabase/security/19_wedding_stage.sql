-- =============================================================================
-- 19 · Wedding stage placement
-- Run after 14_wedding_cars.sql. Safe to re-run. Undo: rollback/19_rollback_wedding_stage.sql
--
--   • vehicles.wedding_stage — how the car's picture stands on the wedding page's podium, set in the
--     admin (Website → Wedding cars → Place on stage): position, size, rotation, crop and flip.
--     Empty = the page places it on its own, as before.
--   • wedding_vehicles       — the same view, now with wedding_stage at the end
-- =============================================================================

alter table public.vehicles add column if not exists wedding_stage jsonb;

create or replace view public.wedding_vehicles as
select v.id, v.brand, v.model, v.year, v.image_url, v.hero_image_url, v.photo_urls,
       v.seats, v.fuel_type, v.transmission, v.web_category as category,
       v.wedding_stage
from public.vehicles v
where v.web_wedding;

revoke all on public.wedding_vehicles from public;
grant select on public.wedding_vehicles to anon, authenticated;

notify pgrst, 'reload schema';
