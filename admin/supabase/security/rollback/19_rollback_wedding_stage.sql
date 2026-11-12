-- Undo 19_wedding_stage.sql: the view goes back to how 14 made it, and the placements are removed.
drop view if exists public.wedding_vehicles;
create view public.wedding_vehicles as
select v.id, v.brand, v.model, v.year, v.image_url, v.hero_image_url, v.photo_urls,
       v.seats, v.fuel_type, v.transmission, v.web_category as category
from public.vehicles v
where v.web_wedding;
revoke all on public.wedding_vehicles from public;
grant select on public.wedding_vehicles to anon, authenticated;
alter table public.vehicles drop column if exists wedding_stage;
notify pgrst, 'reload schema';
