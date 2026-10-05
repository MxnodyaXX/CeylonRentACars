// Supabase Edge Function: whatsapp-templates
// Lists, creates and deletes WhatsApp message templates for the business account, so staff can
// manage templates from the admin (Messages → Templates) instead of WhatsApp Manager.
//
// Body: { action: "list" }
//       { action: "create", name, category: "UTILITY"|"MARKETING", language?: "en", body, examples: { var: sample } }
//            body uses NAMED variables, e.g. "Dear {{name}}, your {{vehicle}} is ready."
//       { action: "delete", name }
//
// Deploy:   supabase functions deploy whatsapp-templates --no-verify-jwt
// Secrets:  WHATSAPP_TOKEN, WHATSAPP_WABA_ID (WhatsApp Business Account ID — shown on the admin's WhatsApp setup page)

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
  const waba = Deno.env.get("WHATSAPP_WABA_ID");
  const version = Deno.env.get("WHATSAPP_API_VERSION") ?? "v21.0";
  if (!token || !waba) return json({ error: "Set the WHATSAPP_TOKEN and WHATSAPP_WABA_ID secrets (see WHATSAPP.md)." }, 500);

  let body: Record<string, any>;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }

  const g = async (path: string, init: RequestInit = {}) => {
    const r = await fetch(`https://graph.facebook.com/${version}/${path}`, {
      ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
    return { ok: r.ok, data: await r.json().catch(() => ({})) };
  };
  const fail = (r: { data: any }, fallback: string) =>
    json({ error: r.data?.error?.error_user_msg || r.data?.error?.message || fallback }, 400);

  if (body.action === "list") {
    const r = await g(`${waba}/message_templates?fields=id,name,language,status,category,components,rejected_reason,parameter_format&limit=200`);
    if (!r.ok) return fail(r, "Could not load templates");
    return json({ templates: r.data?.data ?? [] });
  }

  if (body.action === "create") {
    const name = String(body.name ?? "").trim();
    const text = String(body.body ?? "").trim();
    if (!/^[a-z0-9_]{1,512}$/.test(name)) return json({ error: "Name: lowercase letters, numbers and _ only (e.g. pickup_reminder)." }, 400);
    if (!text) return json({ error: "The message text is empty." }, 400);
    const vars = [...new Set([...text.matchAll(/\{\{([a-z0-9_]+)\}\}/g)].map((m) => m[1]))];
    const examples: Record<string, string> = body.examples ?? {};
    const component: Record<string, unknown> = { type: "BODY", text };
    if (vars.length) {
      component.example = { body_text_named_params: vars.map((v) => ({ param_name: v, example: String(examples[v] || v) })) };
    }
    const r = await g(`${waba}/message_templates`, {
      method: "POST",
      body: JSON.stringify({
        name, language: String(body.language ?? "en"),
        category: body.category === "MARKETING" ? "MARKETING" : "UTILITY",
        parameter_format: "NAMED",
        components: [component],
      }),
    });
    if (!r.ok) return fail(r, "Meta refused the template");
    return json({ ok: true, id: r.data?.id, status: r.data?.status, category: r.data?.category });
  }

  if (body.action === "delete") {
    const name = String(body.name ?? "");
    if (!/^[a-z0-9_]+$/.test(name)) return json({ error: "Invalid template name" }, 400);
    const r = await g(`${waba}/message_templates?name=${encodeURIComponent(name)}`, { method: "DELETE" });
    if (!r.ok) return fail(r, "Could not delete the template");
    return json({ ok: true });
  }

  return json({ error: "Unknown action" }, 400);
});
