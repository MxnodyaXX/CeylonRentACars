import {
  startOfDay, endOfDay, startOfWeek, endOfWeek,
  startOfMonth, endOfMonth, startOfYear, endOfYear, format,
} from 'date-fns';
import { Booking, Vehicle, Owner } from '../types';

/* A referral fee is owed by the OWNER of the rented vehicle, TO the referrer who
   brought the customer. It becomes payable once the rental is realized
   (Ongoing/Completed); Confirmed is upcoming, Cancelled is void. */
export const isPayable = (b: Booking) => b.status === 'Ongoing' || b.status === 'Completed';

export interface RefRecord {
  booking: Booking;
  referrer: string;          // who brought the business (booking.referral)
  referrerOwnerId?: string;  // set when the referrer matches a registered owner
  payerOwnerId: string;      // owner of the rented vehicle — owes the fee
  payerOwnerName: string;
  fee: number;
  payable: boolean;          // realized rental → fee is due
  paid: boolean;             // settled
}

/** Build the flat list of fee-bearing referral records (excludes Direct / fee-less / cancelled). */
export function buildReferralRecords(bookings: Booking[], vehicles: Vehicle[], owners: Owner[]): RefRecord[] {
  const ownerByName = new Map(owners.map((o) => [o.name.trim().toLowerCase(), o]));
  return bookings
    .filter((b) => (b.referralFee ?? 0) > 0 && b.referral && b.referral !== 'Direct' && b.status !== 'Cancelled')
    .map((b) => {
      const vehicle = vehicles.find((v) => v.id === b.vehicleId);
      const payer = owners.find((o) => o.id === vehicle?.ownerId);
      const referrer = b.referral as string;
      return {
        booking: b,
        referrer,
        referrerOwnerId: ownerByName.get(referrer.trim().toLowerCase())?.id,
        payerOwnerId: payer?.id ?? '',
        payerOwnerName: payer?.name ?? 'Unknown owner',
        fee: b.referralFee ?? 0,
        payable: isPayable(b),
        paid: !!b.referralPaid,
      };
    });
}

export type Period = 'all' | 'day' | 'week' | 'month' | 'year';
export const PERIODS: { key: Period; label: string }[] = [
  { key: 'all',   label: 'All'   },
  { key: 'day',   label: 'Today' },
  { key: 'week',  label: 'Week'  },
  { key: 'month', label: 'Month' },
  { key: 'year',  label: 'Year'  },
];

/** Resolve a period preset to a [from, to] window of yyyy-MM-dd strings (null = all time). */
export function periodWindow(period: Period): { from: string; to: string } | null {
  const now = new Date();
  const f = (d: Date) => format(d, 'yyyy-MM-dd');
  switch (period) {
    case 'day':   return { from: f(startOfDay(now)),   to: f(endOfDay(now))   };
    case 'week':  return { from: f(startOfWeek(now, { weekStartsOn: 1 })), to: f(endOfWeek(now, { weekStartsOn: 1 })) };
    case 'month': return { from: f(startOfMonth(now)), to: f(endOfMonth(now)) };
    case 'year':  return { from: f(startOfYear(now)),  to: f(endOfYear(now))  };
    default:      return null;
  }
}

/** Filter records to a period by the booking's start date. */
export function inPeriod(rec: RefRecord, win: { from: string; to: string } | null): boolean {
  if (!win) return true;
  const d = rec.booking.startDate;
  return d >= win.from && d <= win.to;
}

export interface RefTotals { earned: number; paid: number; pending: number; upcoming: number; count: number; pendingCount: number }

/** Sum realized/paid/pending/upcoming over a set of records. */
export function totalsOf(recs: RefRecord[]): RefTotals {
  const t: RefTotals = { earned: 0, paid: 0, pending: 0, upcoming: 0, count: 0, pendingCount: 0 };
  recs.forEach((r) => {
    if (r.payable) {
      t.earned += r.fee; t.count += 1;
      if (r.paid) t.paid += r.fee;
      else { t.pending += r.fee; t.pendingCount += 1; }
    } else {
      t.upcoming += r.fee;
    }
  });
  return t;
}
