import { Booking, Customer } from '../types';

/** The customer's net bill for a booking: rental + extra charges − discount. */
export function bookingBill(b: Booking): number {
  return b.totalAmount + (b.extraCharges ?? 0) - (b.discount ?? 0);
}

/** Total the customer has put in: paid + advance. */
export function bookingPaid(b: Booking): number {
  return b.paidAmount + (b.advanceAmount ?? 0);
}

/** Remaining balance on a booking (never negative). */
export function bookingDue(b: Booking): number {
  return Math.max(0, bookingBill(b) - bookingPaid(b));
}

/** Outstanding credit on a booking = an unsettled recorded credit amount.
 *  Cancelled bookings carry no credit. */
export function bookingCredit(b: Booking): number {
  if (b.status === 'Cancelled') return 0;
  if (b.creditSettled) return 0;
  return b.creditAmount ?? 0;
}

export interface CustomerCredit {
  outstanding: number;                 // total unsettled credit
  count: number;                       // number of bookings with credit
  bookings: { booking: Booking; amount: number }[];
}

/** Aggregate a customer's outstanding credit across their bookings.
 *  Customers are matched by id when present, otherwise by phone. */
export function customerCredit(customer: Customer, bookings: Booking[]): CustomerCredit {
  const mine = bookings.filter(
    (b) => b.customerId === customer.id || b.customerPhone === customer.phone,
  );
  const withCredit = mine
    .map((b) => ({ booking: b, amount: bookingCredit(b) }))
    .filter((x) => x.amount > 0)
    .sort((a, b) => (a.booking.createdAt < b.booking.createdAt ? 1 : -1));
  return {
    outstanding: withCredit.reduce((s, x) => s + x.amount, 0),
    count: withCredit.length,
    bookings: withCredit,
  };
}

export interface CreditTotals {
  total: number;            // total credit to be received
  customers: number;        // distinct customers with outstanding credit
  bookings: number;         // bookings with outstanding credit
}

/** Company-wide credit totals for the dashboard. Keyed by customerId||phone. */
export function creditTotals(bookings: Booking[]): CreditTotals {
  const byCustomer = new Map<string, number>();
  let bookingCount = 0;
  bookings.forEach((b) => {
    const amt = bookingCredit(b);
    if (amt <= 0) return;
    bookingCount += 1;
    const key = b.customerId || b.customerPhone;
    byCustomer.set(key, (byCustomer.get(key) ?? 0) + amt);
  });
  let total = 0;
  byCustomer.forEach((v) => { total += v; });
  return { total, customers: byCustomer.size, bookings: bookingCount };
}

export interface CreditRecord { booking: Booking; amount: number; settled: boolean; }

/** Every booking that has a recorded credit amount (settled or not), newest first. */
export function creditRecords(bookings: Booking[]): CreditRecord[] {
  return bookings
    .filter((b) => (b.creditAmount ?? 0) > 0 && b.status !== 'Cancelled')
    .map((b) => ({ booking: b, amount: b.creditAmount ?? 0, settled: !!b.creditSettled }))
    .sort((a, b) => (a.booking.createdAt < b.booking.createdAt ? 1 : -1));
}

/** Who is liable for a booking's credit, from the referral source. */
export function creditResponsibilityOf(
  referral: string | undefined,
  isOwnerReferral: boolean,
): 'self' | 'owner' | 'company' {
  if (referral === 'Company') return 'company';
  if (isOwnerReferral) return 'owner';   // referred by another owner
  return 'self';                          // direct / walk-in → vehicle owner's own risk
}
