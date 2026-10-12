import { describe, it, expect } from 'vitest'
import { addCalendarMonths, addHours, periodFor, durationLabel } from '../../src/lib/rentalPeriod'

// ─────────────────────────────────────────────────────────────────────────────
// Monthly rentals count calendar months, not 30 / 31 days
// ─────────────────────────────────────────────────────────────────────────────

describe('addCalendarMonths', () => {
  it('5 Jan + 1 month is 5 Feb, + 2 is 5 Mar, + 6 is 5 Jul', () => {
    expect(addCalendarMonths('2026-01-05', 1)).toBe('2026-02-05')
    expect(addCalendarMonths('2026-01-05', 2)).toBe('2026-03-05')
    expect(addCalendarMonths('2026-01-05', 6)).toBe('2026-07-05')
  })
  it('crosses the year end', () => {
    expect(addCalendarMonths('2026-09-15', 12)).toBe('2027-09-15')
    expect(addCalendarMonths('2026-11-20', 3)).toBe('2027-02-20')
  })
  it('uses the last day when the month is shorter', () => {
    expect(addCalendarMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addCalendarMonths('2028-01-31', 1)).toBe('2028-02-29')   // leap year
  })
})

describe('addHours', () => {
  it('same-day and past-midnight returns', () => {
    expect(addHours('2026-10-11', '09:00', 5)).toEqual({ endDate: '2026-10-11', endTime: '14:00' })
    expect(addHours('2026-10-11', '20:30', 6)).toEqual({ endDate: '2026-10-12', endTime: '02:30' })
  })
})

describe('periodFor', () => {
  it('monthly: end date, days held and price', () => {
    expect(periodFor({ rentalType: 'Monthly', startDate: '2026-01-05', startTime: '08:00', rentalUnits: 6, unitRate: 90000 }))
      .toEqual({ endDate: '2026-07-05', endTime: '08:00', totalDays: 181, totalAmount: 540000 })
  })
  it('hourly: return time and price; needs a pickup time', () => {
    expect(periodFor({ rentalType: 'Hourly', startDate: '2026-10-11', startTime: '10:00', rentalUnits: 4, unitRate: 1500 }))
      .toEqual({ endDate: '2026-10-11', endTime: '14:00', totalDays: 1, totalAmount: 6000 })
    expect(periodFor({ rentalType: 'Hourly', startDate: '2026-10-11', rentalUnits: 4, unitRate: 1500 })).toBeNull()
  })
  it('nothing until the number of hours / months is entered; daily is left to the form', () => {
    expect(periodFor({ rentalType: 'Monthly', startDate: '2026-01-05' })).toBeNull()
    expect(periodFor({ rentalType: 'Daily', startDate: '2026-01-05', rentalUnits: 3 })).toBeNull()
  })
})

describe('durationLabel', () => {
  it('shows months / hours for those types and days otherwise', () => {
    expect(durationLabel({ rentalType: 'Monthly', rentalUnits: 6, totalDays: 181 })).toBe('6 months')
    expect(durationLabel({ rentalType: 'Hourly', rentalUnits: 1, totalDays: 1 })).toBe('1 hour')
    expect(durationLabel({ totalDays: 3 })).toBe('3 days')
  })
})
