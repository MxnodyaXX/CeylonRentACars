import type { StaffAbility, StaffJob, StaffPart, StaffPerms } from '../types/auth';

/*
 * Team roles (approved by Brian, Nov 2026). Each employee has their own login with a job and a set
 * of abilities. The job only fills in the starting abilities — the admin can tick more or fewer for
 * one person (e.g. while someone covers for a colleague). The database enforces the same abilities
 * (supabase/security/16_staff_roles.sql), so hiding a button is never the only protection.
 *
 * Admins (Brian — Managing Director, Manodya — IT) keep the full panel.
 */

export interface AbilityInfo { key: StaffAbility; label: string; hint: string; group: 'Bookings' | 'Money' | 'Fleet' | 'People' }

export const ABILITIES: AbilityInfo[] = [
  { key: 'canBook',             group: 'Bookings', label: 'Create & edit bookings',  hint: 'New bookings, changes, cancellations, swapping the car before the trip' },
  { key: 'canViewInquiries',    group: 'Bookings', label: 'Inquiries & messages',     hint: 'Inquiries page, follow-ups and customer messages' },
  { key: 'canViewIncomplete',   group: 'Bookings', label: 'Incomplete records',       hint: 'Bookings missing details or documents' },
  { key: 'canSendAgreements',   group: 'Bookings', label: 'Send e-Agreements',        hint: 'Quotation versions, priority holds, send / revoke the booking e-Agreement' },
  { key: 'canRequestAdvance',   group: 'Money',    label: 'Request the advance',      hint: 'Ask the customer for the advance — only after they accepted the e-Agreement' },
  { key: 'canVerifyPayments',   group: 'Money',    label: 'Verify payments (Finance)', hint: 'Check money really reached the account; match, reject or mark for refund' },
  { key: 'canViewHandovers',    group: 'Fleet',    label: 'Deliver & collect cars',   hint: 'Start and complete rentals: odometer, fuel, condition, photos' },
  { key: 'canChangeStatus',     group: 'Fleet',    label: 'Change vehicle status',    hint: 'Available, maintenance and other operational statuses' },
  { key: 'canEditVehicle',      group: 'Fleet',    label: 'Edit vehicle details',     hint: 'Photos, insurance, specs (not the prices, owner or website listing)' },
  { key: 'canAddVehicle',       group: 'Fleet',    label: 'Add vehicles',             hint: 'Add new cars to the fleet and choose their owner (comes with Edit vehicle details)' },
  { key: 'canManageBreakdowns', group: 'Fleet',    label: 'Breakdowns',               hint: 'Report and manage breakdowns, replacement cars' },
  { key: 'canMarkVehicleReady', group: 'Fleet',    label: 'Return cars to service',   hint: 'Mark vehicle as ready after a breakdown — confirms the car is safe to rent (comes with Breakdowns)' },
  { key: 'canEditPrices',       group: 'Fleet',    label: 'Edit vehicle prices',      hint: 'A car’s fixed price: daily rent, included km, extra-km rate and wedding package (Vehicles → Edit)' },
  { key: 'canTakePayments',     group: 'Money',    label: 'Payments & deposits',      hint: 'Record payments, refunds, deposits, discounts and extra charges' },
  { key: 'canViewFinance',      group: 'Money',    label: 'Finance',                  hint: 'Commissions, owner payouts, credit page' },
  { key: 'canViewReferrals',    group: 'Money',    label: 'Referral fees',            hint: 'Referrals page' },
  { key: 'canViewExpenses',     group: 'Money',    label: 'Expenses page',            hint: 'See, add and edit company expenses' },
  { key: 'canAddExpenses',      group: 'Money',    label: 'Add expenses',             hint: 'Submit an expense (fuel, cleaning, repairs) with its receipt' },
  { key: 'canViewCustomers',    group: 'People',   label: 'Customers',                hint: 'Customers page' },
  { key: 'canViewDrivers',      group: 'People',   label: 'Drivers',                  hint: 'Drivers page: add and update drivers, schedules' },
  { key: 'canViewOwners',       group: 'People',   label: 'Vehicle owners (view)',    hint: 'Owners page — contact details and their cars, read only' },
  { key: 'canViewFeedback',     group: 'People',   label: 'Customer feedback',        hint: 'Feedback page: reviews and complaints' },
];

export interface JobInfo { key: StaffJob; label: string; person: string; summary: string; abilities: StaffAbility[] }

export const JOBS: JobInfo[] = [
  {
    key: 'operations', label: 'Operations Manager', person: 'Buddhi',
    summary: 'Daily operations, phone and in-person customers, bookings, deliveries and breakdowns. Sees payment status, does not record payments.',
    abilities: ['canBook', 'canViewInquiries', 'canViewIncomplete', 'canViewHandovers', 'canChangeStatus', 'canManageBreakdowns',
                'canViewCustomers', 'canViewDrivers', 'canViewOwners', 'canViewFeedback', 'canAddExpenses', 'canSendAgreements', 'canRequestAdvance'],
  },
  {
    key: 'finance', label: 'Finance & Administration', person: 'Dinithi',
    summary: 'WhatsApp inquiries, booking records, payments, deposits, expenses, commissions and owner settlements (Brian approves).',
    abilities: ['canBook', 'canViewInquiries', 'canViewIncomplete', 'canTakePayments', 'canEditPrices', 'canViewFinance', 'canViewReferrals',
                'canViewExpenses', 'canAddExpenses', 'canViewCustomers', 'canViewOwners', 'canVerifyPayments'],
  },
  {
    key: 'fleet', label: 'Fleet Operations & Maintenance', person: 'Thisaga',
    summary: 'Preparing, delivering and collecting cars (odometer, fuel, condition), maintenance and breakdown assistance. No money or prices.',
    abilities: ['canViewHandovers', 'canChangeStatus', 'canEditVehicle', 'canManageBreakdowns', 'canAddExpenses'],
  },
];

export const jobOf = (key?: string) => JOBS.find((j) => j.key === key);

/*
 * Switch one ability on or off, keeping the ones that go together: adding a car means filling in its
 * details, so "Add vehicles" turns on "Edit vehicle details", and turning that off turns "Add vehicles" off.
 * (The database checks both for a new car.)
 */
export function toggleAbility<T extends StaffPerms>(perms: T, key: StaffAbility): T {
  const on = !perms[key];
  const next = { ...perms, [key]: on };
  if (key === 'canAddVehicle' && on) next.canEditVehicle = true;
  if (key === 'canEditVehicle' && !on) next.canAddVehicle = false;
  if (key === 'canMarkVehicleReady' && on) next.canManageBreakdowns = true;
  if (key === 'canManageBreakdowns' && !on) next.canMarkVehicleReady = false;
  // the whole ability on or off: its parts follow it again
  (PARTS[key] ?? []).forEach((p) => { delete next[p.key]; });
  return next;
}

/*
 * Parts of an ability that can be switched off one by one (the ability's row opens like an accordion).
 * A part that was never set follows its ability, so existing logins keep everything they had.
 */
export interface PartInfo { key: StaffPart; label: string; hint: string }
export const PARTS: Partial<Record<StaffAbility, PartInfo[]>> = {
  canBook: [
    { key: 'canBookCreate', label: 'Create new bookings',      hint: 'New booking form, and turning an inquiry into a booking' },
    { key: 'canBookEdit',   label: 'Change bookings',          hint: 'Edit, swap the car before the trip, exchange the car, extend' },
    { key: 'canBookCancel', label: 'Cancel bookings',          hint: 'Cancel a confirmed booking' },
  ],
  canTakePayments: [
    { key: 'canPayRecord',  label: 'Record payments',          hint: 'Payments and advances, and correcting them' },
    { key: 'canPayRefund',  label: 'Give refunds',             hint: 'Record money paid back to the customer' },
    { key: 'canPayDeposit', label: 'Deposits',                 hint: 'Take, return, keep or use the security deposit for the bill' },
    { key: 'canPayCharges', label: 'Charges & deductions',     hint: 'Fines, damage, extra km and other charges — add, waive or remove' },
  ],
  canViewHandovers: [
    { key: 'canHandoverPickup', label: 'Deliver cars (start rental)',  hint: 'Odometer, fuel, condition and photos at pickup' },
    { key: 'canHandoverReturn', label: 'Collect cars (complete rental)', hint: 'Odometer, fuel, condition and photos at return' },
  ],
  canViewFinance: [
    { key: 'canFinanceCommissions', label: 'Commissions',      hint: 'Commissions page' },
    { key: 'canFinancePayouts',     label: 'Owner settlements', hint: 'Prepare owner payouts (Brian approves)' },
    { key: 'canFinanceAccounts',    label: 'Company accounts', hint: 'Cash box and bank balances, transfers' },
    { key: 'canFinanceCredit',      label: 'Credit',           hint: 'Customers who owe money, credit page' },
  ],
};
const PARENT = Object.fromEntries(Object.entries(PARTS).flatMap(([a, ps]) => ps!.map((p) => [p.key, a as StaffAbility]))) as Record<StaffPart, StaffAbility>;
export const parentOf = (part: string): StaffAbility | undefined => PARENT[part as StaffPart];

/** Is this part on for these switches? (its ability on, and the part not switched off) */
export const partOn = (perms: StaffPerms, part: StaffPart) => !!perms[PARENT[part]] && perms[part] !== false;

/** Switch one part. Switching the last part off switches the ability off; a part switched on
 *  while the ability is off switches the ability on with only that part. */
export function togglePart<T extends StaffPerms>(perms: T, part: StaffPart): T {
  const ability = PARENT[part];
  const parts = PARTS[ability]!;
  const next = { ...perms };
  if (!perms[ability]) {
    next[ability] = true;
    parts.forEach((p) => { next[p.key] = p.key === part; });
    return next;
  }
  next[part] = !partOn(perms, part);
  if (parts.every((p) => next[p.key] === false)) {
    next[ability] = false;
    parts.forEach((p) => { delete next[p.key]; });
  } else if (parts.every((p) => next[p.key] !== false)) {
    parts.forEach((p) => { delete next[p.key]; });   // all on again: back to following the ability
  }
  return next;
}
export const jobLabel = (key?: string) => jobOf(key)?.label ?? 'Team';
export const presetFor = (job: StaffJob): Partial<Record<StaffAbility, boolean>> =>
  Object.fromEntries(ABILITIES.map((a) => [a.key, jobOf(job)!.abilities.includes(a.key)]));
