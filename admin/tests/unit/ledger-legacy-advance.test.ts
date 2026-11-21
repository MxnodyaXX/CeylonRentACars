import { describe, it, expect } from 'vitest';
import { ledgerOf, legacyAdvance } from '../../src/lib/bookingRecord';
import type { Booking } from '../../src/types';

const b = (x: Partial<Booking>) => ({ id: 'b1', createdAt: '2026-11-01T09:00:00.000Z', totalAmount: 56000, paidAmount: 0, advanceAmount: 0, ...x }) as Booking;

describe('undated money and the typed advance', () => {
  it('names the advance inside the undated line', () => {
    const l = ledgerOf(b({ paidAmount: 30000, advanceAmount: 30000 }));
    expect(l).toMatchObject([{ id: 'legacy', kind: 'Payment', amount: 60000 }]);
    expect(l[0].note).toContain('advance Rs 30,000 + paid Rs 30,000');
  });

  it('shows an advance-only booking as an advance', () => {
    expect(ledgerOf(b({ advanceAmount: 30000 }))).toMatchObject([{ id: 'legacy', kind: 'Advance', amount: 30000 }]);
  });

  it('does not count an advance that is already in the log', () => {
    expect(legacyAdvance(b({ paidAmount: 26000, advanceAmount: 30000, payments: [{ id: 'a', at: '2026-11-01T09:00:00.000Z', kind: 'Advance', amount: 30000, method: 'Cash', by: 'x' }] }))).toBe(0);
  });
});
