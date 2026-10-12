-- =====================================================================
-- 02 · HARDEN THE PUBLIC WEBSITE FUNCTIONS
-- submit_booking_request · choose_alternative · submit_feedback
-- (the only things website visitors can call — website.sql + 01_scoped_access.sql)
--
-- Changes:
--   • Rate limits per visitor IP and per phone number (stops scripted spam / flooding).
--   • Changing an existing inquiry (alternatives page) now needs the secret token from the
--     link the team sent (inquiries.alt_token) — the inquiry id + first name is no longer enough.
--   • The trip estimate is calculated here from the vehicle's price, never taken from the browser.
--   • Every text input is length-capped.
-- Reversible: rollback/02_rollback_public_functions.sql
-- Deploy together with the website + admin changes (they send / create the token).
-- =====================================================================

create schema if not exists private;

-- ── Rate limiting ───────────────────────────────────────────────────────────
create table if not exists private.rate_limits (
  bucket      text        not null,     -- e.g. 'booking:ip:1.2.3.4'
  window_start timestamptz not null,
  hits        int         not null default 0,
  primary key (bucket, window_start)
);
revoke all on private.rate_limits from public, anon, authenticated;

-- The visitor's IP as PostgREST passes it (first x-forwarded-for entry); '' when unknown
create or replace function private.client_ip() returns text
language sql stable set search_path = '' as $$
  select left(trim(split_part(coalesce(
    nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for', ''), ',', 1)), 64)
$$;

-- Count one hit in a fixed window; true while still under p_max
create or replace function private.allow(p_bucket text, p_max int, p_window interval) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_start timestamptz := to_timestamp(floor(extract(epoch from now()) / extract(epoch from p_window)) * extract(epoch from p_window));
  v_hits int;
begin
  insert into private.rate_limits (bucket, window_start, hits) values (p_bucket, v_start, 1)
  on conflict (bucket, window_start) do update set hits = private.rate_limits.hits + 1
  returning hits into v_hits;
  -- tidy up old windows now and then
  if random() < 0.02 then delete from private.rate_limits where window_start < now() - interval '3 days'; end if;
  return v_hits <= p_max;
end $$;
revoke all on function private.allow(text, int, interval) from public, anon, authenticated;
revoke all on function private.client_ip() from public, anon, authenticated;

-- ── Secret token for the alternatives link ──────────────────────────────────
alter table public.inquiries add column if not exists alt_token text;

-- ── submit_booking_request ──────────────────────────────────────────────────
drop function if exists public.submit_booking_request(text, text, text, text, text, date, text, date, text, text, text, text, text, numeric, text);
create or replace function public.submit_booking_request(
  p_vehicle_id text, p_name text, p_phone text, p_email text, p_country text,
  p_start_date date, p_start_time text, p_end_date date, p_end_time text,
  p_pickup text, p_return text, p_mode text, p_message text, p_estimate numeric,   -- p_estimate: ignored (calculated here)
  p_alternative_of text default null,
  p_alt_token text default null
) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_vehicle vehicles%rowtype;
  v_parent  inquiries%rowtype;
  v_name    text := left(trim(coalesce(p_name, '')), 80);
  v_phone   text := left(trim(coalesce(p_phone, '')), 30);
  v_digits  text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_email   text := nullif(left(trim(coalesce(p_email, '')), 120), '');
  v_mode    text := coalesce(nullif(left(trim(coalesce(p_mode, '')), 30), ''), 'Self drive');
  v_ref     text := 'CRC-' || upper(substr(md5(gen_random_uuid()::text || clock_timestamp()::text), 1, 6));
  v_ip      text := private.client_ip();
  v_days    int;
  v_estimate numeric;
  v_linked  boolean := false;
  v_old     text;
begin
  -- flood protection: per visitor and per phone number
  if not private.allow('booking:ip:' || coalesce(nullif(v_ip, ''), 'unknown'), 6, interval '1 hour') then
    raise exception 'Too many booking requests from this connection — please try again later or call us.';
  end if;

  if length(v_name) < 2 then raise exception 'Please enter your full name'; end if;
  if length(v_digits) < 7 or length(v_digits) > 15 then raise exception 'Please enter a valid phone or WhatsApp number'; end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'That email address doesn''t look right'; end if;
  if p_start_date is null or p_end_date is null then raise exception 'Please choose your pickup and return dates'; end if;
  if p_start_date < current_date then raise exception 'Pickup date cannot be in the past'; end if;
  if p_start_date > current_date + 365 then raise exception 'Please choose a pickup date within the next year'; end if;
  if p_end_date < p_start_date then raise exception 'Return date must be after the pickup date'; end if;
  if p_end_date - p_start_date > 90 then raise exception 'For rentals longer than 90 days please contact us directly'; end if;

  if not private.allow('booking:phone:' || right(v_digits, 9), 3, interval '1 day') then
    raise exception 'We already have your recent booking requests — our team will contact you shortly.';
  end if;

  select * into v_vehicle from vehicles where id = p_vehicle_id;
  if not found then raise exception 'Please choose a vehicle'; end if;

  if exists (
    select 1 from bookings b
    where b.vehicle_id = p_vehicle_id and b.status in ('Confirmed', 'Ongoing')
      and b.start_date::date <= p_end_date and b.end_date::date >= p_start_date
  ) then
    raise exception 'Sorry, this vehicle is already booked for some of those dates';
  end if;

  v_days := greatest(1, p_end_date - p_start_date);
  v_estimate := coalesce(v_vehicle.web_price, v_vehicle.daily_rent) * v_days;

  -- Continuing an open inquiry with an alternative: needs the secret token from the team's link
  if nullif(trim(p_alternative_of), '') is not null and nullif(trim(p_alt_token), '') is not null then
    select * into v_parent from inquiries
    where id = trim(p_alternative_of) and status = 'Pending'
      and alt_token is not null and alt_token = trim(p_alt_token);
    v_linked := found;
  end if;

  if v_linked then
    v_ref := coalesce(substring(v_parent.notes from 'CRC-[A-Z0-9]+'), v_ref);
    v_old := v_parent.requested_vehicle;
    update inquiries set
      start_date = p_start_date::text,
      end_date   = p_end_date::text,
      notes = concat_ws(E'\n',
        'Website booking request ' || v_ref,
        'Type: ' || v_mode,
        'Pickup: ' || coalesce(nullif(left(p_pickup, 300), ''), '—') || ' · ' || p_start_date || coalesce(' ' || nullif(left(p_start_time, 5), ''), ''),
        'Return: ' || coalesce(nullif(left(p_return, 300), ''), '—') || ' · ' || p_end_date || coalesce(' ' || nullif(left(p_end_time, 5), ''), ''),
        'Days: ' || v_days,
        case when v_email is not null then 'Email: ' || v_email end,
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
      'Type: ' || v_mode,
      'Pickup: ' || coalesce(nullif(left(p_pickup, 300), ''), '—') || ' · ' || p_start_date || coalesce(' ' || nullif(left(p_start_time, 5), ''), ''),
      'Return: ' || coalesce(nullif(left(p_return, 300), ''), '—') || ' · ' || p_end_date || coalesce(' ' || nullif(left(p_end_time, 5), ''), ''),
      'Days: ' || v_days || coalesce(' · Estimate: Rs ' || to_char(v_estimate, 'FM999,999,990'), ''),
      case when v_email is not null then 'Email: ' || v_email end,
      case when nullif(trim(p_country), '') is not null then 'Country: ' || left(trim(p_country), 40) end,
      case when nullif(trim(p_message), '') is not null then 'Message: ' || left(trim(p_message), 1000) end
    ),
    to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    p_vehicle_id
  );

  return v_ref;
end $$;

-- ── choose_alternative ──────────────────────────────────────────────────────
drop function if exists public.choose_alternative(text, text);
create or replace function public.choose_alternative(p_inquiry_id text, p_vehicle_id text, p_token text default null)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_inq     inquiries%rowtype;
  v_vehicle vehicles%rowtype;
  v_choice  int;
begin
  if not private.allow('alt:ip:' || coalesce(nullif(private.client_ip(), ''), 'unknown'), 10, interval '1 hour') then
    raise exception 'Too many attempts — please try again later or contact us.';
  end if;

  select * into v_inq from inquiries
  where id = p_inquiry_id and alt_token is not null and alt_token = trim(coalesce(p_token, ''));
  -- same message whether the inquiry doesn't exist or the token is wrong
  if not found then raise exception 'This link is no longer valid — please contact us and we will help you choose.'; end if;
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

-- ── submit_feedback ─────────────────────────────────────────────────────────
create or replace function public.submit_feedback(
  p_name text, p_country text, p_vehicle_id text,
  p_service_rating int, p_service_comment text,
  p_vehicle_rating int, p_vehicle_comment text
) returns void
language plpgsql security definer set search_path = public as $$
declare v_name text := left(trim(coalesce(p_name, '')), 60);
begin
  if not private.allow('feedback:ip:' || coalesce(nullif(private.client_ip(), ''), 'unknown'), 3, interval '1 hour') then
    raise exception 'Thanks — we already received your feedback. Please try again later if you have more to add.';
  end if;
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

-- ── Who may call them ───────────────────────────────────────────────────────
revoke all on function public.submit_booking_request(text, text, text, text, text, date, text, date, text, text, text, text, text, numeric, text, text) from public;
revoke all on function public.choose_alternative(text, text, text) from public;
revoke all on function public.submit_feedback(text, text, text, int, text, int, text) from public;
grant execute on function public.submit_booking_request(text, text, text, text, text, date, text, date, text, text, text, text, text, numeric, text, text) to anon, authenticated;
grant execute on function public.choose_alternative(text, text, text) to anon, authenticated;
grant execute on function public.submit_feedback(text, text, text, int, text, int, text) to anon, authenticated;
revoke all on function public._switch_inquiry_vehicle(text, text, text) from public, anon, authenticated;

notify pgrst, 'reload schema';
