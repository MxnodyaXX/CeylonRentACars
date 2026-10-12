import { describe, it, expect } from 'vitest'
import { statusDateProblem, statusForDates } from '../../src/lib/availability'

// "Now" is 20 Oct 2026, 12:00 local time
const now = new Date('2026-10-20T12:00:00').getTime()
const rental = { startDate: '2026-10-10', endDate: '2026-11-10' }

// ─────────────────────────────────────────────────────────────────────────────
// A manual booking's status must match its dates
// ─────────────────────────────────────────────────────────────────────────────

describe('statusDateProblem', () => {
  it('blocks Completed for a rental that is still running (Oct 10 → Nov 10)', () => {
    expect(statusDateProblem('Completed', rental, now)).toMatch(/can't be Completed yet\. Use Ongoing/)
    expect(statusDateProblem('Ongoing', rental, now)).toBeNull()
  })

  it('blocks Completed and Ongoing for a rental that has not started', () => {
    const future = { startDate: '2026-11-01', endDate: '2026-11-05' }
    expect(statusDateProblem('Completed', future, now)).toMatch(/Use Confirmed/)
    expect(statusDateProblem('Ongoing', future, now)).toMatch(/can't be Ongoing yet/)
    expect(statusDateProblem('Confirmed', future, now)).toBeNull()
  })

  it('blocks Confirmed and Ongoing for a rental that already ended', () => {
    const past = { startDate: '2026-10-01', endDate: '2026-10-05' }
    expect(statusDateProblem('Confirmed', past, now)).toMatch(/use Completed/)
    expect(statusDateProblem('Ongoing', past, now)).toMatch(/can't still be Ongoing/)
    expect(statusDateProblem('Completed', past, now)).toBeNull()
  })

  it('blocks Confirmed once the rental has started', () => {
    expect(statusDateProblem('Confirmed', rental, now)).toMatch(/use Ongoing/)
  })

  it('allows either status on the start / end day when no time proves otherwise', () => {
    const endsToday = { startDate: '2026-10-15', endDate: '2026-10-20' }
    expect(statusDateProblem('Completed', endsToday, now)).toBeNull()      // returned this morning
    expect(statusDateProblem('Ongoing', endsToday, now)).toBeNull()        // still out until tonight
    const startsToday = { startDate: '2026-10-20', endDate: '2026-10-25' }
    expect(statusDateProblem('Confirmed', startsToday, now)).toBeNull()
    expect(statusDateProblem('Ongoing', startsToday, now)).toBeNull()
  })

  it('uses the time on the boundary day when it is given', () => {
    expect(statusDateProblem('Completed', { startDate: '2026-10-15', endDate: '2026-10-20', endTime: '18:00' }, now)).toMatch(/can't be Completed/)
    expect(statusDateProblem('Completed', { startDate: '2026-10-15', endDate: '2026-10-20', endTime: '09:00' }, now)).toBeNull()
    expect(statusDateProblem('Ongoing', { startDate: '2026-10-20', endDate: '2026-10-25', startTime: '15:00' }, now)).toMatch(/can't be Ongoing yet/)
  })

  it('never blocks Cancelled', () => {
    expect(statusDateProblem('Cancelled', rental, now)).toBeNull()
  })
})

describe('statusForDates', () => {
  it('suggests the status the dates point to', () => {
    expect(statusForDates(rental, now)).toBe('Ongoing')
    expect(statusForDates({ startDate: '2026-10-01', endDate: '2026-10-05' }, now)).toBe('Completed')
    expect(statusForDates({ startDate: '2026-11-01', endDate: '2026-11-05' }, now)).toBe('Confirmed')
    expect(statusForDates({ startDate: '2026-10-20', endDate: '2026-10-22' }, now)).toBe('Confirmed')
  })
})
