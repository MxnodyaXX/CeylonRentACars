import { describe, expect, it } from 'vitest';
import type { Booking, Vehicle } from '../../src/types';
import { vehicleNetRevenue } from '../../src/lib/revenue';

// CRC-2026-5HNL: 14 days × Rs 7,000 = 98,000 rent + 66,000 extra charges → the owner page must show 164,000
const car = { id: 'v1', revenue: 98000 } as Vehicle;   // the old stored rollup (rent only)
const bk = (o: Partial<Booking>) => ({ id: 'b', vehicleId: 'v1', status: 'Completed', totalAmount: 0, totalDays: 1, ...o }) as Booking;

describe("a car's revenue is its bookings' final bills", () => {
  it('includes extra charges (extra km …), not only the rent', () => {
    expect(vehicleNetRevenue(car, [bk({ totalAmount: 98000, totalDays: 14, extraCharges: 66000 })])).toBe(164000);
  });
  it('takes off the discount and skips cancelled, personal and other cars', () => {
    expect(vehicleNetRevenue(car, [
      bk({ id: 'a', totalAmount: 30000, discount: 1000 }),
      bk({ id: 'c', totalAmount: 50000, status: 'Cancelled' }),
      bk({ id: 'p', totalAmount: 12000, personal: true }),
      bk({ id: 'o', totalAmount: 40000, vehicleId: 'v2' }),
    ])).toBe(29000);
  });
});
