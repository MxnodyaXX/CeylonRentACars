// Supabase Edge Function: whatsapp-media
// Streams a customer's photo / document from Meta to the admin (Meta media URLs need the access token,
// so the browser can't load them directly). Only media ids stored in whatsapp_messages are served,
// and only to a signed-in admin — customer documents (licences, passports) never have a public link.
//
// Deploy:   supabase functions deploy whatsapp-media --no-verify-jwt
// Usage:    fetch(".../functions/v1/whatsapp-media?id=<media_id>", { headers: { Authorization: "Bearer <session token>" } })
//           — the admin turns the answer into a blob: URL (lib/whatsappInbox.ts → fetchMedia)

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { serviceClient, staffCaller } from "../_shared/staff.ts";

const db = serviceClient();
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  // WhatsApp chats are admin-only in the database, so their files are too
  const caller = await staffCaller(req, db);
  if (!caller || (caller.kind === "staff" && caller.role !== "admin")) {
    return new Response("Sign in to the admin to see this file.", { status: 401, headers: cors });
  }

  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!/^\d+$/.test(id)) return new Response("Bad id", { status: 400, headers: cors });

  // Only serve media that actually arrived in a conversation
  const { data: known } = await db.from("whatsapp_messages").select("media_name").eq("media_id", id).maybeSingle();
  if (!known) return new Response("Not found", { status: 404, headers: cors });

  const token = Deno.env.get("WHATSAPP_TOKEN");
  const version = Deno.env.get("WHATSAPP_API_VERSION") ?? "v21.0";
  if (!token) return new Response("WhatsApp not configured", { status: 500, headers: cors });

  const meta = await fetch(`https://graph.facebook.com/${version}/${id}`, { headers: { Authorization: `Bearer ${token}` } });
  const info = await meta.json().catch(() => ({}));
  if (!meta.ok || !info.url) return new Response("Media expired or unavailable", { status: 404, headers: cors });

  const file = await fetch(info.url, { headers: { Authorization: `Bearer ${token}` } });
  if (!file.ok) return new Response("Media download failed", { status: 502, headers: cors });

  return new Response(file.body, {
    headers: {
      ...cors,
      "Content-Type": info.mime_type ?? file.headers.get("content-type") ?? "application/octet-stream",
      "Cache-Control": "private, no-store",
      ...(known.media_name ? { "Content-Disposition": `inline; filename="${String(known.media_name).replace(/["\r\n]/g, "")}"` } : {}),
    },
  });
});
