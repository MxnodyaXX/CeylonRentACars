// Supabase Edge Function: whatsapp-webhook
// Meta calls this for every incoming customer message and every status update
// (sent → delivered → read / failed). Messages are stored in whatsapp_messages.
//
// Deploy:   supabase functions deploy whatsapp-webhook --no-verify-jwt
// Secrets:  supabase secrets set WHATSAPP_VERIFY_TOKEN=<any random string> WHATSAPP_APP_SECRET=<Meta app secret>
// Meta:     Webhook URL  https://<project-ref>.supabase.co/functions/v1/whatsapp-webhook
//           Verify token = WHATSAPP_VERIFY_TOKEN, subscribe to the "messages" field.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const enc = new TextEncoder();

/** Meta signs each POST with HMAC-SHA256 of the raw body using the app secret */
async function validSignature(raw: string, header: string | null): Promise<boolean> {
  const secret = Deno.env.get("WHATSAPP_APP_SECRET");
  if (!secret) return true;                     // not configured yet: accept (set it before going live)
  if (!header?.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(raw)));
  const hex = Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
  const given = header.slice(7);
  if (given.length !== hex.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

const RANK: Record<string, number> = { sent: 1, delivered: 2, read: 3, failed: 4 };

/** Turn one incoming Meta message into a row */
function toRow(m: Record<string, any>) {
  const base = {
    wa_id: m.id, phone: String(m.from), direction: "in", status: "received",
    created_at: new Date(Number(m.timestamp) * 1000).toISOString(),
  };
  switch (m.type) {
    case "text": return { ...base, kind: "text", body: m.text?.body ?? "" };
    case "image": case "video": case "audio": case "sticker": case "document": {
      const media = m[m.type] ?? {};
      return {
        ...base, kind: m.type === "sticker" ? "image" : m.type, body: media.caption ?? null,
        media_id: media.id ?? null, media_mime: media.mime_type ?? null, media_name: media.filename ?? null,
      };
    }
    case "location": {
      const l = m.location ?? {};
      return { ...base, kind: "location", body: `${l.name ? l.name + " — " : ""}${l.address ? l.address + " — " : ""}https://maps.google.com/?q=${l.latitude},${l.longitude}` };
    }
    case "button": return { ...base, kind: "text", body: m.button?.text ?? "" };
    case "interactive": {
      const i = m.interactive ?? {};
      return { ...base, kind: "text", body: i.button_reply?.title ?? i.list_reply?.title ?? "(interactive reply)" };
    }
    case "contacts": return { ...base, kind: "other", body: "Shared a contact card" };
    default: return { ...base, kind: "other", body: `Unsupported message type: ${m.type}` };
  }
}

serve(async (req) => {
  const url = new URL(req.url);

  // One-time verification when the webhook is registered in Meta
  if (req.method === "GET") {
    const ok = url.searchParams.get("hub.mode") === "subscribe"
      && url.searchParams.get("hub.verify_token") === Deno.env.get("WHATSAPP_VERIFY_TOKEN");
    return ok ? new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 }) : new Response("Forbidden", { status: 403 });
  }
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const raw = await req.text();
  if (!(await validSignature(raw, req.headers.get("x-hub-signature-256")))) return new Response("Bad signature", { status: 401 });

  let body: Record<string, any>;
  try { body = JSON.parse(raw); } catch { return new Response("ok", { status: 200 }); }

  try {
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const v = change.value ?? {};

        // Customer profile names
        for (const c of v.contacts ?? []) {
          if (c.wa_id) await db.from("whatsapp_chats").upsert({ phone: String(c.wa_id), name: c.profile?.name ?? null }, { onConflict: "phone" });
        }

        // Incoming messages (Meta may retry — wa_id is unique, so duplicates are ignored)
        const rows = (v.messages ?? []).map(toRow);
        if (rows.length) await db.from("whatsapp_messages").upsert(rows, { onConflict: "wa_id", ignoreDuplicates: true });

        // ── Coexistence (same number also used in the WhatsApp Business app on a phone) ──
        const business = String(v.metadata?.display_phone_number ?? "").replace(/\D/g, "");

        // Replies typed in the WhatsApp Business app on the phone → show them in the admin too
        const echoes = (v.message_echoes ?? []).map((m: Record<string, any>) => ({
          ...toRow({ ...m, from: m.to }), direction: "out", status: "sent", staff: "WhatsApp app (phone)",
        }));
        if (echoes.length) await db.from("whatsapp_messages").upsert(echoes, { onConflict: "wa_id", ignoreDuplicates: true });

        // Chat history shared when the number was connected (up to 180 days back)
        for (const h of v.history ?? []) {
          for (const t of h.threads ?? []) {
            const customer = String(t.id ?? "").replace(/\D/g, "");
            const hist = (t.messages ?? []).map((m: Record<string, any>) => {
              const fromBusiness = String(m.from ?? "").replace(/\D/g, "") === business;
              const row = toRow({ ...m, from: customer || m.from });
              return fromBusiness
                ? { ...row, direction: "out", status: m.history_context?.status?.toLowerCase?.() === "read" ? "read" : "delivered", staff: "WhatsApp app (history)" }
                : row;
            });
            if (hist.length) await db.from("whatsapp_messages").upsert(hist, { onConflict: "wa_id", ignoreDuplicates: true });
          }
        }

        // Contacts saved in the WhatsApp Business app → names in the inbox
        for (const s of v.state_sync ?? []) {
          const c = s.contact ?? {};
          const phone = String(c.phone_number ?? "").replace(/\D/g, "");
          if (s.type === "contact" && phone && s.action !== "remove") {
            await db.from("whatsapp_chats").upsert({ phone, name: c.full_name ?? c.first_name ?? null }, { onConflict: "phone" });
          }
        }

        // Delivery / read / failed ticks for our outgoing messages — never move backwards
        for (const s of v.statuses ?? []) {
          const { data: cur } = await db.from("whatsapp_messages").select("status").eq("wa_id", s.id).maybeSingle();
          if (!cur || (RANK[s.status] ?? 0) <= (RANK[cur.status] ?? 0)) continue;
          await db.from("whatsapp_messages").update({
            status: s.status,
            status_at: new Date(Number(s.timestamp) * 1000).toISOString(),
            error: s.errors?.[0] ? `${s.errors[0].title}${s.errors[0].error_data?.details ? ` — ${s.errors[0].error_data.details}` : ""}` : null,
          }).eq("wa_id", s.id);
        }
      }
    }
  } catch (e) {
    console.error("[whatsapp-webhook]", e);   // still answer 200 so Meta doesn't keep retrying a bad payload
  }
  return new Response("ok", { status: 200 });
});
