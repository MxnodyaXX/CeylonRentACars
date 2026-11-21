import { describe, it, expect } from 'vitest';
import { historyOf } from '../../src/lib/bookingRecord';
import type { Booking } from '../../src/types';

const base = { id: 'b1', createdAt: '2026-10-14T09:54:00.000Z', notes: '' } as unknown as Booking;
const edit = (at: string, text = 'Commission 15 → 0') => ({ at, by: 'Brian', type: 'Edited' as const, text });

describe('booking history', () => {
  it('shows an edit saved twice in the same minute once', () => {
    const h = historyOf({ ...base, activity: [edit('2026-11-12T05:11:10.000Z'), edit('2026-11-12T05:11:10.300Z')] });
    expect(h.filter((a) => a.type === 'Edited')).toHaveLength(1);
  });

  it('keeps the same change made again later, and different changes', () => {
    const h = historyOf({ ...base, activity: [edit('2026-11-12T05:11:10.000Z'), edit('2026-11-12T07:00:00.000Z'), edit('2026-11-12T05:11:10.300Z', 'Discount Rs 0 → Rs 500')] });
    expect(h.filter((a) => a.type === 'Edited')).toHaveLength(3);
  });
});
