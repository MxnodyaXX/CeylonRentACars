// Supabase Edge Function: agreement-notify
// Sends the booking e-Agreement to the customer by SMS (Text.lk), and the reminders.
//
//   POST { agreement_id }                 staff (Authorization: Bearer <session>): makes the customer's link
//                                         (eag_send_agreement, checked as that staff member), texts it to the
//                                         inquiry's number, logs it in sms_log + on the inquiry's timeline.
//                                         The link is never returned or stored — only the customer gets it.
//   POST ?key=<CRON_SECRET>&run=reminders the scheduled run (eagreement-cron.sql): reminders before the
//                                         agreement / advance deadlines in eagreement_policy.reminders.
//
// "Sent" means Text.lk accepted it. Delivery comes later from the delivery webhook (sms_log.status).
// Respects "SMS paused" in admin Settings. Deploy: supabase functions deploy agreement-notify --no-verify-jwt
// Secrets: TEXTLK_API_TOKEN, TEXTLK_SENDER_ID (as send-sms), CRON_SECRET, SITE_URL (default https://ceylonrentacars.lk)

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serviceClient, staffCaller, unauthorized } from "../_shared/staff.ts";
import { sendTextLk } from "../_shared/textlk.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const SITE = (Deno.env.get("SITE_URL") ?? "https://ceylonrentacars.lk").replace(/\/+$/, "");
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const db = serviceClient();

const lk = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Colombo", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
const sameSecret = (given: string) => CRON_SECRET.length > 0 && given.length === CRON_SECRET.length &&
  [...given].reduce((d, c, i) => d | (c.charCodeAt(0) ^ CRON_SECRET.charCodeAt(i)), 0) === 0;

async function smsPaused(): Promise<boolean> {
  const { data } = await db.from("app_settings").select("value").eq("key", "sms").maybeSingle();
  return data?.value?.enabled === false;
}

/** Send one text, log it in sms_log (linked to the agreement) and on the inquiry's timeline */
async function text(agreementId: string, to: string, message: string, category: string, kind: "link" | "reminder", meta: Record<string, unknown> = {}) {
  const paused = await smsPaused();
  const r = paused ? { ok: false, uid: null, cost: null, error: "SMS sending is paused in admin Settings" } : await sendTextLk(to, message);
  // the link must not sit in the log: the logged copy has it removed
  const logged = message.replace(/\/booking-agreement\/[0-9a-f]{64}/g, "/booking-agreement/•••");
  await db.from("sms_log").insert({
    recipient: to, message: logged, category, recipient_role: "customer", related_id: `eag:${agreementId}`,
    status: paused ? "skipped" : r.ok ? "sent" : "failed", provider_uid: r.uid, cost: r.cost, error: r.error,
  }).then(() => {}, () => {});
  await db.rpc("eag_log_delivery", { p_agreement_id: agreementId, p_kind: kind, p_ok: r.ok, p_provider_uid: r.uid, p_error: r.error, p_meta: meta });
  return { ok: r.ok, paused, error: r.ok ? null : r.error };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
  const url = new URL(req.url);

  // ── the scheduled reminder run ──
  if (url.searchParams.get("run") === "reminders") {
    if (!sameSecret(url.searchParams.get("key") ?? "")) return json({ ok: false, error: "Unauthorized" }, 401);
    const { data: due, error } = await db.rpc("eag_due_reminders");
    if (error) return json({ ok: false, error: error.message }, 500);
    let sent = 0;
    for (const d of (due ?? []) as { agreement_id: string; reference: string; phone: string; deadline: string; kind: string; hours: number }[]) {
      const msg = d.kind === "agreement"
        ? `Ceylon Rent A Cars: your booking agreement ${d.reference} is waiting for your decision until ${lk(d.deadline)}. Open the link we sent, or "My bookings" on ${SITE.replace(/^https?:\/\//, "")}. We never ask for the SMS code by phone.`
        : `Ceylon Rent A Cars: the advance for booking agreement ${d.reference} is due by ${lk(d.deadline)}. Payment details are on your agreement page. Your booking is confirmed only after we verify the payment.`;
      const r = await text(d.agreement_id, d.phone, msg, d.kind === "agreement" ? "eagreementReminder" : "eagreementAdvanceReminder", "reminder", { kind: d.kind, hours: d.hours });
      if (r.ok) sent++;
    }
    return json({ ok: true, due: (due ?? []).length, sent });
  }

  // ── staff: send the agreement link ──
  const caller = await staffCaller(req, db);
  if (!caller || caller.kind !== "staff") return unauthorized(cors);
  let agreementId = "";
  try { agreementId = String((await req.json())?.agreement_id ?? "").slice(0, 40); } catch { /* below */ }
  if (!/^[0-9a-f-]{36}$/.test(agreementId)) return json({ ok: false, error: "Missing agreement_id" }, 400);

  // as the staff member, so their abilities and the agreement's state are checked by the database
  const asStaff = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    auth: { persistSession: false }, global: { headers: { Authorization: req.headers.get("Authorization")! } },
  });
  const { data: contact, error: cErr } = await asStaff.rpc("eag_agreement_contact", { p_agreement_id: agreementId });
  if (cErr) return json({ ok: false, error: cErr.message.replace(/^[A-Z_]+: /, "") }, 400);
  if (await smsPaused()) return json({ ok: false, error: "SMS sending is paused in Settings — send it by WhatsApp or copy the link instead." }, 409);
  const { data: sent, error: sErr } = await asStaff.rpc("eag_send_agreement", { p_agreement_id: agreementId, p_channel: "sms" });
  if (sErr) return json({ ok: false, error: sErr.message.replace(/^[A-Z_]+: /, "") }, 400);
  const s = sent as { token: string; path: string; expires_at: string; reference: string };
  const c = contact as { phone: string; name: string };
  const first = String(c.name ?? "").trim().split(/\s+/)[0] || "there";
  const msg = `Ceylon Rent A Cars: Hi ${first}, please review your booking agreement ${s.reference}: ${SITE}${s.path} — open it until ${lk(s.expires_at)}. ` +
    `You'll confirm with a one-time SMS code. Never share the code with anyone.`;
  const r = await text(agreementId, c.phone, msg, "eagreementLink", "link");
  return json({ ok: r.ok, reference: s.reference, expires_at: s.expires_at, error: r.ok ? null : "The SMS gateway didn't accept it — try again, or send it by WhatsApp." });
});
