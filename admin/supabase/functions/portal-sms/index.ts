// Supabase Edge Function: portal-sms — the Auth "Send SMS" hook
// Supabase Auth calls this whenever a phone sign-in code must be sent; we deliver it through
// Text.lk (Supabase has no Text.lk integration of its own). Calls are signed by Supabase
// (Standard Webhooks) — anything without a valid signature is refused.
// Respects "SMS paused" in admin Settings and allows at most 8 codes a day per number.
// The code itself is never written to sms_log.
//
// Deploy:   supabase functions deploy portal-sms --no-verify-jwt
// Dashboard: Authentication → Hooks → Send SMS hook → HTTPS → https://<ref>.supabase.co/functions/v1/portal-sms
//            → Generate secret, then: supabase secrets set PORTAL_SMS_HOOK_SECRET="v1,whsec_..."

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { serviceClient } from "../_shared/staff.ts";
import { sendTextLk } from "../_shared/textlk.ts";

const db = serviceClient();

/** Error in the shape Supabase Auth shows to the customer */
const fail = (http_code: number, message: string) =>
  new Response(JSON.stringify({ error: { http_code, message } }), { status: http_code, headers: { "Content-Type": "application/json" } });

/** Standard Webhooks signature check (https://www.standardwebhooks.com) */
export async function signedBySupabase(raw: string, h: Headers, secret: string, nowSeconds = Date.now() / 1000): Promise<boolean> {
  const id = h.get("webhook-id"), ts = h.get("webhook-timestamp"), sigs = h.get("webhook-signature");
  if (!secret || !id || !ts || !sigs) return false;
  if (!/^\d+$/.test(ts) || Math.abs(nowSeconds - Number(ts)) > 300) return false;   // 5 minutes — no replays
  let keyBytes: Uint8Array;
  try { keyBytes = Uint8Array.from(atob(secret.replace(/^v1,/, "").replace(/^whsec_/, "")), (c) => c.charCodeAt(0)); } catch { return false; }
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${ts}.${raw}`)));
  const expected = btoa(String.fromCharCode(...mac));
  return sigs.split(" ").some((s) => {
    const [version, sig] = s.split(",");
    if (version !== "v1" || !sig || sig.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
    return diff === 0;
  });
}

serve(async (req) => {
  if (req.method !== "POST") return fail(405, "Method not allowed");
  const raw = await req.text();
  if (!(await signedBySupabase(raw, req.headers, Deno.env.get("PORTAL_SMS_HOOK_SECRET") ?? ""))) return fail(401, "Invalid signature");

  let phone = "", otp = "";
  try {
    const body = JSON.parse(raw);
    phone = String(body?.user?.phone ?? "").replace(/\D/g, "");
    otp = String(body?.sms?.otp ?? "");
  } catch { return fail(400, "Invalid payload"); }
  if (!phone || !/^\d{4,10}$/.test(otp)) return fail(400, "Invalid payload");

  const log = (status: string, uid: string | null, cost: number | null, error: string | null) =>
    db.from("sms_log").insert({
      recipient: phone, message: "Customer portal sign-in code (hidden)", category: "portalOtp", recipient_role: "customer",
      status, provider_uid: uid, cost, error,
    }).then(() => undefined, () => undefined);

  // "SMS paused" in admin Settings stops these too
  const { data: setting } = await db.from("app_settings").select("value").eq("key", "sms").maybeSingle();
  if (setting?.value?.enabled === false) {
    await log("skipped", null, null, "SMS sending is paused in admin Settings");
    return fail(503, "We can't send codes right now — please message us on WhatsApp.");
  }

  const { data: allowed } = await db.rpc("portal_sms_allow", { p_phone: phone });
  if (allowed === false) {
    await log("skipped", null, null, "daily code limit for this number");
    return fail(429, "Too many codes for this number today — please try again tomorrow or message us on WhatsApp.");
  }

  const r = await sendTextLk(phone, `${otp} is your Ceylon Rent A Cars sign-in code. It expires in 10 minutes. Never share it with anyone.`);
  await log(r.ok ? "sent" : "failed", r.uid, r.cost, r.error);
  if (!r.ok) return fail(502, "We couldn't send the code — please try again in a few minutes.");
  return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
});
