import { describe, expect, it } from 'vitest';
import type { Vehicle } from '../../src/types';
import { isFixedBooking, isFixedCar } from '../../src/lib/ownerMoney';
import { smsTemplates } from '../../src/lib/sms';

const fixedCar = { id: 'v1', ownerTerms: { type: 'fixed', schedule: 'monthly', amount: 80000, start: '2026-11-01', end: null } } as unknown as Vehicle;
const shareCar = { id: 'v2' } as Vehicle;
const vehicles = [fixedCar, shareCar];

describe("owners don't see what their fixed-amount cars earn", () => {
  it('a booking under the fixed terms is hidden; one before the terms began is not', () => {
    expect(isFixedBooking({ vehicleId: 'v1', startDate: '2026-11-20' }, vehicles)).toBe(true);
    expect(isFixedBooking({ vehicleId: 'v1', startDate: '2026-10-20' }, vehicles)).toBe(false);
  });
  it('a car on a share of each rental is never hidden', () => {
    expect(isFixedBooking({ vehicleId: 'v2', startDate: '2026-11-20' }, vehicles)).toBe(false);
    expect(isFixedCar(shareCar)).toBe(false);
  });
  it('the "your vehicle was booked" SMS has no amount for a fixed car', () => {
    expect(smsTemplates.ownerVehicleBooked('Kamal', 'Yaris', '2026-12-01', '2026-12-05', null)).not.toMatch(/Rs/);
    expect(smsTemplates.ownerVehicleBooked('Kamal', 'Yaris', '2026-12-01', '2026-12-05', 35000)).toMatch(/Rs 35,000/);
  });
});
