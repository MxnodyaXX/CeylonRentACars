import { Booking, Vehicle } from '../types';

/* ─────────────────────────────────────────────────────────────────────────
   Revenue = money actually earned. The gross bill is `totalAmount`; any
   `discount` granted to the customer is money we never collect, so the real
   (net) revenue is total − discount.

   `vehicle.revenue` is the GROSS rollup (sum of totalAmount) and is kept as-is
   for the "before discounts" figure. Net revenue is derived from the bookings,
   which are the source of truth for discounts (a discount is often applied
   after the booking is created, so the rolled-up field can't track it).
   ──────────────────────────────────────────────────────────────────────── */

const isActive = (b: Booking) => b.status !== 'Cancelled';

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

/** Net revenue for one vehicle = its gross rollup minus its discounts. */
export const vehicleNetRevenue = (vehicle: Vehicle, bookings: Booking[]): number =>
  Math.max(0, vehicle.revenue - vehicleDiscount(vehicle.id, bookings));

/** Net revenue summed across many vehicles. */
export const vehiclesNetRevenue = (vehicles: Vehicle[], bookings: Booking[]): number =>
  vehicles.reduce((s, v) => s + vehicleNetRevenue(v, bookings), 0);
