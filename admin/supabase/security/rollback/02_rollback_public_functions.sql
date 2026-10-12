-- =====================================================================
-- ROLLBACK for 02_public_functions.sql
-- Restores the previous website functions exactly as in website.sql (no rate limits,
-- no alternatives token). Only use this if the website must go back to its previous
-- version; the old functions are weaker (see 02_public_functions.sql header).
-- The inquiries.alt_token column and private.rate_limits are left in place (harmless).
-- =====================================================================

drop function if exists public.submit_booking_request(text, text, text, text, text, date, text, date, text, text, text, text, text, numeric, text, text);
drop function if exists public.choose_alternative(text, text, text);

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

grant execute on function public.submit_feedback(text, text, text, int, text, int, text) to anon, authenticated;
grant execute on function public.submit_booking_request(text, text, text, text, text, date, text, date, text, text, text, text, text, numeric, text) to anon, authenticated;
grant execute on function public.choose_alternative(text, text) to anon, authenticated;

notify pgrst, 'reload schema';
