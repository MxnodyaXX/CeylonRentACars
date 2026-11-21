import { describe, it, expect } from 'vitest';
import { diffOf, showValue, tableLabel, fieldLabel } from '../../src/pages/ChangeLog';

describe('undo changes page', () => {
  it('reads an edit field by field', () => {
    const d = diffOf({ op: 'UPDATE', old_values: { paid_amount: 30000, notes: null }, new_values: { paid_amount: 50000, notes: 'oops' } });
    expect(d).toEqual([
      { key: 'paid_amount', field: 'Paid', before: 'Rs 30,000', after: 'Rs 50,000' },
      { key: 'notes', field: 'Notes', before: '—', after: 'oops' },
    ]);
  });

  it('lists entries added to a list (payment log)', () => {
    const p1 = { id: 'a', kind: 'Advance', amount: 30000, method: 'Cash', at: '2026-11-01T09:00:00Z' };
    const p2 = { id: 'b', kind: 'Payment', amount: 26000, method: 'Bank transfer', at: '2026-11-16T09:00:00Z' };
    const [d] = diffOf({ op: 'UPDATE', old_values: { payments: [p1] }, new_values: { payments: [p1, p2] } });
    expect(d.added).toEqual(['Payment · Rs 26,000 · Bank transfer · 2026-11-16']);
    expect(d.removed).toEqual([]);
  });

  it('shows a deleted record by its filled-in fields', () => {
    const d = diffOf({ op: 'DELETE', old_values: { id: 'V1', brand: 'Toyota', color: null }, new_values: null });
    expect(d.map((x) => [x.field, x.before])).toEqual([['Id', 'V1'], ['Brand', 'Toyota']]);
  });

  it('names things plainly', () => {
    expect(tableLabel('bookings')).toBe('Booking');
    expect(tableLabel('some_new_table')).toBe('Some new table');
    expect(fieldLabel('deposit_returned')).toBe('Deposit given back');
    expect(showValue(true)).toBe('Yes');
    expect(showValue([])).toBe('none');
  });
});
