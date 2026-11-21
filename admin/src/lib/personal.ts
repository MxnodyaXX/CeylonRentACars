import type { Booking, Commission } from '../types';

/*
 * Personal bookings (not company business). They stay on record — the calendar, availability,
 * handovers, documents and the booking's own payment log — but every company money figure leaves
 * them out: the accounts ledger, revenue, commissions, owner payouts / settlements and credit.
 * Only an admin marks a booking personal (security/28_personal_bookings.sql).
 */

export const isPersonal = (b?: Pick<Booking, 'personal'> | null) => !!b?.personal;

/** Bookings that are company business */
export const companyBookings = <B extends Pick<Booking, 'personal'>>(bookings: B[]) =>
  bookings.some(isPersonal) ? bookings.filter((b) => !isPersonal(b)) : bookings;

/** Payout / commission lines without those of personal bookings */
export function companyCommissions<C extends Pick<Commission, 'bookingId'>>(commissions: C[], bookings: Pick<Booking, 'id' | 'personal'>[]): C[] {
  const personal = new Set(bookings.filter(isPersonal).map((b) => b.id));
  return personal.size ? commissions.filter((c) => !personal.has(c.bookingId)) : commissions;
}

/** The books (bookings + commissions + the rest) with personal bookings and their payout lines left out */
export function companyBooks<T extends { bookings: Booking[]; commissions: Commission[] }>(d: T): T {
  if (!d.bookings.some(isPersonal)) return d;
  return { ...d, bookings: companyBookings(d.bookings), commissions: companyCommissions(d.commissions, d.bookings) };
}
