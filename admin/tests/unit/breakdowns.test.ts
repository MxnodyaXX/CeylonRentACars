/**
 * Store tests — breakdown management
 *
 * These tests verify that the Zustand store correctly propagates financial
 * changes across all related records: bookings, commissions, vehicles, owners.
 *
 * All external I/O (Supabase, SMS, toast) is mocked so the tests run fully
 * in-memory and are deterministic.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── Mock all external side-effects BEFORE importing the store ────────────────
// (vitest hoists vi.mock() calls to the top of the module automatically)

vi.mock('../../src/lib/supabase', () => ({
  supabaseEnabled: false,
  supabase: null,
}))

vi.mock('../../src/lib/db', () => ({
  db: {
    insertBooking:    vi.fn().mockResolvedValue({ error: null }),
    insertCommission: vi.fn().mockResolvedValue({ error: null }),
    insertOwner:      vi.fn().mockResolvedValue({ error: null }),
    insertVehicle:    vi.fn().mockResolvedValue({ error: null }),
    insertNotification: vi.fn().mockResolvedValue({ error: null }),
    insertCustomer:   vi.fn().mockResolvedValue({ error: null }),
    insertInquiry:    vi.fn().mockResolvedValue({ error: null }),
    insertExpense:    vi.fn().mockResolvedValue({ error: null }),
    insertDriver:     vi.fn().mockResolvedValue({ error: null }),
    insertHandover:   vi.fn().mockResolvedValue({ error: null }),
    updateBooking:    vi.fn().mockResolvedValue({ error: null }),
    updateCommission: vi.fn().mockResolvedValue({ error: null }),
    updateOwner:      vi.fn().mockResolvedValue({ error: null }),
    updateVehicle:    vi.fn().mockResolvedValue({ error: null }),
    updateNotification: vi.fn().mockResolvedValue({ error: null }),
    updateCustomer:   vi.fn().mockResolvedValue({ error: null }),
    updateInquiry:    vi.fn().mockResolvedValue({ error: null }),
    updateDriver:     vi.fn().mockResolvedValue({ error: null }),
    deleteExpense:    vi.fn().mockResolvedValue({ error: null }),
    deleteCustomer:   vi.fn().mockResolvedValue({ error: null }),
  },
  dbFetchAll: vi.fn().mockResolvedValue({
    vehicles: [], owners: [], bookings: [], commissions: [],
    expenses: [], inquiries: [], drivers: [], notifications: [],
    handovers: [], customers: [],
  }),
}))

vi.mock('../../src/lib/sms', () => ({
  sendSms:      vi.fn(),
  smsTemplates: {
    bookingConfirmation: vi.fn().mockReturnValue(''),
    ownerVehicleBooked:  vi.fn().mockReturnValue(''),
    referralConverted:   vi.fn().mockReturnValue(''),
    adminNewBooking:     vi.fn().mockReturnValue(''),
    paymentReceived:     vi.fn().mockReturnValue(''),
    referralReceived:    vi.fn().mockReturnValue(''),
    ownerExpenseLogged:  vi.fn().mockReturnValue(''),
    adminNewInquiry:     vi.fn().mockReturnValue(''),
  },
  ADMIN_PHONE: null,
}))

vi.mock('../../src/store/useToast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))

// Mock sampleData so the PNG image import inside it doesn't cause issues
vi.mock('../../src/data/sampleData', () => ({
  sampleData: {
    vehicles: [], owners: [], bookings: [], inquiries: [],
    commissions: [], expenses: [], drivers: [], notifications: [],
  },
}))

// ── Now import the store (after all mocks are declared) ──────────────────────
import { useStore } from '../../src/store/useStore'
import type { Owner, Vehicle, Booking, Commission } from '../../src/types'

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const EMPTY_STATE = {
  vehicles:      [] as Vehicle[],
  owners:        [] as Owner[],
  bookings:      [] as Booking[],
  commissions:   [] as Commission[],
  expenses:      [],
  inquiries:     [],
  drivers:       [],
  notifications: [],
  handovers:     [],
  customers:     [],
  drafts:        [],
  loaded:        true,
}

function makeOwner(overrides: Partial<Owner> = {}): Owner {
  return {
    id: 'o1', name: 'Test Owner', phone: '0771000001', email: 'owner@test.com',
    commissionRate: 0, totalEarnings: 0, pendingPayout: 0, createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function makeVehicle(overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id: 'v1', vehicleNumber: 'WP-TEST-01', brand: 'Toyota', model: 'Prius', year: 2022,
    ownerId: 'o1', dailyRent: 5000, status: 'Available', revenue: 0, rentCount: 0,
    insurance: { provider: 'AIA', policyNumber: 'P001', expiryDate: '2027-01-01', premium: 12000 },
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function makeBookingInput(overrides: Partial<Booking> = {}): Omit<Booking, 'id' | 'createdAt'> {
  return {
    vehicleId: 'v1', customerId: 'c1', customerName: 'Test Customer',
    customerPhone: '0770000001',
    startDate: '2026-07-01', endDate: '2026-07-05', totalDays: 5,
    totalAmount: 25000, paidAmount: 0, status: 'Confirmed',
    referral: 'Direct',
    ...overrides,
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// Breakdown management — store + ledger (offline demo mode: everything in memory)
// ─────────────────────────────────────────────────────────────────────────────
import { useBreakdownStore, newKey } from '../../src/store/useBreakdownStore'
import { ledgerFor, expenseStatus, terminationProposal, dashboard } from '../../src/lib/breakdownLedger'
import { legsOf } from '../../src/lib/exchange'

const bd = () => useBreakdownStore.getState()
const main = () => useStore.getState()
const BD_EMPTY = { incidents: [], events: [], solutions: [], expenses: [], allocations: [], payments: [], documents: [] }
const iso = (d: string) => new Date(d).toISOString()

function world(over: Partial<Booking> = {}) {
  useStore.setState(EMPTY_STATE)
  useBreakdownStore.setState({ ...BD_EMPTY, ready: true, missing: false })
  useStore.setState({
    owners: [makeOwner({ id: 'oA', name: 'Owner A' }), makeOwner({ id: 'oB', name: 'Owner B' })],
    vehicles: [
      makeVehicle({ id: 'vA', ownerId: 'oA', vehicleNumber: 'CBU-0745', dailyRent: 12000, status: 'Ongoing' }),
      makeVehicle({ id: 'vB', ownerId: 'oB', vehicleNumber: 'CBB-2222', dailyRent: 15000 }),
      makeVehicle({ id: 'vC', ownerId: 'oB', vehicleNumber: 'CCC-3333', dailyRent: 9000 }),
    ],
  })
  const id = main().addBooking(makeBookingInput({
    vehicleId: 'vA', startDate: '2026-07-01', endDate: '2026-07-07', totalDays: 7, totalAmount: 84000, status: 'Ongoing',
    paidAmount: 84000, startTime: '09:00', endTime: '09:00',
    checklists: { pickup: { at: iso('2026-07-01T09:00:00'), by: 'Staff', odometer: 10000, fuel: 'Full', items: {} } },
    ...over,
  }))
  useStore.setState((s) => ({ vehicles: s.vehicles.map((v) => (v.id === 'vA' ? { ...v, status: 'Ongoing' as const } : v)) }))
  return id
}
const report = (bookingId: string, over = {}) => {
  const r = bd().report({ bookingId, reportedBy: 'customer', category: 'mechanical', description: 'Engine stopped near Kandy', driveable: 'no', passengersSafe: 'safe', urgency: 'high', location: 'Kandy', by: 'Admin', ...over })
  expect(r.error).toBeUndefined()
  return r.incident!
}
const exp = (incidentId: string, unitCost: number, over = {}) =>
  bd().addExpense({ incidentId, category: 'labour', description: 'Labour', quantity: 1, unitCost, vendor: 'Kandy Motors', by: 'Admin', ...over })
const L = (incidentId: string) => ledgerFor(incidentId, bd())

describe('breakdowns — reporting', () => {
  it('a booking can have several incidents, each with its own ref and timeline', () => {
    const b = world()
    const a = report(b), c = report(b, { category: 'tyre', description: 'Flat tyre' })
    expect(bd().incidents.filter((i) => i.bookingId === b)).toHaveLength(2)
    expect(a.ref).not.toBe(c.ref)
    expect(a).toMatchObject({ vehicleId: 'vA', ownerId: 'oA', causeStatus: 'pending', status: 'open' })
    expect(bd().events.filter((e) => e.incidentId === a.id && e.type === 'created')).toHaveLength(1)
    expect(main().notifications.some((n) => n.title.includes(a.ref))).toBe(true)
    expect(main().bookings.find((x) => x.id === b)!.activity?.some((x) => x.text.includes(a.ref))).toBe(true)
  })
  it('needs a real booking and a description', () => {
    world()
    expect(bd().report({ bookingId: 'nope', reportedBy: 'admin', category: 'other', description: 'x', driveable: 'unknown', passengersSafe: 'unknown', urgency: 'low', by: 'A' }).error).toBeTruthy()
  })
})

describe('breakdowns — on-site repair', () => {
  it('successful repair needs the technician clearance and customer confirmation before completing', () => {
    const b = world(); const i = report(b)
    const s = bd().addSolution(i.id, 'onsite_repair', 'Admin').solution!
    bd().updateSolution(s.id, { providerName: 'Nimal (AutoFix)', providerPhone: '0771', arriveAt: iso('2026-07-03T11:00:00') }, 'Admin', 'technician assigned')
    expect(bd().incidents[0].assignedTo).toBe('Nimal (AutoFix)')
    expect(bd().setSolutionStatus(s.id, 'completed', 'Admin', { repairResult: 'repaired' })).toMatch(/clearance/)
    expect(bd().setSolutionStatus(s.id, 'completed', 'Admin', { repairResult: 'repaired', clearanceAt: iso('2026-07-03T12:00:00'), clearanceBy: 'Nimal', customerConfirmedAt: iso('2026-07-03T12:05:00'), customerConfirmedBy: 'Customer' })).toBeNull()
    expect(bd().solutions[0].status).toBe('completed')
  })

  it('a failed repair keeps its records and a replacement follows; both cars split the owner payout', () => {
    const b = world(); const i = report(b)
    const r = bd().addSolution(i.id, 'onsite_repair', 'Admin').solution!
    exp(i.id, 3000, { solutionId: r.id, category: 'callout', description: 'Call-out' })
    expect(bd().setSolutionStatus(r.id, 'failed', 'Admin', { repairResult: 'needs_tow_or_replacement' })).toBeNull()
    const rep = bd().addSolution(i.id, 'replacement', 'Admin').solution!
    expect(bd().linkLatestExchange(rep.id, 'Admin')).toMatch(/No vehicle exchange/)   // nothing exchanged yet
    expect(main().exchangeVehicle(b, {
      at: iso('2026-07-05T09:00:00'), by: 'Admin', toVehicleId: 'vB', fromDays: 4, reason: 'Breakdown',
      returned: { odometer: 10800, fuel: '1/2' }, delivered: { odometer: 5000, fuel: 'Full' }, oldCarTo: 'Maintenance',
    })).toBeNull()
    expect(bd().linkLatestExchange(rep.id, 'Admin')).toBeNull()
    const sol = bd().solutions.find((x) => x.id === rep.id)!
    expect(sol).toMatchObject({ fromVehicleId: 'vA', toVehicleId: 'vB', rateScenario: 'higher', rateDifference: 3000, status: 'in_progress' })
    expect(bd().solutions.find((x) => x.id === r.id)!.status).toBe('failed')
    expect(bd().expenses).toHaveLength(1)
    expect(legsOf(main().bookings.find((x) => x.id === b)!).map((l) => [l.vehicleId, l.days])).toEqual([['vA', 4], ['vB', 3]])
    expect(bd().setSolutionStatus(rep.id, 'completed', 'Admin')).toBeNull()
  })
})

describe('breakdowns — replacement price differences', () => {
  it('a dearer replacement: nothing is charged until the customer approves; then it is a booking charge (price unchanged)', () => {
    const b = world(); const i = report(b)
    const rep = bd().addSolution(i.id, 'replacement', 'Admin').solution!
    const before = main().bookings.find((x) => x.id === b)!
    expect(before.charges ?? []).toHaveLength(0)
    expect(bd().applyPriceDifference(rep.id, 9000, 'Admin')).toBeNull()
    const after = main().bookings.find((x) => x.id === b)!
    expect(after.totalAmount).toBe(84000)
    expect(after.charges?.find((c) => c.amount === 9000)?.note).toMatch(/customer approved/)
    expect(bd().applyPriceDifference(rep.id, 9000, 'Admin')).toMatch(/already applied/)   // not twice
  })
  it('a cheaper replacement: a credit (discount) on the booking', () => {
    const b = world(); const i = report(b)
    const rep = bd().addSolution(i.id, 'replacement', 'Admin').solution!
    expect(bd().applyPriceDifference(rep.id, -6000, 'Admin')).toBeNull()
    expect(main().bookings.find((x) => x.id === b)!.discount).toBe(6000)
  })
})

describe('breakdowns — partner vehicle', () => {
  it('partner cost is separate; the original owner earns less for the days the partner covered', () => {
    const b = world(); const i = report(b)
    const p = bd().addSolution(i.id, 'partner_vehicle', 'Admin').solution!
    bd().updateSolution(p.id, { providerName: 'Lanka Wheels', partnerVehicle: 'Toyota Axio', partnerReg: 'CAX-1111', agreedAmount: 30000 }, 'Admin', 'partner arranged')
    exp(i.id, 30000, { solutionId: p.id, category: 'partner', description: 'Partner vehicle 3 days', vendor: 'Lanka Wheels' })
    expect(bd().applyOwnerShareAdjustment(p.id, 36000, 'Admin')).toBeNull()
    const bk = main().bookings.find((x) => x.id === b)!
    expect(legsOf(bk)[0].payout).toBe(84000 - 36000)
    expect(main().commissions.find((c) => c.bookingId === b)!.ownerPayout).toBe(48000)
    expect(bk.totalAmount).toBe(84000)                     // customer price not touched
    expect(L(i.id).cost).toBe(30000)
    expect(bd().applyOwnerShareAdjustment(p.id, 1000, 'Admin')).toMatch(/already adjusted/)
  })
})

describe('breakdowns — money ledger', () => {
  it('split cost: owner 10,000 + company 5,000; company pays, owner reimburses — nothing counted twice', () => {
    const b = world(); const i = report(b)
    exp(i.id, 15000, { category: 'garage', description: 'Garage repair' })
    expect(L(i.id).pendingInvestigation).toBe(true)
    expect(bd().decideResponsibility(i.id, [{ party: 'owner', mode: 'amount', value: 10000 }, { party: 'company', mode: 'amount', value: 5000 }], 'Owner contract: wear and tear', 'Admin')).toBeNull()
    const e = bd().expenses[0]
    expect(bd().postPayment({ incidentId: i.id, expenseId: e.id, kind: 'vendor_payment', payer: 'company', payee: 'Kandy Motors', amount: 15000, method: 'Bank transfer', key: 'k1', by: 'Admin' })).toBeNull()
    let l = L(i.id)
    expect(l).toMatchObject({ cost: 15000, vendorUnpaid: 0, companyNet: 15000 })
    expect(l.outstanding.owner).toBe(10000)
    expect(l.settled).toBe(false)
    bd().postPayment({ incidentId: i.id, kind: 'reimbursement', payer: 'owner', payee: 'company', amount: 10000, method: 'Cash', key: 'k2', by: 'Admin' })
    l = L(i.id)
    expect(l.outstanding.owner).toBe(0)
    expect(l.companyNet).toBe(5000)
    expect(l.cost).toBe(15000)
    expect(l.settled).toBe(true)
  })

  it('partial payments: expense shows partly paid and the rest stays outstanding', () => {
    const b = world(); const i = report(b)
    exp(i.id, 8000, { category: 'towing', description: 'Tow' })
    const e = bd().expenses[0]
    bd().postPayment({ incidentId: i.id, expenseId: e.id, kind: 'vendor_payment', payer: 'company', payee: 'Tow Co', amount: 3000, key: 'p1', by: 'A' })
    expect(expenseStatus(e, bd().payments)).toBe('partly_paid')
    expect(L(i.id).vendorUnpaid).toBe(5000)
    expect(bd().postPayment({ incidentId: i.id, expenseId: e.id, kind: 'vendor_payment', payer: 'company', payee: 'Tow Co', amount: 6000, key: 'p2', by: 'A' })).toMatch(/Only Rs 5,000 is left/)
    bd().postPayment({ incidentId: i.id, expenseId: e.id, kind: 'vendor_payment', payer: 'company', payee: 'Tow Co', amount: 5000, key: 'p3', by: 'A' })
    expect(expenseStatus(e, bd().payments)).toBe('paid')
  })

  it('the same payment form cannot post twice (one-time key)', () => {
    const b = world(); const i = report(b)
    exp(i.id, 5000)
    const e = bd().expenses[0]
    const key = newKey()
    bd().postPayment({ incidentId: i.id, expenseId: e.id, kind: 'vendor_payment', payer: 'company', payee: 'X', amount: 5000, key, by: 'A' })
    bd().postPayment({ incidentId: i.id, expenseId: e.id, kind: 'vendor_payment', payer: 'company', payee: 'X', amount: 5000, key, by: 'A' })
    expect(bd().payments).toHaveLength(1)
  })

  it('customer share goes to the booking bill once; reversing waives the charge', () => {
    const b = world(); const i = report(b)
    exp(i.id, 20000, { category: 'parts', description: 'Bumper' })
    bd().decideResponsibility(i.id, [{ party: 'customer', mode: 'percent', value: 100 }], 'Customer caused the accident (photos)', 'Admin')
    const key = newKey()
    expect(bd().chargeCustomerShare(i.id, 'Admin', key)).toBeNull()
    expect(bd().chargeCustomerShare(i.id, 'Admin', key)).toBeNull()                       // same click again
    expect(bd().chargeCustomerShare(i.id, 'Admin', newKey())).toMatch(/Nothing is outstanding/)  // new click, already charged
    const bk = main().bookings.find((x) => x.id === b)!
    expect(bk.charges?.filter((c) => c.status === 'Charged')).toHaveLength(1)
    expect(bk.extraCharges).toBe(20000)
    expect(L(i.id).outstanding.customer).toBe(0)
    const pay = bd().payments.find((p) => p.kind === 'customer_charge')!
    expect(bd().reversePayment(pay.id, 'Insurance will cover it', 'Admin')).toBeNull()
    expect(main().bookings.find((x) => x.id === b)!.charges?.[0].status).toBe('Waived')
    expect(L(i.id).outstanding.customer).toBe(20000)
  })

  it('owner share deducted from their payout survives a later booking edit, and can be reversed', () => {
    const b = world(); const i = report(b)
    exp(i.id, 10000)
    bd().decideResponsibility(i.id, [{ party: 'owner', mode: 'percent', value: 100 }], 'Owner maintenance failure', 'Admin')
    expect(bd().offsetOwnerShare(i.id, 10000, 'Admin', newKey())).toBeNull()
    expect(main().commissions.find((c) => c.bookingId === b)!.ownerPayout).toBe(74000)
    main().editBooking(b, { endDate: '2026-07-08', totalDays: 8, totalAmount: 96000 }, { by: 'A', changes: ['Extended'] })
    expect(main().commissions.find((c) => c.bookingId === b)!.ownerPayout).toBe(86000)   // 96,000 − 10,000: still deducted
    expect(L(i.id).outstanding.owner).toBe(0)
    const pay = bd().payments.find((p) => p.kind === 'owner_offset')!
    bd().reversePayment(pay.id, 'Wrong decision', 'Admin')
    expect(main().commissions.find((c) => c.bookingId === b)!.ownerPayout).toBe(96000)
    expect(L(i.id).outstanding.owner).toBe(10000)
  })

  it('can’t deduct more than the owner owes', () => {
    const b = world(); const i = report(b)
    exp(i.id, 5000)
    bd().decideResponsibility(i.id, [{ party: 'owner', mode: 'amount', value: 5000 }], 'x', 'A')
    expect(bd().offsetOwnerShare(i.id, 9000, 'A', newKey())).toMatch(/owes/)
  })

  it('responsibility checks: no more than the cost, reason required, each party once', () => {
    const b = world(); const i = report(b)
    exp(i.id, 10000)
    expect(bd().decideResponsibility(i.id, [{ party: 'owner', mode: 'amount', value: 12000 }], 'x', 'A')).toMatch(/more than the cost/)
    expect(bd().decideResponsibility(i.id, [{ party: 'owner', mode: 'percent', value: 50 }], '', 'A')).toMatch(/reason/)
    expect(bd().decideResponsibility(i.id, [{ party: 'owner', mode: 'percent', value: 50 }, { party: 'owner', mode: 'percent', value: 50 }], 'x', 'A')).toMatch(/once/)
    expect(bd().decideResponsibility(i.id, [{ party: 'owner', mode: 'percent', value: 50 }, { party: 'insurance', mode: 'percent', value: 50 }], 'Policy covers 50%', 'A')).toBeNull()
    expect(bd().decideResponsibility(i.id, [{ party: 'company', mode: 'percent', value: 100 }], 'Insurance refused', 'A')).toBeNull()
    expect(bd().allocations.filter((a) => a.incidentId === i.id)).toHaveLength(3)       // history kept
    expect(bd().allocations.filter((a) => a.incidentId === i.id && !a.supersededAt).map((a) => a.party)).toEqual(['company'])
  })

  it('a removed expense keeps its record (void, never deleted); paid ones must be reversed first', () => {
    const b = world(); const i = report(b)
    exp(i.id, 4000)
    const e = bd().expenses[0]
    bd().postPayment({ incidentId: i.id, expenseId: e.id, kind: 'vendor_payment', payer: 'company', payee: 'X', amount: 4000, key: 'v1', by: 'A' })
    expect(bd().voidExpense(e.id, 'Entered twice', 'A')).toMatch(/Reverse the payments/)
    bd().reversePayment(bd().payments[0].id, 'Wrong', 'A')
    expect(bd().voidExpense(e.id, 'Entered twice', 'A')).toBeNull()
    expect(bd().expenses).toHaveLength(1)
    expect(L(i.id).cost).toBe(0)
  })
})

describe('breakdowns — termination & refund', () => {
  it('proposes a pro-rata refund, needs approval, shortens the booking (audited) and records the refund', () => {
    const b = world(); const i = report(b)
    const t = bd().addSolution(i.id, 'termination', 'Admin').solution!
    expect(bd().proposeTermination(t.id, { terminateAt: iso('2026-07-04T09:00:00'), reason: 'Car beyond repair, customer flying home' }, 'Admin')).toBeNull()
    let s = bd().solutions.find((x) => x.id === t.id)!
    expect(s).toMatchObject({ usedDays: 3, unusedDays: 4, refundProposed: 84000 - 36000, refundStatus: 'pending_approval' })
    expect(bd().payRefund(t.id, { method: 'Bank transfer', key: newKey() }, 'Admin')).toMatch(/Approve/)          // no refund without approval
    expect(bd().approveRefund(t.id, 46000, 'Admin')).toBeNull()                                                  // approved a bit less
    expect(bd().payRefund(t.id, { method: 'Bank transfer', key: newKey() }, 'Admin')).toMatch(/Shorten the booking/)
    expect(bd().amendBookingForTermination(t.id, 'Admin')).toBeNull()
    const bk = main().bookings.find((x) => x.id === b)!
    expect(bk).toMatchObject({ totalDays: 3, totalAmount: 36000, endDate: '2026-07-04', status: 'Ongoing' })
    expect(bk.notes).toMatch(/84,000 → Rs 36,000/)
    const key = newKey()
    expect(bd().payRefund(t.id, { method: 'Bank transfer', reference: 'TRX-9', key }, 'Admin')).toBeNull()
    expect(bd().payRefund(t.id, { method: 'Bank transfer', reference: 'TRX-9', key }, 'Admin')).toBeNull()     // double click
    expect(main().bookings.find((x) => x.id === b)!.paidAmount).toBe(84000 - 46000)
    expect(main().bookings.find((x) => x.id === b)!.payments?.filter((p) => p.kind === 'Refund')).toHaveLength(1)
    s = bd().solutions.find((x) => x.id === t.id)!
    expect(s.refundStatus).toBe('paid')
    expect(L(i.id).refundsPaid).toBe(46000)
  })

  it('can’t resolve or complete while the vehicle is still not recovered; recovery completes the booking', () => {
    const b = world(); const i = report(b)
    const t = bd().addSolution(i.id, 'termination', 'Admin').solution!
    bd().proposeTermination(t.id, { terminateAt: iso('2026-07-04T09:00:00'), reason: 'x' }, 'A')
    bd().approveRefund(t.id, 48000, 'A'); bd().amendBookingForTermination(t.id, 'A'); bd().payRefund(t.id, { method: 'Cash', key: newKey() }, 'A')
    expect(bd().setSolutionStatus(t.id, 'completed', 'A')).toMatch(/not been recovered/)
    expect(bd().resolve(i.id, 'Terminated', 'A')).toMatch(/Complete at least one|not been recovered/)
    bd().setRecovery(t.id, 'recovered', 'A')
    expect(main().bookings.find((x) => x.id === b)!.status).toBe('Completed')
    expect(bd().setSolutionStatus(t.id, 'completed', 'A')).toBeNull()
    expect(bd().resolve(i.id, 'Booking ended early and refunded', 'A')).toBeNull()
  })

  it('terminationProposal: used days follow the 24h rule, at least one day', () => {
    const b = world()
    const bk = main().bookings.find((x) => x.id === b)!
    expect(terminationProposal(bk, iso('2026-07-01T15:00:00')).usedDays).toBe(1)
    expect(terminationProposal(bk, iso('2026-07-03T10:00:00')).usedDays).toBe(3)
  })
})

describe('breakdowns — resolving & closing', () => {
  it('cannot close while money is outstanding; closes once settled', () => {
    const b = world(); const i = report(b)
    const s = bd().addSolution(i.id, 'towing_garage', 'Admin').solution!
    bd().updateSolution(s.id, { quoteAmount: 25000 }, 'A')
    expect(bd().approveQuote(s.id, 'A')).toBeNull()
    expect(bd().setSolutionStatus(s.id, 'completed', 'A')).toMatch(/roadworthy/)
    bd().confirmRoadworthy(s.id, 'A')
    expect(main().vehicles.find((v) => v.id === 'vA')!.status).toBe('Maintenance')   // roadworthy ≠ ready
    bd().setSolutionStatus(s.id, 'completed', 'A')
    exp(i.id, 25000, { solutionId: s.id, category: 'garage', description: 'Garage invoice' })
    expect(bd().close(i.id, 'A')).toMatch(/Resolve the incident first/)
    expect(bd().resolve(i.id, 'Repaired at garage', 'A')).toBeNull()
    const err = bd().close(i.id, 'A')
    expect(err).toMatch(/not yet paid to providers/)
    expect(err).toMatch(/Responsibility not decided/)
    expect(main().notifications.some((n) => n.title.includes('payments outstanding'))).toBe(true)
    bd().decideResponsibility(i.id, [{ party: 'company', mode: 'percent', value: 100 }], 'Goodwill', 'A')
    bd().postPayment({ incidentId: i.id, expenseId: bd().expenses[0].id, kind: 'vendor_payment', payer: 'company', payee: 'Garage', amount: 25000, key: 'z', by: 'A' })
    expect(bd().close(i.id, 'A')).toBeNull()
    expect(bd().incidents[0].status).toBe('closed')
    expect(bd().addExpense({ incidentId: i.id, category: 'other', description: 'late', quantity: 1, unitCost: 1, by: 'A' })).toMatch(/closed/)
  })

  it('dashboard counts', () => {
    const b = world()
    const a = report(b, { urgency: 'emergency' })
    const c = report(b)
    const r = bd().addSolution(c.id, 'onsite_repair', 'A').solution!
    bd().addSolution(c.id, 'replacement', 'A')
    exp(c.id, 7000)
    bd().decideResponsibility(c.id, [{ party: 'owner', mode: 'percent', value: 100 }], 'x', 'A')
    const d = dashboard(bd())
    expect(d).toMatchObject({ total: 2, active: 2, emergency: 1, awaitingTechnician: 1, awaitingReplacement: 1, cost: 7000, ownerOutstanding: 7000 })
    bd().updateSolution(r.id, { arriveAt: iso('2026-07-03T10:00:00') }, 'A')
    expect(dashboard(bd()).underRepair).toBe(1)
    expect(a.id).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Maintenance holds — UNDER_MAINTENANCE until an admin confirms the vehicle ready
// ─────────────────────────────────────────────────────────────────────────────
import { financeStatus, vehicleHistory } from '../../src/lib/breakdownLedger'
import { phaseOf } from '../../src/lib/breakdowns'

const vStatus = (id: string) => main().vehicles.find((v) => v.id === id)!.status
const readyX = (o = {}) => ({ outcome: 'Radiator replaced — road-tested', safe: true, by: 'Admin', isAdmin: true, ...o })

describe('breakdowns — maintenance hold', () => {
  it('reporting puts the vehicle under maintenance and blocks new bookings (its own booking continues)', () => {
    const b = world(); const i = report(b)
    expect(i.holdVehicleId).toBe('vA')
    expect(vStatus('vA')).toBe('Maintenance')
    expect(main().isVehicleAvailable('vA', '2026-08-01', '2026-08-03')).toBe(false)
    expect(main().isVehicleAvailable('vA', '2026-07-01', '2026-07-07', b)).toBe(true)
    expect(main().bookings.find((x) => x.id === b)!.status).toBe('Ongoing')
    expect(bd().events.some((e) => e.incidentId === i.id && e.type === 'hold')).toBe(true)
  })

  it('completing a repair, a garage repair or resolving does not make the vehicle ready', () => {
    const b = world(); const i = report(b)
    const r = bd().addSolution(i.id, 'onsite_repair', 'A').solution!
    bd().setSolutionStatus(r.id, 'completed', 'A', { repairResult: 'repaired', clearanceAt: iso('2026-07-03T12:00:00'), clearanceBy: 'Tech', customerConfirmedAt: iso('2026-07-03T12:05:00'), customerConfirmedBy: 'C' })
    expect(vStatus('vA')).toBe('Maintenance')
    const t = bd().addSolution(i.id, 'towing_garage', 'A').solution!
    bd().confirmRoadworthy(t.id, 'A')
    expect(vStatus('vA')).toBe('Maintenance')
    bd().setSolutionStatus(t.id, 'completed', 'A')
    expect(bd().resolve(i.id, 'Fixed', 'A')).toBeNull()
    expect(vStatus('vA')).toBe('Maintenance')
  })

  it('an exchange keeps the broken car under maintenance even if "Available" was chosen', () => {
    const b = world(); report(b)
    main().exchangeVehicle(b, { at: iso('2026-07-04T09:00:00'), by: 'A', toVehicleId: 'vB', fromDays: 3, reason: 'Breakdown',
      returned: { odometer: 10500, fuel: '1/2' }, delivered: { odometer: 100, fuel: 'Full' }, oldCarTo: 'Available' })
    expect(vStatus('vA')).toBe('Maintenance')
    expect(vStatus('vB')).toBe('Ongoing')
  })

  it('a rental cannot start on a held car; cancelling keeps it under maintenance', () => {
    const b = world({ status: 'Confirmed' }); report(b)
    main().startBooking(b)
    expect(main().bookings.find((x) => x.id === b)!.status).toBe('Confirmed')
    main().recordHandover(b, 'pickup', { at: iso('2026-07-01T09:00:00'), by: 'A', odometer: 10000, fuel: 'Full', items: {} })
    expect(main().bookings.find((x) => x.id === b)!.status).toBe('Confirmed')
    main().cancelBooking(b, { reason: 'Vehicle broke down', by: 'A' })
    expect(vStatus('vA')).toBe('Maintenance')
  })

  it('Mark vehicle as ready: admin only, needs the outcome and the safety confirmation', async () => {
    const b = world(); const i = report(b)
    expect(await bd().markVehicleReady(i.id, readyX({ isAdmin: false }))).toMatch(/Only an admin/)
    expect(await bd().markVehicleReady(i.id, readyX({ safe: false }))).toMatch(/safe for rental/)
    expect(await bd().markVehicleReady(i.id, readyX({ outcome: ' ' }))).toMatch(/outcome/)
    expect(await bd().markVehicleReady(i.id, readyX({ approvedAt: new Date(Date.now() + 864e5).toISOString() }))).toMatch(/future/)
    expect(vStatus('vA')).toBe('Maintenance')
    expect(await bd().markVehicleReady(i.id, readyX({ comments: 'Garage invoice in documents' }))).toBeNull()
    const inc = bd().incidents.find((x) => x.id === i.id)!
    expect(inc).toMatchObject({ holdClearedBy: 'Admin', readySafeConfirmed: true, readyOutcome: 'Radiator replaced — road-tested', readyComments: 'Garage invoice in documents' })
    expect(vStatus('vA')).toBe('Ongoing')
    expect(bd().events.some((e) => e.incidentId === i.id && e.type === 'ready')).toBe(true)
    expect(await bd().markVehicleReady(i.id, readyX())).toMatch(/no active maintenance hold/)
  })

  it('ready with no bookings on it → Available (e.g. after an exchange)', async () => {
    const b = world(); const i = report(b)
    main().exchangeVehicle(b, { at: iso('2026-07-04T09:00:00'), by: 'A', toVehicleId: 'vB', fromDays: 3, reason: 'Breakdown',
      returned: { odometer: 10500, fuel: '1/2' }, delivered: { odometer: 100, fuel: 'Full' }, oldCarTo: 'Maintenance' })
    expect(await bd().markVehicleReady(i.id, readyX())).toBeNull()
    expect(vStatus('vA')).toBe('Available')
    expect(main().isVehicleAvailable('vA', '2026-08-01', '2026-08-03')).toBe(true)
  })

  it('a second breakdown while held links to the same hold; after ready a new breakdown places a new hold', async () => {
    const b = world(); const first = report(b)
    const second = report(b, { category: 'tyre', description: 'Flat tyre while waiting' })
    expect(second.holdVehicleId).toBeUndefined()
    expect(bd().activeHold('vA')!.id).toBe(first.id)
    expect(await bd().markVehicleReady(second.id, readyX())).toMatch(/no active maintenance hold/)
    expect(await bd().markVehicleReady(first.id, readyX())).toBeNull()
    const third = report(b, { category: 'battery', description: 'Battery dead' })
    expect(third.holdVehicleId).toBe('vA')
    expect(vStatus('vA')).toBe('Maintenance')
    expect(bd().incidents.filter((x) => x.vehicleId === 'vA')).toHaveLength(3)
    expect(bd().incidents.find((x) => x.id === first.id)!.holdClearedAt).toBeTruthy()
    expect(vehicleHistory('vA', bd().incidents).repeat).toBe(true)
    expect(main().notifications.some((n) => n.title.includes('Repeated breakdowns'))).toBe(true)
    expect(bd().events.some((e) => e.incidentId === third.id && /earlier breakdown/.test(e.text))).toBe(true)
  })
})

describe('breakdowns — status concepts', () => {
  it('incident: open → in progress; money: pending → partial → settled', () => {
    const b = world(); const i = report(b)
    expect(phaseOf(bd().incidents[0], bd().solutions)).toBe('open')
    bd().addSolution(i.id, 'alt_transport', 'A')
    expect(phaseOf(bd().incidents[0], bd().solutions)).toBe('in_progress')
    exp(i.id, 6000, { category: 'alt_transport', description: 'Taxi' })
    bd().decideResponsibility(i.id, [{ party: 'company', mode: 'percent', value: 100 }], 'Goodwill', 'A')
    expect(financeStatus(L(i.id))).toBe('pending')
    bd().postPayment({ incidentId: i.id, expenseId: bd().expenses[0].id, kind: 'vendor_payment', payer: 'company', payee: 'Taxi', amount: 2000, key: 'f1', by: 'A' })
    expect(financeStatus(L(i.id))).toBe('partial')
    bd().postPayment({ incidentId: i.id, expenseId: bd().expenses[0].id, kind: 'vendor_payment', payer: 'company', payee: 'Taxi', amount: 4000, key: 'f2', by: 'A' })
    expect(financeStatus(L(i.id))).toBe('settled')
  })
})
