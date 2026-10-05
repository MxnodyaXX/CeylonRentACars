// Supabase Edge Function: whatsapp-onboard
// Finishes connecting an EXISTING WhatsApp Business app number (coexistence) after Meta's
// Embedded Signup pop-up on the admin's "Connect WhatsApp" page:
//   1. finds the phone number in the connected WhatsApp Business Account (WABA)
//   2. subscribes this Meta app to the WABA (so the webhook receives messages)
//   3. asks Meta to sync contacts and chat history (must happen within 24 h of connecting)
//   4. reports whether the number is live on both the app and the Cloud API
//
// Body: { waba_id }            (or { waba_id, phone_number_id })
// Deploy:   supabase functions deploy whatsapp-onboard --no-verify-jwt
// Needs:    WHATSAPP_TOKEN = system-user token with access to that WABA (see WHATSAPP.md)

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const token = Deno.env.get("WHATSAPP_TOKEN");
  const version = Deno.env.get("WHATSAPP_API_VERSION") ?? "v21.0";
  if (!token) return json({ error: "Set the WHATSAPP_TOKEN secret first (system-user token — see WHATSAPP.md step 4)." }, 400);

  let body: Record<string, string>;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }
  const wabaId = String(body.waba_id ?? "").trim();
  if (!/^\d+$/.test(wabaId)) return json({ error: "Missing or invalid waba_id" }, 400);

  const g = async (path: string, init: RequestInit = {}) => {
    const r = await fetch(`https://graph.facebook.com/${version}/${path}`, {
      ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    });
    const data = await r.json().catch(() => ({}));
    return { ok: r.ok, data };
  };
  const steps: { step: string; ok: boolean; detail?: string }[] = [];
  const note = (step: string, r: { ok: boolean; data: any }) =>
    steps.push({ step, ok: r.ok, detail: r.ok ? undefined : r.data?.error?.message ?? "failed" });

  // 1. phone number
  let phoneId = String(body.phone_number_id ?? "");
  let display = "";
  const nums = await g(`${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name,platform_type`);
  note("Find phone number", nums);
  if (!nums.ok) return json({ error: nums.data?.error?.message ?? "Could not read the WhatsApp account — does WHATSAPP_TOKEN have access to it?", steps }, 400);
  const n = (nums.data?.data ?? []).find((x: any) => !phoneId || x.id === phoneId) ?? nums.data?.data?.[0];
  if (!n) return json({ error: "No phone number found in this WhatsApp account.", steps }, 400);
  phoneId = n.id; display = n.display_phone_number;

  // 2. subscribe our app to the account's webhooks
  note("Subscribe app to webhooks", await g(`${wabaId}/subscribed_apps`, { method: "POST" }));

  // 3. sync contacts + history (Meta: within 24 h of onboarding)
  for (const sync_type of ["smb_app_state_sync", "history"]) {
    note(sync_type === "history" ? "Sync chat history" : "Sync contacts",
      await g(`${phoneId}/smb_app_data`, { method: "POST", body: JSON.stringify({ messaging_product: "whatsapp", sync_type }) }));
  }

  // 4. status check
  const st = await g(`${phoneId}?fields=is_on_biz_app,platform_type,display_phone_number,verified_name`);
  note("Check status", st);

  return json({
    ok: steps.every((s) => s.ok),
    waba_id: wabaId,
    phone_number_id: phoneId,
    display_phone_number: display,
    verified_name: n.verified_name,
    is_on_biz_app: st.data?.is_on_biz_app ?? null,
    platform_type: st.data?.platform_type ?? null,
    steps,
  });
});
