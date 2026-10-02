// Supabase Edge Function: sms-delivery-webhook
// Receives Text.lk delivery reports and updates the matching sms_log row.
//
// Deploy:   supabase functions deploy sms-delivery-webhook --no-verify-jwt
// Configure: paste the function URL into Text.lk → Sender ID → Delivery Report Webhook URL
//   https://<project-ref>.supabase.co/functions/v1/sms-delivery-webhook
//
// Text.lk posts a delivery report containing the message uid and a status. Field
// names vary by account, so we accept JSON or form-encoded and probe common keys.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const pick = (o: Record<string, unknown>, keys: string[]): string | undefined => {
  for (const k of keys) {
    const v = o[k];
    if (v !== undefined && v !== null && String(v) !== "") return String(v);
  }
  return undefined;
};

// Map provider status text → our canonical set.
const normalizeStatus = (raw?: string): string => {
  const s = (raw ?? "").toLowerCase();
  if (s.includes("deliver")) return "delivered";
  if (s.includes("fail") || s.includes("reject") || s.includes("undeliver") || s.includes("expire")) return "failed";
  if (s.includes("sent") || s.includes("submit")) return "sent";
  return s || "sent";
};

serve(async (req) => {
  if (req.method !== "POST") return new Response("ok"); // health check

  // Parse JSON or form body
  let body: Record<string, unknown> = {};
  try {
    const ct = req.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      body = await req.json();
    } else {
      const form = await req.formData();
      body = Object.fromEntries([...form.entries()]);
    }
  } catch { /* ignore — also try query string below */ }

  const url = new URL(req.url);
  const fromQuery = Object.fromEntries(url.searchParams.entries());
  const data = { ...fromQuery, ...body };

  const uid = pick(data, ["uid", "message_uid", "messageId", "message_id", "id"]);
  const status = normalizeStatus(pick(data, ["status", "delivery_status", "dlr_status", "state"]));

  if (!uid) return new Response(JSON.stringify({ ok: false, error: "no uid in report" }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });

  try {
    await admin.from("sms_log")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("provider_uid", uid);
  } catch (_) { /* swallow */ }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
});
