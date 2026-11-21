import { describe, expect, it } from 'vitest';
import type { Booking, Commission } from '../../src/types';
import { companyBooks, companyBookings, companyCommissions, isPersonal } from '../../src/lib/personal';
import { netRevenue } from '../../src/lib/revenue';
import { bookingCredit } from '../../src/lib/credit';

const bk = (id: string, o: Partial<Booking> = {}) => ({
  id, vehicleId: 'v1', customerId: 'c', customerName: 'X', customerPhone: '0771234567', startDate: '2026-11-01', endDate: '2026-11-03',
  totalDays: 3, totalAmount: 30000, paidAmount: 0, status: 'Completed', createdAt: '2026-11-01T00:00:00Z', ...o,
}) as Booking;
const cm = (id: string, bookingId: string) => ({ id, bookingId, vehicleId: 'v1', ownerId: 'o1', ownerPayout: 25000, status: 'Pending' }) as unknown as Commission;

describe('personal bookings (not company business)', () => {
  const company = bk('b1'), personal = bk('b2', { personal: true, creditAmount: 30000 });

  it('are recognised and left out of the company bookings', () => {
    expect(isPersonal(personal)).toBe(true);
    expect(isPersonal(company)).toBe(false);
    expect(companyBookings([company, personal]).map((b) => b.id)).toEqual(['b1']);
  });

  it('their payout lines are left out', () => {
    expect(companyCommissions([cm('c1', 'b1'), cm('c2', 'b2')], [company, personal]).map((c) => c.id)).toEqual(['c1']);
  });

  it('the books passed to the accounts drop both', () => {
    const books = companyBooks({ bookings: [company, personal], commissions: [cm('c1', 'b1'), cm('c2', 'b2')], other: 1 });
    expect(books.bookings.map((b) => b.id)).toEqual(['b1']);
    expect(books.commissions.map((c) => c.id)).toEqual(['c1']);
    expect(books.other).toBe(1);
  });

  it('earn no company revenue and carry no credit', () => {
    expect(netRevenue([company, personal])).toBe(30000);
    expect(bookingCredit(personal)).toBe(0);
  });

  it('nothing changes when there are no personal bookings', () => {
    const list = [company];
    expect(companyBookings(list)).toBe(list);
  });
});
