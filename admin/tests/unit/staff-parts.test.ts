import { describe, expect, it } from 'vitest';
import { PARTS, partOn, toggleAbility, togglePart } from '../../src/lib/staffRoles';
import type { StaffPerms } from '../../src/types/auth';

describe('ability parts (Permissions → Team accordion)', () => {
  it('a part never set follows its ability — existing logins keep everything', () => {
    expect(partOn({ canTakePayments: true }, 'canPayRefund')).toBe(true);
    expect(partOn({ canTakePayments: false }, 'canPayRefund')).toBe(false);
    expect(partOn({}, 'canPayRefund')).toBe(false);
  });

  it('switches one part off and leaves the rest on', () => {
    const p = togglePart({ canTakePayments: true } as StaffPerms, 'canPayRefund');
    expect(p.canTakePayments).toBe(true);
    expect(partOn(p, 'canPayRefund')).toBe(false);
    expect(partOn(p, 'canPayRecord')).toBe(true);
    expect(partOn(p, 'canPayDeposit')).toBe(true);
  });

  it('switching the last part off switches the ability off', () => {
    let p: StaffPerms = { canViewHandovers: true };
    p = togglePart(p, 'canHandoverPickup');
    p = togglePart(p, 'canHandoverReturn');
    expect(p.canViewHandovers).toBe(false);
    expect(p.canHandoverPickup).toBeUndefined();
  });

  it('a part switched on while the ability is off turns on only that part', () => {
    const p = togglePart({ canBook: false } as StaffPerms, 'canBookCancel');
    expect(p.canBook).toBe(true);
    expect(partOn(p, 'canBookCancel')).toBe(true);
    expect(partOn(p, 'canBookCreate')).toBe(false);
    expect(partOn(p, 'canBookEdit')).toBe(false);
  });

  it('all parts on again goes back to following the ability', () => {
    let p = togglePart({ canBook: true } as StaffPerms, 'canBookEdit');
    p = togglePart(p, 'canBookEdit');
    expect(p).toEqual({ canBook: true });
  });

  it('the whole-ability switch resets its parts', () => {
    const off = togglePart({ canViewFinance: true } as StaffPerms, 'canFinanceCredit');
    const allOff = toggleAbility(off, 'canViewFinance');
    expect(allOff).toEqual({ canViewFinance: false });
    const allOn = toggleAbility(allOff, 'canViewFinance');
    PARTS.canViewFinance!.forEach((x) => expect(partOn(allOn, x.key)).toBe(true));
  });

  it('every part name passes the server filter (canXxx, no dots)', () => {
    Object.values(PARTS).flat().forEach((x) => expect(x!.key).toMatch(/^can[A-Z]\w+$/));
  });
});
