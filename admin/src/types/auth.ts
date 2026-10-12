export type UserRole = 'admin' | 'owner';

export interface AppUser {
  id: string;
  username: string;
  /** Only in offline demo mode — real logins live in Supabase Auth (hashed, never readable) */
  password?: string;
  name: string;
  role: UserRole;
  ownerId?: string; // only when role === 'owner'
  nic?: string;
  email?: string;
  /** Owner permissions as saved on the login (server-side app_metadata) */
  permissions?: Partial<OwnerPermissions>;
  /** Login switched off by the admin */
  disabled?: boolean;
  lastSignIn?: string;
  /** Signed in with a temporary password — must choose their own before using the app */
  mustChangePassword?: boolean;
}

export interface OwnerPermissions {
  // ── Actions ────────────────────────────────────────────────────────────────
  canBook: boolean;           // create new bookings
  canEditVehicle: boolean;    // edit their own vehicle details
  canChangeStatus: boolean;   // change booking / vehicle status
  canAddExpenses: boolean;    // log vehicle expenses
  // ── Page visibility ────────────────────────────────────────────────────────
  canViewExpenses: boolean;   // Expenses page
  canViewHandovers: boolean;  // Handovers page
  canViewDrivers: boolean;    // Drivers page
  canViewCustomers: boolean;  // Customers page
  canViewReferrals: boolean;  // Referrals page
  canViewInquiries: boolean;  // Inquiries page
  canViewIncomplete: boolean; // Incomplete processes page
  // ── Account ────────────────────────────────────────────────────────────────
  disabled: boolean;          // admin can fully lock an owner out
}

export interface AuthState {
  /** Staff logins (loaded for the admin from the server) */
  users: AppUser[];
  currentUser: AppUser | null;
  /** The saved session has been checked (so the login page doesn't flash on reload) */
  ready: boolean;
  /** Offline demo mode only — real permissions are saved on each login */
  permissions: Record<string, OwnerPermissions>; // keyed by ownerId
  /** null when signed in, otherwise the reason */
  login: (username: string, password: string) => Promise<string | null>;
  logout: () => Promise<void>;
  /** Restore the saved session and follow sign-in / sign-out */
  initAuth: () => Promise<void>;
  /** Reload the staff list (admin) */
  refreshUsers: () => Promise<void>;
  /** null when created, otherwise the reason */
  addUser: (user: Omit<AppUser, 'id'>) => Promise<string | null>;
  updatePermissions: (ownerId: string, perms: Partial<OwnerPermissions>) => Promise<void>;
  getOwnerPermissions: (ownerId: string) => OwnerPermissions;
  /** Creates a login with a generated username + temporary password, shown to the admin once */
  createOwnerAccount: (ownerId: string, ownerName: string) => Promise<{ username: string; password: string } | null>;
  /** Sets a new temporary password for a login and returns it (shown to the admin once) */
  resetPassword: (userId: string) => Promise<string | null>;
  /** Change your own password — null when done, otherwise the reason */
  changePassword: (currentPassword: string, newPassword: string) => Promise<string | null>;
  isAdmin: () => boolean;
  isOwner: () => boolean;
  can: (perm: keyof Omit<OwnerPermissions, 'disabled'>) => boolean;
}
