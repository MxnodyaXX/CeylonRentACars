// Supabase Edge Function: vehicle-assistant
// The website's AI chat ("Find my car"): talks with the customer about their trip and recommends
// vehicles from the REAL fleet (catalog_vehicles), checking real booking dates (vehicle_busy_dates).
//
// Body:    { messages: [{ role: "user" | "assistant", content: string }, ...] }   (plain text history)
// Returns: { reply: string, vehicles: string[] }   — vehicles = ids to show as cards under the reply
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
- Recommend 1-3 vehicles that genuinely fit, and say briefly why each fits (seats, luggage, fuel economy, comfort for hill roads, price).
- Every time you recommend vehicles, call show_vehicles with their ids so the customer sees cards with photos and a Book button.
- When you know the dates, call check_availability before recommending, and only recommend vehicles that are free. If the ideal one is booked, say so and offer the closest alternatives.
- Prices are per day in Sri Lankan rupees (LKR). You can estimate a total as price x days, and say the final quote is confirmed by our team.

Rules:
- Only recommend vehicles from the fleet list below, using their exact ids. Never invent vehicles, prices, discounts or policies.
- Rental modes: Self drive (licence plus International Driving Permit needed), With driver (English-speaking driver), Airport pickup (meet and greet at Colombo airport CMB).
- For questions you can't answer from this information (deposit, insurance details, special requests, payment), say our team will confirm on WhatsApp at +94 77 972 6761 or by email hello@ceylonrentacars.lk.
- Keep replies short and friendly: 1-4 sentences, plain text, no markdown headings or tables. Reply in the customer's language.
- Stay on topic: vehicle rental and travel in Sri Lanka. Politely decline anything else.`;

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
  {
    name: "show_vehicles",
    description: "Show vehicle cards (photo, price, Book button) under your reply. Call this with the 1-3 vehicles you recommend, best first.",
    input_schema: {
      type: "object",
      properties: {
        vehicle_ids: { type: "array", items: { type: "string" }, description: "Fleet ids, best match first (1-3)." },
      },
      required: ["vehicle_ids"],
      additionalProperties: false,
    },
    strict: true,
  },
];

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

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Colombo" });
  const system: Anthropic.Beta.BetaTextBlockParam[] = [
    { type: "text", text: INSTRUCTIONS },
    // Instructions + fleet are the stable prefix → cached; the date comes after the breakpoint
    { type: "text", text: `Our fleet (one vehicle per line):\n${fleetText(list)}`, cache_control: { type: "ephemeral" } },
    { type: "text", text: `Today's date in Sri Lanka: ${today}.` },
  ];

  const messages = [...history];
  let shown: string[] = [];

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

      if (response.stop_reason !== "tool_use" || !calls.length || round === MAX_TOOL_ROUNDS) {
        return json({ reply: text || "Could you tell me a little more about your trip?", vehicles: shown });
      }

      messages.push({ role: "assistant", content: response.content });
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const call of calls) {
        let result: unknown;
        if (call.name === "check_availability") {
          result = await checkAvailability(call.input, known);
        } else if (call.name === "show_vehicles") {
          const ids = ((call.input as any)?.vehicle_ids ?? []).map(String).filter((id: string) => known.has(id)).slice(0, 3);
          shown = ids;
          result = ids.length ? { shown: ids } : { error: "None of these ids are in the fleet." };
        } else {
          result = { error: `Unknown tool ${call.name}` };
        }
        results.push({ type: "tool_result", tool_use_id: call.id, content: JSON.stringify(result), is_error: !!(result as any)?.error });
      }
      messages.push({ role: "user", content: results });
    }
    return json({ reply: "Could you tell me a little more about your trip?", vehicles: shown });
  } catch (e) {
    console.error("[vehicle-assistant]", e);
    if (e instanceof Anthropic.RateLimitError) return json({ error: "The assistant is busy — please try again in a moment." }, 429);
    if (e instanceof Anthropic.AuthenticationError) return json({ error: "The assistant isn't set up correctly (API key)." }, 500);
    if (e instanceof Anthropic.APIError) return json({ error: "The assistant is unavailable right now." }, 502);
    return json({ error: "Something went wrong." }, 500);
  }
});
