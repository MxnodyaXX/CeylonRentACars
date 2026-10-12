import { describe, it, expect } from 'vitest'
import { parseCapture, questionsFor, statusOf, missing, askLater, nextAsk, emptyConsultation } from '../../src/lib/consultation'
import type { Consultation, Inquiry } from '../../src/types'

const inq = { id: 'i1', customerName: 'Anna Smith', customerPhone: '0771234567', requestedVehicle: 'Toyota Aqua', startDate: '2026-11-01', endDate: '2026-11-03' } as Inquiry
const blank = (): Consultation => emptyConsultation('Staff')

// ─────────────────────────────────────────────────────────────────────────────
// Quick capture: what the customer said → fields
// ─────────────────────────────────────────────────────────────────────────────

describe('parseCapture', () => {
  it('reads people, place, days and bags from one sentence', () => {
    const { patch, found } = parseCapture("We're four people travelling to Ella for five days with three suitcases", blank(), '2026-11-01')
    expect(patch.adults).toBe(4)
    expect(patch.areas).toBe('Ella')
    expect(patch.largeBags).toBe(3)
    expect(patch.returnAt).toBe('2026-11-06T10:00')
    expect(patch.purpose).toBe('Holiday / tour')
    expect(found.some((f) => f.includes('hill country'))).toBe(true)
  })

  it('splits adults and children and detects a driver', () => {
    const { patch } = parseCapture('2 adults and 2 kids, Kandy then Sigiriya, with a driver, need a child seat', blank())
    expect(patch).toMatchObject({ adults: 2, children: 2, mode: 'With driver', areas: 'Kandy → Sigiriya' })
    expect(patch.special).toContain('Child seat')
  })

  it('takes the adults from a total when children are mentioned', () => {
    expect(parseCapture('family of 5 with 2 children', blank()).patch).toMatchObject({ adults: 3, children: 2 })
  })

  it('does not treat "a day" as the rental length', () => {
    const { patch } = parseCapture('about 150 km a day for 4 days, self drive', blank(), '2026-11-01')
    expect(patch.returnAt).toBe('2026-11-05T10:00')
    expect(patch.distanceKm).toBe(600)
    expect(patch.mode).toBe('Self drive')
  })

  it('reads a daily budget and hand luggage', () => {
    const { patch } = parseCapture('hand luggage only, budget around Rs 8,000 per day', blank())
    expect(patch.largeBags).toBe(0)
    expect(patch.budgetPerDay).toBe(8000)
  })

  it('appends new places to the existing route only once', () => {
    const c = { ...blank(), areas: 'Colombo → Kandy' }
    expect(parseCapture('Kandy and then Ella', c).patch.areas).toBe('Colombo → Kandy → Ella')
  })

  it('keeps a purpose already chosen by staff', () => {
    const c = { ...blank(), purpose: 'Business / company' }
    expect(parseCapture('trip to Galle', c).patch.purpose).toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Answered / Not required / Ask later
// ─────────────────────────────────────────────────────────────────────────────

describe('question statuses', () => {
  it('a filled field counts as answered whatever staff set', () => {
    const c: Consultation = { ...blank(), adults: 2, questions: { passengers: 'later' } }
    const q = questionsFor(inq, c).find((x) => x.id === 'passengers')!
    expect(statusOf(q, c)).toBe('answered')
  })

  it('Not required and Ask later stop a question blocking the finish', () => {
    const c: Consultation = { ...blank(), questions: { route: 'na', distance: 'later' } }
    const m = missing(inq, c)
    expect(m).not.toContain('Route')
    expect(m).not.toContain('Expected km')
    expect(m).toContain('Luggage')
    expect(askLater(inq, c)).toEqual(['Expected km'])
  })

  it('follow-ups appear only when they apply', () => {
    const ids = (c: Consultation) => questionsFor(inq, c).map((q) => q.id)
    expect(ids(blank())).not.toContain('licence')
    expect(ids({ ...blank(), mode: 'Self drive' })).toContain('licence')
    expect(ids({ ...blank(), mode: 'Self drive', licence: 'Foreign' })).toContain('idp')
    expect(ids({ ...blank(), children: 1 })).toContain('childSeats')
    expect(ids({ ...blank(), areas: 'Nuwara Eliya' })).toContain('hillStay')
  })

  it('suggests the purpose opener once the purpose is known', () => {
    expect(nextAsk(inq, blank())?.text).toMatch(/what is the trip for/i)
    expect(nextAsk(inq, { ...blank(), purpose: 'Holiday / tour' })?.text).toMatch(/places are you planning to visit/i)
  })
})
