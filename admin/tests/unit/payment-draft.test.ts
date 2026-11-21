import { describe, it, expect } from 'vitest';
import { applyDraft, blankRow, draftOf, totalsOf } from '../../src/lib/paymentDraft';
import { ledgerOf } from '../../src/lib/bookingRecord';
import type { Booking, PaymentEntry } from '../../src/types';

const at = '2026-12-16T06:30:00.000Z';
const entry = (id: string, kind: PaymentEntry['kind'], amount: number, method = 'Cash'): PaymentEntry => ({ id, at, kind, amount, method, by: 'Dinithi', note: 'Entered with the manual booking' });
const booking = (x: Partial<Booking> = {}) => ({
  id: 'b1', createdAt: at, totalAmount: 90000, paidAmount: 80000, advanceAmount: 10000, depositType: 'cash', depositAmount: 50000,
  payments: [entry('a', 'Advance', 10000), entry('p', 'Payment', 80000), entry('d', 'Deposit received', 50000)], ...x,
}) as Booking;

describe('payment log edited in Correct booking', () => {
  it('nothing changed → nothing to save', () => {
    const b = booking();
    expect(applyDraft(b, draftOf(b), 'Brian')).toBeNull();
  });

  it('changing an amount rewrites that entry and the totals', () => {
    const b = booking();
    const rows = draftOf(b).map((r) => (r.key === 'a' ? { ...r, amount: 30000 } : r.key === 'p' ? { ...r, amount: 26000, method: 'Bank transfer' } : r));
    const res = applyDraft(b, rows, 'Brian')!;
    expect(res.error).toBeUndefined();
    expect(res.updates).toMatchObject({ paidAmount: 26000, advanceAmount: 30000, depositAmount: 50000 });
    const log = res.updates!.payments!;
    expect(log.map((p) => [p.id, p.kind, p.amount, p.method])).toEqual([['a', 'Advance', 30000, 'Cash'], ['p', 'Payment', 26000, 'Bank transfer'], ['d', 'Deposit received', 50000, 'Cash']]);
    expect(log[0].at).toBe(at);                          // date untouched
    expect(log[0].by).toBe('Dinithi');                   // who took it stays
    expect(log[0].note).toMatch(/corrected in Correct booking/);
    expect(log[2]).toBe(b.payments![2]);                 // unchanged entry kept as it was
    expect(res.changes).toEqual(['Payment log: Advance Rs 10,000 — Rs 10,000 → Rs 30,000', 'Payment log: Payment Rs 80,000 — Rs 80,000 → Rs 26,000, Cash → Bank transfer']);
  });

  it('the saved booking shows the same log (no "date not recorded" left over)', () => {
    const b = booking();
    const rows = draftOf(b).map((r) => (r.key === 'p' ? { ...r, amount: 26000 } : r));
    const next = { ...b, ...applyDraft(b, rows, 'Brian')!.updates } as Booking;
    expect(ledgerOf(next).map((p) => [p.kind, p.amount])).toEqual([['Advance', 10000], ['Payment', 26000], ['Deposit received', 50000]]);
  });

  it('adds and removes entries', () => {
    const b = booking();
    const rows = [...draftOf(b).map((r) => (r.key === 'p' ? { ...r, removed: true } : r)), { ...blankRow('2026-12-20'), amount: 15000, kind: 'Deposit returned' as const }];
    const res = applyDraft(b, rows, 'Brian')!;
    expect(res.updates).toMatchObject({ paidAmount: 0, advanceAmount: 10000, depositReturned: 15000 });
    expect(res.updates!.payments!.map((p) => p.kind)).toEqual(['Advance', 'Deposit received', 'Deposit returned']);
    expect(res.updates!.payments![2].by).toBe('Brian');
  });

  it('undated money: split into advance + payment, stays undated until a date is entered', () => {
    const b = booking({ payments: [], paidAmount: 30000, advanceAmount: 30000, depositAmount: 50000 });
    const rows = draftOf(b);
    expect(rows.map((r) => [r.kind, r.amount, r.date])).toEqual([['Deposit received', 50000, ''], ['Advance', 30000, ''], ['Payment', 30000, '']]);
    const fixed = rows.map((r) => (r.kind === 'Payment' ? { ...r, amount: 26000, date: '2026-12-16' } : r.kind === 'Advance' ? { ...r, date: '2026-12-01' } : r));
    const res = applyDraft(b, fixed, 'Brian')!;
    expect(res.updates).toMatchObject({ paidAmount: 26000, advanceAmount: 30000, depositAmount: 50000 });
    expect(res.updates!.payments!.map((p) => [p.kind, p.amount])).toEqual([['Advance', 30000], ['Payment', 26000]]);   // the deposit stays undated
    const next = { ...b, ...res.updates } as Booking;
    expect(ledgerOf(next).find((p) => p.id === 'legacy-deposit')?.amount).toBe(50000);
    expect(ledgerOf(next).some((p) => p.id === 'legacy')).toBe(false);
  });

  it('refuses what cannot be right', () => {
    const b = booking({ depositReturned: 0, depositDeduction: 20000 });
    const cut = draftOf(b).map((r) => (r.key === 'd' ? { ...r, amount: 10000 } : r));
    expect(applyDraft(b, cut, 'x')!.error).toMatch(/deposit/);
    const zero = [...draftOf(b), blankRow()];
    expect(applyDraft(b, zero, 'x')!.error).toMatch(/amount/);
    const vehicle = booking({ depositType: 'vehicle', depositAmount: 0, payments: [entry('a', 'Advance', 10000)] });
    expect(applyDraft(vehicle, draftOf(vehicle).map((r) => ({ ...r, kind: 'Deposit received' as const })), 'x')!.error).toMatch(/vehicle/);
  });

  it('a payment taken from the deposit is fixed here', () => {
    const b = booking({ payments: [...booking().payments!, entry('s', 'Payment', 5000, 'Security deposit')], paidAmount: 85000 });
    expect(draftOf(b).find((r) => r.key === 's')?.locked).toBe(true);
    expect(totalsOf(draftOf(b)).paidAmount).toBe(85000);
  });
});
