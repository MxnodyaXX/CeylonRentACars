// Supabase Edge Function: agreement-pdf
// The booking e-Agreement (CRC-AGR-003) as a PDF.
//
//   POST { token }          the customer, from the agreement page (the link is the key)
//   POST { agreement_id }   staff, signed in to the admin (Authorization: Bearer <session>)
//
// Before acceptance the PDF is made on the fly and marked "NOT ACCEPTED — for reading only" (never stored).
// The first time an ACCEPTED agreement is downloaded, its PDF is made once, stored in the private
// 'agreements' bucket and its SHA-256 recorded (eag_attach_pdf). From then on that exact file is served,
// and its fingerprint is checked every time — it can't be swapped.
//
// Deploy:   supabase functions deploy agreement-pdf --no-verify-jwt
//           (the database decides who may read what; this function only forwards the caller's own session)

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as PDFLib from "https://esm.sh/pdf-lib@1.17.1";
import { serviceClient } from "../_shared/staff.ts";
import { buildAgreementPdf, type PdfSource } from "../_shared/agreementPdf.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Expose-Headers": "content-disposition, x-document-sha256",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

async function sha256(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** "CODE: words" from the database → { code, message } */
function dbError(msg: string) {
  const m = /^([A-Z_]+): (.*)$/s.exec(msg ?? "");
  return m ? { code: m[1], message: m[2] } : { code: "ERROR", message: "This agreement isn't available right now." };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  let token: string | null = null, agreementId: string | null = null;
  try {
    const b = await req.json();
    token = typeof b?.token === "string" ? b.token.slice(0, 80) : null;
    agreementId = typeof b?.agreement_id === "string" ? b.agreement_id.slice(0, 40) : null;
  } catch { return json({ ok: false, error: "Invalid request" }, 400); }
  if (!token && !agreementId) return json({ ok: false, error: "Missing token or agreement_id" }, 400);

  // Read the frozen document AS THE CALLER (the database checks the link or the staff ability)
  const asCaller = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    auth: { persistSession: false },
    global: { headers: {
      Authorization: req.headers.get("Authorization") ?? `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`,
      "x-forwarded-for": req.headers.get("x-forwarded-for") ?? "",
    } },
  });
  const { data: src, error } = await asCaller.rpc("eag_pdf_source", { p_token: token, p_agreement_id: token ? null : agreementId });
  if (error || !src) {
    const e = dbError(error?.message ?? "");
    return json({ ok: false, code: e.code, error: e.message }, e.code === "NOT_ALLOWED" ? 403 : 404);
  }
  const s = src as PdfSource & { id: string; pdf_path: string | null; pdf_hash: string | null };
  const db = serviceClient();
  const file = (bytes: Uint8Array, hash: string) => new Response(bytes, { headers: {
    ...cors, "Content-Type": "application/pdf", "Cache-Control": "private, no-store",
    "Content-Disposition": `attachment; filename="${s.reference}.pdf"`, "x-document-sha256": hash,
  } });

  try {
    if (s.status === "ACCEPTED" || (s.status === "SUPERSEDED" && s.pdf_path)) {
      // the stored, accepted copy — checked against its recorded fingerprint
      if (s.pdf_path && s.pdf_hash) {
        const { data: blob, error: dlErr } = await db.storage.from("agreements").download(s.pdf_path);
        if (dlErr || !blob) throw new Error(`stored PDF missing: ${dlErr?.message}`);
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const hash = await sha256(bytes);
        if (hash !== s.pdf_hash) { console.error("[agreement-pdf] fingerprint mismatch", s.reference); return json({ ok: false, error: "The stored copy failed its check — CRC has been told." }, 500); }
        return file(bytes, hash);
      }
      if (s.status === "ACCEPTED") {
        const bytes = await buildAgreementPdf(PDFLib, s);
        const hash = await sha256(bytes);
        const path = `accepted/${s.id}-${hash.slice(0, 12)}.pdf`;
        const { error: upErr } = await db.storage.from("agreements").upload(path, bytes, { contentType: "application/pdf", upsert: false });
        if (upErr && !/exists/i.test(upErr.message)) throw new Error(`upload failed: ${upErr.message}`);
        const { data: att, error: attErr } = await db.rpc("eag_attach_pdf", { p_agreement_id: s.id, p_path: path, p_hash: hash });
        if (attErr) throw new Error(`attach failed: ${attErr.message}`);
        if ((att as { already?: boolean })?.already) {
          // someone else stored it a moment earlier — serve theirs
          const a = att as { path: string; hash: string };
          const { data: blob } = await db.storage.from("agreements").download(a.path);
          if (blob) return file(new Uint8Array(await blob.arrayBuffer()), a.hash);
        }
        return file(bytes, hash);
      }
    }
    // not accepted (sent, viewed, declined, expired…): a reading copy, never stored
    const bytes = await buildAgreementPdf(PDFLib, s);
    return file(bytes, await sha256(bytes));
  } catch (e) {
    console.error("[agreement-pdf]", s.reference, e);
    return json({ ok: false, error: "We couldn't make the PDF right now — please try again." }, 500);
  }
});
