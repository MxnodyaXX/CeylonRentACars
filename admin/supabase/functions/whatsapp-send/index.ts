// Supabase Edge Function: whatsapp-send
// Sends a WhatsApp message through the Meta Cloud API and stores it in whatsapp_messages.
// The access token stays server-side.
//
// Body: { to, text, staff? }                                  — free-form (only inside the 24-hour window)
//       { to, template: { name, language, params[], preview }, staff? }  — approved template (any time)
//
// Deploy:   supabase functions deploy whatsapp-send --no-verify-jwt
// Secrets:  supabase secrets set WHATSAPP_TOKEN=... WHATSAPP_PHONE_NUMBER_ID=... [WHATSAPP_API_VERSION=v21.0]

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

/** International digits only; Sri Lankan 07x… → 947x… */
const digits = (p: string) => {
  const d = String(p ?? "").replace(/\D/g, "");
  return d.startsWith("0") ? `94${d.slice(1)}` : d;
};

/** Friendlier text for the errors staff will actually hit */
function explain(code: number | undefined, fallback: string) {
  if (code === 131047) return "More than 24 hours since the customer's last message — send an approved template instead.";
  if (code === 131026) return "This number can't receive WhatsApp messages (not on WhatsApp, or an old app version).";
  if (code === 132001) return "Template not found or not approved yet — check the name/language in WhatsApp Manager.";
  if (code === 132000) return "The template's number of parameters doesn't match.";
  if (code === 190) return "WhatsApp access token expired or invalid — update the WHATSAPP_TOKEN secret.";
  return fallback;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const token = Deno.env.get("WHATSAPP_TOKEN");
  const phoneId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
  const version = Deno.env.get("WHATSAPP_API_VERSION") ?? "v21.0";
  if (!token || !phoneId) return json({ error: "WhatsApp is not configured (set WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID)." }, 500);

  let body: Record<string, any>;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }

  const to = digits(body.to);
  const staff = body.staff ? String(body.staff).slice(0, 80) : null;
  if (to.length < 8) return json({ error: "Invalid phone number" }, 400);

  let payload: Record<string, unknown>;
  let row: Record<string, unknown>;
  if (body.template?.name) {
    const t = body.template;
    const params: string[] = Array.isArray(t.params) ? t.params.map((p: unknown) => String(p ?? "").slice(0, 900)) : [];
    payload = {
      messaging_product: "whatsapp", to, type: "template",
      template: {
        name: String(t.name), language: { code: String(t.language ?? "en") },
        ...(params.length ? { components: [{ type: "body", parameters: params.map((text) => ({ type: "text", text })) }] } : {}),
      },
    };
    row = { kind: "template", template: String(t.name), body: t.preview ? String(t.preview).slice(0, 4000) : null };
  } else {
    const text = String(body.text ?? "").trim();
    if (!text) return json({ error: "Message is empty" }, 400);
    payload = { messaging_product: "whatsapp", to, type: "text", text: { body: text.slice(0, 4096), preview_url: true } };
    row = { kind: "text", body: text.slice(0, 4096) };
  }

  const res = await fetch(`https://graph.facebook.com/${version}/${phoneId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const out = await res.json().catch(() => ({}));

  if (!res.ok) {
    const err = out?.error;
    const message = explain(err?.code, err?.error_data?.details || err?.message || `HTTP ${res.status}`);
    await db.from("whatsapp_messages").insert({ ...row, phone: to, direction: "out", status: "failed", error: message, staff });
    return json({ error: message, code: err?.code }, 400);
  }

  const waId = out?.messages?.[0]?.id ?? null;
  const { data } = await db.from("whatsapp_messages")
    .insert({ ...row, wa_id: waId, phone: to, direction: "out", status: "sent", staff })
    .select().single();
  return json({ ok: true, id: waId, message: data });
});
