import { describe, expect, it } from 'vitest';
import { optionMatches } from '../../src/components/ui/Select';

const yaris = { value: 'v1', label: 'Toyota Yaris X', sub: 'CBU-0745 · Rs 5,000/day' };

describe('vehicle dropdown search', () => {
  it('matches model, brand and number, ignoring case', () => {
    expect(optionMatches(yaris, 'yaris')).toBe(true);
    expect(optionMatches(yaris, 'TOYOTA')).toBe(true);
    expect(optionMatches(yaris, 'CBU-0745')).toBe(true);
  });
  it('ignores dashes and spaces in the number', () => {
    expect(optionMatches(yaris, 'cbu0745')).toBe(true);
    expect(optionMatches(yaris, '0745')).toBe(true);
  });
  it('needs every word to match', () => {
    expect(optionMatches(yaris, 'toyota 0745')).toBe(true);
    expect(optionMatches(yaris, 'toyota raize')).toBe(false);
    expect(optionMatches(yaris, 'vitz')).toBe(false);
  });
});
