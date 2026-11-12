import type { StaffAbility, StaffJob } from '../types/auth';

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
  { key: 'canViewHandovers',    group: 'Fleet',    label: 'Deliver & collect cars',   hint: 'Start and complete rentals: odometer, fuel, condition, photos' },
  { key: 'canChangeStatus',     group: 'Fleet',    label: 'Change vehicle status',    hint: 'Available, maintenance and other operational statuses' },
  { key: 'canEditVehicle',      group: 'Fleet',    label: 'Edit vehicle details',     hint: 'Photos, insurance, specs (not the prices, owner or website listing)' },
  { key: 'canManageBreakdowns', group: 'Fleet',    label: 'Breakdowns',               hint: 'Report and manage breakdowns, replacement cars' },
  { key: 'canEditPrices',       group: 'Money',    label: 'Edit vehicle prices',      hint: 'A car’s fixed price: daily rent, included km, extra-km rate and wedding package (Vehicles → Edit)' },
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
                'canViewCustomers', 'canViewDrivers', 'canViewOwners', 'canViewFeedback', 'canAddExpenses'],
  },
  {
    key: 'finance', label: 'Finance & Administration', person: 'Dinithi',
    summary: 'WhatsApp inquiries, booking records, payments, deposits, expenses, commissions and owner settlements (Brian approves).',
    abilities: ['canBook', 'canViewInquiries', 'canViewIncomplete', 'canTakePayments', 'canEditPrices', 'canViewFinance', 'canViewReferrals',
                'canViewExpenses', 'canAddExpenses', 'canViewCustomers', 'canViewOwners'],
  },
  {
    key: 'fleet', label: 'Fleet Operations & Maintenance', person: 'Thisaga',
    summary: 'Preparing, delivering and collecting cars (odometer, fuel, condition), maintenance and breakdown assistance. No money or prices.',
    abilities: ['canViewHandovers', 'canChangeStatus', 'canEditVehicle', 'canManageBreakdowns', 'canAddExpenses'],
  },
];

export const jobOf = (key?: string) => JOBS.find((j) => j.key === key);
export const jobLabel = (key?: string) => jobOf(key)?.label ?? 'Team';
export const presetFor = (job: StaffJob): Partial<Record<StaffAbility, boolean>> =>
  Object.fromEntries(ABILITIES.map((a) => [a.key, jobOf(job)!.abilities.includes(a.key)]));
