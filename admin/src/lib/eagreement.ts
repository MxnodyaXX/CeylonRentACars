/*
 * Booking e-Agreement (CRC-AGR-003) — the admin side of admin/supabase/EAGREEMENT.md.
 * Every action is a database function (security/23–25) that checks the caller's abilities and the
 * step's state itself; these wrappers only call them and turn "CODE: words" errors into readable text.
 * Nothing here works in offline demo mode (no Supabase) — the panels say so.
 */
import { useEffect, useState } from 'react';
import { supabase, supabaseEnabled } from './supabase';

export const eagEnabled = supabaseEnabled;

export class EagError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}

/** "POLICY_NOT_APPROVED: these … are not set yet" → EagError(code, "These … are not set yet") */
export function eagError(raw: unknown): EagError {
  const msg = String((raw as { message?: string })?.message ?? raw ?? '');
  const m = /^([A-Z_]+): ([\s\S]*)$/.exec(msg);
  if (!m) return new EagError('ERROR', msg || 'Something went wrong — try again.');
  return new EagError(m[1], m[2].charAt(0).toUpperCase() + m[2].slice(1));
}

async function call<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!eagEnabled) throw new EagError('OFFLINE', 'e-Agreements need the live database.');
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw eagError(error);
  return data as T;
}

/* ── Types (as the database returns them) ── */
export type GateState = 'NO_QUOTATION' | 'LOCKED' | 'PRIORITY_EXPIRED' | 'ELIGIBLE' | 'ADVANCE_REQUESTED' | 'PAYMENT_REPORTED' | 'PAYMENT_VERIFIED' | 'CONFIRMED';
export interface Gate {
  state: GateState; problems: string[];
  quotation_id?: string; quotation_version?: number; agreement_id?: string; agreement_status?: string;
  hold_id?: string; hold_status?: string; hold_stage?: string; stage_deadline?: string; hold_expires_at?: string;
  request_id?: string; request_status?: string; advance?: number;
}
export interface Quotation {
  id: string; reference: string; version: number; vehicle_id: string; vehicle_label: string; vehicle_category?: string;
  pickup_at: string; return_at: string; pickup_location?: string; return_location?: string; rental_type: string;
  rate?: number; units?: number; included_km?: number; extra_km_rate?: number; extras: { label: string; amount: number }[];
  discount: number; total: number; advance_required: number; deposit: number; valid_until: string; status: string;
  accepted_at?: string; created_by: string; created_at: string;
}
export interface Hold { id: string; status: string; stage: string; stage_deadline?: string; expires_at: string; release_reason?: string; vehicle_id: string; created_at: string }
export interface Acceptance { decision: string; decided_at: string; verification_method: string; verified_phone_key?: string; statement_version?: string; accepted_document_hash?: string; decline_reason?: string; reviewed_by?: string; evidence?: Record<string, unknown> }
export interface Agreement {
  id: string; reference: string; version: number; status: string; quotation_version: number; template_version: number;
  expires_at: string; sent_at?: string; first_viewed_at?: string; decided_at?: string; generated_by: string; created_at: string;
  document_hash: string; rendered_html: string; pdf_hash?: string; customer_phone_key: string;
  acceptance?: Acceptance | null; links: number; opens: number;
}
export interface PayRequest { id: string; amount: number; deadline: string; status: string; requested_by: string; created_at: string; agreement_id: string }
export interface Receipt {
  id: string; request_id?: string; inquiry_id?: string; booking_id?: string; amount: number; account_id?: string; bank_reference?: string;
  received_at?: string; reported_by_customer: boolean; status: string; verified_by?: string; verified_at?: string; note?: string; created_by?: string; created_at: string;
  customer?: string; request_amount?: number; request_deadline?: string; account?: string;
}
export interface EagEvent { id: number; event_type: string; actor_type: string; actor_id?: string; at: string; metadata: Record<string, unknown>; agreement_id?: string }
export interface ExceptionRow {
  id: string; kind: string; inquiry_id?: string; booking_id?: string; reason: string; requested_by: string; requested_at: string;
  status: string; decided_by?: string; decided_at?: string; decision_note?: string; details: Record<string, unknown>; customer?: string;
}
export interface Overview {
  gate: Gate; quotations: Quotation[]; holds: Hold[]; agreements: Agreement[]; requests: PayRequest[]; receipts: Receipt[];
  waitlist: { id: string; status: string; created_at: string }[]; exceptions: ExceptionRow[]; events: EagEvent[]; booking_id?: string | null;
}
export interface Allocation {
  booking_id: string; vehicle_id: string; start_date: string; start_time: string; end_date: string; end_time: string;
  total: number; advance: number; deposit: number; rental_type: string; pickup_location?: string; return_location?: string;
}
export interface Policy {
  enforce_from?: string | null; split_admin_approvals?: boolean;
  link_valid_hours?: number | null; agreement_deadline_hours?: number | null; advance_deadline_hours?: number | null;
  verification_deadline_hours?: number | null; hold_max_hours?: number | null; turnaround_minutes?: number | null; quotation_valid_hours?: number | null;
  advance_rule?: { type: 'percent' | 'fixed'; value: number; by_category?: Record<string, { type: 'percent' | 'fixed'; value: number }> } | null;
  collection_account_id?: string | null; cancellation_policy_version?: string | null; cancellation_policy_text?: string | null;
  reminders?: { agreement?: number[]; advance?: number[] } | null;
}
export interface Template { id: string; version: number; title: string; sections: { heading: string; body: string }[]; acceptance_statement: string; status: string; approved_by?: string; approved_at?: string; created_by: string; created_at: string }
export interface Dashboard {
  awaiting_acceptance: number; accepted_awaiting_advance: number; expiring_soon: number; declined_30d: number; expired_30d: number;
  holds_near_expiry: number; payments_to_verify: number; exceptions_pending: number;
}

/* ── Calls ── */
export const eag = {
  overview: (inquiryId: string) => call<Overview>('eag_inquiry_overview', { p_inquiry_id: inquiryId }),
  freezeQuotation: (inquiryId: string, q: Record<string, unknown>) => call<{ id: string; reference: string; version: number; advance_required: number; valid_until: string }>('eag_freeze_quotation', { p_inquiry_id: inquiryId, p_q: q }),
  acceptQuotation: (quotationId: string) => call<{ status: 'HELD' | 'WAITLISTED'; reason?: string; kept_hold?: boolean; expires_at?: string }>('eag_accept_quotation', { p_quotation_id: quotationId }),
  releaseHold: (inquiryId: string, reason: string) => call<void>('eag_release_hold', { p_inquiry_id: inquiryId, p_reason: reason }),
  generate: (inquiryId: string, discloseRegistration: boolean) => call<{ id: string; reference: string; reused: boolean }>('eag_generate_agreement', { p_inquiry_id: inquiryId, p_disclose_registration: discloseRegistration }),
  /** WhatsApp / copy / in person: the link comes back once — it is never stored */
  send: (agreementId: string, channel: 'whatsapp_link' | 'copy' | 'in_person') => call<{ token: string; path: string; expires_at: string; reference: string }>('eag_send_agreement', { p_agreement_id: agreementId, p_channel: channel }),
  revoke: (agreementId: string, reason: string) => call<void>('eag_revoke_agreement', { p_agreement_id: agreementId, p_reason: reason }),
  requestAdvance: (inquiryId: string) => call<{ id: string; amount: number; deadline: string }>('eag_request_advance', { p_inquiry_id: inquiryId }),
  recordReceipt: (inquiryId: string | null, amount: number, accountId: string, reference: string, receivedAt: string, note?: string) =>
    call<{ receipt_id: string; status: string }>('eag_record_receipt', { p_inquiry_id: inquiryId, p_amount: amount, p_account_id: accountId, p_reference: reference, p_received_at: receivedAt, p_note: note ?? null }),
  verifyReceipt: (receiptId: string, decision: string, accountId: string | null, receivedAt: string | null, note: string | null, requestId: string | null) =>
    call<{ status: string; request_status?: string }>('eag_verify_receipt', { p_receipt_id: receiptId, p_decision: decision, p_account_id: accountId, p_received_at: receivedAt, p_note: note, p_request_id: requestId }),
  allocate: (inquiryId: string) => call<Allocation>('eag_allocate', { p_inquiry_id: inquiryId }),
  receiptsToVerify: () => call<Receipt[]>('eag_receipts_to_verify'),
  openRequests: () => call<{ id: string; inquiry_id: string; customer: string; amount: number; deadline: string; status: string; reference: string }[]>('eag_open_requests'),
  dashboard: () => call<Dashboard>('eag_dashboard'),
  recent: (limit = 20) => call<{ id: string; reference: string; inquiry_id: string; customer: string; status: string; expires_at: string; decided_at?: string; sent_at?: string; vehicle?: string }[]>('eag_recent', { p_limit: limit }),
  exceptions: () => call<ExceptionRow[]>('eag_exceptions'),
  requestException: (kind: string, inquiryId: string | null, bookingId: string | null, reason: string, details: Record<string, unknown> = {}) =>
    call<string>('eag_request_exception', { p_kind: kind, p_inquiry_id: inquiryId, p_booking_id: bookingId, p_reason: reason, p_details: details }),
  decideException: (id: string, approve: boolean, note: string) => call<void>('eag_decide_exception', { p_id: id, p_approve: approve, p_note: note || null }),
  useExemption: (exceptionId: string) => call<{ booking_id: string; vehicle_id: string; details: Record<string, string | number> }>('eag_use_gate_exemption', { p_exception_id: exceptionId }),
  manualAcceptance: (agreementId: string, exceptionId: string, description: string) =>
    call<{ status: string }>('eag_record_manual_acceptance', { p_agreement_id: agreementId, p_exception_id: exceptionId, p_evidence: { description } }),
  templates: () => call<Template[]>('eag_templates'),
  saveTemplate: (title: string, sections: { heading: string; body: string }[], statement: string) => call<{ id: string; version: number }>('eag_save_template', { p_title: title, p_sections: sections, p_statement: statement }),
  approveTemplate: (id: string) => call<void>('eag_approve_template', { p_id: id }),
  savePolicy: (patch: Partial<Policy>) => call<Policy>('eag_save_policy', { p_policy: patch }),
  deliveries: (agreementId: string) => call<{ at: string; status: string; category: string; error?: string }[]>('eag_deliveries', { p_agreement_id: agreementId }),
  runExpiry: () => call<Record<string, number>>('eag_run_expiry'),
  accounts: () => call<{ id: string; name: string; kind: string }[]>('eag_accounts'),
};

export async function loadPolicy(): Promise<Policy> {
  if (!eagEnabled) return {};
  const { data, error } = await supabase.from('app_settings').select('value').eq('key', 'eagreement_policy').maybeSingle();
  if (error) throw eagError(error);
  return (data?.value ?? {}) as Policy;
}

/** Is the booking gate on (go-live date reached)? */
export const gateOn = (p: Policy) => !!p.enforce_from && new Date(p.enforce_from).getTime() <= Date.now();

/** The policy, loaded once per page */
export function usePolicy() {
  const [policy, setPolicy] = useState<Policy | null>(null);
  useEffect(() => { let live = true; loadPolicy().then((p) => live && setPolicy(p)).catch(() => live && setPolicy({})); return () => { live = false; }; }, []);
  return policy;
}

/* ── Edge Functions (SMS link, PDF) ── */
async function sessionToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new EagError('SIGNED_OUT', 'Sign in again.');
  return data.session.access_token;
}

/** Text the link to the customer (agreement-notify). The link never reaches the browser. */
export async function sendBySms(agreementId: string): Promise<{ ok: boolean; reference?: string; error?: string }> {
  const t = await sessionToken();
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/agreement-notify`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ agreement_id: agreementId }),
  }).catch(() => null);
  if (!res) return { ok: false, error: 'No connection — try again.' };
  const body = await res.json().catch(() => ({}));
  return res.ok && body.ok ? { ok: true, reference: body.reference } : { ok: false, error: body.error || 'The SMS could not be sent.' };
}

/** Download the agreement PDF (accepted ones: the stored, fingerprinted copy) */
export async function downloadPdf(agreementId: string, reference: string) {
  const t = await sessionToken();
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/agreement-pdf`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ agreement_id: agreementId }),
  });
  if (!res.ok) { const b = await res.json().catch(() => ({})); throw new EagError('PDF', b.error || 'The PDF could not be made.'); }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a'); a.href = url; a.download = `${reference}.pdf`; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/* ── Wording ── */
export const SITE_URL = 'https://ceylonrentacars.lk';

export const lk = (iso?: string | null) => (iso
  ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Colombo', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso))
  : '—');

export const AGREEMENT_STATUS: Record<string, { label: string; cls: string }> = {
  DRAFT: { label: 'Draft', cls: 'bg-navy-100 text-navy-700' },
  SENT: { label: 'Sent', cls: 'bg-sky-100 text-sky-800' },
  VIEWED: { label: 'Viewed', cls: 'bg-indigo-100 text-indigo-800' },
  ACCEPTED: { label: 'Accepted', cls: 'bg-emerald-100 text-emerald-800' },
  DECLINED: { label: 'Declined', cls: 'bg-red-100 text-red-700' },
  EXPIRED: { label: 'Expired', cls: 'bg-amber-100 text-amber-800' },
  SUPERSEDED: { label: 'Superseded', cls: 'bg-navy-100 text-navy-500' },
  REVOKED: { label: 'Revoked', cls: 'bg-navy-100 text-navy-500' },
};

export const EVENT_LABEL: Record<string, string> = {
  QUOTATION_SENT: 'Quotation sent', QUOTATION_ACCEPTED: 'Quotation accepted', PRIORITY_ASSIGNED: 'Temporary priority assigned', WAITLISTED: 'Put on the waiting list',
  WAITLIST_OFFERED: 'Car free — offer to this customer', HOLD_RELEASED: 'Priority released', HOLD_EXPIRED: 'Priority expired', AGREEMENT_GENERATED: 'e-Agreement generated',
  AGREEMENT_SENT: 'e-Agreement sent', AGREEMENT_RESENT: 'e-Agreement sent again (new link)', SMS_SENT: 'SMS handed to the gateway', SMS_FAILED: 'SMS failed',
  REMINDER_SENT: 'Reminder sent', REMINDER_FAILED: 'Reminder failed', AGREEMENT_VIEWED: 'e-Agreement viewed', LINK_OPENED_FROM_PORTAL: 'Opened from My bookings',
  CLARIFICATION_REQUESTED: 'Customer asked a question', IDENTITY_VERIFIED: 'Customer verified (SMS code)', AGREEMENT_ACCEPTED: 'e-Agreement accepted',
  AGREEMENT_DECLINED: 'e-Agreement declined', AGREEMENT_EXPIRED: 'e-Agreement expired', AGREEMENT_REVOKED: 'e-Agreement revoked', REVALIDATION_REQUIRED: 'Accepted after the hold ended — recheck',
  ADVANCE_REQUESTED: 'Advance requested', PAYMENT_REPORTED: 'Payment reported', UNSOLICITED_PAYMENT: 'Payment without a request', PAYMENT_VERIFIED: 'Payment verified',
  PAYMENT_REJECTED: 'Payment rejected', PAYMENT_DUPLICATE: 'Payment marked duplicate', PAYMENT_UNMATCHED: 'Payment unmatched', PAYMENT_REFUND_DUE: 'Payment to refund',
  ADVANCE_VERIFIED: 'Advance verified', PAYMENT_AFTER_HOLD_ENDED: 'Money arrived after the hold ended', ALLOCATION_ISSUED: 'Booking id issued', BOOKING_CONFIRMED: 'Booking confirmed',
  ACCEPTED_PDF_STORED: 'Accepted PDF stored', EXCEPTION_REQUESTED: 'Exception requested', EXCEPTION_APPROVED: 'Exception approved', EXCEPTION_REJECTED: 'Exception rejected',
  MANUAL_ACCEPTANCE_RECORDED: 'Manual acceptance recorded',
};

export const GATE_BANNER: Record<GateState, { title: string; cls: string }> = {
  NO_QUOTATION: { title: 'No quotation sent yet — Advance Request Locked', cls: 'border-navy-200 bg-navy-50 text-navy-700' },
  LOCKED: { title: 'Agreement Pending — Advance Request Locked', cls: 'border-amber-300 bg-amber-50 text-amber-900' },
  PRIORITY_EXPIRED: { title: 'Agreement Accepted — Priority Expired — Revalidation Required', cls: 'border-red-300 bg-red-50 text-red-800' },
  ELIGIBLE: { title: 'Agreement Accepted — Eligible for Advance Request', cls: 'border-emerald-300 bg-emerald-50 text-emerald-900' },
  ADVANCE_REQUESTED: { title: 'Advance requested — waiting for the customer’s payment', cls: 'border-sky-300 bg-sky-50 text-sky-900' },
  PAYMENT_REPORTED: { title: 'Payment reported — Finance verification pending', cls: 'border-indigo-300 bg-indigo-50 text-indigo-900' },
  PAYMENT_VERIFIED: { title: 'Advance verified — allocate the booking', cls: 'border-emerald-400 bg-emerald-50 text-emerald-900' },
  CONFIRMED: { title: 'Booking confirmed', cls: 'border-emerald-500 bg-emerald-100 text-emerald-900' },
};
