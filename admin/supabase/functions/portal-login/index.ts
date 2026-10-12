// Supabase Edge Function: portal-login
// Step 1 of the customer portal sign-in ("My bookings" on the website): the customer types their
// phone number; if it has bookings or booking requests with us, Supabase Auth sends a 6-digit code
// (delivered by portal-sms through Text.lk). The website then verifies the code with Supabase Auth.
//
// Why a function: sign-ups are switched off (staff logins are created by the admin), so the
// customer's login is created here — but only for numbers we know, which also means strangers
// can't make us send (and pay for) SMS. Limits: 5 codes per number and 10 tries per connection an hour.
//
// Deploy:   supabase functions deploy portal-login --no-verify-jwt
// Body:     { phone: "077 123 4567" }  →  { ok: true, phone: "+94771234567" }  or  { ok: false, error }

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { serviceClient } from "../_shared/staff.ts";

const db = serviceClient();
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

/** Same rule as private.phone_key in the database: 077 123 4567 / +94 77… / 0094 77… → 94771234567 */
export function phoneKey(raw: string): string {
  const d = String(raw ?? "").replace(/\D/g, "");
  if (d.startsWith("00")) return d.slice(2);
  if (d.length === 10 && d.startsWith("0")) return "94" + d.slice(1);
  if (d.length === 9 && d.startsWith("7")) return "94" + d;
  return d;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  let phone = "";
  try { phone = String((await req.json())?.phone ?? "").slice(0, 40); } catch { return json({ ok: false, error: "Invalid request" }, 400); }
  const key = phoneKey(phone);
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();

  const { data: status, error } = await db.rpc("portal_phone_status", { p_phone: key, p_ip: ip });
  if (error) { console.error("[portal-login] check failed:", error.message); return json({ ok: false, error: "Sign-in isn't available right now — please try again later." }, 503); }
  if (status === "invalid") return json({ ok: false, error: "Please enter your mobile number, e.g. 077 123 4567 or +44 7700 900123." }, 400);
  if (status === "limited") return json({ ok: false, error: "Too many attempts — please wait an hour, or message us on WhatsApp." }, 429);
  if (status !== "ok") {
    return json({ ok: false, notFound: true, error: "We couldn't find any bookings for this number. Please use the number you booked with, or message us on WhatsApp." }, 404);
  }

  // The customer's login (role "customer" — gives no access to staff data or functions)
  const { error: createError } = await db.auth.admin.createUser({ phone: key, phone_confirm: true, app_metadata: { role: "customer" } });
  if (createError && !/already|exists|registered/i.test(createError.message)) {
    console.error("[portal-login] could not create login:", createError.message);
    return json({ ok: false, error: "Sign-in isn't available right now — please try again later." }, 503);
  }

  // Ask Supabase Auth for a code (it calls portal-sms to deliver it)
  const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/auth/v1/otp`, {
    method: "POST",
    headers: { apikey: Deno.env.get("SUPABASE_ANON_KEY")!, "Content-Type": "application/json" },
    body: JSON.stringify({ phone: "+" + key, create_user: false }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg = String(body?.msg ?? body?.message ?? body?.error_description ?? "");
    console.error("[portal-login] code not sent:", res.status, msg);
    if (res.status === 429 || /seconds|rate/i.test(msg)) return json({ ok: false, error: "A code was just sent — please wait a minute before asking for another." }, 429);
    return json({ ok: false, error: "We couldn't send the code right now — please try again in a few minutes." }, 502);
  }
  return json({ ok: true, phone: "+" + key });
});
