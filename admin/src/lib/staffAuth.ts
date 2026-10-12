import type { Session, User } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { AppUser, OwnerPermissions } from '../types/auth';

/*
 * Staff logins on Supabase Auth. Staff still sign in with a username: it maps to the
 * address <username>@staff.ceylonrentacars.com (never emailed — just the login id).
 * Role, owner and permissions live in the login's app_metadata, which only the server
 * (Edge Function staff-users) can change.
 */
export const STAFF_DOMAIN = 'staff.ceylonrentacars.com';
export const cleanUsername = (u: string) => u.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
export const staffEmail = (username: string) => `${cleanUsername(username)}@${STAFF_DOMAIN}`;

/** The app's user from a Supabase login — null when it isn't a staff login */
export function userFromAuth(u: User | null | undefined): AppUser | null {
  const m = u?.app_metadata ?? {};
  if (!u || (m.role !== 'admin' && m.role !== 'owner')) return null;
  return {
    id: u.id,
    username: m.username ?? String(u.email ?? '').split('@')[0],
    name: m.name ?? m.username ?? 'Staff',
    role: m.role,
    ownerId: m.owner_id ?? undefined,
    email: u.user_metadata?.contact_email ?? undefined,
    nic: u.user_metadata?.nic ?? undefined,
    permissions: m.permissions as Partial<OwnerPermissions> | undefined,
  };
}

export async function signIn(username: string, password: string): Promise<{ user?: AppUser; error?: string }> {
  const { data, error } = await supabase.auth.signInWithPassword({ email: staffEmail(username), password });
  if (error) {
    return { error: /banned/i.test(error.message) ? 'This login has been disabled — contact the admin.' : 'Wrong username or password.' };
  }
  const user = userFromAuth(data.user);
  if (!user) { await supabase.auth.signOut(); return { error: 'This login has no staff access.' }; }
  return { user };
}

export const signOut = () => supabase.auth.signOut();
export const currentSession = async (): Promise<Session | null> => (await supabase.auth.getSession()).data.session;

/* ---------- Staff login management (Edge Function: staff-users) ---------- */

export interface StaffLogin extends AppUser { disabled?: boolean; lastSignIn?: string; contactEmail?: string }

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('staff-users', { body });
  // the function answers errors with { ok: false, error } — surface its message
  const payload = (data ?? (await (error as { context?: Response })?.context?.json?.().catch(() => null))) as { ok?: boolean; error?: string } | null;
  if (!payload?.ok) throw new Error(payload?.error ?? error?.message ?? 'The login service did not answer.');
  return payload as T;
}

export const listStaff = () => call<{ users: StaffLogin[] }>({ action: 'list' }).then((r) => r.users);
export const createStaff = (p: { username: string; password: string; name: string; role?: 'admin' | 'owner'; ownerId?: string; contactEmail?: string; nic?: string }) =>
  call<{ user: StaffLogin }>({ action: 'create', ...p }).then((r) => r.user);
export const updateStaff = (id: string, p: { name?: string; password?: string; permissions?: Partial<OwnerPermissions>; disabled?: boolean }) =>
  call<{ user: StaffLogin }>({ action: 'update', id, ...p }).then((r) => r.user);
export const deleteStaff = (id: string) => call<{ ok: true }>({ action: 'delete', id });
export const migrateLegacyLogins = () =>
  call<{ created: string[]; skipped: string[]; failed: string[] }>({ action: 'migrate-legacy' });

/** 6-digit PIN for new owner logins — easy to read out over the phone */
export const genPin = () => String(Math.floor(100000 + Math.random() * 900000));
