import { describe, expect, it } from 'vitest';
import { detailWithoutAmounts } from '../../src/lib/statementText';

describe('"Show rental amounts to owners" switched off', () => {
  it("the owner's payout statement keeps the booking and dates, not the rental figures", () => {
    expect(detailWithoutAmounts('CRC-2026-5HNL · 26 Oct – 7 Nov · final bill Rs 164,000 − company commission Rs 0'))
      .toBe('CRC-2026-5HNL · 26 Oct – 7 Nov');
    expect(detailWithoutAmounts(undefined)).toBe('');
  });
});
