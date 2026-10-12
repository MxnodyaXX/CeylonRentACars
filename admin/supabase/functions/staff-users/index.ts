// Supabase Edge Function: staff-users
// Admin + owner logins on Supabase Auth (passwords are hashed by Supabase — never stored or
// returned by us). Each login is an Auth user with a username-based email
// (<username>@staff.ceylonrentacars.com) and app_metadata:
//   { role: 'admin' | 'owner', owner_id?, username, name, permissions? }
// app_metadata can only be set server-side, so a user can't promote themselves.
//
// Deploy:  supabase functions deploy staff-users --no-verify-jwt
//
// POST { action, ... } — callers must be signed-in staff:
//   list                                   admin → all staff logins
//   create   { username, password, name, role?, ownerId?, contactEmail?, nic? }   admin
//   update   { id, name?, password?, permissions?, disabled? }   admin (or anyone: own password)
//   delete   { id }                                                admin
//   migrate-legacy                         admin → copy logins from the old public.users table

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { serviceClient, staffCaller, unauthorized } from "../_shared/staff.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

export const STAFF_DOMAIN = "staff.ceylonrentacars.com";
const cleanUsername = (u: string) => String(u ?? "").trim().toLowerCase().replace(/[^a-z0-9._-]/g, "");
const emailOf = (username: string) => `${cleanUsername(username)}@${STAFF_DOMAIN}`;
const BAN_FOREVER = "876000h";   // ~100 years

// deno-lint-ignore no-explicit-any
const toStaff = (u: any) => ({
  id: u.id,
  username: u.app_metadata?.username ?? String(u.email ?? "").split("@")[0],
  name: u.app_metadata?.name ?? "",
  role: u.app_metadata?.role,
  ownerId: u.app_metadata?.owner_id ?? undefined,
  permissions: u.app_metadata?.permissions ?? undefined,
  contactEmail: u.user_metadata?.contact_email ?? undefined,
  nic: u.user_metadata?.nic ?? undefined,
  disabled: !!u.banned_until && new Date(u.banned_until) > new Date(),
  lastSignIn: u.last_sign_in_at ?? undefined,
});

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const db = serviceClient();
  const caller = await staffCaller(req, db);
  if (!caller || caller.kind !== "staff") return unauthorized(cors);
  const isAdmin = caller.role === "admin";

  // deno-lint-ignore no-explicit-any
  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: "Invalid JSON" }, 400); }
  const action = String(body.action ?? "");

  // All staff logins (Auth has no server-side filter on app_metadata, so page through them)
  const listAll = async () => {
    // deno-lint-ignore no-explicit-any
    const out: any[] = [];
    for (let page = 1; page < 50; page++) {
      const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
      if (error) throw error;
      out.push(...data.users.filter((u) => ["admin", "owner"].includes(u.app_metadata?.role)));
      if (data.users.length < 200) break;
    }
    return out;
  };

  try {
    switch (action) {
      case "list": {
        if (!isAdmin) return json({ ok: false, error: "Admins only" }, 403);
        return json({ ok: true, users: (await listAll()).map(toStaff) });
      }

      case "create": {
        if (!isAdmin) return json({ ok: false, error: "Admins only" }, 403);
        const username = cleanUsername(body.username);
        const role = body.role === "admin" ? "admin" : "owner";
        if (!username) return json({ ok: false, error: "Choose a username (letters and numbers)." }, 400);
        if (String(body.password ?? "").length < 6) return json({ ok: false, error: "The password must be at least 6 characters." }, 400);
        if (role === "owner" && !body.ownerId) return json({ ok: false, error: "An owner login needs the owner." }, 400);
        const { data, error } = await db.auth.admin.createUser({
          email: emailOf(username), password: String(body.password), email_confirm: true,
          app_metadata: { role, owner_id: role === "owner" ? String(body.ownerId) : undefined, username, name: String(body.name ?? username) },
          user_metadata: { contact_email: body.contactEmail || undefined, nic: body.nic || undefined },
        });
        if (error) {
          const taken = /already|registered|exists/i.test(error.message);
          return json({ ok: false, error: taken ? "That username is already taken — choose another." : error.message }, taken ? 409 : 400);
        }
        return json({ ok: true, user: toStaff(data.user) });
      }

      case "update": {
        const id = String(body.id ?? "");
        const own = id === caller.user!.id;
        if (!isAdmin && !(own && body.password && Object.keys(body).every((k) => ["action", "id", "password"].includes(k)))) {
          return json({ ok: false, error: "Admins only" }, 403);
        }
        const { data: cur, error: getErr } = await db.auth.admin.getUserById(id);
        if (getErr || !cur?.user) return json({ ok: false, error: "Login not found" }, 404);
        // deno-lint-ignore no-explicit-any
        const patch: any = {};
        if (body.password !== undefined) {
          if (String(body.password).length < 6) return json({ ok: false, error: "The password must be at least 6 characters." }, 400);
          patch.password = String(body.password);
        }
        if (body.name !== undefined || body.permissions !== undefined) {
          patch.app_metadata = {
            ...cur.user.app_metadata,
            ...(body.name !== undefined ? { name: String(body.name) } : {}),
            ...(body.permissions !== undefined ? { permissions: body.permissions } : {}),
          };
        }
        if (body.disabled !== undefined) {
          if (own) return json({ ok: false, error: "You can't disable your own login." }, 400);
          patch.ban_duration = body.disabled ? BAN_FOREVER : "none";
        }
        const { data, error } = await db.auth.admin.updateUserById(id, patch);
        if (error) return json({ ok: false, error: error.message }, 400);
        return json({ ok: true, user: toStaff(data.user) });
      }

      case "delete": {
        if (!isAdmin) return json({ ok: false, error: "Admins only" }, 403);
        if (String(body.id) === caller.user!.id) return json({ ok: false, error: "You can't delete your own login." }, 400);
        const { error } = await db.auth.admin.deleteUser(String(body.id));
        if (error) return json({ ok: false, error: error.message }, 400);
        return json({ ok: true });
      }

      // One-time: copy the old plain-text logins (public.users) into Supabase Auth with the
      // same username + password, so owners keep signing in as before. Safe to run again.
      case "migrate-legacy": {
        if (!isAdmin) return json({ ok: false, error: "Admins only" }, 403);
        const { data: rows, error } = await db.from("users").select("*");
        if (error) return json({ ok: false, error: `Could not read the old logins: ${error.message}` }, 400);
        const existing = new Set((await listAll()).map((u) => String(u.email).toLowerCase()));
        const result = { created: [] as string[], skipped: [] as string[], failed: [] as string[] };
        for (const r of rows ?? []) {
          const username = cleanUsername(r.username);
          if (!username || existing.has(emailOf(username))) { result.skipped.push(r.username); continue; }
          const { error: e } = await db.auth.admin.createUser({
            email: emailOf(username), password: String(r.password ?? ""), email_confirm: true,
            app_metadata: { role: r.role === "admin" ? "admin" : "owner", owner_id: r.owner_id ?? undefined, username, name: r.name ?? username },
            user_metadata: { contact_email: r.email ?? undefined, nic: r.nic ?? undefined },
          });
          if (e) result.failed.push(`${r.username}: ${e.message}`); else result.created.push(r.username);
        }
        return json({ ok: true, ...result });
      }

      default:
        return json({ ok: false, error: `Unknown action "${action}"` }, 400);
    }
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message ?? e) }, 500);
  }
});
