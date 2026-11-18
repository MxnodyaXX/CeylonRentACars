-- =====================================================================
-- 25 · BOOKING e-AGREEMENT — what the screens need (Stages 4–6 of admin/supabase/EAGREEMENT.md)
--
--   • my_agreement_link()      customer portal: a fresh personal link to one of their own agreements
--                              (they proved their number with the SMS code, so "My bookings" can open it)
--   • eag_templates()          admin: the wording versions                (Settings → e-Agreement)
--   • eag_exceptions()         staff: exceptions waiting / decided         (approver decides in Settings → e-Agreement)
--   • eag_open_requests()      Finance: open advance requests, to match an unmatched payment to
--   • eag_save_policy()        business approver: the company policy values (blank = not approved)
--   • eag_recent()             staff: the latest agreements, for the dashboard list
--
-- Needs 22, 23, 24. Safe to re-run. Undo: rollback/25_rollback_eagreement_screens.sql
-- =====================================================================

-- ── Portal: open my agreement ────────────────────────────────────────────────
create or replace function public.my_agreement_link(p_reference text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a esign.agreements; me text := private.customer_phone(); token text;
begin
  perform private.esign_need(me is not null, 'SIGN_IN_REQUIRED', 'sign in with your mobile number first');
  perform private.esign_need(private.allow('eag:portal-link:' || me, 30, interval '1 hour'), 'RATE_LIMITED', 'please wait a few minutes');
  select * into a from esign.agreements where reference = p_reference and customer_phone_key = me;
  perform private.esign_need(a.id is not null, 'NOT_FOUND', 'agreement not found');
  perform private.esign_need(a.status in ('SENT', 'VIEWED', 'ACCEPTED'), 'BAD_STEP', 'this agreement is ' || lower(a.status));
  -- the links already sent keep working; this is one more, only for this signed-in customer
  token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into esign.access_tokens (agreement_id, token_hash, expires_at, created_by)
  values (a.id, private.esign_sha(token), greatest(a.expires_at, now() + interval '2 days'), 'customer-portal');
  perform private.esign_event(a.inquiry_id, a.id, 'LINK_OPENED_FROM_PORTAL', 'customer');
  return jsonb_build_object('path', '/booking-agreement/' || token);
end $$;

-- ── Admin lists ──────────────────────────────────────────────────────────────
create or replace function public.eag_templates() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.esign_need(private.is_admin(), 'NOT_ALLOWED', 'admins only');
  return coalesce((select jsonb_agg(to_jsonb(t) order by t.version desc) from esign.agreement_templates t), '[]');
end $$;

create or replace function public.eag_exceptions() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.esign_need(private.is_admin() or private.is_staff(), 'NOT_ALLOWED', 'staff only');
  return coalesce((select jsonb_agg(to_jsonb(x) || jsonb_build_object('customer', i.customer_name) order by x.status = 'PENDING' desc, x.requested_at desc)
                     from (select * from esign.exceptions order by requested_at desc limit 100) x
                     left join public.inquiries i on i.id = x.inquiry_id), '[]');
end $$;

create or replace function public.eag_open_requests() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.esign_need(private.esign_can_verify() or private.esign_can('canTakePayments'), 'NOT_ALLOWED', 'Finance only');
  return coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'inquiry_id', r.inquiry_id, 'customer', i.customer_name, 'amount', r.amount,
                                                       'deadline', r.deadline, 'status', r.status, 'reference', a.reference) order by r.created_at)
                     from esign.payment_requests r join public.inquiries i on i.id = r.inquiry_id join esign.agreements a on a.id = r.agreement_id
                    where r.status in ('REQUESTED', 'REPORTED', 'PARTIAL', 'LATE')), '[]');
end $$;

create or replace function public.eag_recent(p_limit int default 20) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.esign_need(private.esign_can('canViewInquiries') or private.esign_can('canSendAgreements'), 'NOT_ALLOWED', 'you can''t see this');
  return coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'reference', a.reference, 'inquiry_id', a.inquiry_id, 'customer', i.customer_name,
                                                       'status', a.status, 'expires_at', a.expires_at, 'decided_at', a.decided_at, 'sent_at', a.sent_at,
                                                       'vehicle', a.snapshot #>> '{vehicle,make_model}') order by coalesce(a.decided_at, a.sent_at, a.created_at) desc)
                     from (select * from esign.agreements where status <> 'DRAFT' order by created_at desc limit least(greatest(p_limit, 1), 100)) a
                     left join public.inquiries i on i.id = a.inquiry_id), '[]');
end $$;

-- The accounts money can be recorded into (names only — no balances), for whoever records or checks payments
create or replace function public.eag_accounts() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.esign_need(private.esign_can('canTakePayments') or private.esign_can_verify() or private.is_admin(), 'NOT_ALLOWED', 'you can''t see this');
  return coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'kind', c.kind) order by c.name)
                     from public.company_accounts c where c.active), '[]');
end $$;

-- ── Policy (the values Brian approves) ───────────────────────────────────────
-- Only the listed keys; numbers must be positive; blanks stay blank (= not approved, sending blocked).
create or replace function public.eag_save_policy(p_policy jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  cur jsonb := private.eag_policy(); nxt jsonb; k text;
  hours text[] := array['link_valid_hours', 'agreement_deadline_hours', 'advance_deadline_hours', 'verification_deadline_hours',
                        'hold_max_hours', 'quotation_valid_hours'];
  texts text[] := array['cancellation_policy_version', 'cancellation_policy_text', 'collection_account_id'];
begin
  perform private.esign_need(private.is_business_approver(), 'NOT_ALLOWED', 'only the business approver changes the policy');
  perform private.esign_need(jsonb_typeof(p_policy) = 'object', 'BAD_INPUT', 'bad policy');
  for k in select jsonb_object_keys(p_policy) loop
    perform private.esign_need(k = any(hours || texts || array['turnaround_minutes', 'advance_rule', 'reminders', 'enforce_from', 'split_admin_approvals']),
      'BAD_INPUT', 'unknown policy value ' || k);
  end loop;
  foreach k in array hours || array['turnaround_minutes'] loop
    if p_policy ? k and jsonb_typeof(p_policy -> k) <> 'null' then
      perform private.esign_need(jsonb_typeof(p_policy -> k) = 'number', 'BAD_INPUT', k || ' must be a number');
      perform private.esign_need((p_policy ->> k)::numeric > 0 or (k = 'turnaround_minutes' and (p_policy ->> k)::numeric = 0),
        'BAD_INPUT', k || ' must be above 0');
    end if;
  end loop;
  if p_policy ? 'advance_rule' and jsonb_typeof(p_policy -> 'advance_rule') <> 'null' then
    perform private.esign_need(p_policy #>> '{advance_rule,type}' in ('percent', 'fixed') and (p_policy #>> '{advance_rule,value}')::numeric > 0
      and (p_policy #>> '{advance_rule,type}' <> 'percent' or (p_policy #>> '{advance_rule,value}')::numeric <= 100), 'BAD_INPUT', 'the advance rule needs a type and a value');
  end if;
  if p_policy ? 'collection_account_id' and coalesce(p_policy ->> 'collection_account_id', '') <> '' then
    perform private.esign_need(exists (select 1 from public.company_accounts c where c.id = p_policy ->> 'collection_account_id' and c.active),
      'BAD_INPUT', 'choose an active company account');
  end if;
  if p_policy ? 'enforce_from' and jsonb_typeof(p_policy -> 'enforce_from') <> 'null' then
    perform private.esign_need(private.try_ts(p_policy ->> 'enforce_from') is not null, 'BAD_INPUT', 'the go-live date isn''t valid');
  end if;
  nxt := cur || p_policy;
  update public.app_settings set value = nxt, updated_at = now() where key = 'eagreement_policy';
  -- kept on the record: who changed which values, from what, to what
  perform private.esign_event('—', null, 'POLICY_UPDATED', 'staff', jsonb_build_object(
    'changes', (select jsonb_object_agg(k2, jsonb_build_object('from', cur -> k2, 'to', nxt -> k2))
                  from jsonb_object_keys(p_policy) k2 where cur -> k2 is distinct from nxt -> k2)));
  return nxt;
end $$;

-- ── Grants ───────────────────────────────────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array['public.my_agreement_link(text)', 'public.eag_accounts()', 'public.eag_templates()', 'public.eag_exceptions()', 'public.eag_open_requests()',
                           'public.eag_recent(int)', 'public.eag_save_policy(jsonb)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
