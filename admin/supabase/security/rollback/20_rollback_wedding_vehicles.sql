-- Undo 20_wedding_vehicles.sql: the views go back to how website.sql and 19 made them,
-- and the wedding-only flag and wedding hire terms are removed (wedding cars stay ticked).

-- the Wedding Cars page, as 19 made it
drop view if exists public.wedding_vehicles;
create view public.wedding_vehicles as
select v.id, v.brand, v.model, v.year, v.image_url, v.hero_image_url, v.photo_urls,
       v.seats, v.fuel_type, v.transmission, v.web_category as category,
       v.wedding_stage
from public.vehicles v
where v.web_wedding;
revoke all on public.wedding_vehicles from public;
grant select on public.wedding_vehicles to anon, authenticated;

-- the rental pages, as website.sql made them
create or replace view public.website_vehicles as
select
  id, brand, model, year,
  coalesce(web_price, daily_rent) as price,
  image_url, seats, fuel_type, transmission,
  web_category as category, web_badge as badge, web_location as location,
  coalesce(web_order, 9999) as sort_order,
  hero_image_url, photo_urls,
  (select count(*) from bookings b where b.vehicle_id = vehicles.id and b.status = 'Completed')::int as completed_hires,
  mileage, fuel_efficiency, tank_capacity,
  (select round(avg(r.rating), 1) from vehicle_reviews r where r.vehicle_id = vehicles.id and r.published) as rating,
  (select count(*) from vehicle_reviews r where r.vehicle_id = vehicles.id and r.published)::int as review_count
from public.vehicles
where web_featured = true;

create or replace view public.popular_vehicles as
select
  v.id, v.brand, v.model, v.year,
  coalesce(v.web_price, v.daily_rent) as price,
  v.image_url, v.seats, v.fuel_type, v.transmission,
  v.web_category as category, v.web_badge as badge, v.web_location as location,
  v.hero_image_url, v.photo_urls,
  h.completed_hires,
  row_number() over (
    order by h.completed_hires desc, v.web_featured desc, (v.image_url is not null) desc, v.created_at desc
  )::int as hire_rank,
  v.mileage, v.fuel_efficiency, v.tank_capacity,
  (select round(avg(r.rating), 1) from vehicle_reviews r where r.vehicle_id = v.id and r.published) as rating,
  (select count(*) from vehicle_reviews r where r.vehicle_id = v.id and r.published)::int as review_count
from public.vehicles v
join (
  select v2.id, (count(b.id) filter (where b.status = 'Completed'))::int as completed_hires
  from public.vehicles v2
  left join bookings b on b.vehicle_id = v2.id
  group by v2.id
) h on h.id = v.id
order by hire_rank
limit 10;

create or replace view public.catalog_vehicles as
select
  v.id, v.brand, v.model, v.year,
  coalesce(v.web_price, v.daily_rent) as price,
  v.image_url, v.seats, v.fuel_type, v.transmission,
  v.web_category as category, v.web_badge as badge, v.web_location as location,
  v.hero_image_url, v.photo_urls,
  (select count(*) from bookings b where b.vehicle_id = v.id and b.status = 'Completed')::int as completed_hires,
  (v.status = 'Available') as available,
  v.web_featured as featured,
  v.mileage, v.fuel_efficiency, v.tank_capacity,
  (select round(avg(r.rating), 1) from vehicle_reviews r where r.vehicle_id = v.id and r.published) as rating,
  (select count(*) from vehicle_reviews r where r.vehicle_id = v.id and r.published)::int as review_count
from public.vehicles v;

grant select on public.website_vehicles, public.popular_vehicles, public.catalog_vehicles to anon, authenticated;

drop trigger if exists guard_wedding_cols on public.vehicles;
drop function if exists private.guard_wedding_cols();
alter table public.vehicles drop constraint if exists vehicles_wedding_only_is_wedding;
alter table public.vehicles drop column if exists wedding_only;
alter table public.vehicles drop column if exists wedding_details;
notify pgrst, 'reload schema';
