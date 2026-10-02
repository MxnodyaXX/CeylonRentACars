// Supabase Edge Function: send-sms
// Holds the SMS gateway secret server-side, forwards to Text.lk, and logs every
// attempt to the sms_log table for delivery tracking + unit reconciliation.
//
// Deploy:   supabase functions deploy send-sms --no-verify-jwt
// Secrets:  supabase secrets set TEXTLK_API_TOKEN=xxxx TEXTLK_SENDER_ID="Dodan's Clo"

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Service-role client (env auto-injected into every Edge Function) for writing logs.
const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let to = "", message = "", category = "", role = "", relatedId = "";
  try {
    const body = await req.json();
    to = String(body.to ?? "").trim();
    message = String(body.message ?? "").trim();
    category = String(body.category ?? "");
    role = String(body.role ?? "");
    relatedId = String(body.relatedId ?? "");
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  if (!to || !message) return json({ error: "Missing 'to' or 'message'" }, 400);

  const apiToken = Deno.env.get("TEXTLK_API_TOKEN");
  const senderId = Deno.env.get("TEXTLK_SENDER_ID") ?? "TextLKDemo";
  if (!apiToken) return json({ error: "SMS gateway not configured (set TEXTLK_API_TOKEN secret)" }, 500);

  // helper: insert a log row, ignore failures (logging must never block sending)
  const log = async (status: string, providerUid: string | null, cost: number | null, error: string | null) => {
    try {
      await admin.from("sms_log").insert({
        recipient: to, message, category: category || null, recipient_role: role || null,
        related_id: relatedId || null, status, provider_uid: providerUid, cost, error,
      });
    } catch (_) { /* swallow */ }
  };

  // ── Authoritative opt-out check (recipient sent STOP) ───────────
  try {
    const { data: optedOut } = await admin.from("sms_opt_out").select("phone").eq("phone", to).maybeSingle();
    if (optedOut) {
      await log("skipped", null, null, "recipient opted out");
      return json({ ok: false, skipped: true, reason: "opted_out" }, 200);
    }
  } catch (_) { /* if the check fails, fall through and attempt the send */ }

  // ── Text.lk v3 send ─────────────────────────────────────────────
  try {
    const res = await fetch("https://app.text.lk/api/v3/sms/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ recipient: to, sender_id: senderId, type: "plain", message }),
    });
    const data = await res.json().catch(() => ({}));
    const ok = res.ok && (data?.status === "success" || data?.status === true);
    const uid = data?.data?.uid ?? null;
    const cost = data?.data?.cost != null ? Number(data.data.cost) : null;
    await log(ok ? "sent" : "failed", uid, cost, ok ? null : JSON.stringify(data).slice(0, 500));
    return json({ ok, provider: data }, ok ? 200 : 502);
  } catch (e) {
    await log("failed", null, null, String(e));
    return json({ ok: false, error: String(e) }, 502);
  }
});
