import { describe, expect, it } from 'vitest';
import { monthlyRentUsed } from '../../src/lib/bookingRecord';

describe('monthlyRentUsed — full months + the days of the month in progress', () => {
  it('15 Sep 07:00 → 21 Oct 11:45: 1 full month + 7 started days of a 31-day month', () => {
    const r = monthlyRentUsed({ date: '2026-09-15', time: '07:00' }, '2026-10-21T11:45', 140000);
    expect(r).toMatchObject({ months: 1, days: 7, monthDays: 31, partRent: 31613, rent: 171613 });
  });
  it('partial days waived: only whole days count', () => {
    expect(monthlyRentUsed({ date: '2026-09-15', time: '07:00' }, '2026-10-21T11:45', 140000, true)).toMatchObject({ days: 6, rent: 140000 + Math.round(6 * 140000 / 31) });
  });
  it('exactly two months is two months, no extra days', () => {
    expect(monthlyRentUsed({ date: '2026-09-15', time: '07:00' }, '2026-11-15T07:00', 140000)).toMatchObject({ months: 2, days: 0, rent: 280000 });
  });
  it('under a month: days at that month\'s day rate (Feb has 28 days)', () => {
    expect(monthlyRentUsed({ date: '2027-02-01', time: '09:00' }, '2027-02-11T09:00', 140000)).toMatchObject({ months: 0, days: 10, monthDays: 28, rent: 50000 });
  });
  it('starts on the 31st: the next month ends on its last day', () => {
    expect(monthlyRentUsed({ date: '2027-01-31', time: '10:00' }, '2027-02-28T10:00', 90000)).toMatchObject({ months: 1, days: 0, rent: 90000 });
  });
});
