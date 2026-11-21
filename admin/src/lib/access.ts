import { useAuthStore } from '../store/useAuthStore';
import { useOwnerAmounts } from './ownerMoney';
import type { StaffAbility, StaffPart } from '../types/auth';

/*
 * Which pages a login may open — one list for the routes (App.tsx) and the menu (Sidebar).
 *   admin  every page
 *   staff  the pages their abilities cover (Permissions page → Team)
 *   owner  their own pages + the ones the admin switched on for them
 * The database enforces the same rules; this only decides what is shown.
 */

const TEAM_PAGES: Record<string, StaffAbility | StaffPart | (StaffAbility | StaffPart)[] | true | false> = {
  '/': true, '/vehicles': true, '/bookings': true, '/notifications': true, '/settings': true,
  '/inquiries': 'canViewInquiries', '/messages': 'canViewInquiries', '/sms-log': 'canViewInquiries',
  '/handovers': 'canViewHandovers', '/breakdowns': 'canManageBreakdowns', '/incomplete': 'canViewIncomplete',
  '/commissions': 'canFinanceCommissions', '/credit': 'canFinanceCredit', '/settlements': 'canFinancePayouts', '/accounts': 'canFinanceAccounts', '/referrals': 'canViewReferrals', '/expenses': 'canViewExpenses',
  '/owners': 'canViewOwners', '/drivers': 'canViewDrivers', '/customers': 'canViewCustomers', '/feedback': 'canViewFeedback',
  // booking e-Agreements: the overview + exceptions, and Finance's payment checks (any one of the abilities)
  '/agreements': ['canViewInquiries', 'canSendAgreements', 'canVerifyPayments'],
  '/payment-checks': ['canVerifyPayments', 'canTakePayments'],
  // Brian and IT only
  '/partners': false, '/website': false, '/whatsapp-setup': false, '/whatsapp-templates': false, '/permissions': false,
  '/changes': false,   // Undo changes — admin only (the database lets only an admin read the log and undo)
};

const OWNER_PAGES: Record<string, Parameters<ReturnType<typeof useAuthStore.getState>['can']>[0] | true | false> = {
  '/': true, '/vehicles': true, '/bookings': true, '/commissions': true, '/notifications': true, '/settings': true,
  // never for owners: Inquiries, Messages and Customers — the customers are the company's (lib/ownerPrivacy)
  '/inquiries': false, '/messages': false, '/customers': false, '/sms-log': false, '/changes': false,
  '/expenses': 'canViewExpenses', '/drivers': 'canViewDrivers',
  '/handovers': 'canViewHandovers', '/referrals': 'canViewReferrals', '/incomplete': 'canViewIncomplete',
};

// Settings → "Show bookings and rental amounts to owners" OFF: payouts only — their cars, their payouts,
// notifications and settings. No bookings, handovers or finance pages (the database gives them none either: 32).
const OWNER_PAYOUTS_ONLY = new Set(['/', '/vehicles', '/commissions', '/notifications', '/settings']);

/** The first part of a path: "/bookings/abc" → "/bookings" */
const root = (path: string) => '/' + (path.split('/')[1] ?? '');

export function canOpen(path: string): boolean {
  const { currentUser, can } = useAuthStore.getState();
  if (!currentUser) return false;
  if (currentUser.role === 'admin') return true;
  if (currentUser.role === 'owner' && !useOwnerAmounts.getState().show && !OWNER_PAYOUTS_ONLY.has(root(path))) return false;
  const rule = (currentUser.role === 'staff' ? TEAM_PAGES : OWNER_PAGES)[root(path)];
  if (rule === undefined || rule === false) return false;
  if (Array.isArray(rule)) return rule.some((r) => can(r));
  return rule === true || can(rule);
}
