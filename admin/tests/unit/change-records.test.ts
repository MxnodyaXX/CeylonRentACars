import { describe, it, expect } from 'vitest'
import { parseChanges } from '../../src/lib/bookingRecord'

describe('parseChanges — readable edit records', () => {
  it('splits an extension into rows with friendly dates and the money difference', () => {
    const r = parseChanges('Return: 2026-10-14 07:00 → 2026-10-23 21:00; Length: 13 days → 23 days; Total: Rs 84,500 → Rs 115,000')!
    expect(r.changes).toEqual([
      { label: 'Return', from: '14 Oct 2026, 7:00 AM', to: '23 Oct 2026, 9:00 PM' },
      { label: 'Length', from: '13 days', to: '23 days' },
      { label: 'Total', from: 'Rs 84,500', to: 'Rs 115,000', delta: 30500 },
    ])
    expect(r.reason).toBeUndefined()
  })

  it('keeps the reason and copes with empty (—) values', () => {
    const r = parseChanges('NIC: — → 901234567V; Discount: Rs 14,500 → Rs 0 — Entered by mistake')!
    expect(r.changes[0]).toEqual({ label: 'NIC', from: '—', to: '901234567V' })
    expect(r.changes[1]).toMatchObject({ label: 'Discount', delta: -14500 })
    expect(r.reason).toBe('Entered by mistake')
  })

  it('leaves ordinary history text alone', () => {
    expect(parseChanges('Rs 17,000 payment by Cash (receipt R-1001)')).toBeNull()
    expect(parseChanges('Customer changed plans — Flight moved')).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// missingInfo — what still needs filling in on a booking
// ─────────────────────────────────────────────────────────────────────────────
import { missingInfo } from '../../src/lib/bookingRecord'
import type { Booking } from '../../src/types'

const base = (o: Partial<Booking> = {}): Booking => ({
  id: 'b1', vehicleId: 'v1', customerId: 'c1', customerName: 'Punsisi Keshan', customerPhone: '0721968104',
  startDate: '2026-10-01', endDate: '2026-10-23', startTime: '22:00', endTime: '21:00', totalDays: 22, totalAmount: 110000,
  paidAmount: 50000, status: 'Ongoing', createdAt: '2026-10-08T07:55:41Z', ...o,
})
const labels = (b: Booking) => missingInfo(b).map((i) => i.label)

describe('missingInfo', () => {
  it('flags the empty customer details on a live self-drive rental', () => {
    const l = labels(base())
    expect(l).toEqual(expect.arrayContaining(['NIC / passport no.', 'Licence number', 'Licence expiry', 'Pickup location', 'Return location', 'ID copy', 'Licence copy', 'Signed agreement', 'Pickup checklist']))
    expect(l).not.toContain('Pickup time')
    expect(missingInfo(base()).find((i) => i.label === 'Licence number')?.critical).toBe(true)
  })

  it('does not ask for a licence when the rental has a driver', () => {
    expect(labels(base({ driverId: 'd1' }))).not.toContain('Licence number')
  })

  it('warns when the licence expires before the return, or a foreign licence has no IDP', () => {
    const l = labels(base({ customerInfo: { licenceNumber: 'B123', licenceExpiry: '2026-10-15', licenceType: 'Foreign' } }))
    expect(l).toContain('Licence expires before return')
    expect(l).toContain('International Driving Permit')
  })

  it('a complete booking has nothing missing', () => {
    expect(missingInfo(base({
      customerNIC: '901234567V', pickupLocation: 'Colombo', dropLocation: 'Colombo',
      customerInfo: { licenceNumber: 'B123', licenceExpiry: '2028-01-01', licenceType: 'Sri Lankan' },
      documents: [{ id: '1', kind: 'NIC / Passport', name: 'nic.jpg', path: 'x', uploadedAt: '', by: '' }, { id: '2', kind: 'Driving licence', name: 'l.jpg', path: 'y', uploadedAt: '', by: '' }],
      agreement: { signedAt: '2026-10-01T22:00:00Z' },
      checklists: { pickup: { at: '', by: '', odometer: 1, fuel: 'Full', items: {} } },
    }))).toEqual([])
  })

  it('completed bookings are checked too (plus the return and deposit); cancelled never', () => {
    const l = labels(base({ status: 'Completed', depositType: 'cash', depositAmount: 10000 }))
    expect(l).toEqual(expect.arrayContaining(['NIC / passport no.', 'Licence number', 'Pickup checklist', 'Return checklist', 'Deposit to settle']))
    expect(labels(base({ status: 'Cancelled' }))).toEqual([])
  })

  it('marks the items that can only be done after saving', () => {
    const after = missingInfo(base({ status: 'Confirmed' })).filter((i) => i.after).map((i) => i.label)
    expect(after).toEqual(['ID copy', 'Licence copy'])
  })
})
