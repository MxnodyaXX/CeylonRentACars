// Supabase Edge Function: staff-users
// Staff logins on Supabase Auth. Passwords are hashed by Supabase — this function never stores
// or logs them; it only returns a NEW temporary password once, to the admin who created/reset it.
//
// Each login = Auth user <username>@staff.ceylonrentacars.com with app_metadata
//   { role: 'admin' | 'owner', owner_id?, username, name, permissions?, must_change_password? }
// app_metadata is only writable with the service-role key (here), so nobody can promote themselves.
// ADMIN logins are never created here — only in the Supabase dashboard (DEPLOY-CHECKLIST.md).
//
// Deploy:  supabase functions deploy staff-users --no-verify-jwt   (the caller is checked below)
//
// POST { action, ... }
//   list                                    admin  → staff logins
//   create          { username, name, ownerId, password? }   admin → owner login (temp password if none)
//   update          { id, name?, permissions?, disabled? }    admin → owner logins only
//   reset-password  { id }                  admin  → owner login: new temp password, must change at sign-in
//   change-password { currentPassword, newPassword }          any staff → own password
//   delete          { id }                  admin  → owner logins only
//   migrate-preview                         admin  → what migrate-legacy would do (changes nothing)
//   migrate-legacy                          admin  → move valid old logins (public.users) — new temp passwords

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serviceClient, staffCaller, unauthorized } from "../_shared/staff.ts";
import { passwordProblem, tempPassword } from "../_shared/password.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const STAFF_DOMAIN = "staff.ceylonrentacars.com";
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;
const emailOf = (username: string) => `${username}@${STAFF_DOMAIN}`;
const normalUsername = (u: unknown) => String(u ?? "").trim().toLowerCase();

// deno-lint-ignore no-explicit-any
const toStaff = (u: any) => ({
  id: u.id,
  username: u.app_metadata?.username ?? String(u.email ?? "").split("@")[0],
  name: u.app_metadata?.name ?? "",
  role: u.app_metadata?.role,
  ownerId: u.app_metadata?.owner_id ?? undefined,
  permissions: u.app_metadata?.permissions ?? undefined,
  mustChangePassword: !!u.app_metadata?.must_change_password,
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
  if (!caller || caller.kind !== "staff") return unauthorized(cors);   // signed-in staff only (not the service key)
  const isAdmin = caller.role === "admin";
  const me = caller.user!;

  // deno-lint-ignore no-explicit-any
  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: "Invalid JSON" }, 400); }
  const action = String(body.action ?? "");
  const adminOnly = () => json({ ok: false, error: "Admins only" }, 403);

  const listAll = async () => {
    // deno-lint-ignore no-explicit-any
    const out: any[] = [];
    for (let page = 1; page < 50; page++) {
      const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
      if (error) throw error;
      out.push(...data.users);
      if (data.users.length < 200) break;
    }
    return out;
  };
  const staffOnly = (users: { app_metadata?: { role?: string } }[]) => users.filter((u) => ["admin", "owner"].includes(u.app_metadata?.role ?? ""));
  // Owner logins only — admin logins can't be changed through this function
  const ownerLogin = async (id: string) => {
    const { data, error } = await db.auth.admin.getUserById(String(id ?? ""));
    if (error || !data?.user) return null;
    return data.user.app_metadata?.role === "owner" ? data.user : null;
  };
  const ownerExists = async (ownerId: string) =>
    !!ownerId && !!(await db.from("owners").select("id").eq("id", ownerId).maybeSingle()).data;

  try {
    switch (action) {
      case "list": {
        if (!isAdmin) return adminOnly();
        return json({ ok: true, users: staffOnly(await listAll()).map(toStaff) });
      }

      case "create": {
        if (!isAdmin) return adminOnly();
        const username = normalUsername(body.username);
        const ownerId = String(body.ownerId ?? "");
        if (!USERNAME_RE.test(username)) return json({ ok: false, error: "Username: 3–32 characters — lowercase letters, numbers, . _ -" }, 400);
        if (!(await ownerExists(ownerId))) return json({ ok: false, error: "That owner doesn't exist." }, 400);
        const all = await listAll();
        if (all.some((u) => String(u.email).toLowerCase() === emailOf(username))) return json({ ok: false, error: "That username is already taken — choose another." }, 409);
        if (all.some((u) => u.app_metadata?.role === "owner" && u.app_metadata?.owner_id === ownerId)) return json({ ok: false, error: "This owner already has a login." }, 409);
        const chosen = body.password ? String(body.password) : null;
        if (chosen) { const p = passwordProblem(chosen, username); if (p) return json({ ok: false, error: p }, 400); }
        const password = chosen ?? tempPassword();
        const { data, error } = await db.auth.admin.createUser({
          email: emailOf(username), password, email_confirm: true,
          app_metadata: { role: "owner", owner_id: ownerId, username, name: String(body.name ?? username).slice(0, 80), must_change_password: !chosen },
          user_metadata: { contact_email: body.contactEmail ? String(body.contactEmail).slice(0, 120) : undefined, nic: body.nic ? String(body.nic).slice(0, 20) : undefined },
        });
        if (error) return json({ ok: false, error: error.message }, 400);
        return json({ ok: true, user: toStaff(data.user), ...(chosen ? {} : { tempPassword: password }) });
      }

      case "update": {
        if (!isAdmin) return adminOnly();
        const target = await ownerLogin(body.id);
        if (!target) return json({ ok: false, error: "Owner login not found." }, 404);
        // deno-lint-ignore no-explicit-any
        const patch: any = {};
        if (body.name !== undefined || body.permissions !== undefined) {
          patch.app_metadata = {
            ...target.app_metadata,
            ...(body.name !== undefined ? { name: String(body.name).slice(0, 80) } : {}),
            ...(body.permissions !== undefined ? { permissions: Object.fromEntries(Object.entries(body.permissions ?? {}).filter(([k, v]) => /^can[A-Z]\w+$/.test(k) && typeof v === "boolean")) } : {}),
          };
        }
        if (body.disabled !== undefined) patch.ban_duration = body.disabled ? "876000h" : "none";
        const { data, error } = await db.auth.admin.updateUserById(target.id, patch);
        if (error) return json({ ok: false, error: error.message }, 400);
        return json({ ok: true, user: toStaff(data.user) });
      }

      case "reset-password": {
        if (!isAdmin) return adminOnly();
        const target = await ownerLogin(body.id);
        if (!target) return json({ ok: false, error: "Owner login not found." }, 404);
        const password = tempPassword();
        const { data, error } = await db.auth.admin.updateUserById(target.id, {
          password, app_metadata: { ...target.app_metadata, must_change_password: true },
        });
        if (error) return json({ ok: false, error: error.message }, 400);
        return json({ ok: true, user: toStaff(data.user), tempPassword: password });
      }

      case "change-password": {
        const current = String(body.currentPassword ?? ""), next = String(body.newPassword ?? "");
        const username = me.app_metadata?.username ?? String(me.email ?? "").split("@")[0];
        const problem = passwordProblem(next, username);
        if (problem) return json({ ok: false, error: problem }, 400);
        if (current === next) return json({ ok: false, error: "Choose a different password from the current one." }, 400);
        // confirm the current password with a throwaway public-key client (no session kept)
        const check = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
        const { error: wrong } = await check.auth.signInWithPassword({ email: me.email!, password: current });
        if (wrong) return json({ ok: false, error: "Your current password is not correct." }, 400);
        const { error } = await db.auth.admin.updateUserById(me.id, {
          password: next, app_metadata: { ...me.app_metadata, must_change_password: false },
        });
        if (error) return json({ ok: false, error: error.message }, 400);
        return json({ ok: true });
      }

      case "delete": {
        if (!isAdmin) return adminOnly();
        const target = await ownerLogin(body.id);
        if (!target) return json({ ok: false, error: "Owner login not found." }, 404);
        const { error } = await db.auth.admin.deleteUser(target.id);
        if (error) return json({ ok: false, error: error.message }, 400);
        return json({ ok: true });
      }

      // ── Moving the old logins (public.users) ──────────────────────────────
      // The old table is NOT trusted: its role column is ignored (admin rows are refused),
      // every username / owner is validated, duplicates and clashes are reported, and the old
      // passwords — which were publicly readable — are replaced by new temporary passwords.
      case "migrate-preview":
      case "migrate-legacy": {
        if (!isAdmin) return adminOnly();
        const { data: rows, error } = await db.from("users").select("id, username, role, owner_id, name, email, nic");
        if (error) return json({ ok: false, error: `Could not read the old logins: ${error.message}` }, 400);
        const { data: owners } = await db.from("owners").select("id, name");
        const ownerName = new Map((owners ?? []).map((o) => [o.id, o.name]));
        const auth = await listAll();
        const authByEmail = new Map(auth.map((u) => [String(u.email).toLowerCase(), u]));
        const authOwnerIds = new Map(auth.filter((u) => u.app_metadata?.role === "owner").map((u) => [u.app_metadata?.owner_id, u]));
        // duplicates inside the old table
        const count = (key: (r: typeof rows[0]) => string) => (rows ?? []).reduce((m, r) => m.set(key(r), (m.get(key(r)) ?? 0) + 1), new Map<string, number>());
        const usernameCount = count((r) => normalUsername(r.username));
        const ownerCount = count((r) => String(r.owner_id ?? ""));

        type Plan = { username: string; ownerId: string | null; ownerName?: string; status: "move" | "already-moved" | "rejected"; reason?: string };
        const plan: Plan[] = (rows ?? []).map((r) => {
          const username = normalUsername(r.username);
          const ownerId = r.owner_id ? String(r.owner_id) : null;
          const base = { username: r.username, ownerId, ownerName: ownerId ? ownerName.get(ownerId) : undefined };
          const reject = (reason: string): Plan => ({ ...base, status: "rejected", reason });
          if (r.role !== "owner") return reject(`role "${r.role}" — only owner logins are moved; create admins in the Supabase dashboard`);
          if (!USERNAME_RE.test(username) || username !== String(r.username).trim().toLowerCase()) return reject("invalid username (3–32: lowercase letters, numbers, . _ -)");
          if ((usernameCount.get(username) ?? 0) > 1) return reject("the same username appears more than once in the old logins");
          if (!ownerId || !ownerName.has(ownerId)) return reject("linked owner doesn't exist");
          if ((ownerCount.get(ownerId) ?? 0) > 1) return reject("this owner has more than one old login — keep one");
          const existing = authByEmail.get(emailOf(username));
          if (existing) {
            return existing.app_metadata?.role === "owner" && existing.app_metadata?.owner_id === ownerId
              ? { ...base, status: "already-moved" }
              : reject("a secure login with this username already exists for someone else");
          }
          const other = authOwnerIds.get(ownerId);
          if (other) return reject(`owner already has a secure login (${other.app_metadata?.username ?? other.email})`);
          return { ...base, status: "move" };
        });

        if (action === "migrate-preview") return json({ ok: true, plan });

        const moved: { username: string; ownerName?: string; tempPassword: string }[] = [];
        const failed: string[] = [];
        for (const p of plan.filter((x) => x.status === "move")) {
          const r = rows!.find((x) => x.username === p.username)!;
          const username = normalUsername(r.username);
          const password = tempPassword();
          const { error: e } = await db.auth.admin.createUser({
            email: emailOf(username), password, email_confirm: true,
            app_metadata: { role: "owner", owner_id: p.ownerId, username, name: String(r.name ?? username).slice(0, 80), must_change_password: true },
            user_metadata: { contact_email: r.email ?? undefined, nic: r.nic ?? undefined },
          });
          if (e) failed.push(`${r.username}: ${e.message}`);
          else moved.push({ username, ownerName: p.ownerName, tempPassword: password });
        }
        return json({ ok: true, plan, moved, failed });
      }

      default:
        return json({ ok: false, error: `Unknown action "${action}"` }, 400);
    }
  } catch (e) {
    console.error("[staff-users]", action, (e as Error)?.message);   // never logs passwords or bodies
    return json({ ok: false, error: "Something went wrong — please try again." }, 500);
  }
});
