import { describe, it, expect } from 'vitest'
import { emptyMileage, mileageOf, type MileageDraft, type ReplacementDraft } from '../../src/components/ui/ManualMileageFields'
import { manualSwaps, tripKm } from '../../src/lib/tripKm'
import type { Booking, Vehicle } from '../../src/types'

const vehicles = [
  { id: 'yaris', vehicleNumber: 'CBU-0745', brand: 'Toyota', model: 'Yaris', dailyRent: 5000, extraKmRate: 50, includedKmPerDay: 100, mileage: 9000 },
  { id: 'axio', vehicleNumber: 'CBU-0649', brand: 'Toyota', model: 'Axio', dailyRent: 6000, extraKmRate: 50, includedKmPerDay: 100, mileage: 4000 },
] as unknown as Vehicle[]
const ctx = { vehicles, vehicleId: 'yaris', status: 'Completed', startDate: '2026-10-01', startTime: '10:00', endDate: '2026-10-04', endTime: '10:00', totalDays: 3, by: 'Admin' }
const rep = (x: Partial<ReplacementDraft> & { km: ReplacementDraft['km'] }): ReplacementDraft => ({
  id: 'r1', source: 'fleet', vehicleId: 'axio', partnerName: '', partnerReg: '', outAt: '2026-10-02T09:00', backAt: '2026-10-03T09:00',
  outcome: 'swapped_back', reason: 'gearbox', payout: '', meters: { originalOdometer: 'odo', replacementOdometerOut: 'odo', replacementOdometerIn: 'odo', originalOdometerBack: 'odo' }, ...x,
})
const draft = (x: Partial<MileageDraft>): MileageDraft => ({ ...emptyMileage(), ...x })

describe('manual booking mileage', () => {
  it('pickup → return on one car: km over the included allowance is charged', () => {
    const m = mileageOf(draft({ pickupKm: '10000', returnKm: '10900' }), ctx)
    expect(m.trip?.total).toBe(900)
    expect(m.includedKm).toBe(300)
    expect(m.extraKm).toBe(600)
    expect(m.charge).toBe(30000)
    expect(m.chargeNote).toBe('Extra km: 600 km × Rs 50')
    expect(m.checklists?.pickup).toMatchObject({ odometer: 10000, at: '2026-10-01T10:00' })
    expect(m.checklists?.return).toMatchObject({ odometer: 10900, at: '2026-10-04T10:00' })
    expect(m.carReadings).toEqual([{ vehicleId: 'yaris', km: 10900 }])
    expect(m.problems).toEqual([])
  })

  it('a breakdown replacement on the way: every car counts, garage km do not', () => {
    const m = mileageOf(draft({
      pickupKm: '10000', returnKm: '10700', rate: '40',
      replacements: [rep({ payout: '6000', km: { originalOdometer: '10400', replacementOdometerOut: '5000', replacementOdometerIn: '5300', originalOdometerBack: '10410' } })],
    }), ctx)
    expect(m.trip?.legs.map((l) => [l.car, l.km])).toEqual([['CBU-0745', 400], ['CBU-0649', 300], ['CBU-0745', 290]])
    expect(m.trip?.total).toBe(990)
    expect(m.trip?.garageKm).toBe(10)
    expect(m.charge).toBe((990 - 300) * 40)
    expect(m.chargeNote).toBe('Extra km: 690 km × Rs 40 (990 km driven in CBU-0745 + CBU-0649)')
    expect(m.payouts).toEqual([expect.objectContaining({ id: 'man-pay-r1', vehicleId: 'axio', amount: 6000 })])
    expect(m.checklists?.replacements?.[0]).toMatchObject({ replacementVehicleId: 'axio', payoutId: 'man-pay-r1', originalOdometerBack: 10410 })
  })

  it('readings from different trip meters are kept apart (Trip A at the breakdown, Trip B going back)', () => {
    const m = mileageOf(draft({
      pickupKm: '22833', pickupMeter: 'A', returnKm: '800', returnMeter: 'B',
      replacements: [rep({ km: { originalOdometer: '24708', replacementOdometerOut: '2450', replacementOdometerIn: '3100', originalOdometerBack: '559' },
        meters: { originalOdometer: 'A', replacementOdometerOut: 'odo', replacementOdometerIn: 'odo', originalOdometerBack: 'B' } })],
    }), ctx)
    expect(m.trip?.legs.map((l) => l.km)).toEqual([1875, 650, 241])
    expect(m.checklists?.replacements?.[0].meters).toEqual({ originalOdometer: 'A', originalOdometerBack: 'B' })
    expect(m.carReadings).toEqual([{ vehicleId: 'axio', km: 3100 }])   // a trip meter is not the car's own mileage
  })

  it('the customer kept the replacement to the end: no return reading of the booked car', () => {
    const m = mileageOf(draft({
      pickupKm: '10000', returnKm: '99999',
      replacements: [rep({ outcome: 'customer_kept', backAt: '2026-10-04T10:00', km: { originalOdometer: '10200', replacementOdometerOut: '5000', replacementOdometerIn: '5150', originalOdometerBack: '' } })],
    }), ctx)
    expect(m.checklists?.return).toBeUndefined()
    expect(m.trip?.total).toBe(350)
  })

  it('stops wrong entries: dates outside the booking, back before out, lower end reading', () => {
    const m = mileageOf(draft({
      pickupKm: '10000', returnKm: '9000',
      replacements: [rep({ vehicleId: '', outAt: '2026-10-03T09:00', backAt: '2026-10-02T09:00', km: { originalOdometer: '', replacementOdometerOut: '', replacementOdometerIn: '', originalOdometerBack: '' } })],
    }), ctx)
    expect(m.problems).toEqual(expect.arrayContaining([
      'Replacement 1: choose the replacement car.',
      'Replacement 1: it must be taken back after it was handed over.',
    ]))
    const low = mileageOf(draft({ pickupKm: '10000', returnKm: '9000' }), ctx)
    expect(low.problems[0]).toMatch(/end reading is lower than the start/)
  })

  it('nothing is recorded for a booking that has not started', () => {
    const m = mileageOf(draft({ pickupKm: '10000' }), { ...ctx, status: 'Confirmed' })
    expect(m.checklists).toBeUndefined()
    expect(m.charge).toBe(0)
  })

  it('saved replacements count in the trip km of the booking like live breakdown swaps', () => {
    const m = mileageOf(draft({ pickupKm: '10000', returnKm: '10700',
      replacements: [rep({ km: { originalOdometer: '10400', replacementOdometerOut: '5000', replacementOdometerIn: '5300', originalOdometerBack: '10410' } })] }), ctx)
    const b = { id: 'b1', vehicleId: 'yaris', pickupAt: '2026-10-01T10:00', checklists: m.checklists } as Booking
    const t = tripKm({ booking: b, swaps: manualSwaps(b), startKm: 10000, returnKm: 10700, carNumber: (id) => vehicles.find((v) => v.id === id)?.vehicleNumber ?? '?' })
    expect(t.total).toBe(990)
    expect(t.complete).toBe(true)
  })
})

describe('manual booking mileage — while the form is being filled', () => {
  it('works out what it can when a replacement reading is still empty (two cars, no total yet)', () => {
    const m = mileageOf(draft({ pickupKm: '10000', returnKm: '10700',
      replacements: [rep({ km: { originalOdometer: '10400', replacementOdometerOut: '5000', replacementOdometerIn: '5300', originalOdometerBack: '' } })] }), ctx)
    expect(m.trip?.total).toBeUndefined()
    expect(m.charge).toBe(0)
    expect(m.chargeNote).toBe('Extra km: 0 km × Rs 50')
  })
})

describe('correcting a saved booking', () => {
  it('a saved booking comes back into the form unchanged (readings, meters, replacements, km rate)', async () => {
    const { mileageDraftOf } = await import('../../src/components/ui/ManualMileageFields')
    const d = draft({ pickupKm: '22833', pickupMeter: 'A', returnKm: '800', returnMeter: 'B', rate: '40',
      replacements: [rep({ payout: '6000', km: { originalOdometer: '24708', replacementOdometerOut: '2450', replacementOdometerIn: '3100', originalOdometerBack: '559' },
        meters: { originalOdometer: 'A', replacementOdometerOut: 'odo', replacementOdometerIn: 'odo', originalOdometerBack: 'B' } })] })
    const m = mileageOf(d, ctx)
    const b = { id: 'b1', vehicleId: 'yaris', checklists: m.checklists, charges: [{ id: 'c', kind: 'Other', amount: m.charge, date: '2026-10-04', note: m.chargeNote, status: 'Charged', by: 'A', at: '' }] } as unknown as Booking
    expect(mileageDraftOf(b)).toEqual(d)
    // no extra km charge on the bill yet → a correction doesn't add one unless ticked
    expect(mileageDraftOf({ ...b, charges: [] }).chargeKm).toBe(false)
  })
})
