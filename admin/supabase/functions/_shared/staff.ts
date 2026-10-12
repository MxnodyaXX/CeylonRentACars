// Shared check for Edge Functions that only staff may call (send SMS / WhatsApp, manage logins).
//
// Allowed callers:
//   - a signed-in admin or owner (Supabase Auth session; role is in the user's app_metadata,
//     which only the server can set)
//   - other Edge Functions / cron using the service-role key (e.g. send-reminders → send-sms)
// Everyone else — including the public website key — gets 401.

import { createClient, type SupabaseClient, type User } from "https://esm.sh/@supabase/supabase-js@2";

export type StaffRole = "admin" | "owner";
export interface Caller { kind: "service" | "staff"; user?: User; role?: StaffRole }

const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

export const serviceClient = (): SupabaseClient =>
  createClient(Deno.env.get("SUPABASE_URL")!, SERVICE_KEY, { auth: { persistSession: false } });

/** Who is calling, or null when it's not staff / the service role */
export async function staffCaller(req: Request, db: SupabaseClient = serviceClient()): Promise<Caller | null> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  if (token === SERVICE_KEY) return { kind: "service" };
  const { data, error } = await db.auth.getUser(token);
  if (error || !data?.user) return null;
  const role = data.user.app_metadata?.role as StaffRole | undefined;
  if (role !== "admin" && role !== "owner") return null;
  return { kind: "staff", user: data.user, role };
}

export const unauthorized = (headers: Record<string, string>) =>
  new Response(JSON.stringify({ ok: false, error: "Sign in to the admin to do this." }), {
    status: 401, headers: { ...headers, "Content-Type": "application/json" },
  });
