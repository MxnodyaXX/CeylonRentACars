import { describe, expect, it } from 'vitest';
import { maskName, ownersOwnCustomer } from '../../src/lib/ownerPrivacy';

describe("owners see the company's customers as first name + initials", () => {
  it('masks the name', () => {
    expect(maskName('Dushmantha niroshan')).toBe('Dushmantha N.');
    expect(maskName('kasun lakmal perera')).toBe('Kasun L. P.');
    expect(maskName('Nimal')).toBe('Nimal');
    expect(maskName('  ')).toBe('Customer');
  });

  it("keeps the owner's own customers in full: entered by them, or referred by them", () => {
    expect(ownersOwnCustomer({ enteredByOwner: 'o1' }, 'o1', 'Brian Naditha')).toBe(true);
    expect(ownersOwnCustomer({ referral: 'Brian Naditha' }, 'o1', 'Brian Naditha')).toBe(true);
    expect(ownersOwnCustomer({ referral: '  brian   naditha ' }, 'o1', 'Brian Naditha')).toBe(true);
  });

  it("anyone else's booking on their car is masked", () => {
    expect(ownersOwnCustomer({ referral: 'Direct' }, 'o1', 'Brian Naditha')).toBe(false);
    expect(ownersOwnCustomer({ enteredByOwner: 'o2' }, 'o1', 'Brian Naditha')).toBe(false);
    expect(ownersOwnCustomer({}, undefined, undefined)).toBe(false);
  });
});
