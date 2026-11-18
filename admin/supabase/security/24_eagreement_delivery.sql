-- =====================================================================
-- 24 · BOOKING e-AGREEMENT — delivery, PDF and reminders (Stage 3c of admin/supabase/EAGREEMENT.md)
--
--   • eag_agreement_contact()   staff: who to send the link to (the inquiry's number) — used by agreement-notify
--   • eag_log_delivery()        server only: records an SMS / WhatsApp attempt on the timeline (sent ≠ delivered:
--                               the Text.lk delivery report updates sms_log, linked by related_id 'eag:<agreement id>')
--   • eag_deliveries()          staff: the SMS attempts for one agreement with their delivery status
--   • eag_pdf_source()          the agreement-pdf function reads the frozen document through this — with the
--                               customer's link, or as staff
--   • eag_attach_pdf()          server only: stores the ACCEPTED PDF's path + SHA-256 once (it can never change)
--   • eag_due_reminders()       server only: agreements / advances close to their deadline that haven't been reminded
--   • private bucket 'agreements' (no policies — only the server reaches it; people get short signed links)
--
-- Needs 22 and 23. Safe to re-run. Undo: rollback/24_rollback_eagreement_delivery.sql
-- The 5-minute expiry job + the reminder run are scheduled in ../eagreement-cron.sql (needs pg_cron).
-- =====================================================================

insert into storage.buckets (id, name, public) values ('agreements', 'agreements', false)
on conflict (id) do update set public = false;

-- ── Contact for sending ──────────────────────────────────────────────────────
create or replace function public.eag_agreement_contact(p_agreement_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a esign.agreements; i public.inquiries;
begin
  perform private.esign_need(private.esign_can('canSendAgreements'), 'NOT_ALLOWED', 'you can''t send agreements');
  select * into a from esign.agreements where id = p_agreement_id;
  perform private.esign_need(a.id is not null, 'NOT_FOUND', 'agreement not found');
  select * into i from public.inquiries where id = a.inquiry_id;
  return jsonb_build_object('phone', a.customer_phone_key, 'name', i.customer_name, 'reference', a.reference,
                            'expires_at', a.expires_at, 'status', a.status, 'inquiry_id', a.inquiry_id);
end $$;

-- ── Delivery attempts (server only) ──────────────────────────────────────────
create or replace function public.eag_log_delivery(p_agreement_id uuid, p_kind text, p_ok boolean, p_provider_uid text, p_error text, p_meta jsonb default '{}')
returns void language plpgsql security definer set search_path = '' as $$
declare a esign.agreements;
begin
  select * into a from esign.agreements where id = p_agreement_id;
  if a.id is null then raise exception 'NOT_FOUND: agreement not found' using errcode = 'P0001'; end if;
  perform private.esign_event(a.inquiry_id, a.id,
    case when p_kind = 'link' then (case when p_ok then 'SMS_SENT' else 'SMS_FAILED' end)
         else upper(p_kind) || case when p_ok then '_SENT' else '_FAILED' end end,
    'system', coalesce(p_meta, '{}') || jsonb_build_object('provider_uid', p_provider_uid, 'error', left(p_error, 300),
                                                            'note', 'sent to the gateway — delivery is confirmed separately'));
end $$;

create or replace function public.eag_deliveries(p_agreement_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.esign_need(private.esign_can('canViewInquiries') or private.esign_can('canSendAgreements'), 'NOT_ALLOWED', 'you can''t see this');
  return coalesce((select jsonb_agg(jsonb_build_object('at', s.created_at, 'status', s.status, 'category', s.category, 'updated_at', s.updated_at,
                                                       'error', s.error) order by s.created_at)
                     from public.sms_log s where s.related_id = 'eag:' || p_agreement_id::text), '[]');
end $$;

-- ── PDF ──────────────────────────────────────────────────────────────────────
-- What the PDF is made from. With the link (customer) or as staff. The acceptance block shows the masked number.
create or replace function public.eag_pdf_source(p_token text default null, p_agreement_id uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a esign.agreements; d esign.acceptances;
begin
  if p_token is not null then
    a := private.esign_token_agreement(p_token);
  else
    perform private.esign_need(private.esign_can('canViewInquiries') or private.esign_can('canSendAgreements') or private.esign_can_verify(),
      'NOT_ALLOWED', 'you can''t see this');
    select * into a from esign.agreements where id = p_agreement_id;
  end if;
  perform private.esign_need(a.id is not null and a.status <> 'DRAFT', 'NOT_FOUND', 'agreement not found');
  select * into d from esign.acceptances where agreement_id = a.id;
  return jsonb_build_object('id', a.id, 'reference', a.reference, 'status', a.status, 'version', a.version,
    'document', a.snapshot, 'html', a.rendered_html, 'document_hash', a.document_hash, 'expires_at', a.expires_at,
    'pdf_path', a.pdf_path, 'pdf_hash', a.pdf_hash,
    'acceptance', case when d.id is null then null else jsonb_build_object(
      'decision', d.decision, 'at', d.decided_at, 'method', d.verification_method,
      'phone', '+' || left(d.verified_phone_key, 2) || ' ••• ••• ' || right(d.verified_phone_key, 3),
      'statement', d.acceptance_statement, 'statement_version', d.statement_version, 'document_hash', d.accepted_document_hash) end);
end $$;

-- The accepted PDF is stored once; afterwards its path and fingerprint can't change (file 22's guard)
create or replace function public.eag_attach_pdf(p_agreement_id uuid, p_path text, p_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a esign.agreements;
begin
  select * into a from esign.agreements where id = p_agreement_id for update;
  perform private.esign_need(a.id is not null and a.status = 'ACCEPTED', 'BAD_STEP', 'only an accepted agreement gets its stored PDF');
  if a.pdf_hash is not null then return jsonb_build_object('path', a.pdf_path, 'hash', a.pdf_hash, 'already', true); end if;
  perform private.esign_need(p_hash ~ '^[0-9a-f]{64}$' and p_path like 'accepted/%', 'BAD_INPUT', 'bad pdf');
  update esign.agreements set pdf_path = p_path, pdf_hash = p_hash where id = a.id;
  perform private.esign_event(a.inquiry_id, a.id, 'ACCEPTED_PDF_STORED', 'system', jsonb_build_object('path', p_path, 'sha256', p_hash));
  return jsonb_build_object('path', p_path, 'hash', p_hash, 'already', false);
end $$;

-- ── Reminders (server only) ──────────────────────────────────────────────────
-- policy.reminders = {"agreement":[24, 2], "advance":[6]}  → hours before the deadline
-- Each (agreement / request, hours) is reminded once. Reminders carry no link (links aren't stored):
-- they point the customer to "My bookings" on the website, where they sign in with the SMS code.
create or replace function public.eag_due_reminders() returns jsonb
language sql stable security definer set search_path = '' as $$
  with pol as (select coalesce(private.eag_policy() -> 'reminders', '{}'::jsonb) r),
  agr as (
    select a.id, a.reference, a.customer_phone_key phone, a.expires_at deadline, 'agreement' kind, h::numeric hours
      from esign.agreements a, pol, jsonb_array_elements_text(coalesce(pol.r -> 'agreement', '[]')) h
     where a.status in ('SENT', 'VIEWED') and a.expires_at > now() and a.expires_at <= now() + make_interval(secs => h::numeric * 3600)),
  adv as (
    select a.id, a.reference, a.customer_phone_key, r.deadline, 'advance', h::numeric
      from esign.payment_requests r join esign.agreements a on a.id = r.agreement_id, pol,
           jsonb_array_elements_text(coalesce(pol.r -> 'advance', '[]')) h
     where r.status = 'REQUESTED' and r.deadline > now() and r.deadline <= now() + make_interval(secs => h::numeric * 3600)),
  due as (select * from agr union all select * from adv)
  select coalesce(jsonb_agg(jsonb_build_object('agreement_id', d.id, 'reference', d.reference, 'phone', d.phone, 'deadline', d.deadline,
                                               'kind', d.kind, 'hours', d.hours)), '[]')
    from due d
   where not exists (select 1 from esign.events e where e.agreement_id = d.id and e.event_type = 'REMINDER_SENT'
                       and e.metadata ->> 'kind' = d.kind and (e.metadata ->> 'hours')::numeric = d.hours)
$$;

-- ── Grants ───────────────────────────────────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array['public.eag_agreement_contact(uuid)', 'public.eag_deliveries(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  execute 'revoke all on function public.eag_pdf_source(text, uuid) from public';
  execute 'grant execute on function public.eag_pdf_source(text, uuid) to anon, authenticated, service_role';
  foreach f in array array['public.eag_log_delivery(uuid, text, boolean, text, text, jsonb)', 'public.eag_attach_pdf(uuid, text, text)',
                           'public.eag_due_reminders()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
