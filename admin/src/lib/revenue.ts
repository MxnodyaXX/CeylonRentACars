import { Booking, Vehicle } from '../types';
import { legsOf } from './exchange';

/* ─────────────────────────────────────────────────────────────────────────
   Revenue = money actually earned. The gross bill is `totalAmount`; any
   `discount` granted to the customer is money we never collect, so the real
   (net) revenue is total − discount.

   `vehicle.revenue` is the GROSS rollup (sum of totalAmount) and is kept as-is
   for the "before discounts" figure. Net revenue is derived from the bookings,
   which are the source of truth for discounts (a discount is often applied
   after the booking is created, so the rolled-up field can't track it).
   ──────────────────────────────────────────────────────────────────────── */

// cancelled bookings and personal ones (not company business) earn the company nothing
const isActive = (b: Booking) => b.status !== 'Cancelled' && !b.personal;

/** Gross bill for a booking, before any discount (cancelled = 0). */
export const bookingGross = (b: Booking): number => (isActive(b) ? b.totalAmount : 0);

/** Discount granted on a booking (cancelled = 0). */
export const bookingDiscount = (b: Booking): number => (isActive(b) ? (b.discount ?? 0) : 0);

/** Net revenue for a booking = gross − discount. */
export const bookingNet = (b: Booking): number => bookingGross(b) - bookingDiscount(b);

/** Total discount granted across a set of bookings. */
export const totalDiscount = (bookings: Booking[]): number =>
  bookings.reduce((s, b) => s + bookingDiscount(b), 0);

/** Total gross revenue (before discounts) across a set of bookings. */
export const grossRevenue = (bookings: Booking[]): number =>
  bookings.reduce((s, b) => s + bookingGross(b), 0);

/** Net revenue (after discounts) across a set of bookings. */
export const netRevenue = (bookings: Booking[]): number =>
  bookings.reduce((s, b) => s + bookingNet(b), 0);

/** Sum of discounts on a single vehicle's bookings. */
export const vehicleDiscount = (vehicleId: string, bookings: Booking[]): number =>
  bookings.reduce((s, b) => (b.vehicleId === vehicleId ? s + bookingDiscount(b) : s), 0);

/**
 * Net revenue for one vehicle: the FINAL bills of its bookings (rent + extra charges − deductions − discount),
 * worked out from the bookings themselves. The stored `vehicle.revenue` rollup only ever adds the rent, so
 * extra km and other charges were missing from it (e.g. rent 98,000 + extra km 66,000 showed as 98,000).
 * After a mid-trip exchange each car counts its own part, in proportion to its share of the rent.
 */
export const vehicleNetRevenue = (vehicle: Vehicle, bookings: Booking[]): number =>
  Math.max(0, Math.round(bookings.reduce((s, b) => s + vehicleBillShare(vehicle.id, b), 0)));

/** One car's part of a booking's final bill (0 for cancelled / personal bookings and other cars) */
export function vehicleBillShare(vehicleId: string, b: Booking): number {
  if (!isActive(b)) return 0;
  const bill = b.totalAmount + (b.extraCharges ?? 0) - (b.discount ?? 0);
  if (!b.exchanges?.length) return b.vehicleId === vehicleId ? bill : 0;
  const rent = legsOf(b).filter((l) => l.vehicleId === vehicleId).reduce((s, l) => s + l.revenue, 0);
  return b.totalAmount > 0 ? bill * (rent / b.totalAmount) : 0;
}

/** Net revenue summed across many vehicles. */
export const vehiclesNetRevenue = (vehicles: Vehicle[], bookings: Booking[]): number =>
  vehicles.reduce((s, v) => s + vehicleNetRevenue(v, bookings), 0);

/**
 * A car's money, on the same basis as the Bookings page (final bills: rent + extra charges − discount):
 *   earned   = completed and on-rent trips · upcoming = confirmed bookings not started · company = its commission on the earned trips
 * so the Bookings page total for the car = earned + upcoming.
 */
export function vehicleMoney(vehicleId: string, bookings: Booking[], commissions: { bookingId: string; vehicleId: string; commissionAmount?: number }[]) {
  const mine = bookings.filter((b) => b.vehicleId === vehicleId && b.status !== 'Cancelled');
  const done = mine.filter((b) => b.status === 'Completed' || b.status === 'Ongoing');
  const next = mine.filter((b) => b.status === 'Confirmed');
  const bill = (b: Booking) => Math.max(0, b.totalAmount + (b.extraCharges ?? 0) - (b.discount ?? 0));
  const ids = new Set(done.map((b) => b.id));
  return {
    earned: done.reduce((s, b) => s + bill(b), 0), trips: done.length, onRent: done.filter((b) => b.status === 'Ongoing').length,
    upcoming: next.reduce((s, b) => s + bill(b), 0), upcomingCount: next.length,
    company: commissions.filter((c) => ids.has(c.bookingId) && c.vehicleId === vehicleId).reduce((s, c) => s + (c.commissionAmount ?? 0), 0),
  };
}
