import { useAuthStore } from '../store/useAuthStore';
import type { StaffAbility } from '../types/auth';

/*
 * Which pages a login may open — one list for the routes (App.tsx) and the menu (Sidebar).
 *   admin  every page
 *   staff  the pages their abilities cover (Permissions page → Team)
 *   owner  their own pages + the ones the admin switched on for them
 * The database enforces the same rules; this only decides what is shown.
 */

const TEAM_PAGES: Record<string, StaffAbility | true | false> = {
  '/': true, '/vehicles': true, '/bookings': true, '/notifications': true, '/settings': true,
  '/inquiries': 'canViewInquiries', '/messages': 'canViewInquiries',
  '/handovers': 'canViewHandovers', '/breakdowns': 'canManageBreakdowns', '/incomplete': 'canViewIncomplete',
  '/commissions': 'canViewFinance', '/credit': 'canViewFinance', '/referrals': 'canViewReferrals', '/expenses': 'canViewExpenses',
  '/owners': 'canViewOwners', '/drivers': 'canViewDrivers', '/customers': 'canViewCustomers', '/feedback': 'canViewFeedback',
  // Brian and IT only
  '/partners': false, '/website': false, '/whatsapp-setup': false, '/whatsapp-templates': false, '/permissions': false,
};

const OWNER_PAGES: Record<string, Parameters<ReturnType<typeof useAuthStore.getState>['can']>[0] | true | false> = {
  '/': true, '/vehicles': true, '/bookings': true, '/commissions': true, '/notifications': true, '/settings': true,
  '/inquiries': 'canViewInquiries', '/messages': 'canViewInquiries', '/expenses': 'canViewExpenses', '/drivers': 'canViewDrivers',
  '/handovers': 'canViewHandovers', '/customers': 'canViewCustomers', '/referrals': 'canViewReferrals', '/incomplete': 'canViewIncomplete',
};

/** The first part of a path: "/bookings/abc" → "/bookings" */
const root = (path: string) => '/' + (path.split('/')[1] ?? '');

export function canOpen(path: string): boolean {
  const { currentUser, can } = useAuthStore.getState();
  if (!currentUser) return false;
  if (currentUser.role === 'admin') return true;
  const rule = (currentUser.role === 'staff' ? TEAM_PAGES : OWNER_PAGES)[root(path)];
  if (rule === undefined || rule === false) return false;
  return rule === true || can(rule);
}
