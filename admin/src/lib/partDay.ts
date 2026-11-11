import type { Booking } from '../types';

/*
 * A part day: one of a daily rental's days is short — e.g. the customer picks the car up in the evening — so it is
 * charged an agreed smaller amount (e.g. Rs 5,000 instead of Rs 7,000). It still counts as one of the booked days
 * (km allowance, per-day commission); only its price is different.
 */

/** the rent for a number of days at a day rate, one of them a part day at its own amount */
export function rentFor(days: number, rate: number, part?: number) {
  return part && part > 0 && days >= 1 ? Math.round((days - 1) * rate + part) : Math.round(days * rate);
}

/** the full-day rate behind a booking's rent (leaving out its part day) */
export function fullDayRate(b: Pick<Booking, 'totalAmount' | 'totalDays' | 'partDayAmount'>) {
  const part = b.partDayAmount ?? 0;
  if (part > 0 && b.totalDays > 1) return Math.round((b.totalAmount - part) / (b.totalDays - 1));
  return b.totalDays ? Math.round(b.totalAmount / b.totalDays) : 0;
}

/** "13 days × Rs 7,000 + part day Rs 5,000" */
export function partDayText(days: number, rate: number, part: number) {
  const full = Math.max(0, days - 1);
  const rs = (n: number) => `Rs ${Math.round(n).toLocaleString('en-LK')}`;
  return `${full ? `${full} day${full === 1 ? '' : 's'} × ${rs(rate)} + ` : ''}part day ${rs(part)}`;
}
