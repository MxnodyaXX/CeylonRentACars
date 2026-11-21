import { describe, it, expect } from 'vitest';
import { categoryLabel, isCode, localPhone, periodRange, shownMessage } from '../../src/pages/SmsLog';

describe('SMS log helpers', () => {
  it('shows a phone the local way', () => {
    expect(localPhone('94771234567')).toBe('077 123 4567');
    expect(localPhone('12345')).toBe('12345');
  });

  it('names the kinds of texts', () => {
    expect(categoryLabel('bookingConfirmation')).toBe('Booking confirmed');
    expect(categoryLabel('someNewThing')).toBe('Some New Thing');
    expect(categoryLabel(null)).toBe('Other');
  });

  it('never shows a one-time code again', () => {
    expect(isCode('profileOtp')).toBe(true);
    expect(isCode('creditOtp')).toBe(true);
    expect(isCode('bookingConfirmation')).toBe(false);
    expect(shownMessage({ category: 'profileOtp', message: 'Your EMRAC verification code is: 482913' })).toBe('Your EMRAC verification code is: ••••');
    expect(shownMessage({ category: 'paymentReceived', message: 'Paid Rs 60,000. Ref 123456' })).toBe('Paid Rs 60,000. Ref 123456');
  });

  it('turns a period into a date range', () => {
    const now = new Date(2026, 10, 20, 15, 0);
    expect(periodRange('all', '', '', now)).toEqual([null, null]);
    expect(periodRange('lastMonth', '', '', now)).toEqual([new Date(2026, 9, 1).toISOString(), new Date(2026, 10, 1).toISOString()]);
    expect(periodRange('custom', '2026-10-01', '2026-10-31', now)).toEqual([new Date(2026, 9, 1).toISOString(), new Date(2026, 10, 1).toISOString()]);
    expect(periodRange('today', '', '', now)[0]).toBe(new Date(2026, 10, 20).toISOString());
  });
});
