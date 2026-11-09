-- =============================================================================
-- 14 · Wedding cars
-- Run after 02_public_functions.sql. Safe to re-run. Undo: rollback/14_rollback_wedding_cars.sql
--
--   • vehicles.web_wedding — ticked on the admin's Website page
--   • wedding_vehicles     — what the website's /wedding-cars page may read (no price, plate or owner)
--   • submit_wedding_request(p) — a quote request from that page; becomes a Pending inquiry
--
-- Prices are quoted by the team, so nothing here calculates or shows one.
-- =============================================================================

alter table public.vehicles add column if not exists web_wedding boolean not null default false;

create or replace view public.wedding_vehicles as
select v.id, v.brand, v.model, v.year, v.image_url, v.hero_image_url, v.photo_urls,
       v.seats, v.fuel_type, v.transmission, v.web_category as category
from public.vehicles v
where v.web_wedding;

revoke all on public.wedding_vehicles from public;
grant select on public.wedding_vehicles to anon, authenticated;

create or replace function public.submit_wedding_request(p jsonb)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_name     text := left(trim(coalesce(p->>'name', '')), 80);
  v_phone    text := left(trim(coalesce(p->>'phone', '')), 30);
  v_digits   text := regexp_replace(coalesce(p->>'phone', ''), '\D', '', 'g');
  v_email    text := nullif(left(trim(coalesce(p->>'email', '')), 120), '');
  v_event    text := left(trim(coalesce(p->>'event', '')), 30);
  v_venue    text := left(trim(coalesce(p->>'venue', '')), 300);
  v_time     text := nullif(left(trim(coalesce(p->>'time', '')), 5), '');
  v_hours    text := nullif(left(trim(coalesce(p->>'hours', '')), 30), '');
  v_deco     text := nullif(left(trim(coalesce(p->>'decoration', '')), 30), '');
  v_message  text := nullif(left(trim(coalesce(p->>'message', '')), 1000), '');
  v_car      text := nullif(trim(coalesce(p->>'vehicleId', '')), '');
  v_date_txt text := nullif(trim(coalesce(p->>'date', '')), '');
  v_date     date;
  v_vehicle  vehicles%rowtype;
  v_booked   boolean := false;
  v_ref      text := 'CRC-' || upper(substr(md5(gen_random_uuid()::text || clock_timestamp()::text), 1, 6));
begin
  if length(v_name) < 2 then raise exception 'Please enter your full name'; end if;
  if length(v_digits) < 7 or length(v_digits) > 15 then raise exception 'Please enter a valid phone or WhatsApp number'; end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'That email address doesn''t look right'; end if;
  if v_event not in ('Wedding', 'Homecoming', 'Photoshoot', 'Other event') then raise exception 'Please choose the type of event'; end if;
  if v_date_txt is null or v_date_txt !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Please choose the date of your event'; end if;
  begin
    v_date := v_date_txt::date;
  exception when others then
    raise exception 'Please choose the date of your event';
  end;
  if v_date < current_date then raise exception 'The event date cannot be in the past'; end if;
  if v_date > current_date + 730 then raise exception 'Please choose a date within the next two years'; end if;
  if length(v_venue) < 2 then raise exception 'Please tell us the venue or area'; end if;
  if v_time is not null and v_time !~ '^([01]\d|2[0-3]):[0-5]\d$' then v_time := null; end if;

  -- No car chosen = the team suggests one. A chosen car must really be a wedding car.
  if v_car is not null then
    select * into v_vehicle from vehicles where id = v_car and web_wedding;
    if not found then raise exception 'That car isn''t available for weddings — please choose another'; end if;
    v_booked := exists (
      select 1 from bookings b
      where b.vehicle_id = v_car and b.status in ('Confirmed', 'Ongoing')
        and b.start_date::date <= v_date and b.end_date::date >= v_date
    );
  end if;

  -- flood protection: counted only for valid requests, so a typing mistake never uses up a try
  if not private.allow('wedding:ip:' || coalesce(nullif(private.client_ip(), ''), 'unknown'), 6, interval '1 hour') then
    raise exception 'Too many requests from this connection — please try again later or call us.';
  end if;
  if not private.allow('wedding:phone:' || right(v_digits, 9), 3, interval '1 day') then
    raise exception 'We already have your recent requests — our team will contact you shortly.';
  end if;

  insert into inquiries (id, customer_name, customer_phone, requested_vehicle, preferred_brand,
                         start_date, end_date, referral, status, notes, created_at, vehicle_id)
  values (
    'web_' || lower(substr(v_ref, 5)),
    v_name, v_phone,
    case when v_car is null then 'Wedding car — help me choose'
         else trim(v_vehicle.brand || ' ' || v_vehicle.model) || coalesce(' (' || nullif(v_vehicle.vehicle_number, '') || ')', '') end,
    v_vehicle.brand,
    v_date::text, v_date::text,
    'Website', 'Pending',
    concat_ws(E'\n',
      'Website booking request ' || v_ref,
      'Type: Wedding car (with driver)',
      'Event: ' || v_event,
      'Pickup: ' || v_venue || ' · ' || v_date || coalesce(' ' || v_time, ''),
      'Days: 1',
      case when v_hours is not null then 'Hours: ' || v_hours end,
      case when v_deco is not null then 'Decoration: ' || v_deco end,
      case when v_booked then 'Availability: this car already has a booking on this date' end,
      case when v_email is not null then 'Email: ' || v_email end,
      case when v_message is not null then 'Message: ' || v_message end
    ),
    to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    v_car
  );

  return v_ref;
end $$;

revoke all on function public.submit_wedding_request(jsonb) from public;
grant execute on function public.submit_wedding_request(jsonb) to anon, authenticated;

notify pgrst, 'reload schema';