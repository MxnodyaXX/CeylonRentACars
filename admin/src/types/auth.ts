export type UserRole = 'admin' | 'owner';

export interface AppUser {
  id: string;
  username: string;
  password: string;
  name: string;
  role: UserRole;
  ownerId?: string; // only when role === 'owner'
  nic?: string;
  email?: string;
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
  users: AppUser[];
  currentUser: AppUser | null;
  permissions: Record<string, OwnerPermissions>; // keyed by ownerId
  login: (username: string, password: string) => boolean;
  logout: () => void;
  addUser: (user: Omit<AppUser, 'id'>) => void;
  loadUsers: () => Promise<void>;
  updatePermissions: (ownerId: string, perms: Partial<OwnerPermissions>) => void;
  getOwnerPermissions: (ownerId: string) => OwnerPermissions;
  createOwnerAccount: (ownerId: string, ownerName: string) => void;
  isAdmin: () => boolean;
  isOwner: () => boolean;
  can: (perm: keyof Omit<OwnerPermissions, 'disabled'>) => boolean;
}
