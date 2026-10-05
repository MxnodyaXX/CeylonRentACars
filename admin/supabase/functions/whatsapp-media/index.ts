// Supabase Edge Function: whatsapp-media
// Streams a customer's photo / document from Meta to the admin (Meta media URLs need the access token,
// so the browser can't load them directly). Only media ids stored in whatsapp_messages are served.
//
// Deploy:   supabase functions deploy whatsapp-media --no-verify-jwt
// Usage:    <img src="https://<ref>.supabase.co/functions/v1/whatsapp-media?id=<media_id>">

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const cors = { "Access-Control-Allow-Origin": "*" };

serve(async (req) => {
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
      "Cache-Control": "private, max-age=3600",
      ...(known.media_name ? { "Content-Disposition": `inline; filename="${String(known.media_name).replace(/"/g, "")}"` } : {}),
    },
  });
});
