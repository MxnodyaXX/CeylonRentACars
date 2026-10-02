// Supabase Edge Function: sms-inbound
// Receives inbound SMS from Text.lk and honours opt-out keywords.
//   STOP / UNSUBSCRIBE / OPTOUT  → add phone to sms_opt_out (no more messages)
//   START / UNSTOP / SUBSCRIBE   → remove phone from sms_opt_out (re-subscribe)
//
// Deploy:    supabase functions deploy sms-inbound --no-verify-jwt
// Configure: set this URL as the Incoming/Inbound SMS webhook in your Text.lk account
//   https://<project-ref>.supabase.co/functions/v1/sms-inbound
//
// NOTE: requires inbound SMS to be enabled on your Text.lk plan/number.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const pick = (o: Record<string, unknown>, keys: string[]): string => {
  for (const k of keys) {
    const v = o[k];
    if (v !== undefined && v !== null && String(v) !== "") return String(v);
  }
  return "";
};

// Normalize an LK phone to 94XXXXXXXXX (matches send-sms / sms_opt_out keys).
function normalize(raw: string): string | null {
  const d = (raw ?? "").replace(/\D/g, "");
  if (d.startsWith("94") && d.length === 11) return d;
  if (d.startsWith("0") && d.length === 10) return "94" + d.slice(1);
  if (d.length === 9 && d.startsWith("7")) return "94" + d;
  return null;
}

const OPT_OUT = ["stop", "unsubscribe", "optout", "opt-out", "remove", "cancel"];
const OPT_IN  = ["start", "unstop", "subscribe", "optin", "opt-in"];

serve(async (req) => {
  if (req.method !== "POST") return new Response("ok"); // health check

  let body: Record<string, unknown> = {};
  try {
    const ct = req.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) body = await req.json();
    else body = Object.fromEntries([...(await req.formData()).entries()]);
  } catch { /* fall back to query string */ }
  const data = { ...Object.fromEntries(new URL(req.url).searchParams.entries()), ...body };

  const from = normalize(pick(data, ["from", "sender", "msisdn", "source", "number"]));
  const text = pick(data, ["message", "text", "body", "content"]).trim().toLowerCase();

  if (!from || !text) {
    return new Response(JSON.stringify({ ok: false, error: "missing from/message" }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }

  const firstWord = text.split(/\s+/)[0];
  try {
    if (OPT_OUT.includes(firstWord)) {
      await admin.from("sms_opt_out").upsert({ phone: from });
    } else if (OPT_IN.includes(firstWord)) {
      await admin.from("sms_opt_out").delete().eq("phone", from);
    }
  } catch (_) { /* swallow */ }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
});
