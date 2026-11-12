-- =============================================================================
-- 20 · Wedding cars as a kind of vehicle
-- Run after 14_wedding_cars.sql (19 is optional). Safe to re-run. Undo: rollback/20_rollback_wedding_vehicles.sql
--
-- Vehicles → Add / Edit → "What is this vehicle for?": Rental car, Wedding car, or Rental & wedding.
--
--   • vehicles.wedding_only    — a wedding car only: kept off the website's rental pages
--                                (a wedding-only car is always a wedding car: web_wedding is true)
--   • vehicles.wedding_details — its wedding hire terms, set in the admin:
--                                { decoration: included | extra | none, packagePrice, hours, extraHour,
--                                  showPrice, highlights }
--                                  cutout (the decorated car, cut out), photos (wedding photos) }
--   • wedding_vehicles         — + decoration and highlights, and the package price and hours only when
--                                "show price" is ticked (the extra-hour rate stays in the admin);
--                                image_url = the wedding cut-out when there is one; + wedding_photos
--   • website_vehicles, popular_vehicles, catalog_vehicles — the same as website.sql, without
--                                wedding-only cars
-- =============================================================================

alter table public.vehicles add column if not exists wedding_only boolean not null default false;
alter table public.vehicles add column if not exists wedding_details jsonb;
alter table public.vehicles add column if not exists wedding_stage jsonb;     -- from 19, in case it hasn't been run

update public.vehicles set web_wedding = true where wedding_only and not web_wedding;
alter table public.vehicles drop constraint if exists vehicles_wedding_only_is_wedding;
alter table public.vehicles add constraint vehicles_wedding_only_is_wedding check (not wedding_only or web_wedding);

-- ── What the team may change (16_staff_roles.sql) ───────────────────────────
--   • wedding_only (which website pages the car is on): admins only, like the rest of the website listing
--   • the wedding package prices (packagePrice, hours, extraHour, showPrice): canEditPrices
--   • the rest of wedding_details (decoration, highlights, pictures): canEditVehicle
create or replace function private.guard_wedding_cols() returns trigger
language plpgsql set search_path = '' as $$
declare
  price_keys constant text[] := array['packagePrice', 'hours', 'extraHour', 'showPrice'];
  d_old jsonb := coalesce(old.wedding_details, '{}'::jsonb);
  d_new jsonb := coalesce(new.wedding_details, '{}'::jsonb);
begin
  if current_user <> 'authenticated' or to_regprocedure('private.is_staff()') is null or not private.is_staff() then
    return new;
  end if;
  new.wedding_only := old.wedding_only;
  if not private.staff_may('canEditPrices') then          -- keep the old prices
    d_new := (d_new - price_keys) || (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from jsonb_each(d_old) e(k, v) where k = any(price_keys));
  end if;
  if not private.staff_may('canEditVehicle') then         -- keep everything but the prices
    d_new := (d_old - price_keys) || (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from jsonb_each(d_new) e(k, v) where k = any(price_keys));
  end if;
  new.wedding_details := case when old.wedding_details is null and new.wedding_details is null then null else d_new end;
  return new;
end $$;
revoke all on function private.guard_wedding_cols() from public, anon;

drop trigger if exists guard_wedding_cols on public.vehicles;
create trigger guard_wedding_cols before update on public.vehicles for each row execute function private.guard_wedding_cols();

-- ── The Wedding Cars page ───────────────────────────────────────────────────
create or replace view public.wedding_vehicles as
select v.id, v.brand, v.model, v.year,
       -- the decorated cut-out uploaded for weddings, else the car's own cut-out
       coalesce(nullif(v.wedding_details->>'cutout', ''), v.image_url) as image_url,
       v.hero_image_url, v.photo_urls,
       v.seats, v.fuel_type, v.transmission, v.web_category as category,
       v.wedding_stage,
       case when v.wedding_details->>'decoration' in ('included', 'extra', 'none')
            then v.wedding_details->>'decoration' end as wedding_decoration,
       nullif(left(trim(coalesce(v.wedding_details->>'highlights', '')), 160), '') as wedding_highlights,
       case when v.wedding_details->>'showPrice' = 'true' and v.wedding_details->>'packagePrice' ~ '^\d{1,9}(\.\d+)?$'
            then (v.wedding_details->>'packagePrice')::numeric end as wedding_price,
       case when v.wedding_details->>'showPrice' = 'true' and v.wedding_details->>'hours' ~ '^\d{1,3}(\.\d+)?$'
            then (v.wedding_details->>'hours')::numeric end as wedding_hours,
       case when jsonb_typeof(v.wedding_details->'photos') = 'array'
            then array(select jsonb_array_elements_text(v.wedding_details->'photos'))
            else '{}'::text[] end as wedding_photos
from public.vehicles v
where v.web_wedding;

revoke all on public.wedding_vehicles from public;
grant select on public.wedding_vehicles to anon, authenticated;

-- ── The rental pages: as in website.sql, without wedding-only cars ─────────
create or replace view public.website_vehicles as
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
from public.vehicles
where web_featured = true and not wedding_only;

create or replace view public.popular_vehicles as
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
from public.vehicles v
join (
  select v2.id, (count(b.id) filter (where b.status = 'Completed'))::int as completed_hires
  from public.vehicles v2
  left join bookings b on b.vehicle_id = v2.id
  group by v2.id
) h on h.id = v.id
where not v.wedding_only
order by hire_rank
limit 10;

create or replace view public.catalog_vehicles as
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
from public.vehicles v
where not v.wedding_only;

grant select on public.website_vehicles, public.popular_vehicles, public.catalog_vehicles to anon, authenticated;

notify pgrst, 'reload schema';
