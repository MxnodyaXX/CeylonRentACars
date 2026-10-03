-- =============================================================================
-- Ceylon Rent A Cars — public website listing
-- Run once in the Supabase SQL Editor (after schema.sql).
--
-- MRAC is the admin panel: the "Website" page decides which vehicles appear on
-- the customer site (ceylonrentacars) and how they are presented. The customer
-- site reads ONLY the `website_vehicles` view below, which exposes listing-safe
-- columns (no owner, insurance, revenue or plate number).
-- =============================================================================

-- Stop early with a clear message if this is not the admin's database
do $$
begin
  if to_regclass('public.vehicles') is null then
    raise exception 'No "vehicles" table in this Supabase project. Open the project the admin uses (the ref in VITE_SUPABASE_URL in admin/.env.local), or run schema.sql first for a brand-new project.';
  end if;
end $$;

alter table vehicles add column if not exists web_featured boolean not null default false;
alter table vehicles add column if not exists web_order    integer;
alter table vehicles add column if not exists web_category text;     -- economy / sedan / hybrid / suv / luxury / van
alter table vehicles add column if not exists web_badge    text;     -- e.g. "Most booked", "Premium"
alter table vehicles add column if not exists web_location text;     -- pickup area shown on the card
alter table vehicles add column if not exists web_price    numeric(10,2); -- optional "from" price; falls back to daily_rent

-- Three kinds of vehicle image:
--   image_url       (existing) admin image — transparent cut-out for the admin cards
--   hero_image_url  hero image — wide, polished photo for the website hero
--   photo_urls      vehicle photos — real photos customers browse in the vehicle details
alter table vehicles add column if not exists hero_image_url text;
alter table vehicles add column if not exists photo_urls     jsonb not null default '[]'::jsonb;

-- Specs shown in the website's vehicle details (mileage already exists on vehicles)
alter table vehicles add column if not exists fuel_efficiency numeric(5,1);  -- km per litre
alter table vehicles add column if not exists tank_capacity   numeric(5,1);  -- litres

-- Customer reviews, recorded and moderated in the admin (Vehicles → vehicle details)
create table if not exists vehicle_reviews (
  id            uuid primary key default gen_random_uuid(),
  vehicle_id    text not null references vehicles(id) on delete cascade,
  booking_id    text references bookings(id) on delete set null,
  customer_name text not null,
  rating        integer not null check (rating between 1 and 5),
  comment       text,
  published     boolean not null default true,
  created_at    timestamptz not null default now()
);
create index if not exists vehicle_reviews_vehicle_idx on vehicle_reviews (vehicle_id);

-- What the website may read: published reviews only, reviewer shown as "First L."
create or replace view public_reviews as
select
  r.id,
  r.vehicle_id,
  split_part(trim(r.customer_name), ' ', 1)
    || coalesce(' ' || nullif(left(split_part(trim(r.customer_name), ' ', 2), 1), '') || '.', '') as reviewer,
  r.rating,
  r.comment,
  r.created_at
from vehicle_reviews r
where r.published;

grant select on public_reviews to anon, authenticated;

create or replace view website_vehicles as
select
  id,
  brand,
  model,
  year,
  coalesce(web_price, daily_rent) as price,
  image_url,
  seats,
  fuel_type,
  transmission,
  web_category as category,
  web_badge    as badge,
  web_location as location,
  coalesce(web_order, 9999) as sort_order,
  hero_image_url,
  photo_urls,
  (select count(*) from bookings b where b.vehicle_id = vehicles.id and b.status = 'Completed')::int as completed_hires,
  mileage,
  fuel_efficiency,
  tank_capacity,
  (select round(avg(r.rating), 1) from vehicle_reviews r where r.vehicle_id = vehicles.id and r.published) as rating,
  (select count(*) from vehicle_reviews r where r.vehicle_id = vehicles.id and r.published)::int as review_count
from vehicles
where web_featured = true;

grant select on website_vehicles to anon, authenticated;

-- "Popular Vehicles" on the website: the 10 vehicles with the most COMPLETED hires.
-- Bookings are only counted here, inside the database — no booking or customer data
-- reaches the website, just the vehicle's listing details and its hire count.
-- Ties (e.g. vehicles with no hires yet) go to website-listed vehicles, then ones with a photo, then newest.
create or replace view popular_vehicles as
select
  v.id,
  v.brand,
  v.model,
  v.year,
  coalesce(v.web_price, v.daily_rent) as price,
  v.image_url,
  v.seats,
  v.fuel_type,
  v.transmission,
  v.web_category as category,
  v.web_badge    as badge,
  v.web_location as location,
  v.hero_image_url,
  v.photo_urls,
  h.completed_hires,
  row_number() over (
    order by h.completed_hires desc, v.web_featured desc, (v.image_url is not null) desc, v.created_at desc
  )::int as hire_rank,
  v.mileage,
  v.fuel_efficiency,
  v.tank_capacity,
  (select round(avg(r.rating), 1) from vehicle_reviews r where r.vehicle_id = v.id and r.published) as rating,
  (select count(*) from vehicle_reviews r where r.vehicle_id = v.id and r.published)::int as review_count
from vehicles v
join (
  select v2.id, (count(b.id) filter (where b.status = 'Completed'))::int as completed_hires
  from vehicles v2
  left join bookings b on b.vehicle_id = v2.id
  group by v2.id
) h on h.id = v.id
order by hire_rank
limit 10;

grant select on popular_vehicles to anon, authenticated;

-- "All Vehicles" page (/vehicles): the whole fleet with listing-safe columns, its
-- completed-trip count and whether it is free right now (status = 'Available').
create or replace view catalog_vehicles as
select
  v.id,
  v.brand,
  v.model,
  v.year,
  coalesce(v.web_price, v.daily_rent) as price,
  v.image_url,
  v.seats,
  v.fuel_type,
  v.transmission,
  v.web_category as category,
  v.web_badge    as badge,
  v.web_location as location,
  v.hero_image_url,
  v.photo_urls,
  (select count(*) from bookings b where b.vehicle_id = v.id and b.status = 'Completed')::int as completed_hires,
  (v.status = 'Available') as available,
  v.web_featured as featured,
  v.mileage,
  v.fuel_efficiency,
  v.tank_capacity,
  (select round(avg(r.rating), 1) from vehicle_reviews r where r.vehicle_id = v.id and r.published) as rating,
  (select count(*) from vehicle_reviews r where r.vehicle_id = v.id and r.published)::int as review_count
from vehicles v;

grant select on catalog_vehicles to anon, authenticated;

-- Make the API see the new columns immediately (otherwise: "could not find the web_category column ... in the schema cache")
notify pgrst, 'reload schema';
