import { describe, expect, it } from 'vitest';
import { customerDetailsMessage, customerDetailsToAsk } from '../../src/lib/bookingRecord';
import type { Booking } from '../../src/types';

const base = {
  id: 'b1', customerName: 'Punsisi Perera', customerPhone: '0771234567', startDate: '2026-10-01', endDate: '2026-10-23',
  status: 'Confirmed', totalDays: 22, totalAmount: 110000, paidAmount: 0, vehicleId: 'v1', createdAt: '2026-09-30T10:00:00Z',
} as unknown as Booking;

describe('asking the customer for missing details', () => {
  it('lists everything when nothing is recorded (self drive)', () => {
    const items = customerDetailsToAsk(base);
    expect(items).toEqual([
      'NIC or passport number', 'a photo of your NIC / passport', 'driving licence number and expiry date',
      'a photo of your driving licence (both sides)', 'home address', 'an emergency contact (name and phone)',
    ]);
  });

  it('skips licence items when a driver is assigned, and what is already filled in', () => {
    const b = { ...base, driverId: 'd1', customerNIC: '199912345678', customerInfo: { address: 'Kandy' },
      documents: [{ kind: 'NIC / Passport' }] } as unknown as Booking;
    expect(customerDetailsToAsk(b)).toEqual(['an emergency contact (name and phone)']);
  });

  it('WhatsApp message lists each item; SMS asks for photos on WhatsApp', () => {
    const items = customerDetailsToAsk(base);
    const wa = customerDetailsMessage(base, items, 'whatsapp');
    expect(wa).toContain('Hello Punsisi Perera');
    expect(wa).toContain('• home address');
    const sms = customerDetailsMessage(base, items, 'sms');
    expect(sms).toContain('please reply with: NIC or passport number;');
    expect(sms).toContain('WhatsApp photos');
    expect(sms).not.toContain('a photo of');
  });

  it('SMS with only photos missing reads naturally', () => {
    const sms = customerDetailsMessage(base, ['a photo of your NIC / passport'], 'sms');
    expect(sms).toContain('we need copies of your documents.');
    expect(sms).not.toContain('reply with');
  });
});
