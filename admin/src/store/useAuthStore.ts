import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { AuthState, AppUser, OwnerPermissions } from '../types/auth';
import { supabase, supabaseEnabled } from '../lib/supabase';
import {
  cleanUsername, createStaff, currentSession, genPin, listStaff, signIn, signOut, updateStaff, userFromAuth,
} from '../lib/staffAuth';
import { toast } from './useToast';

/*
 * Who is signed in to the admin.
 *
 * With Supabase connected, logins are real Supabase Auth accounts: passwords are hashed by
 * Supabase and never reach the browser, role / owner / permissions are set server-side
 * (Edge Function staff-users), and the database only answers signed-in staff
 * (supabase/security-lockdown.sql). The session is kept by Supabase, not by this store.
 *
 * Offline demo mode (no Supabase configured) keeps the sample logins below.
 */

/** Offline demo logins only — never used when Supabase is connected */
export const USERS: AppUser[] = [
  { id: 'u_admin', username: 'admin',  password: 'admin123',  name: 'Ceylon Admin',        role: 'admin'             },
  { id: 'u_o1',    username: 'kasun',  password: 'owner123',  name: 'Sumod Pieris',        role: 'owner', ownerId: 'o1' },
  { id: 'u_o2',    username: 'nimesh', password: 'owner123',  name: 'Pavith Bimsara',      role: 'owner', ownerId: 'o2' },
  { id: 'u_o3',    username: 'roshan', password: 'owner123',  name: 'Roshan Fernando',     role: 'owner', ownerId: 'o3' },
  { id: 'u_o4',    username: 'priya',  password: 'owner123',  name: 'Priya Jayawardena',   role: 'owner', ownerId: 'o4' },
  { id: 'u_o5',    username: 'ruwan',  password: 'owner123',  name: 'Ruwan Bandara',       role: 'owner', ownerId: 'o5' },
];

export const DEFAULT_PERMS: OwnerPermissions = {
  // Actions — on by default so owners can do the core tasks
  canBook: true,
  canEditVehicle: true,
  canChangeStatus: true,
  canAddExpenses: true,
  // Pages — common operational pages on, specialist pages off
  canViewExpenses: true,
  canViewHandovers: true,
  canViewDrivers: false,
  canViewCustomers: false,
  canViewReferrals: false,
  canViewInquiries: false,
  canViewIncomplete: false,
  disabled: false,
};

const permsOf = (u?: AppUser | null): OwnerPermissions =>
  ({ ...DEFAULT_PERMS, ...(u?.permissions ?? {}), disabled: !!u?.disabled });

/** A free username from the owner's name: "Brian Naditha" → "briannaditha", "briannaditha2"… */
const usernameFor = (name: string, taken: Set<string>) => {
  const base = cleanUsername(name).replace(/[._-]/g, '').slice(0, 12) || 'owner';
  let u = base, n = 2;
  while (taken.has(u)) u = base + n++;
  return u;
};

let listening = false;

// The old store kept every login — with its plain-text password — in this browser
try { localStorage.removeItem('emrac-auth-v2'); } catch { /* private mode */ }

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      users: supabaseEnabled ? [] : USERS,
      currentUser: null,
      ready: !supabaseEnabled,
      permissions: {},

      initAuth: async () => {
        if (!supabaseEnabled) { set({ ready: true }); return; }
        if (!listening) {
          listening = true;
          // signed out elsewhere, session expired, or the login was disabled
          supabase.auth.onAuthStateChange((_event, session) => {
            const user = userFromAuth(session?.user);
            set({ currentUser: user, ...(user ? {} : { users: [] }) });
          });
        }
        try {
          const session = await currentSession();
          set({ currentUser: userFromAuth(session?.user), ready: true });
          if (get().currentUser?.role === 'admin') get().refreshUsers();
        } catch (e) {
          console.error('[auth] session check failed:', e);
          set({ ready: true });
        }
      },

      login: async (username, password) => {
        if (!supabaseEnabled) {
          const user = get().users.find((u) => u.username === username && u.password === password);
          if (!user) return 'Wrong username or password.';
          if (user.role === 'owner' && (get().permissions[user.ownerId ?? '']?.disabled ?? false)) return 'This login has been disabled — contact the admin.';
          set({ currentUser: user });
          return null;
        }
        const { user, error } = await signIn(username, password);
        if (!user) return error ?? 'Could not sign in.';
        set({ currentUser: user });
        if (user.role === 'admin') get().refreshUsers();
        return null;
      },

      logout: async () => {
        if (supabaseEnabled) await signOut().catch(() => undefined);
        set({ currentUser: null, ...(supabaseEnabled ? { users: [] } : {}) });
      },

      refreshUsers: async () => {
        if (!supabaseEnabled || get().currentUser?.role !== 'admin') return;
        try { set({ users: await listStaff() }); } catch (e) {
          console.error('[auth] could not load logins:', e);
          toast.error('Could not load logins', (e as Error).message);
        }
      },

      addUser: async (userData) => {
        if (!supabaseEnabled) {
          if (get().users.some((u) => u.username === userData.username)) return 'That username is already taken — choose another.';
          set((s) => ({ users: [...s.users, { ...userData, id: 'u_' + Math.random().toString(36).slice(2, 8) }] }));
          return null;
        }
        try {
          await createStaff({
            username: userData.username, password: userData.password ?? '', name: userData.name, role: userData.role,
            ownerId: userData.ownerId, contactEmail: userData.email, nic: userData.nic,
          });
          await get().refreshUsers();
          return null;
        } catch (e) { return (e as Error).message; }
      },

      getOwnerPermissions: (ownerId) => {
        if (!supabaseEnabled) return get().permissions[ownerId] ?? DEFAULT_PERMS;
        const me = get().currentUser;
        if (me?.role === 'owner' && me.ownerId === ownerId) return permsOf(me);
        return permsOf(get().users.find((u) => u.ownerId === ownerId));
      },

      updatePermissions: async (ownerId, perms) => {
        if (!supabaseEnabled) {
          set((s) => ({ permissions: { ...s.permissions, [ownerId]: { ...(s.permissions[ownerId] ?? DEFAULT_PERMS), ...perms } } }));
          return;
        }
        const user = get().users.find((u) => u.ownerId === ownerId);
        if (!user) return;
        const { disabled, ...rest } = perms;
        const permissions = { ...(user.permissions ?? {}), ...rest };
        // show the change straight away, then save it on the server
        set((s) => ({ users: s.users.map((u) => (u.id === user.id ? { ...u, permissions, ...(disabled !== undefined ? { disabled } : {}) } : u)) }));
        try {
          await updateStaff(user.id, { ...(Object.keys(rest).length ? { permissions } : {}), ...(disabled !== undefined ? { disabled } : {}) });
          if (disabled !== undefined) toast.success(disabled ? 'Login disabled' : 'Login enabled', disabled ? `${user.name} can no longer sign in.` : `${user.name} can sign in again.`);
        } catch (e) {
          toast.error('Permission not saved', (e as Error).message);
        }
        get().refreshUsers();
      },

      createOwnerAccount: async (ownerId, ownerName) => {
        if (get().users.some((u) => u.ownerId === ownerId)) return null;
        const username = usernameFor(ownerName, new Set(get().users.map((u) => u.username)));
        const password = genPin();
        const error = await get().addUser({ username, password, name: ownerName, role: 'owner', ownerId });
        if (error) { toast.error('Login not created', error); return null; }
        return { username, password };
      },

      resetPassword: async (userId) => {
        const pin = genPin();
        if (!supabaseEnabled) {
          set((s) => ({ users: s.users.map((u) => (u.id === userId ? { ...u, password: pin } : u)) }));
          return pin;
        }
        try { await updateStaff(userId, { password: pin }); return pin; } catch (e) {
          toast.error('Password not reset', (e as Error).message);
          return null;
        }
      },

      isAdmin: () => get().currentUser?.role === 'admin',
      isOwner: () => get().currentUser?.role === 'owner',

      can: (perm) => {
        const { currentUser } = get();
        if (!currentUser) return false;
        if (currentUser.role === 'admin') return true;
        const perms = get().getOwnerPermissions(currentUser.ownerId ?? '');
        if (perms.disabled) return false;
        return perms[perm];
      },
    }),
    {
      name: 'emrac-auth-v3',
      // With Supabase the session lives in Supabase's own storage — nothing about logins is kept here
      partialize: (s) => (supabaseEnabled ? {} : { users: s.users, currentUser: s.currentUser, permissions: s.permissions }),
    },
  ),
);
