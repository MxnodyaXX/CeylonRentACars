// Supabase Edge Function: send-reminders
// Time-based SMS — run once daily by pg_cron (see supabase/sms-cron.sql).
// Sends pickup reminders, return reminders, overdue alerts, and a daily admin summary.
// Delegates the actual send (and logging) to the send-sms function.
//
// Deploy:   supabase functions deploy send-reminders --no-verify-jwt
// Secrets:  supabase secrets set CRON_SECRET=<random>  ADMIN_PHONE=94XXXXXXXXX
// Trigger:  POST .../functions/v1/send-reminders?key=<CRON_SECRET>

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ADMIN_PHONE  = Deno.env.get("ADMIN_PHONE") ?? "";
const CRON_SECRET  = Deno.env.get("CRON_SECRET") ?? "";
const BRAND = "EMRAC Rent A Car";
const rs = (n: number) => `Rs ${Number(n || 0).toLocaleString()}`;

const admin = createClient(SUPABASE_URL, SERVICE_KEY);

// Sri Lanka local date (UTC+5:30) as yyyy-MM-dd.
const slDate = (offsetDays = 0) =>
  new Date(Date.now() + (5.5 * 3600 * 1000) + offsetDays * 86400000).toISOString().slice(0, 10);

async function sendOne(to: string, message: string, category: string, role: string, relatedId?: string) {
  if (!to) return;
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/send-sms`, {
      method: "POST",
      headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ to, message, category, role, relatedId }),
    });
  } catch (_) { /* swallow — one failure shouldn't stop the batch */ }
}

serve(async (req) => {
  const url = new URL(req.url);
  if (CRON_SECRET && url.searchParams.get("key") !== CRON_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  const today = slDate(0);
  const tomorrow = slDate(1);

  const [{ data: bookings }, { data: vehicles }, { data: optedOut }] = await Promise.all([
    admin.from("bookings").select("*"),
    admin.from("vehicles").select("id,brand,model,vehicle_number"),
    admin.from("customers").select("phone").eq("sms_opt_in", false),
  ]);

  const vLabel = (id: string) => {
    const v = (vehicles ?? []).find((x: Record<string, string>) => x.id === id);
    return v ? `${v.brand} ${v.model} (${v.vehicle_number})` : "your vehicle";
  };
  const blocked = new Set((optedOut ?? []).map((c: { phone: string }) => c.phone));
  const rows = bookings ?? [];

  let pickups = 0, returns = 0, overdue = 0;

  for (const b of rows as Record<string, string>[]) {
    if (blocked.has(b.customer_phone)) continue;
    const veh = vLabel(b.vehicle_id);

    if (b.status === "Confirmed" && b.start_date === tomorrow) {
      pickups++;
      await sendOne(b.customer_phone,
        `Dear ${b.customer_name}, a reminder from ${BRAND}: your vehicle ${veh} is ready for pickup on ${b.start_date}. We look forward to serving you.`,
        "pickupReminder", "customer", b.id);
    } else if (b.status === "Ongoing" && b.end_date === tomorrow) {
      returns++;
      await sendOne(b.customer_phone,
        `Dear ${b.customer_name}, a friendly reminder from ${BRAND}: your hired vehicle ${veh} is due for return on ${b.end_date}. Please return it on time to avoid extra charges. Thank you.`,
        "returnReminder", "customer", b.id);
    } else if (b.status === "Ongoing" && b.end_date < today) {
      overdue++;
      await sendOne(b.customer_phone,
        `Dear ${b.customer_name}, our records show ${veh} was due back on ${b.end_date} and is now overdue. Late charges may apply. Please return it or contact us immediately. - ${BRAND}.`,
        "overdueReturn", "customer", b.id);
      if (ADMIN_PHONE) {
        await sendOne(ADMIN_PHONE,
          `EMRAC ALERT: ${veh} (customer ${b.customer_name}) was due ${b.end_date} and is overdue. Action required.`,
          "adminOverdueReturn", "admin", b.id);
      }
    }
  }

  // Daily admin summary
  if (ADMIN_PHONE) {
    const pickupsToday = rows.filter((b: Record<string, string>) => b.start_date === today).length;
    const returnsToday = rows.filter((b: Record<string, string>) => b.status === "Ongoing" && b.end_date === today).length;
    const revenueToday = rows
      .filter((b: Record<string, string>) => b.start_date === today && b.status !== "Cancelled")
      .reduce((s: number, b: Record<string, number>) => s + Number(b.total_amount || 0), 0);
    await sendOne(ADMIN_PHONE,
      `EMRAC daily summary (${today}): ${pickupsToday} pickup(s), ${returnsToday} return(s) due, ${rs(revenueToday)} booked.`,
      "adminDailySummary", "admin");
  }

  return new Response(JSON.stringify({ ok: true, date: today, pickups, returns, overdue }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
});
