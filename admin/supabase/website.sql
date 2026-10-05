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

-- ---------------------------------------------------------------------------
-- Customer feedback page (website /feedback)
-- Past customers rate the COMPANY/SERVICE and (optionally) the VEHICLE they hired.
-- Everything arrives unpublished; the admin approves it on the Feedback page.
-- ---------------------------------------------------------------------------
alter table vehicle_reviews add column if not exists source text not null default 'admin';  -- 'admin' | 'customer'

create table if not exists service_reviews (
  id            uuid primary key default gen_random_uuid(),
  customer_name text not null,
  country       text,
  vehicle_id    text references vehicles(id) on delete set null,
  rating        integer not null check (rating between 1 and 5),
  comment       text,
  published     boolean not null default false,
  created_at    timestamptz not null default now()
);

-- The only way the public site can write: validated, length-limited, always unpublished.
create or replace function submit_feedback(
  p_name text, p_country text, p_vehicle_id text,
  p_service_rating int, p_service_comment text,
  p_vehicle_rating int, p_vehicle_comment text
) returns void
language plpgsql security definer set search_path = public as $$
declare v_name text := left(trim(coalesce(p_name, '')), 60);
begin
  if length(v_name) < 2 then raise exception 'Please enter your name'; end if;
  if p_service_rating is null or p_service_rating not between 1 and 5 then raise exception 'Please rate our service'; end if;
  if p_vehicle_id is not null and not exists (select 1 from vehicles where id = p_vehicle_id) then p_vehicle_id := null; end if;

  insert into service_reviews (customer_name, country, vehicle_id, rating, comment)
  values (v_name, nullif(left(trim(coalesce(p_country, '')), 40), ''), p_vehicle_id,
          p_service_rating, nullif(left(trim(coalesce(p_service_comment, '')), 1000), ''));

  if p_vehicle_id is not null and p_vehicle_rating between 1 and 5 then
    insert into vehicle_reviews (vehicle_id, customer_name, rating, comment, published, source)
    values (p_vehicle_id, v_name, p_vehicle_rating, nullif(left(trim(coalesce(p_vehicle_comment, '')), 1000), ''), false, 'customer');
  end if;
end $$;

grant execute on function submit_feedback(text, text, text, int, text, int, text) to anon, authenticated;

-- Vehicle picker on the feedback form: customers recognise their car by its number plate.
-- Kept to this one small view so plate numbers don't spread to the other website data.
create or replace view feedback_vehicles as
select id, brand, model, year, vehicle_number, image_url
from vehicles;

grant select on feedback_vehicles to anon, authenticated;

-- Approved company reviews for the website's homepage, reviewer shown as "First L."
create or replace view public_service_reviews as
select
  s.id,
  split_part(trim(s.customer_name), ' ', 1)
    || coalesce(' ' || nullif(left(split_part(trim(s.customer_name), ' ', 2), 1), '') || '.', '') as reviewer,
  s.country,
  case when v.id is not null then trim(v.brand || ' ' || v.model) end as vehicle,
  s.rating,
  s.comment,
  s.created_at
from service_reviews s
left join vehicles v on v.id = s.vehicle_id
where s.published;

grant select on public_service_reviews to anon, authenticated;

-- Inquiry review page: qualification checklist, quote and the requested vehicle (set by the booking page)
alter table inquiries add column if not exists checklist  jsonb not null default '{}'::jsonb;
alter table inquiries add column if not exists quote      jsonb;
alter table inquiries add column if not exists vehicle_id text;
-- Alternatives: the customer picked another vehicle from the /alternatives page
alter table inquiries add column if not exists alternative_of     text;   -- on the NEW inquiry: the original inquiry id
alter table inquiries add column if not exists alternative_chosen text;   -- on the ORIGINAL inquiry: the new inquiry id
alter table inquiries add column if not exists alternatives_offered jsonb; -- vehicle ids the team offered (only these can be chosen)
-- Every vehicle the inquiry had before its current one: [{ vehicle, vehicleId, replacedAt, reason, quote }]
alter table inquiries add column if not exists vehicle_history jsonb not null default '[]'::jsonb;

-- Internal: move an inquiry to another vehicle, keeping the previous one (and its quote) in vehicle_history.
-- Vehicle-specific checks (availability, fit, price) and the old quote are reset; the estimate is recalculated.
create or replace function _switch_inquiry_vehicle(p_inquiry_id text, p_vehicle_id text, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_inq     inquiries%rowtype;
  v_vehicle vehicles%rowtype;
  v_days    int;
  v_est     text;
begin
  select * into v_inq from inquiries where id = p_inquiry_id for update;
  select * into v_vehicle from vehicles where id = p_vehicle_id;

  v_days := case when coalesce(v_inq.start_date, '') <> '' and coalesce(v_inq.end_date, '') <> ''
                 then greatest(1, v_inq.end_date::date - v_inq.start_date::date) end;
  v_est := case when v_days is not null
                then 'Days: ' || v_days || ' · Estimate: Rs '
                     || to_char(coalesce(v_vehicle.web_price, v_vehicle.daily_rent) * v_days, 'FM999,999,990') end;

  update inquiries set
    vehicle_history = coalesce(v_inq.vehicle_history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'vehicle',    v_inq.requested_vehicle,
      'vehicleId',  v_inq.vehicle_id,
      'replacedAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'reason',     p_reason,
      'quote',      v_inq.quote
    )),
    vehicle_id        = p_vehicle_id,
    requested_vehicle = trim(v_vehicle.brand || ' ' || v_vehicle.model) || coalesce(' (' || nullif(v_vehicle.vehicle_number, '') || ')', ''),
    preferred_brand   = v_vehicle.brand,
    quote             = null,
    checklist         = coalesce(v_inq.checklist, '{}'::jsonb) - 'available' - 'fits' - 'price',
    alternatives_offered = null,
    notes = case
      when v_est is null then v_inq.notes
      when coalesce(v_inq.notes, '') ~ 'Days:' then regexp_replace(v_inq.notes, 'Days:[^\n]*', v_est)
      else concat_ws(E'\n', nullif(v_inq.notes, ''), v_est)
    end
  where id = p_inquiry_id;
end $$;

-- Only the two website functions below may call this
revoke execute on function _switch_inquiry_vehicle(text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Booking page (website /book)
-- Requests become PENDING inquiries in the admin (Inquiries page, referral "Website");
-- the team confirms and converts them into bookings.
-- ---------------------------------------------------------------------------

-- Dates each vehicle is already taken (live bookings only) — no customer details
create or replace view vehicle_busy_dates as
select vehicle_id, start_date, end_date
from bookings
where status in ('Confirmed', 'Ongoing') and vehicle_id is not null;

grant select on vehicle_busy_dates to anon, authenticated;

-- Validated insert of a booking request (checks dates against live bookings); returns the reference number.
-- p_alternative_of: the original inquiry id when the customer booked from the /alternatives page —
-- then the SAME inquiry is updated to the new vehicle (no new inquiry) and keeps its reference.
drop function if exists submit_booking_request(text, text, text, text, text, date, text, date, text, text, text, text, text, numeric);
create or replace function submit_booking_request(
  p_vehicle_id text, p_name text, p_phone text, p_email text, p_country text,
  p_start_date date, p_start_time text, p_end_date date, p_end_time text,
  p_pickup text, p_return text, p_mode text, p_message text, p_estimate numeric,
  p_alternative_of text default null
) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_vehicle vehicles%rowtype;
  v_parent  inquiries%rowtype;
  v_name  text := left(trim(coalesce(p_name, '')), 80);
  v_phone text := left(trim(coalesce(p_phone, '')), 30);
  v_ref   text := 'CRC-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
  v_days  int;
  v_linked boolean := false;
  v_old   text;
begin
  if length(v_name) < 2 then raise exception 'Please enter your full name'; end if;
  if length(regexp_replace(v_phone, '\D', '', 'g')) < 7 then raise exception 'Please enter a valid phone or WhatsApp number'; end if;
  if p_start_date is null or p_end_date is null then raise exception 'Please choose your pickup and return dates'; end if;
  if p_start_date < current_date then raise exception 'Pickup date cannot be in the past'; end if;
  if p_end_date < p_start_date then raise exception 'Return date must be after the pickup date'; end if;
  if p_end_date - p_start_date > 90 then raise exception 'For rentals longer than 90 days please contact us directly'; end if;

  select * into v_vehicle from vehicles where id = p_vehicle_id;
  if not found then raise exception 'Please choose a vehicle'; end if;

  if exists (
    select 1 from bookings b
    where b.vehicle_id = p_vehicle_id and b.status in ('Confirmed', 'Ongoing')
      and b.start_date::date <= p_end_date and b.end_date::date >= p_start_date
  ) then
    raise exception 'Sorry, this vehicle is already booked for some of those dates';
  end if;

  -- Same customer continuing their open inquiry with an alternative vehicle?
  if nullif(trim(p_alternative_of), '') is not null then
    select * into v_parent from inquiries where id = trim(p_alternative_of) and status = 'Pending';
    if found and (
      right(regexp_replace(v_parent.customer_phone, '\D', '', 'g'), 7) = right(regexp_replace(v_phone, '\D', '', 'g'), 7)
      or lower(split_part(trim(v_parent.customer_name), ' ', 1)) = lower(split_part(v_name, ' ', 1))
    ) then
      v_linked := true;
    end if;
  end if;

  v_days := greatest(1, p_end_date - p_start_date);

  if v_linked then
    -- Update the original inquiry: keep its reference, take the (possibly adjusted) trip details from the form
    v_ref := coalesce(substring(v_parent.notes from 'CRC-[A-Z0-9]+'), v_ref);
    v_old := v_parent.requested_vehicle;
    update inquiries set
      start_date = p_start_date::text,
      end_date   = p_end_date::text,
      notes = concat_ws(E'\n',
        'Website booking request ' || v_ref,
        'Type: ' || coalesce(nullif(p_mode, ''), 'Self drive'),
        'Pickup: ' || coalesce(nullif(left(p_pickup, 300), ''), '—') || ' · ' || p_start_date || coalesce(' ' || nullif(left(p_start_time, 5), ''), ''),
        'Return: ' || coalesce(nullif(left(p_return, 300), ''), '—') || ' · ' || p_end_date || coalesce(' ' || nullif(left(p_end_time, 5), ''), ''),
        'Days: ' || v_days,
        case when nullif(trim(p_email), '') is not null then 'Email: ' || left(trim(p_email), 120) end,
        case when nullif(trim(p_country), '') is not null then 'Country: ' || left(trim(p_country), 40) end,
        case when nullif(trim(p_message), '') is not null then 'Message: ' || left(trim(p_message), 1000) end
      )
    where id = v_parent.id;

    perform _switch_inquiry_vehicle(v_parent.id, p_vehicle_id, 'Not available — customer chose an alternative on the booking page');

    insert into inquiry_followups (inquiry_id, channel, outcome, response, staff)
    values (v_parent.id, 'Website', 'Interested',
            'Customer chose an alternative: ' || trim(v_vehicle.brand || ' ' || v_vehicle.model)
              || ' (' || p_start_date || ' → ' || p_end_date || '), replacing ' || v_old || '.',
            'Website');
    return v_ref;
  end if;

  insert into inquiries (id, customer_name, customer_phone, requested_vehicle, preferred_brand,
                         start_date, end_date, referral, status, notes, created_at, vehicle_id)
  values (
    'web_' || lower(substr(v_ref, 5)),
    v_name, v_phone,
    trim(v_vehicle.brand || ' ' || v_vehicle.model) || coalesce(' (' || nullif(v_vehicle.vehicle_number, '') || ')', ''),
    v_vehicle.brand,
    p_start_date::text, p_end_date::text,
    'Website', 'Pending',
    concat_ws(E'\n',
      'Website booking request ' || v_ref,
      'Type: ' || coalesce(nullif(p_mode, ''), 'Self drive'),
      'Pickup: ' || coalesce(nullif(left(p_pickup, 300), ''), '—') || ' · ' || p_start_date || coalesce(' ' || nullif(left(p_start_time, 5), ''), ''),
      'Return: ' || coalesce(nullif(left(p_return, 300), ''), '—') || ' · ' || p_end_date || coalesce(' ' || nullif(left(p_end_time, 5), ''), ''),
      'Days: ' || v_days || coalesce(' · Estimate: Rs ' || to_char(p_estimate, 'FM999,999,990'), ''),
      case when nullif(trim(p_email), '') is not null then 'Email: ' || left(trim(p_email), 120) end,
      case when nullif(trim(p_country), '') is not null then 'Country: ' || left(trim(p_country), 40) end,
      case when nullif(trim(p_message), '') is not null then 'Message: ' || left(trim(p_message), 1000) end
    ),
    to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    p_vehicle_id
  );

  return v_ref;
end $$;

grant execute on function submit_booking_request(text, text, text, text, text, date, text, date, text, text, text, text, text, numeric, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Inquiry follow-ups (admin Inquiries page): every time the team contacts a
-- customer about an inquiry — channel, outcome, what the customer said, next step.
-- ---------------------------------------------------------------------------
create table if not exists inquiry_followups (
  id             uuid primary key default gen_random_uuid(),
  inquiry_id     text not null references inquiries(id) on delete cascade,
  channel        text not null,                 -- Call / WhatsApp / Email / SMS / In person
  outcome        text not null,                 -- Reached / No answer / Interested / …
  response       text,                          -- what the customer said / requirements
  next_follow_up date,                          -- when to contact them again
  staff          text,                          -- who made the contact
  created_at     timestamptz not null default now()
);
create index if not exists inquiry_followups_inquiry_idx on inquiry_followups (inquiry_id, created_at desc);
alter table inquiry_followups disable row level security;

-- ---------------------------------------------------------------------------
-- Alternatives page: the customer picks one of the vehicles the team offered.
-- No form and no new inquiry — the SAME inquiry moves to the chosen vehicle
-- (its 2nd, 3rd… choice); the previous vehicle and its quote stay in vehicle_history.
-- Only vehicles listed in alternatives_offered can be chosen.
-- ---------------------------------------------------------------------------
create or replace function choose_alternative(p_inquiry_id text, p_vehicle_id text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_inq     inquiries%rowtype;
  v_vehicle vehicles%rowtype;
  v_choice  int;
begin
  select * into v_inq from inquiries where id = p_inquiry_id;
  if not found then raise exception 'We could not find your booking request — please contact us.'; end if;
  if v_inq.status <> 'Pending' then
    raise exception 'This booking request has already been confirmed or closed — please message us on WhatsApp if you would like to change the vehicle.';
  end if;
  if not (coalesce(v_inq.alternatives_offered, '[]'::jsonb) ? p_vehicle_id) then
    raise exception 'This offer has changed — please contact us and we will help you choose.';
  end if;

  select * into v_vehicle from vehicles where id = p_vehicle_id;
  if not found then raise exception 'This vehicle is no longer available — please contact us.'; end if;

  if coalesce(v_inq.start_date, '') <> '' and coalesce(v_inq.end_date, '') <> '' and exists (
    select 1 from bookings b
    where b.vehicle_id = p_vehicle_id and b.status in ('Confirmed', 'Ongoing')
      and b.start_date::date <= v_inq.end_date::date and b.end_date::date >= v_inq.start_date::date
  ) then
    raise exception 'Sorry, this vehicle was just booked for your dates — please choose another option.';
  end if;

  v_choice := jsonb_array_length(coalesce(v_inq.vehicle_history, '[]'::jsonb)) + 2;
  perform _switch_inquiry_vehicle(v_inq.id, p_vehicle_id, 'Not available — customer chose an alternative on the website');

  insert into inquiry_followups (inquiry_id, channel, outcome, response, staff)
  values (v_inq.id, 'Website', 'Interested',
          'Customer chose an alternative on the website: ' || trim(v_vehicle.brand || ' ' || v_vehicle.model)
            || ' (vehicle choice ' || v_choice || '), replacing ' || v_inq.requested_vehicle || '.',
          'Website');

  return coalesce(substring(v_inq.notes from 'CRC-[A-Z0-9]+'), v_inq.id);
end $$;

grant execute on function choose_alternative(text, text) to anon, authenticated;

-- The admin (MRAC) signs in with its own logins, not Supabase Auth, and the rest of its tables
-- run with RLS off (see schema.sql). Supabase may switch RLS on automatically for NEW tables,
-- which hides these rows from the admin — so match the rest of the app.
alter table vehicle_reviews disable row level security;
alter table service_reviews disable row level security;

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
