import { describe, expect, it } from 'vitest';
import { readOwnerShare, shareSummary } from '../../src/lib/ownerTerms';
import { companyShareOf } from '../../src/lib/companyShare';

describe('the commission agreed with an owner (per car)', () => {
  it('reads what the database holds, and drops anything unusable', () => {
    expect(readOwnerShare({ type: 'percent_min', value: 15, min: 1000 })).toEqual({ type: 'percent_min', value: 15, min: 1000 });
    expect(readOwnerShare({ type: 'per_day', value: 1000, min: 99 })).toEqual({ type: 'per_day', value: 1000 });
    expect(readOwnerShare({ type: 'percent', value: 120 })).toBeNull();
    expect(readOwnerShare({ type: 'weird', value: 1 })).toBeNull();
    expect(readOwnerShare(null)).toBeNull();
  });
  it('is described in plain words', () => {
    expect(shareSummary({ type: 'percent_min', value: 15, min: 1000 })).toBe('15%, at least Rs 1,000 a day');
    expect(shareSummary({ type: 'per_day', value: 1000 })).toBe('Rs 1,000 a day');
    expect(shareSummary({ type: 'fixed', value: 0 })).toBe('No commission');
  });
  it('gives the same split as the booking fields it becomes', () => {
    // 13 days, final bill Rs 114,400: 12% → Rs 13,728 to the company
    expect(companyShareOf({ companyShareType: 'percent', companyShareValue: 12, companyShareMin: undefined, totalDays: 13 } as never, 114400)).toBe(13728);
  });
});
