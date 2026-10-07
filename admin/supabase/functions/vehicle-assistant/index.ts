// Supabase Edge Function: vehicle-assistant
// The website's AI chat ("Find my car"): talks with the customer about their trip and recommends
// vehicles from the REAL fleet (catalog_vehicles), checking real booking dates (vehicle_busy_dates).
//
// Body:    { messages: [{ role: "user" | "assistant", content: string }, ...] }   (plain text history)
//          plus { trip } — trip details remembered from earlier replies
// Returns: { reply, vehicles, trip, suggestions, info }
//   reply has [[car:ID]] markers the chat turns into vehicle cards; trip = dates/mode/people so far;
//   suggestions = quick replies; info[id] = { available, days, total } for the trip dates
//
// Deploy:  supabase functions deploy vehicle-assistant --no-verify-jwt
// Secret:  supabase secrets set ANTHROPIC_API_KEY=sk-ant-...

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const client = new Anthropic(); // reads ANTHROPIC_API_KEY

const MODEL = "claude-opus-5-5";
const MAX_TURNS = 30;          // messages per conversation sent by the browser
const MAX_CHARS = 1500;        // per customer message
const MAX_TOOL_ROUNDS = 5;

/* ---------------- Fleet (cached for 5 minutes per function instance) ---------------- */

type Vehicle = Record<string, any>;
let fleetCache: { at: number; list: Vehicle[] } | null = null;

async function fleet(): Promise<Vehicle[]> {
  if (fleetCache && Date.now() - fleetCache.at < 5 * 60e3) return fleetCache.list;
  const { data, error } = await db.from("catalog_vehicles")
    .select("id,brand,model,year,price,seats,fuel_type,transmission,category,badge,location,available,completed_hires,rating,review_count,fuel_efficiency")
    .order("id");
  if (error) throw error;
  fleetCache = { at: Date.now(), list: data ?? [] };
  return fleetCache.list;
}

/** One compact line per vehicle — stable order so the prompt cache keeps hitting */
const fleetText = (list: Vehicle[]) => list.map((v) => [
  `id=${v.id}`, `${v.brand} ${v.model}${v.year ? ` ${v.year}` : ""}`,
  `category=${v.category ?? "-"}`, `seats=${v.seats ?? "?"}`, `transmission=${v.transmission ?? "?"}`,
  `fuel=${v.fuel_type ?? "?"}`, v.fuel_efficiency ? `km_per_l=${v.fuel_efficiency}` : "",
  `price_lkr_per_day=${v.price ?? "ask"}`, v.location ? `location=${v.location}` : "",
  v.badge ? `badge=${v.badge}` : "", v.rating ? `rating=${v.rating}/5 (${v.review_count} reviews)` : "",
  `completed_trips=${v.completed_hires ?? 0}`, v.available === false ? "status=not_in_service_now" : "",
].filter(Boolean).join(" | ")).join("\n");

/* ---------------- Prompt ---------------- */

const INSTRUCTIONS = `You are the vehicle assistant on the website of Ceylon Rent A Cars, a car rental company in Sri Lanka.
Your job: help each customer choose the right vehicle from OUR fleet for their trip, then guide them to book.

How to help:
- Find out what matters, a question or two at a time (never a long questionnaire): how many people and how much luggage, the dates, where they will travel (city driving, hill country, long tours, airport transfer), self drive or with a driver, and a budget if they have one.
- Recommend 1-3 vehicles that genuinely fit, and say briefly why each fits (luggage, fuel economy, comfort for hill roads, value).
- When you know the dates, call check_availability before recommending, and only recommend vehicles that are free. If the ideal one is booked, say so and offer the closest alternatives.
- Prices are per day in Sri Lankan rupees (LKR). You can estimate a total as price x days, and say the final quote is confirmed by our team.

Rules:
- Only recommend vehicles from the fleet list below, using their exact ids. Never invent vehicles, prices, discounts or policies.
- Rental modes: Self drive (licence plus International Driving Permit needed), With driver (English-speaking driver), Airport pickup (meet and greet at Colombo airport CMB).
- For questions you can't answer from this information (deposit, insurance details, special requests, payment), say our team will confirm on WhatsApp at +94 71 733 3313, by phone at +94 77 972 6761, or by email hello@ceylonrentacars.lk.
- Reply in the customer's language, friendly and short (about 40-90 words).

Layout (the chat shows every line as its own row — write tidy rows, never one long paragraph):
- The chat window is small, so be brief: usually 2-4 rows in total, plus any vehicle lines and the question list. Keep the text (not counting vehicle lines) under about 60 words.
- Row 1: a one-sentence direct answer (it is shown as the headline).
- Then the details. Keep sentences that belong together in the SAME row; start a new row (blank line) only where the topic changes — e.g. answer → how it works → advice → vehicles → questions. Do not put every sentence on its own row.
- Last row: ONE short question. If you need several details, write a lead-in row (e.g. "To find the right car:") followed by a "- " list of short questions, max 3, each ending with "?" (e.g. "- Your pickup and return dates?").
- Never put a question in the middle of a row with other information.

Formatting:
- Each vehicle you recommend goes on its own line in this exact form:
  - [[car:ID]] why it fits this trip, in one or two short sentences
  Example: "- [[car:ab12cd34]] Easy to park in Colombo and very light on fuel."
  The chat turns [[car:ID]] into a card with the photo, name, seats, gearbox, fuel, daily price, and — once the dates are known — "Free for your dates" and the trip total, plus a Book button that carries the trip details. So do NOT repeat the name, seats, gearbox, fuel, prices, totals or availability in that line. Never list a recommended vehicle in any other way.
- If you mention another vehicle in passing, just use its name (no marker) — but prefer giving it its own [[car:ID]] line if you suggest it.
- Use **bold** only for key numbers (totals, dates).
- No headings, tables, links or emojis, and never mention "cards" or "below".
- Stay on topic: vehicle rental and travel in Sri Lanka. Politely decline anything else.

Hidden notes (the chat reads and removes these — put them on the LAST lines, after everything else):
- Trip details: whenever you know any of them, add one line with ALL details known so far in the conversation:
  [[trip:from=YYYY-MM-DD;to=YYYY-MM-DD;mode=Self drive;people=4]]
  mode is exactly one of: Self drive, With driver, Airport pickup. Leave out anything not known yet. Resolve relative dates ("next Friday", "12-16 Nov") using today's date; if the customer gives a number of days, set to = from + days.
- Quick replies: add 2-3 lines like [[reply:12–16 Nov]] — short answers (max 4 words) the customer is likely to tap next, matching your question (e.g. dates, "With driver", "Self drive", "Show cheaper cars", "7 seats please"). Write them as the customer would say them.`;

const TRIP_MODES = ["Self drive", "With driver", "Airport pickup"];
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Reads and removes the hidden [[trip:…]] and [[reply:…]] notes */
function hiddenNotes(reply: string) {
  const trip: Record<string, string | number> = {};
  const suggestions: string[] = [];
  const text = reply
    .replace(/\[\[trip:([^\]]*)\]\]/g, (_m, body: string) => {
      for (const pair of body.split(";")) {
        const [k, ...rest] = pair.split("=");
        const key = k?.trim(), val = rest.join("=").trim();
        if ((key === "from" || key === "to") && ISO_DAY.test(val)) trip[key] = val;
        else if (key === "mode" && TRIP_MODES.includes(val)) trip.mode = val;
        else if (key === "people" && /^\d{1,2}$/.test(val)) trip.people = Number(val);
      }
      return "";
    })
    .replace(/\[\[reply:([^\]]{1,40})\]\]/g, (_m, s: string) => {
      const t = s.trim();
      if (t && suggestions.length < 3 && !suggestions.includes(t)) suggestions.push(t);
      return "";
    })
    .replace(/\n{3,}/g, "\n\n").trim();
  if (trip.from && trip.to && String(trip.to) < String(trip.from)) delete trip.to;
  return { text, trip, suggestions };
}

/** Rental days like the booking page: return date minus pickup date, at least 1 */
const rentalDays = (from: string, to: string) =>
  Math.max(1, Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000));

const tools: Anthropic.Beta.BetaTool[] = [
  {
    name: "check_availability",
    description: "Check which vehicles are free for the customer's dates (no confirmed or ongoing booking overlapping). Call this whenever the dates are known, before recommending.",
    input_schema: {
      type: "object",
      properties: {
        vehicle_ids: { type: "array", items: { type: "string" }, description: "Fleet ids to check (up to 20)." },
        start_date: { type: "string", description: "Pickup date, YYYY-MM-DD" },
        end_date: { type: "string", description: "Return date, YYYY-MM-DD" },
      },
      required: ["vehicle_ids", "start_date", "end_date"],
      additionalProperties: false,
    },
    strict: true,
  },
];

/** Keeps [[car:ID]] markers only for real fleet ids (others are dropped); returns the ids in order */
function cards(reply: string, known: Set<string>) {
  const ids: string[] = [];
  const text = reply.replace(/\[\[car:([A-Za-z0-9_-]+)\]\]\s*/g, (_m, id: string) => {
    if (!known.has(id)) return "";
    if (!ids.includes(id)) ids.push(id);
    return `[[car:${id}]] `;
  });
  return { reply: text, vehicles: ids };
}

/** Trip details the browser remembered from earlier replies (untrusted → validated) */
function cleanTrip(t: any) {
  const out: Record<string, string | number> = {};
  if (ISO_DAY.test(t?.from ?? "")) out.from = t.from;
  if (ISO_DAY.test(t?.to ?? "")) out.to = t.to;
  if (TRIP_MODES.includes(t?.mode)) out.mode = t.mode;
  if (Number.isInteger(t?.people) && t.people > 0 && t.people < 100) out.people = t.people;
  return out;
}

/**
 * Final answer for the browser: text with [[car:ID]] markers, the trip so far, quick replies,
 * and for each shown vehicle its availability + total for the trip dates (when known).
 */
async function finish(raw: string, known: Set<string>, fleetList: Vehicle[], prevTrip: Record<string, string | number>) {
  const notes = hiddenNotes(raw);
  const { reply, vehicles } = cards(notes.text || "Could you tell me a little more about your trip?", known);
  const trip = { ...prevTrip, ...notes.trip };
  if (trip.from && trip.to && String(trip.to) < String(trip.from)) delete trip.to;

  const info: Record<string, { available: boolean | null; days?: number; total?: number }> = {};
  if (vehicles.length && trip.from && trip.to) {
    const from = String(trip.from), to = String(trip.to);
    const days = rentalDays(from, to);
    const { data, error } = await db.from("vehicle_busy_dates")
      .select("vehicle_id").in("vehicle_id", vehicles).lte("start_date", to).gte("end_date", from);
    const busy = new Set((data ?? []).map((b) => String(b.vehicle_id)));
    for (const id of vehicles) {
      const price = Number(fleetList.find((v) => String(v.id) === id)?.price) || 0;
      info[id] = { available: error ? null : !busy.has(id), days, total: price ? price * days : undefined };
    }
  }
  return { reply, vehicles, trip, suggestions: notes.suggestions, info };
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

async function checkAvailability(input: any, known: Set<string>) {
  const ids = (Array.isArray(input?.vehicle_ids) ? input.vehicle_ids : []).map(String).filter((id: string) => known.has(id)).slice(0, 20);
  const { start_date: from, end_date: to } = input ?? {};
  if (!ISO.test(from ?? "") || !ISO.test(to ?? "") || from > to) return { error: "Dates must be YYYY-MM-DD with start_date on or before end_date." };
  if (!ids.length) return { error: "None of these ids are in the fleet." };
  const { data, error } = await db.from("vehicle_busy_dates")
    .select("vehicle_id,start_date,end_date").in("vehicle_id", ids).lte("start_date", to).gte("end_date", from);
  if (error) return { error: "Availability check failed — tell the customer our team will confirm availability." };
  const busy = new Set((data ?? []).map((b) => String(b.vehicle_id)));
  return { start_date: from, end_date: to, available: ids.filter((id: string) => !busy.has(id)), booked: ids.filter((id: string) => busy.has(id)) };
}

/* ---------------- Rate limit (per visitor IP, per function instance) ---------------- */

const hits = new Map<string, number[]>();
function limited(ip: string) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 10 * 60e3);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > 25;   // 25 messages per 10 minutes is plenty for a real customer
}

/* ---------------- Handler ---------------- */

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  if (limited(ip)) return json({ error: "Too many messages — please wait a few minutes, or chat with us on WhatsApp." }, 429);
  if (!Deno.env.get("ANTHROPIC_API_KEY")) return json({ error: "The assistant isn't set up yet (ANTHROPIC_API_KEY)." }, 500);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }

  // Plain-text history from the browser — validated and trimmed (it is untrusted input)
  const history: Anthropic.Beta.BetaMessageParam[] = (Array.isArray(body?.messages) ? body.messages : [])
    .filter((m: any) => (m?.role === "user" || m?.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-MAX_TURNS)
    .map((m: any) => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }));
  while (history.length && history[0].role !== "user") history.shift();
  if (!history.length || history[history.length - 1].role !== "user") return json({ error: "Send the customer's message last." }, 400);

  let list: Vehicle[];
  try { list = await fleet(); } catch { return json({ error: "Couldn't load the fleet right now." }, 503); }
  const known = new Set(list.map((v) => String(v.id)));
  const prevTrip = cleanTrip(body?.trip);

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Colombo" });
  const system: Anthropic.Beta.BetaTextBlockParam[] = [
    { type: "text", text: INSTRUCTIONS },
    // Instructions + fleet are the stable prefix → cached; the date comes after the breakpoint
    { type: "text", text: `Our fleet (one vehicle per line):\n${fleetText(list)}`, cache_control: { type: "ephemeral" } },
    { type: "text", text: `Today's date in Sri Lanka: ${today}.` +
      (Object.keys(prevTrip).length ? `\nTrip details known so far: ${JSON.stringify(prevTrip)}` : "") },
  ];

  const messages = [...history];
  const said: string[] = [];   // text from every round

  try {
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const response = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 4000,
        output_config: { effort: "low" },          // short chat replies; thinking stays adaptive
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",                       // a declined request is retried on Anthropic's fallback model
        system,
        tools,
        messages,
      } as any) as Anthropic.Beta.BetaMessage;

      if (response.stop_reason === "refusal") {
        return json({ reply: "Sorry, I can't help with that. I can help you choose a vehicle for your trip in Sri Lanka.", vehicles: [] });
      }

      const text = response.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map((b) => b.text).join("\n").trim();
      const calls = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");

      if (text) said.push(text);
      if (response.stop_reason !== "tool_use" || !calls.length || round === MAX_TOOL_ROUNDS) {
        // A full final answer stands alone; only a very short one gets the earlier rounds' text too
        const reply = text.split(/\s+/).length >= 25 ? text : said.join("\n\n");
        return json(await finish(reply, known, list, prevTrip));
      }

      messages.push({ role: "assistant", content: response.content });
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const call of calls) {
        let result: unknown;
        if (call.name === "check_availability") {
          result = await checkAvailability(call.input, known);
        } else {
          result = { error: `Unknown tool ${call.name}` };
        }
        results.push({ type: "tool_result", tool_use_id: call.id, content: JSON.stringify(result), is_error: !!(result as any)?.error });
      }
      messages.push({ role: "user", content: results });
    }
    return json(await finish(said.join("\n\n"), known, list, prevTrip));
  } catch (e) {
    console.error("[vehicle-assistant]", e);
    if (e instanceof Anthropic.RateLimitError) return json({ error: "The assistant is busy — please try again in a moment." }, 429);
    if (e instanceof Anthropic.AuthenticationError) return json({ error: "The assistant isn't set up correctly (API key)." }, 500);
    if (e instanceof Anthropic.APIError) return json({ error: "The assistant is unavailable right now." }, 502);
    return json({ error: "Something went wrong." }, 500);
  }
});
