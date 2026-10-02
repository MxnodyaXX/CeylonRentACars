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
  photo_urls
from vehicles
where web_featured = true;

grant select on website_vehicles to anon, authenticated;

-- Make the API see the new columns immediately (otherwise: "could not find the web_category column ... in the schema cache")
notify pgrst, 'reload schema';
