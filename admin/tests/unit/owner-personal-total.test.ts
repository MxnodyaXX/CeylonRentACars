import { describe, expect, it } from 'vitest';
import type { Booking } from '../../src/types';
import { bookingBill } from '../../src/lib/credit';

// The owner page counts a personal booking at its final bill — the same figure as Booking → Payments → "Final bill"
describe('personal booking value on the owner page', () => {
  it('is rent + charges − deductions − discount', () => {
    const b = { totalAmount: 110000, extraCharges: -19400, discount: 600 } as Booking;
    expect(bookingBill(b)).toBe(90000);
  });
});
