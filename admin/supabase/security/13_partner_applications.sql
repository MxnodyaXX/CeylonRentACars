-- =====================================================================
-- 13 · PARTNER APPLICATIONS (website → "List your vehicle")
-- Vehicle owners outside the company apply to list a car. They prove their phone with an SMS
-- code (the same Supabase phone login as "My bookings", role "customer"), then send:
--   their details, the vehicle, the price they ask, photos, documents (CR, revenue licence,
--   insurance, NIC) and the partner agreement they signed on screen.
-- Nothing reaches owners / vehicles until an admin approves the application in the admin app
-- (Partner applications page), which then creates the owner, their login and the vehicle.
--
--   partner_applications   admin only (01's rule). Applicants have NO table access — they call
--                          submit_partner_application() / my_partner_applications() / reply_partner_application()
--   storage: partner-files private bucket; an applicant may only ADD files under their own
--            verified phone (path: <phone>/…); only admins can open them.
--
-- Needs 01 (private.is_admin), 02 (private.allow) and 05 (private.phone_key, private.customer_phone).
-- Also redeploy the Edge Function portal-login (it now sends codes to new numbers for partner sign-up).
-- Re-running 01 drops every storage rule — run this file again after it. Safe to re-run.
-- Undo: rollback/13_rollback_partner_applications.sql
-- =====================================================================

create table if not exists public.partner_applications (
  id              text primary key default ('PA-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6))),
  applicant_type  text not null default 'individual' check (applicant_type in ('individual', 'company')),
  status          text not null default 'Pending'
                  check (status in ('Pending', 'Under review', 'Needs info', 'Approved', 'Rejected', 'Withdrawn')),
  phone           text not null,                  -- verified by the SMS code: 94XXXXXXXXX
  -- the applicant
  name            text not null,
  email           text,
  nic             text not null,
  address         text not null,
  city            text,
  -- the vehicle
  vehicle_number  text not null,
  brand           text not null,
  model           text not null,
  year            int,
  category        text,
  color           text,
  seats           int,
  transmission    text,
  fuel_type       text,
  mileage         int,
  -- the price the owner asks (the agreed one is set at approval)
  asking_daily    numeric(12,2),
  asking_monthly  numeric(12,2),
  price_notes     text,
  available_from  date,
  notes           text,
  -- storage paths in partner-files: photos text[]; documents { cr, revenueLicence, insurance, nicFront, nicBack }
  photos          jsonb not null default '[]'::jsonb,
  documents       jsonb not null default '{}'::jsonb,
  -- { version, text, name, signature (PNG data URL), acceptedAt }
  agreement       jsonb not null,
  -- the review (admin)
  info_request    text,                           -- what the admin asked for (status Needs info)
  applicant_reply text,                           -- the applicant's answer from the website
  review_notes    text,
  inspection      jsonb,                          -- { method, date, status, result, notes, by }
  verification    jsonb,                          -- owner check call: { attempts, answers, verdict, … }
  agreed_daily    numeric(12,2),
  agreed_monthly  numeric(12,2),
  commission_rate numeric(5,2),
  decision_reason text,                           -- why rejected
  owner_id        text,                           -- set on approval
  vehicle_id      text,
  decided_by      text,
  decided_at      timestamptz,
  history         jsonb not null default '[]'::jsonb,   -- [{ at, by, text }]
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
-- added after the first version: the owner check call (questions, answers, verdict) — admin only
alter table public.partner_applications add column if not exists verification jsonb;

create index if not exists partner_applications_status_idx on public.partner_applications (status, created_at desc);
create index if not exists partner_applications_phone_idx  on public.partner_applications (phone);

alter table public.partner_applications enable row level security;
drop policy if exists admin_all on public.partner_applications;
create policy admin_all on public.partner_applications for all to authenticated
  using (private.is_admin()) with check (private.is_admin());
revoke all on public.partner_applications from anon;

create or replace function private.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists partner_applications_touch on public.partner_applications;
create trigger partner_applications_touch before update on public.partner_applications
  for each row execute function private.touch_updated_at();

-- ── What an applicant can do (signed in with their phone) ────────────────────
-- Send an application. The phone always comes from the login, never from the form.
create or replace function public.submit_partner_application(p jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_phone text := private.customer_phone();
  v_id    text;
  txt     text;
  -- file paths must sit in the applicant's own folder
  ok_path constant text := '^' || coalesce(v_phone, 'x') || '/[A-Za-z0-9._-]+$';
begin
  if v_phone is null then raise exception 'Please verify your phone number first.'; end if;
  if coalesce(p ->> 'applicantType', 'individual') <> 'individual' then
    raise exception 'Company applications are not open yet — please message us on WhatsApp.';
  end if;
  foreach txt in array array['name', 'nic', 'address', 'vehicleNumber', 'brand', 'model'] loop
    if length(trim(coalesce(p ->> txt, ''))) < 2 then raise exception 'Please fill in %.', txt; end if;
  end loop;
  if coalesce(nullif(p ->> 'askingDaily', '')::numeric, 0) <= 0 and coalesce(nullif(p ->> 'askingMonthly', '')::numeric, 0) <= 0 then
    raise exception 'Please enter the price you ask for the vehicle.';
  end if;
  if length(coalesce(p -> 'agreement' ->> 'signature', '')) < 100 or length(trim(coalesce(p -> 'agreement' ->> 'name', ''))) < 2 then
    raise exception 'Please sign the partner agreement.';
  end if;
  if length(coalesce(p -> 'agreement' ->> 'signature', '')) > 400000 then raise exception 'The signature is too large.'; end if;
  if jsonb_typeof(coalesce(p -> 'photos', '[]')) <> 'array' or jsonb_array_length(coalesce(p -> 'photos', '[]')) > 12
     or exists (select 1 from jsonb_array_elements_text(coalesce(p -> 'photos', '[]')) f where f !~ ok_path) then
    raise exception 'The photos could not be attached — please upload them again.';
  end if;
  if jsonb_typeof(coalesce(p -> 'documents', '{}')) <> 'object'
     or exists (select 1 from jsonb_each_text(coalesce(p -> 'documents', '{}')) d
                where d.key not in ('cr', 'revenueLicence', 'insurance', 'nicFront', 'nicBack') or d.value !~ ok_path) then
    raise exception 'The documents could not be attached — please upload them again.';
  end if;

  if not private.allow('partner:apply:' || v_phone, 5, interval '1 day') then
    raise exception 'Too many applications from this number today — please message us on WhatsApp.';
  end if;

  insert into public.partner_applications (
    applicant_type, phone, name, email, nic, address, city,
    vehicle_number, brand, model, year, category, color, seats, transmission, fuel_type, mileage,
    asking_daily, asking_monthly, price_notes, available_from, notes, photos, documents, agreement, history
  ) values (
    'individual', v_phone,
    left(trim(p ->> 'name'), 120), nullif(left(trim(coalesce(p ->> 'email', '')), 160), ''),
    left(trim(p ->> 'nic'), 20), left(trim(p ->> 'address'), 300), nullif(left(trim(coalesce(p ->> 'city', '')), 80), ''),
    upper(left(trim(p ->> 'vehicleNumber'), 20)), left(trim(p ->> 'brand'), 60), left(trim(p ->> 'model'), 60),
    nullif(p ->> 'year', '')::int, nullif(left(p ->> 'category', 40), ''), nullif(left(trim(coalesce(p ->> 'color', '')), 40), ''),
    nullif(p ->> 'seats', '')::int, nullif(left(p ->> 'transmission', 20), ''), nullif(left(p ->> 'fuelType', 20), ''),
    nullif(p ->> 'mileage', '')::int,
    nullif(p ->> 'askingDaily', '')::numeric, nullif(p ->> 'askingMonthly', '')::numeric,
    nullif(left(trim(coalesce(p ->> 'priceNotes', '')), 500), ''), nullif(p ->> 'availableFrom', '')::date,
    nullif(left(trim(coalesce(p ->> 'notes', '')), 1000), ''),
    coalesce(p -> 'photos', '[]'), coalesce(p -> 'documents', '{}'),
    jsonb_build_object(
      'version', left(coalesce(p -> 'agreement' ->> 'version', ''), 40),
      'text', left(coalesce(p -> 'agreement' ->> 'text', ''), 30000),
      'name', left(trim(p -> 'agreement' ->> 'name'), 120),
      'signature', p -> 'agreement' ->> 'signature',
      'acceptedAt', now()),
    jsonb_build_array(jsonb_build_object('at', now(), 'by', 'Applicant', 'text', 'Application sent from the website'))
  ) returning id into v_id;
  return v_id;
end $$;

-- The applicant's own applications and where each one stands (no admin notes)
drop function if exists public.my_partner_applications();
create function public.my_partner_applications() returns table (
  id text, status text, vehicle text, vehicle_number text, asking_daily numeric, asking_monthly numeric,
  info_request text, applicant_reply text, agreed_daily numeric, agreed_monthly numeric, decision_reason text, created_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  select a.id, a.status, trim(a.brand || ' ' || a.model), a.vehicle_number, a.asking_daily, a.asking_monthly,
         case when a.status = 'Needs info' then a.info_request end, a.applicant_reply,
         case when a.status = 'Approved' then a.agreed_daily end, case when a.status = 'Approved' then a.agreed_monthly end,
         case when a.status = 'Rejected' then a.decision_reason end, a.created_at
  from public.partner_applications a
  where private.customer_phone() is not null and a.phone = private.customer_phone()
  order by a.created_at desc
  limit 20
$$;

-- Answer the admin's question (status Needs info): a reply and, optionally, more files
create or replace function public.reply_partner_application(p_id text, p_reply text, p_photos jsonb default '[]', p_documents jsonb default '{}')
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_phone text := private.customer_phone();
  ok_path constant text := '^' || coalesce(v_phone, 'x') || '/[A-Za-z0-9._-]+$';
begin
  if v_phone is null then raise exception 'Please verify your phone number first.'; end if;
  if length(trim(coalesce(p_reply, ''))) < 2 and coalesce(jsonb_array_length(p_photos), 0) = 0 and p_documents = '{}'::jsonb then
    raise exception 'Please write a reply or add the files we asked for.';
  end if;
  if jsonb_typeof(p_photos) <> 'array' or jsonb_array_length(p_photos) > 12
     or exists (select 1 from jsonb_array_elements_text(p_photos) f where f !~ ok_path)
     or jsonb_typeof(p_documents) <> 'object'
     or exists (select 1 from jsonb_each_text(p_documents) d
                where d.key not in ('cr', 'revenueLicence', 'insurance', 'nicFront', 'nicBack') or d.value !~ ok_path) then
    raise exception 'The files could not be attached — please upload them again.';
  end if;
  update public.partner_applications a set
    applicant_reply = nullif(left(trim(coalesce(p_reply, '')), 2000), ''),
    photos = case when jsonb_array_length(a.photos || p_photos) <= 24 then a.photos || p_photos else a.photos end,
    documents = a.documents || p_documents,
    status = 'Pending',
    history = a.history || jsonb_build_array(jsonb_build_object('at', now(), 'by', 'Applicant', 'text',
      'Replied: ' || coalesce(nullif(left(trim(coalesce(p_reply, '')), 300), ''), 'files added')))
  where a.id = p_id and a.phone = v_phone and a.status = 'Needs info';
  if not found then raise exception 'This application is not waiting for a reply.'; end if;
end $$;

revoke all on function public.submit_partner_application(jsonb) from public, anon;
revoke all on function public.my_partner_applications() from public, anon;
revoke all on function public.reply_partner_application(text, text, jsonb, jsonb) from public, anon;
grant execute on function public.submit_partner_application(jsonb) to authenticated;
grant execute on function public.my_partner_applications() to authenticated;
grant execute on function public.reply_partner_application(text, text, jsonb, jsonb) to authenticated;

-- ── Files: photos and documents ──────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('partner-files', 'partner-files', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Is this file path in the signed-in applicant's own folder? (05 keeps customer_phone() itself
-- away from signed-in users; this only answers yes/no about the caller.)
create or replace function private.own_partner_folder(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.customer_phone() is not null and (storage.foldername(p_name))[1] = private.customer_phone()
$$;
revoke all on function private.own_partner_folder(text) from public, anon;
grant execute on function private.own_partner_folder(text) to authenticated;

drop policy if exists partner_files_insert on storage.objects;
drop policy if exists partner_files_admin on storage.objects;
-- applicants: add files to their own folder only (they can't list, open, replace or delete any)
create policy partner_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'partner-files' and (private.is_admin() or private.own_partner_folder(name)));
-- admins: everything in the bucket
create policy partner_files_admin on storage.objects for all to authenticated
  using (bucket_id = 'partner-files' and private.is_admin())
  with check (bucket_id = 'partner-files' and private.is_admin());

notify pgrst, 'reload schema';
