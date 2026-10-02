import { describe, it, expect } from 'vitest'
import {
  bookingBill,
  bookingPaid,
  bookingDue,
  bookingCredit,
  creditTotals,
  customerCredit,
  creditRecords,
  creditResponsibilityOf,
} from '../../src/lib/credit'
import { resolveReferralFee } from '../../src/lib/referral'
import type { Booking, Customer } from '../../src/types'

// ─────────────────────────────────────────────────────────────────────────────
// Test fixtures
// ─────────────────────────────────────────────────────────────────────────────

let _seq = 0
function makeBooking(overrides: Partial<Booking> = {}): Booking {
  const id = `b${++_seq}`
  return {
    id,
    vehicleId: 'v1',
    customerId: 'c1',
    customerName: 'Test Customer',
    customerPhone: '0771234567',
    startDate: '2026-07-01',
    endDate:   '2026-07-05',
    totalDays:   5,
    totalAmount: 20000,
    paidAmount:  0,
    status:      'Completed',
    createdAt:   '2026-07-01T00:00:00.000Z',
    ...overrides,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// bookingBill — net bill = totalAmount + extraCharges − discount
// ─────────────────────────────────────────────────────────────────────────────
describe('bookingBill', () => {
  it('no extras, no discount → equals totalAmount', () => {
    expect(bookingBill(makeBooking({ totalAmount: 20000 }))).toBe(20000)
  })

  it('discount reduces bill', () => {
    expect(bookingBill(makeBooking({ totalAmount: 20000, discount: 2000 }))).toBe(18000)
  })

  it('extra charges increase bill', () => {
    expect(bookingBill(makeBooking({ totalAmount: 20000, extraCharges: 1500 }))).toBe(21500)
  })

  it('both discount and extra charges applied together', () => {
    // 20000 + 1500 - 1000 = 20500
    expect(bookingBill(makeBooking({ totalAmount: 20000, extraCharges: 1500, discount: 1000 }))).toBe(20500)
  })

  it('discount equals totalAmount → bill is 0', () => {
    expect(bookingBill(makeBooking({ totalAmount: 5000, discount: 5000 }))).toBe(0)
  })

  it('discount larger than totalAmount → negative bill (caller clamps if needed)', () => {
    // bookingBill is pure math; clamping is the caller's responsibility
    expect(bookingBill(makeBooking({ totalAmount: 5000, discount: 6000 }))).toBe(-1000)
  })

  it('zero totalAmount → bill is 0', () => {
    expect(bookingBill(makeBooking({ totalAmount: 0 }))).toBe(0)
  })

  it('cancelled booking still returns correct bill (bill is status-agnostic)', () => {
    expect(bookingBill(makeBooking({ totalAmount: 15000, discount: 2000, status: 'Cancelled' }))).toBe(13000)
  })

  // ── Complex scenario ────────────────────────────────────────────────────────
  it('complex scenario: 25000 total, 1000 discount → bill 24000', () => {
    expect(bookingBill(makeBooking({ totalAmount: 25000, discount: 1000 }))).toBe(24000)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// bookingPaid — total paid = paidAmount + advanceAmount
// ─────────────────────────────────────────────────────────────────────────────
describe('bookingPaid', () => {
  it('no advance → equals paidAmount', () => {
    expect(bookingPaid(makeBooking({ paidAmount: 10000 }))).toBe(10000)
  })

  it('with advance → paidAmount + advanceAmount', () => {
    expect(bookingPaid(makeBooking({ paidAmount: 10000, advanceAmount: 5000 }))).toBe(15000)
  })

  it('only advance, no paidAmount', () => {
    expect(bookingPaid(makeBooking({ paidAmount: 0, advanceAmount: 5000 }))).toBe(5000)
  })

  it('both zero → 0', () => {
    expect(bookingPaid(makeBooking({ paidAmount: 0 }))).toBe(0)
  })

  // ── Complex scenario ────────────────────────────────────────────────────────
  it('complex scenario: 10000 paid + 5000 advance → 15000 total paid', () => {
    expect(bookingPaid(makeBooking({ paidAmount: 10000, advanceAmount: 5000 }))).toBe(15000)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// bookingDue — outstanding balance (never negative)
// ─────────────────────────────────────────────────────────────────────────────
describe('bookingDue', () => {
  it('fully paid → 0', () => {
    expect(bookingDue(makeBooking({ totalAmount: 10000, paidAmount: 10000 }))).toBe(0)
  })

  it('partial payment → bill minus paid', () => {
    // Bill 20000, paid 8000, advance 2000 → due 10000
    expect(bookingDue(makeBooking({ totalAmount: 20000, paidAmount: 8000, advanceAmount: 2000 }))).toBe(10000)
  })

  it('discount reduces the due amount', () => {
    // Bill 10000 - 1500 = 8500, paid 5000 → due 3500
    expect(bookingDue(makeBooking({ totalAmount: 10000, discount: 1500, paidAmount: 5000 }))).toBe(3500)
  })

  it('extra charges increase the due amount', () => {
    // Bill 10000 + 2000 = 12000, paid 10000 → due 2000
    expect(bookingDue(makeBooking({ totalAmount: 10000, extraCharges: 2000, paidAmount: 10000 }))).toBe(2000)
  })

  it('overpayment → 0 (never negative)', () => {
    expect(bookingDue(makeBooking({ totalAmount: 5000, paidAmount: 6000 }))).toBe(0)
  })

  it('no payment at all → full bill is due', () => {
    expect(bookingDue(makeBooking({ totalAmount: 20000, paidAmount: 0 }))).toBe(20000)
  })

  // ── Full payment scenarios ──────────────────────────────────────────────────
  it('full payment scenario: 10000 total, 10000 paid → 0 due', () => {
    expect(bookingDue(makeBooking({ totalAmount: 10000, paidAmount: 10000 }))).toBe(0)
  })

  it('advance covers full bill → 0 due', () => {
    expect(bookingDue(makeBooking({ totalAmount: 8000, paidAmount: 0, advanceAmount: 8000 }))).toBe(0)
  })

  // ── Complex scenario (discount + partial + bad debt + credit) ───────────────
  it('complex scenario: 25000 total, 1000 discount, 5000 advance, 10000 paid → 9000 due', () => {
    // Bill = 25000 - 1000 = 24000
    // Paid = 10000 + 5000 = 15000
    // Due  = 24000 - 15000 = 9000
    const b = makeBooking({
      totalAmount: 25000,
      discount: 1000,
      advanceAmount: 5000,
      paidAmount: 10000,
      badDebt: 2000,
      creditAmount: 7000,
      creditSettled: false,
    })
    expect(bookingBill(b)).toBe(24000)
    expect(bookingPaid(b)).toBe(15000)
    expect(bookingDue(b)).toBe(9000)
  })

  it('after credit settlement: paidAmount absorbs credit, due shrinks to bad debt', () => {
    // Same scenario but credit is settled: paidAmount increased by creditAmount
    const b = makeBooking({
      totalAmount: 25000,
      discount: 1000,
      advanceAmount: 5000,
      paidAmount: 17000,  // original 10000 + 7000 credit settled
      badDebt: 2000,
      creditAmount: 7000,
      creditSettled: true,
    })
    // Bill = 24000, Paid = 17000 + 5000 = 22000 → due = 2000 (= bad debt)
    expect(bookingBill(b)).toBe(24000)
    expect(bookingPaid(b)).toBe(22000)
    expect(bookingDue(b)).toBe(2000)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// bookingCredit — unsettled recorded credit amount
// ─────────────────────────────────────────────────────────────────────────────
describe('bookingCredit', () => {
  it('no credit amount → 0', () => {
    expect(bookingCredit(makeBooking({ paidAmount: 5000 }))).toBe(0)
  })

  it('credit amount recorded and not settled → returns the amount', () => {
    expect(bookingCredit(makeBooking({ creditAmount: 7000, creditSettled: false }))).toBe(7000)
  })

  it('credit settled → 0', () => {
    expect(bookingCredit(makeBooking({ creditAmount: 7000, creditSettled: true }))).toBe(0)
  })

  it('cancelled booking → 0 even with credit amount', () => {
    expect(bookingCredit(makeBooking({ creditAmount: 5000, status: 'Cancelled' }))).toBe(0)
  })

  it('credit on completed booking → full amount returned', () => {
    expect(bookingCredit(makeBooking({ creditAmount: 3000, status: 'Completed', creditSettled: false }))).toBe(3000)
  })

  it('ongoing booking with credit → amount returned', () => {
    expect(bookingCredit(makeBooking({ creditAmount: 4000, status: 'Ongoing', creditSettled: false }))).toBe(4000)
  })

  it('zero credit amount → 0', () => {
    expect(bookingCredit(makeBooking({ creditAmount: 0 }))).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// resolveReferralFee — converts referral fee input to rupee amount
// ─────────────────────────────────────────────────────────────────────────────
describe('resolveReferralFee', () => {
  it('no feeValue → 0', () => {
    expect(resolveReferralFee(undefined, undefined, 25000)).toBe(0)
  })

  it('zero feeValue → 0', () => {
    expect(resolveReferralFee('fixed', 0, 25000)).toBe(0)
  })

  it('negative feeValue → 0', () => {
    expect(resolveReferralFee('fixed', -500, 25000)).toBe(0)
  })

  // ── Fixed fee ───────────────────────────────────────────────────────────────
  it('fixed: returns the exact rupee value', () => {
    expect(resolveReferralFee('fixed', 2500, 25000)).toBe(2500)
  })

  it('fixed: independent of booking amount', () => {
    expect(resolveReferralFee('fixed', 1000, 50000)).toBe(1000)
    expect(resolveReferralFee('fixed', 1000, 5000)).toBe(1000)
  })

  it('fixed: fractional input → Math.round', () => {
    expect(resolveReferralFee('fixed', 1500.7, 20000)).toBe(1501)
  })

  // ── Percent fee ─────────────────────────────────────────────────────────────
  it('percent: 10% of 25000 = 2500', () => {
    expect(resolveReferralFee('percent', 10, 25000)).toBe(2500)
  })

  it('percent: 15% of 20000 = 3000', () => {
    expect(resolveReferralFee('percent', 15, 20000)).toBe(3000)
  })

  it('percent: 12.5% of 8000 = 1000', () => {
    expect(resolveReferralFee('percent', 12.5, 8000)).toBe(1000)
  })

  it('percent: rounds to nearest rupee', () => {
    // 10% of 25001 = 2500.1 → rounds to 2500
    expect(resolveReferralFee('percent', 10, 25001)).toBe(2500)
    // 10% of 25005 = 2500.5 → rounds to 2501
    expect(resolveReferralFee('percent', 10, 25005)).toBe(2501)
  })

  it('percent: 100% → full booking amount', () => {
    expect(resolveReferralFee('percent', 100, 10000)).toBe(10000)
  })

  it('percent: 0% → 0 (feeValue is 0 guard)', () => {
    expect(resolveReferralFee('percent', 0, 25000)).toBe(0)
  })

  // ── Owner payout derived from referral fee ──────────────────────────────────
  it('owner payout = totalAmount − referral fee (fixed)', () => {
    const total = 25000
    const fee   = resolveReferralFee('fixed', 2500, total)
    expect(Math.max(0, total - fee)).toBe(22500)
  })

  it('owner payout = totalAmount − referral fee (percent)', () => {
    const total = 25000
    const fee   = resolveReferralFee('percent', 10, total)
    expect(Math.max(0, total - fee)).toBe(22500)
  })

  it('referral fee capped: fee cannot exceed totalAmount (caller uses Math.max)', () => {
    const total = 5000
    const fee   = resolveReferralFee('fixed', 8000, total)
    expect(Math.max(0, total - fee)).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// creditTotals — company-wide unsettled credit across all bookings
// ─────────────────────────────────────────────────────────────────────────────
describe('creditTotals', () => {
  it('empty bookings list → all zeros', () => {
    const totals = creditTotals([])
    expect(totals.total).toBe(0)
    expect(totals.customers).toBe(0)
    expect(totals.bookings).toBe(0)
  })

  it('no bookings with credit → all zeros', () => {
    const totals = creditTotals([
      makeBooking({ paidAmount: 10000, totalAmount: 10000 }),
    ])
    expect(totals.total).toBe(0)
    expect(totals.customers).toBe(0)
    expect(totals.bookings).toBe(0)
  })

  it('one customer with credit → counted once', () => {
    const totals = creditTotals([
      makeBooking({ customerId: 'c1', customerPhone: '0771111111', creditAmount: 5000, creditSettled: false }),
    ])
    expect(totals.total).toBe(5000)
    expect(totals.customers).toBe(1)
    expect(totals.bookings).toBe(1)
  })

  it('two different customers with credit → both counted', () => {
    const totals = creditTotals([
      makeBooking({ customerId: 'c1', customerPhone: '0771111111', creditAmount: 5000, creditSettled: false }),
      makeBooking({ customerId: 'c2', customerPhone: '0772222222', creditAmount: 3000, creditSettled: false }),
    ])
    expect(totals.total).toBe(8000)
    expect(totals.customers).toBe(2)
    expect(totals.bookings).toBe(2)
  })

  it('settled credit excluded from totals', () => {
    const totals = creditTotals([
      makeBooking({ customerId: 'c1', customerPhone: '0771111111', creditAmount: 5000, creditSettled: false }),
      makeBooking({ customerId: 'c2', customerPhone: '0772222222', creditAmount: 3000, creditSettled: true }),
    ])
    expect(totals.total).toBe(5000)
    expect(totals.customers).toBe(1)
    expect(totals.bookings).toBe(1)
  })

  it('cancelled booking excluded from credit totals', () => {
    const totals = creditTotals([
      makeBooking({ customerId: 'c1', customerPhone: '0771111111', creditAmount: 4000, creditSettled: false, status: 'Cancelled' }),
    ])
    expect(totals.total).toBe(0)
    expect(totals.customers).toBe(0)
    expect(totals.bookings).toBe(0)
  })

  it('same customer with multiple credit bookings → 1 customer, N bookings', () => {
    const totals = creditTotals([
      makeBooking({ customerId: 'c1', customerPhone: '0771111111', creditAmount: 5000, creditSettled: false }),
      makeBooking({ customerId: 'c1', customerPhone: '0771111111', creditAmount: 3000, creditSettled: false }),
    ])
    expect(totals.total).toBe(8000)
    expect(totals.customers).toBe(1)
    expect(totals.bookings).toBe(2)
  })

  it('mix of settled, unsettled, and cancelled → only unsettled active bookings counted', () => {
    const totals = creditTotals([
      makeBooking({ customerId: 'c1', customerPhone: '0771111111', creditAmount: 5000, creditSettled: false }),
      makeBooking({ customerId: 'c2', customerPhone: '0772222222', creditAmount: 3000, creditSettled: true }),
      makeBooking({ customerId: 'c3', customerPhone: '0773333333', creditAmount: 2000, status: 'Cancelled' }),
      makeBooking({ customerId: 'c4', customerPhone: '0774444444', creditAmount: 4000, creditSettled: false }),
    ])
    expect(totals.total).toBe(9000)
    expect(totals.customers).toBe(2)
    expect(totals.bookings).toBe(2)
  })

  // ── Complex scenario ────────────────────────────────────────────────────────
  it('complex scenario: 7000 credit on completed booking', () => {
    const totals = creditTotals([
      makeBooking({
        customerId: 'c1', customerPhone: '0779999999',
        totalAmount: 25000, discount: 1000, advanceAmount: 5000, paidAmount: 10000,
        badDebt: 2000, creditAmount: 7000, creditSettled: false, status: 'Completed',
      }),
    ])
    expect(totals.total).toBe(7000)
    expect(totals.customers).toBe(1)
    expect(totals.bookings).toBe(1)
  })

  it('complex scenario: after credit settled → 0 outstanding', () => {
    const totals = creditTotals([
      makeBooking({
        customerId: 'c1', customerPhone: '0779999999',
        totalAmount: 25000, discount: 1000, advanceAmount: 5000,
        paidAmount: 17000,  // 10000 + 7000 credit settled
        badDebt: 2000, creditAmount: 7000, creditSettled: true, status: 'Completed',
      }),
    ])
    expect(totals.total).toBe(0)
    expect(totals.customers).toBe(0)
    expect(totals.bookings).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// customerCredit — per-customer outstanding credit
// ─────────────────────────────────────────────────────────────────────────────
describe('customerCredit', () => {
  const customer: Customer = {
    id: 'c1', name: 'Alpha Customer', phone: '0771111111', createdAt: '2026-01-01T00:00:00Z',
  }

  it('no bookings for customer → zero outstanding', () => {
    const result = customerCredit(customer, [])
    expect(result.outstanding).toBe(0)
    expect(result.count).toBe(0)
    expect(result.bookings).toHaveLength(0)
  })

  it('bookings by other customers excluded', () => {
    const result = customerCredit(customer, [
      makeBooking({ customerId: 'c99', customerPhone: '0779999999', creditAmount: 5000, creditSettled: false }),
    ])
    expect(result.outstanding).toBe(0)
  })

  it('matches by customerId', () => {
    const result = customerCredit(customer, [
      makeBooking({ customerId: 'c1', customerPhone: '0771111111', creditAmount: 4500, creditSettled: false }),
    ])
    expect(result.outstanding).toBe(4500)
    expect(result.count).toBe(1)
  })

  it('matches by phone when no customerId set on booking', () => {
    const result = customerCredit(customer, [
      makeBooking({ customerId: '', customerPhone: '0771111111', creditAmount: 3000, creditSettled: false }),
    ])
    expect(result.outstanding).toBe(3000)
  })

  it('settled credit excluded', () => {
    const result = customerCredit(customer, [
      makeBooking({ customerId: 'c1', customerPhone: '0771111111', creditAmount: 4000, creditSettled: true }),
    ])
    expect(result.outstanding).toBe(0)
    expect(result.count).toBe(0)
  })

  it('multiple bookings with credit summed', () => {
    const result = customerCredit(customer, [
      makeBooking({ customerId: 'c1', customerPhone: '0771111111', creditAmount: 5000, creditSettled: false }),
      makeBooking({ customerId: 'c1', customerPhone: '0771111111', creditAmount: 2000, creditSettled: false }),
    ])
    expect(result.outstanding).toBe(7000)
    expect(result.count).toBe(2)
  })

  it('settled bookings excluded from count and total', () => {
    const result = customerCredit(customer, [
      makeBooking({ customerId: 'c1', customerPhone: '0771111111', creditAmount: 5000, creditSettled: false }),
      makeBooking({ customerId: 'c1', customerPhone: '0771111111', creditAmount: 2000, creditSettled: true }),
    ])
    expect(result.outstanding).toBe(5000)
    expect(result.count).toBe(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// creditRecords — all credit bookings (settled or not) for audit
// ─────────────────────────────────────────────────────────────────────────────
describe('creditRecords', () => {
  it('empty list → empty records', () => {
    expect(creditRecords([])).toHaveLength(0)
  })

  it('booking without credit omitted', () => {
    const records = creditRecords([makeBooking({ paidAmount: 10000, totalAmount: 10000 })])
    expect(records).toHaveLength(0)
  })

  it('unsettled credit booking included with settled=false', () => {
    const records = creditRecords([makeBooking({ creditAmount: 5000, creditSettled: false })])
    expect(records).toHaveLength(1)
    expect(records[0].settled).toBe(false)
    expect(records[0].amount).toBe(5000)
  })

  it('settled credit booking included with settled=true', () => {
    const records = creditRecords([makeBooking({ creditAmount: 5000, creditSettled: true })])
    expect(records).toHaveLength(1)
    expect(records[0].settled).toBe(true)
  })

  it('cancelled booking with credit excluded', () => {
    const records = creditRecords([makeBooking({ creditAmount: 5000, status: 'Cancelled' })])
    expect(records).toHaveLength(0)
  })

  it('returns both settled and unsettled records', () => {
    const records = creditRecords([
      makeBooking({ creditAmount: 5000, creditSettled: false }),
      makeBooking({ creditAmount: 3000, creditSettled: true }),
    ])
    expect(records).toHaveLength(2)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// creditResponsibilityOf — determines who is liable for unpaid credit
// ─────────────────────────────────────────────────────────────────────────────
describe('creditResponsibilityOf', () => {
  it('direct / walk-in (no referral) → self (vehicle owner liable)', () => {
    expect(creditResponsibilityOf('Direct', false)).toBe('self')
  })

  it('undefined referral → self', () => {
    expect(creditResponsibilityOf(undefined, false)).toBe('self')
  })

  it('owner referral → owner (referring owner liable)', () => {
    expect(creditResponsibilityOf('Kasun Perera', true)).toBe('owner')
  })

  it('Company referral → company', () => {
    expect(creditResponsibilityOf('Company', false)).toBe('company')
  })

  it('Company referral overrides isOwnerReferral flag', () => {
    expect(creditResponsibilityOf('Company', true)).toBe('company')
  })

  it('marketing source referral, not owner → self', () => {
    // WhatsApp/Facebook/etc. are not owner referrals → responsibility falls to self
    expect(creditResponsibilityOf('WhatsApp', false)).toBe('self')
    expect(creditResponsibilityOf('Facebook', false)).toBe('self')
    expect(creditResponsibilityOf('Google', false)).toBe('self')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Full-scenario integration: all calculations working together
// ─────────────────────────────────────────────────────────────────────────────
describe('Full financial scenario: booking with referral, discount, partial payment, bad debt, credit', () => {
  // Setup:
  //   Vehicle: Rs 5,000/day, 5-day rental → totalAmount = 25,000
  //   Referral: Owner B, 10% fee = 2,500 → ownerPayout = 22,500
  //   Discount: Rs 1,000 → net bill = 24,000
  //   Advance: Rs 5,000 (at booking creation)
  //   Additional payment: Rs 10,000 → total paid = 15,000
  //   Outstanding: 24,000 − 15,000 = 9,000
  //   Bad debt (written off): Rs 2,000
  //   Credit (to collect later): Rs 7,000

  const booking = makeBooking({
    totalAmount:  25000,
    discount:     1000,
    advanceAmount: 5000,
    paidAmount:   10000,
    badDebt:       2000,
    creditAmount:  7000,
    creditSettled: false,
    referral:      'Owner B',
    referralFeeType:  'percent',
    referralFeeValue: 10,
    status: 'Completed',
  })

  it('bill is correctly calculated', () => {
    expect(bookingBill(booking)).toBe(24000)
  })

  it('total paid is correctly calculated', () => {
    expect(bookingPaid(booking)).toBe(15000)
  })

  it('outstanding due is correctly calculated', () => {
    expect(bookingDue(booking)).toBe(9000)
  })

  it('credit amount outstanding is 7000', () => {
    expect(bookingCredit(booking)).toBe(7000)
  })

  it('referral fee is 10% of 25000 = 2500', () => {
    const fee = resolveReferralFee(booking.referralFeeType, booking.referralFeeValue, booking.totalAmount)
    expect(fee).toBe(2500)
  })

  it('owner payout = totalAmount − referral fee = 22500', () => {
    const fee     = resolveReferralFee(booking.referralFeeType, booking.referralFeeValue, booking.totalAmount)
    const payout  = Math.max(0, booking.totalAmount - fee)
    expect(payout).toBe(22500)
  })

  it('credit totals reflect the outstanding balance', () => {
    const totals = creditTotals([booking])
    expect(totals.total).toBe(7000)
    expect(totals.customers).toBe(1)
    expect(totals.bookings).toBe(1)
  })

  it('after credit settled: outstanding credit = 0, due = 2000 (bad debt)', () => {
    const settled = { ...booking, creditSettled: true, paidAmount: 10000 + 7000 }
    expect(bookingCredit(settled)).toBe(0)
    expect(bookingPaid(settled)).toBe(22000)  // 17000 + 5000 advance
    expect(bookingDue(settled)).toBe(2000)    // = bad debt
    expect(creditTotals([settled]).total).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Partial payment scenarios
// ─────────────────────────────────────────────────────────────────────────────
describe('Payment scenario variants', () => {
  it('full payment: totalAmount = paidAmount, no discount → due 0', () => {
    const b = makeBooking({ totalAmount: 15000, paidAmount: 15000 })
    expect(bookingDue(b)).toBe(0)
  })

  it('full payment with advance splitting: 5000 advance + 10000 cash = 15000 full', () => {
    const b = makeBooking({ totalAmount: 15000, paidAmount: 10000, advanceAmount: 5000 })
    expect(bookingDue(b)).toBe(0)
  })

  it('partial payment: 50% advance, no additional payment → half outstanding', () => {
    const b = makeBooking({ totalAmount: 20000, paidAmount: 0, advanceAmount: 10000 })
    expect(bookingDue(b)).toBe(10000)
  })

  it('discount covers partial outstanding: bill 9000, paid 9000 → 0 due', () => {
    const b = makeBooking({ totalAmount: 10000, discount: 1000, paidAmount: 9000 })
    expect(bookingDue(b)).toBe(0)
  })

  it('zero payment with credit for full balance: credit = 15000, settled=false', () => {
    const b = makeBooking({ totalAmount: 15000, paidAmount: 0, creditAmount: 15000, creditSettled: false })
    expect(bookingCredit(b)).toBe(15000)
    expect(bookingDue(b)).toBe(15000)  // bookingDue doesn't know about credit (separate tracking)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Bad debt and incomplete process scenarios
// ─────────────────────────────────────────────────────────────────────────────
describe('Bad debt scenarios', () => {
  it('bad debt field tracked on booking (bookingDue is unaffected)', () => {
    // Bad debt is informational — it doesn't change the bill or due calculations
    // The decision to write off is a business choice recorded separately
    const b = makeBooking({ totalAmount: 10000, paidAmount: 7000, badDebt: 3000 })
    // bill = 10000, paid = 7000, due = 3000 (same as bad debt amount in this case)
    expect(bookingDue(b)).toBe(3000)
    expect(b.badDebt).toBe(3000)
  })

  it('partial bad debt: some recovered, some written off', () => {
    // 10000 bill, 5000 paid, 3000 bad debt, 2000 credit
    const b = makeBooking({
      totalAmount: 10000,
      paidAmount:  5000,
      badDebt:     3000,
      creditAmount: 2000,
      creditSettled: false,
    })
    expect(bookingDue(b)).toBe(5000)     // 10000 - 5000 = 5000 total outstanding
    expect(b.badDebt).toBe(3000)          // 3000 written off
    expect(bookingCredit(b)).toBe(2000)   // 2000 to collect later
    // The 3000 + 2000 = 5000 matches bookingDue → accounts are balanced
    expect((b.badDebt ?? 0) + bookingCredit(b)).toBe(bookingDue(b))
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Insurance reminder threshold — notification logic (pure calculation)
// ─────────────────────────────────────────────────────────────────────────────
describe('Insurance expiry threshold calculations', () => {
  function daysUntilExpiry(expiryDate: string, today = '2026-06-20'): number {
    const expiry = new Date(expiryDate).getTime()
    const now    = new Date(today).getTime()
    return Math.ceil((expiry - now) / (1000 * 60 * 60 * 24))
  }

  it('insurance expiring in 30 days → within warning window', () => {
    expect(daysUntilExpiry('2026-07-20')).toBe(30)
  })

  it('insurance expiring tomorrow → 1 day remaining', () => {
    expect(daysUntilExpiry('2026-06-21')).toBe(1)
  })

  it('insurance already expired → negative days', () => {
    expect(daysUntilExpiry('2026-06-10')).toBeLessThan(0)
  })

  it('insurance expiring in 60 days → outside 30-day warning window', () => {
    expect(daysUntilExpiry('2026-08-19')).toBeGreaterThan(30)
  })
})
