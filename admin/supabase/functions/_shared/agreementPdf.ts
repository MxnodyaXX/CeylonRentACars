// The booking e-Agreement (CRC-AGR-003) as an A4 PDF, drawn from the frozen document (eag_pdf_source).
// pdf-lib is passed in, so the same code runs in the Edge Function (esm.sh) and in the Node tests (npm).

// deno-lint-ignore no-explicit-any
type PdfLib = any;

export interface PdfSource {
  reference: string;
  status: string;
  version: number;
  document: Record<string, Record<string, string>>;
  html: string;
  document_hash: string;
  expires_at?: string;
  acceptance?: { decision: string; at: string; method: string; phone: string; statement?: string; statement_version?: string; document_hash?: string } | null;
}

const RED = [0.8, 0.07, 0.11];
const INK = [0.07, 0.07, 0.08];
const GREY = [0.42, 0.45, 0.5];
const RULE = [0.86, 0.87, 0.89];

/** "<p>a &amp; b<br>c</p>" → "a & b\nc" */
function text(html: string): string {
  return html.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&").trim();
}

/** The sections of the rendered wording, in order: [{ heading, body }] */
export function sectionsOf(html: string): { heading: string; body: string }[] {
  const out: { heading: string; body: string }[] = [];
  for (const m of html.matchAll(/<section[^>]*>([\s\S]*?)<\/section>/gi)) {
    const h = m[1].match(/<h2>([\s\S]*?)<\/h2>/i);
    const p = [...m[1].matchAll(/<p>([\s\S]*?)<\/p>/gi)].map((x) => text(x[1])).join("\n\n");
    out.push({ heading: h ? text(h[1]) : "", body: p });
  }
  return out;
}

export const lkTime = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Colombo", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })
    .format(new Date(iso)) + " (Sri Lanka)";

export async function buildAgreementPdf(lib: PdfLib, src: PdfSource): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = lib;
  const doc = await PDFDocument.create();
  doc.setTitle(`${src.document?.agreement?.title ?? "Booking e-Agreement"} ${src.reference}`);
  doc.setAuthor("Ceylon Rent A Cars");
  doc.setSubject("CRC-AGR-003 Booking Acceptance & Advance Payment e-Agreement");
  doc.setCreator("CRC admin");
  doc.setProducer("CRC e-Agreement");
  const fixed = new Date(src.acceptance?.at ?? src.expires_at ?? "2026-01-01T00:00:00Z");
  doc.setCreationDate(fixed);            // the same document always gives the same file
  doc.setModificationDate(fixed);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const okChars = new Set<number>(font.getCharacterSet());
  // the standard PDF fonts only know Western characters: keep what they can draw
  const safe = (s: string) => [...String(s ?? "")].map((c) => {
    const map: Record<string, string> = { "→": "->", "•": "*", " ": " ", " ": " " };
    if (map[c]) return map[c];
    return okChars.has(c.codePointAt(0)!) || c === "\n" ? c : "?";
  }).join("");

  const W = 595.28, H = 841.89, M = 48, CW = W - 2 * M;
  let page = doc.addPage([W, H]);
  let y = H - M;
  const col = (c: number[]) => rgb(c[0], c[1], c[2]);

  const lines = (s: string, f = font, size = 10, width = CW): string[] => {
    const out: string[] = [];
    for (const para of safe(s).split("\n")) {
      let line = "";
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const next = line ? `${line} ${word}` : word;
        if (f.widthOfTextAtSize(next, size) <= width) { line = next; continue; }
        if (line) out.push(line);
        // a single word wider than the line (a long hash) is broken
        let w = word;
        while (f.widthOfTextAtSize(w, size) > width) {
          let n = w.length;
          while (n > 1 && f.widthOfTextAtSize(w.slice(0, n), size) > width) n--;
          out.push(w.slice(0, n)); w = w.slice(n);
        }
        line = w;
      }
      out.push(line);
    }
    return out;
  };
  const need = (h: number) => { if (y - h < M + 28) { page = doc.addPage([W, H]); y = H - M; } };
  const write = (s: string, o: { f?: typeof font; size?: number; color?: number[]; x?: number; width?: number; gap?: number } = {}) => {
    const size = o.size ?? 10, lh = size * 1.35;
    for (const l of lines(s, o.f ?? font, size, o.width ?? CW)) {
      need(lh);
      page.drawText(l, { x: o.x ?? M, y: y - size, size, font: o.f ?? font, color: col(o.color ?? INK) });
      y -= lh;
    }
    y -= o.gap ?? 0;
  };
  const rule = (c = RULE, t = 0.6) => { need(6); page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: t, color: col(c) }); y -= 8; };

  // ── header ──
  write("CEYLON RENT A CARS", { f: bold, size: 9, color: RED });
  write(src.document?.agreement?.title ?? "Booking Acceptance & Advance Payment e-Agreement", { f: bold, size: 17, gap: 2 });
  write(`${src.reference}  ·  Version ${src.version}  ·  CRC-AGR-003`, { size: 9, color: GREY });
  const a = src.document?.agreement ?? {};
  write(`Generated ${a.generated_at ?? ""}  ·  Valid until ${a.expires_at ?? ""}`, { size: 9, color: GREY, gap: 4 });
  rule(RED, 1.2);

  // ── summary ──
  const d = src.document ?? {};
  const rows: [string, string][] = [
    ["Customer", `${d.customer?.name ?? ""}  ·  ${d.customer?.mobile ?? ""}${d.customer?.email ? `  ·  ${d.customer.email}` : ""}`],
    ["References", `Inquiry ${d.ids?.inquiry ?? ""}  ·  Quotation ${d.ids?.quotation ?? ""} v${d.ids?.quotation_version ?? ""}  ·  Customer ${d.ids?.customer ?? ""}`],
    ["Vehicle", `${d.vehicle?.make_model ?? ""}${d.vehicle?.category ? ` (${d.vehicle.category})` : ""}  ·  ${d.vehicle?.registration ?? ""}`],
    ["Pickup", `${d.rental?.pickup ?? ""}  ·  ${d.rental?.pickup_location ?? ""}`],
    ["Return", `${d.rental?.return ?? ""}  ·  ${d.rental?.return_location ?? ""}`],
    ["Rental", `${d.rental?.duration ?? ""}  ·  ${d.rental?.package ?? ""}  ·  ${d.rental?.included_km ?? ""} included  ·  extra ${d.rental?.extra_km_rate ?? ""}`],
    ["Total rental", d.payment?.total ?? ""],
    ["Advance required", `${d.payment?.advance ?? ""}  (${d.payment?.advance_deadline ?? ""})`],
    ["Balance", d.payment?.balance ?? ""],
    ["Security deposit", d.payment?.deposit ?? ""],
  ];
  for (const [k, v] of rows) {
    const vl = lines(v, font, 10, CW - 130);
    need(vl.length * 13.5);
    page.drawText(safe(k), { x: M, y: y - 10, size: 9, font: bold, color: col(GREY) });
    for (const l of vl) { page.drawText(l, { x: M + 130, y: y - 10, size: 10, font, color: col(INK) }); y -= 13.5; }
    y -= 2;
  }
  y -= 4; rule();

  // ── the wording ──
  for (const s of sectionsOf(src.html ?? "")) {
    need(40);
    write(s.heading, { f: bold, size: 11.5, gap: 2 });
    write(s.body, { size: 10, gap: 8 });
  }

  // ── acceptance record ──
  rule();
  const acc = src.acceptance;
  if (acc && acc.decision === "ACCEPTED") {
    write("ACCEPTANCE RECORD", { f: bold, size: 10, color: RED, gap: 2 });
    write(`Accepted on ${lkTime(acc.at)}`, { f: bold, size: 10 });
    write(`Verified by ${acc.method === "SMS_OTP_PORTAL_LOGIN" ? "a one-time SMS code to the customer's mobile" : "CRC's reviewed manual acceptance"} ${acc.phone}`, { size: 9.5 });
    write(`Statement ${acc.statement_version ?? ""}: "${acc.statement ?? ""}"`, { size: 9.5, color: GREY, gap: 2 });
  } else if (acc && acc.decision === "DECLINED") {
    write(`DECLINED by the customer on ${lkTime(acc.at)}.`, { f: bold, size: 10, color: RED });
  } else {
    write(`NOT ACCEPTED — status ${src.status}. This copy is for reading only; it is not a signed agreement.`, { f: bold, size: 10, color: RED });
  }
  write(`Document fingerprint (SHA-256): ${src.document_hash}`, { size: 8, color: GREY });
  write("Your booking is confirmed only after CRC verifies the advance payment and allocates the vehicle. The full rental agreement (CRC-AGR-002) is signed at vehicle handover.",
    { size: 8, color: GREY });

  // ── footer on every page ──
  const pages = doc.getPages();
  pages.forEach((p: typeof page, i: number) => {
    const foot = safe(`${src.reference}  ·  Page ${i + 1} of ${pages.length}  ·  ${src.document_hash.slice(0, 16)}…`);
    p.drawText(foot, { x: M, y: 26, size: 7.5, font, color: col(GREY) });
  });
  return await doc.save({ useObjectStreams: false });
}
