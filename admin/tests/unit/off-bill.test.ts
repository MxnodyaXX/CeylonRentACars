import { describe, it, expect } from 'vitest';
import { OFF_BILL_PREFIX, chargeLine, offBillLabel } from '../../src/lib/bookingRecord';
import type { ExtraCharge } from '../../src/types';

const line = (note: string): ExtraCharge => ({ id: 'x', kind: 'Deduction', amount: -2500, date: '2026-11-24', note, status: 'Charged', by: 'Brian', at: '2026-11-21T00:00:00Z' });

describe('a balance taken off the bill with its reason', () => {
  it('reads as the reason on the bill', () => {
    const note = OFF_BILL_PREFIX + offBillLabel({ reason: 'First day charged less', note: 'first day Rs 10,000 instead of Rs 12,500' });
    expect(chargeLine(line(note))).toMatchObject({ label: 'First day charged less', detail: 'first day Rs 10,000 instead of Rs 12,500', amount: -2500, group: 'deduction' });
  });
  it('"Other reason" uses what was written', () => {
    expect(offBillLabel({ reason: 'Other reason', note: 'Customer’s birthday' })).toBe('Customer’s birthday');
    expect(chargeLine(line(OFF_BILL_PREFIX + 'Rounded off'))).toMatchObject({ label: 'Rounded off', detail: undefined });
  });
});
