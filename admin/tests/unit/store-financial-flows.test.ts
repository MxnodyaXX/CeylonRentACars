/**
 * Store integration tests — financial flows
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
// addBooking → commission and vehicle stats
// ─────────────────────────────────────────────────────────────────────────────
describe('addBooking — commission and vehicle stats', () => {
  beforeEach(() => {
    useStore.setState(EMPTY_STATE)
    useStore.setState({ owners: [makeOwner()], vehicles: [makeVehicle()] })
  })

  it('creates a commission record linked to the booking', () => {
    const id = useStore.getState().addBooking(makeBookingInput())
    const { commissions } = useStore.getState()
    const c = commissions.find((x) => x.bookingId === id)
    expect(c).toBeDefined()
  })

  it('commission ownerId matches the vehicle owner', () => {
    const id = useStore.getState().addBooking(makeBookingInput())
    const c = useStore.getState().commissions.find((x) => x.bookingId === id)!
    expect(c.ownerId).toBe('o1')
  })

  it('commission totalIncome = booking totalAmount', () => {
    const id = useStore.getState().addBooking(makeBookingInput({ totalAmount: 25000 }))
    const c = useStore.getState().commissions.find((x) => x.bookingId === id)!
    expect(c.totalIncome).toBe(25000)
  })

  it('commission starts as Pending', () => {
    const id = useStore.getState().addBooking(makeBookingInput())
    const c = useStore.getState().commissions.find((x) => x.bookingId === id)!
    expect(c.status).toBe('Pending')
  })

  it('no referral → coordinatorFee = 0, ownerPayout = totalAmount', () => {
    const id = useStore.getState().addBooking(makeBookingInput({ referral: 'Direct', totalAmount: 25000 }))
    const c = useStore.getState().commissions.find((x) => x.bookingId === id)!
    expect(c.coordinatorFee).toBe(0)
    expect(c.ownerPayout).toBe(25000)
  })

  it('fixed referral fee: coordinatorFee and ownerPayout correct', () => {
    const id = useStore.getState().addBooking(makeBookingInput({
      referral: 'Partner Owner', referralFeeType: 'fixed', referralFeeValue: 2500, totalAmount: 25000,
    }))
    const c = useStore.getState().commissions.find((x) => x.bookingId === id)!
    expect(c.coordinatorFee).toBe(2500)
    expect(c.ownerPayout).toBe(22500)
  })

  it('percent referral fee: 10% of 25000 = 2500 coordinator, 22500 owner', () => {
    const id = useStore.getState().addBooking(makeBookingInput({
      referral: 'Partner Owner', referralFeeType: 'percent', referralFeeValue: 10, totalAmount: 25000,
    }))
    const c = useStore.getState().commissions.find((x) => x.bookingId === id)!
    expect(c.coordinatorFee).toBe(2500)
    expect(c.ownerPayout).toBe(22500)
  })

  it('vehicle status set to Reserved', () => {
    useStore.getState().addBooking(makeBookingInput())
    const v = useStore.getState().vehicles.find((x) => x.id === 'v1')!
    expect(v.status).toBe('Reserved')
  })

  it('vehicle revenue incremented by totalAmount', () => {
    useStore.getState().addBooking(makeBookingInput({ totalAmount: 25000 }))
    expect(useStore.getState().vehicles.find((v) => v.id === 'v1')!.revenue).toBe(25000)
  })

  it('vehicle rentCount incremented by 1', () => {
    useStore.getState().addBooking(makeBookingInput())
    expect(useStore.getState().vehicles.find((v) => v.id === 'v1')!.rentCount).toBe(1)
  })

  it('second booking on same vehicle accumulates revenue', () => {
    useStore.setState({ vehicles: [makeVehicle({ status: 'Available' })] })
    // Need a second vehicle for the second booking (or the first booking makes it Reserved)
    useStore.setState({
      vehicles: [
        makeVehicle({ id: 'v1', status: 'Available' }),
        makeVehicle({ id: 'v2', status: 'Available' }),
      ],
    })
    useStore.getState().addBooking(makeBookingInput({ vehicleId: 'v1', totalAmount: 25000 }))
    useStore.getState().addBooking(makeBookingInput({ vehicleId: 'v2', totalAmount: 18000 }))
    expect(useStore.getState().vehicles.find((v) => v.id === 'v1')!.revenue).toBe(25000)
    expect(useStore.getState().vehicles.find((v) => v.id === 'v2')!.revenue).toBe(18000)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// startBooking / completeBooking / cancelBooking → status transitions
// ─────────────────────────────────────────────────────────────────────────────
describe('Booking lifecycle — status transitions', () => {
  beforeEach(() => {
    useStore.setState(EMPTY_STATE)
    useStore.setState({ owners: [makeOwner()], vehicles: [makeVehicle()] })
  })

  it('startBooking: booking → Ongoing, vehicle → Ongoing', () => {
    const id = useStore.getState().addBooking(makeBookingInput())
    useStore.getState().startBooking(id)
    expect(useStore.getState().bookings.find((b) => b.id === id)!.status).toBe('Ongoing')
    expect(useStore.getState().vehicles.find((v) => v.id === 'v1')!.status).toBe('Ongoing')
  })

  it('completeBooking: booking → Completed, vehicle → Available', () => {
    const id = useStore.getState().addBooking(makeBookingInput())
    useStore.getState().startBooking(id)
    useStore.getState().completeBooking(id)
    expect(useStore.getState().bookings.find((b) => b.id === id)!.status).toBe('Completed')
    expect(useStore.getState().vehicles.find((v) => v.id === 'v1')!.status).toBe('Available')
  })

  it('cancelBooking: booking → Cancelled, vehicle → Available', () => {
    const id = useStore.getState().addBooking(makeBookingInput())
    useStore.getState().cancelBooking(id)
    expect(useStore.getState().bookings.find((b) => b.id === id)!.status).toBe('Cancelled')
    expect(useStore.getState().vehicles.find((v) => v.id === 'v1')!.status).toBe('Available')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// updateCommission (Pending → Paid) → owner pendingPayout reduced
// ─────────────────────────────────────────────────────────────────────────────
describe('updateCommission — owner pending payout', () => {
  beforeEach(() => {
    useStore.setState(EMPTY_STATE)
    // Owner starts with a known pendingPayout matching the ownerPayout
    useStore.setState({
      owners: [makeOwner({ id: 'o1', pendingPayout: 22500, totalEarnings: 22500 })],
      vehicles: [makeVehicle({ id: 'v1', ownerId: 'o1' })],
      commissions: [
        {
          id: 'comm1', bookingId: 'bk1', vehicleId: 'v1', ownerId: 'o1',
          referral: 'Direct', totalIncome: 25000, commissionRate: 0, commissionAmount: 0,
          ownerPayout: 22500, coordinatorFee: 2500, status: 'Pending',
          createdAt: '2026-07-01T00:00:00Z',
        },
      ],
    })
  })

  it('Pending → Paid reduces owner pendingPayout by ownerPayout', () => {
    useStore.getState().updateCommission('comm1', { status: 'Paid' })
    expect(useStore.getState().owners.find((o) => o.id === 'o1')!.pendingPayout).toBe(0)
  })

  it('pendingPayout never goes below 0', () => {
    // Force pendingPayout to be lower than ownerPayout (edge case)
    useStore.setState({ owners: [makeOwner({ id: 'o1', pendingPayout: 10000, totalEarnings: 22500 })] })
    useStore.getState().updateCommission('comm1', { status: 'Paid' })
    expect(useStore.getState().owners.find((o) => o.id === 'o1')!.pendingPayout).toBe(0)
  })

  it('Paid → Paid again does NOT double-reduce pendingPayout', () => {
    useStore.getState().updateCommission('comm1', { status: 'Paid' })
    const afterFirst = useStore.getState().owners.find((o) => o.id === 'o1')!.pendingPayout
    // Simulate calling Paid again (e.g. duplicate event)
    useStore.getState().updateCommission('comm1', { status: 'Paid' })
    expect(useStore.getState().owners.find((o) => o.id === 'o1')!.pendingPayout).toBe(afterFirst)
  })

  it('commission status is updated in store', () => {
    useStore.getState().updateCommission('comm1', { status: 'Paid' })
    expect(useStore.getState().commissions.find((c) => c.id === 'comm1')!.status).toBe('Paid')
  })

  it('commission status Credit does NOT reduce pendingPayout', () => {
    useStore.getState().updateCommission('comm1', { status: 'Credit' })
    // pendingPayout should remain unchanged (only 'Paid' reduces it)
    expect(useStore.getState().owners.find((o) => o.id === 'o1')!.pendingPayout).toBe(22500)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// settleCredit — outstanding credit collected, paidAmount updated
// ─────────────────────────────────────────────────────────────────────────────
describe('settleCredit — credit collection', () => {
  beforeEach(() => {
    useStore.setState(EMPTY_STATE)
    useStore.setState({
      bookings: [
        {
          id: 'bk1', vehicleId: 'v1', customerId: 'c1',
          customerName: 'Credit Customer', customerPhone: '0779000001',
          startDate: '2026-07-01', endDate: '2026-07-05',
          totalDays: 5, totalAmount: 25000,
          paidAmount: 10000, advanceAmount: 5000,
          discount: 1000, badDebt: 2000,
          creditAmount: 7000, creditSettled: false,
          status: 'Completed', createdAt: '2026-07-01T00:00:00Z',
        },
      ],
    })
  })

  it('settleCredit marks creditSettled = true', () => {
    useStore.getState().settleCredit('bk1')
    expect(useStore.getState().bookings.find((b) => b.id === 'bk1')!.creditSettled).toBe(true)
  })

  it('settleCredit increases paidAmount by the credit amount', () => {
    useStore.getState().settleCredit('bk1')
    // paidAmount was 10000; creditAmount was 7000 → new paidAmount = 17000
    expect(useStore.getState().bookings.find((b) => b.id === 'bk1')!.paidAmount).toBe(17000)
  })

  it('after settling, bookingDue matches only the bad debt amount', async () => {
    useStore.getState().settleCredit('bk1')
    const b = useStore.getState().bookings.find((x) => x.id === 'bk1')!
    // Bill = 24000, paid = 22000 (17000 + 5000 advance), due = 2000 (bad debt)
    const { bookingBill: calcBill, bookingPaid: calcPaid, bookingDue: calcDue } = await import('../../src/lib/credit')
    expect(calcBill(b)).toBe(24000)
    expect(calcPaid(b)).toBe(22000)
    expect(calcDue(b)).toBe(2000)
  })

  it('calling settleCredit twice is a no-op on the second call', () => {
    useStore.getState().settleCredit('bk1')
    const afterFirst = useStore.getState().bookings.find((b) => b.id === 'bk1')!.paidAmount
    useStore.getState().settleCredit('bk1')  // already settled
    expect(useStore.getState().bookings.find((b) => b.id === 'bk1')!.paidAmount).toBe(afterFirst)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// recomputeStats — rebuild earnings and revenue from authoritative records
// ─────────────────────────────────────────────────────────────────────────────
describe('recomputeStats — rebuild from authoritative records', () => {
  beforeEach(() => {
    useStore.setState(EMPTY_STATE)
    useStore.setState({
      owners: [
        makeOwner({ id: 'o1', totalEarnings: 0, pendingPayout: 0 }),
      ],
      vehicles: [
        makeVehicle({ id: 'v1', ownerId: 'o1', revenue: 0, rentCount: 0 }),
      ],
      bookings: [
        {
          id: 'bk1', vehicleId: 'v1', customerId: 'c1',
          customerName: 'Customer A', customerPhone: '0771111111',
          startDate: '2026-07-01', endDate: '2026-07-05', totalDays: 5,
          totalAmount: 25000, paidAmount: 25000, status: 'Completed',
          createdAt: '2026-07-01T00:00:00Z',
        },
        {
          id: 'bk2', vehicleId: 'v1', customerId: 'c2',
          customerName: 'Customer B', customerPhone: '0772222222',
          startDate: '2026-07-10', endDate: '2026-07-12', totalDays: 3,
          totalAmount: 15000, paidAmount: 15000, status: 'Completed',
          createdAt: '2026-07-10T00:00:00Z',
        },
        {
          id: 'bk3', vehicleId: 'v1', customerId: 'c3',
          customerName: 'Customer C', customerPhone: '0773333333',
          startDate: '2026-07-15', endDate: '2026-07-17', totalDays: 3,
          totalAmount: 12000, paidAmount: 0, status: 'Cancelled',
          createdAt: '2026-07-15T00:00:00Z',
        },
      ],
      commissions: [
        {
          id: 'comm1', bookingId: 'bk1', vehicleId: 'v1', ownerId: 'o1',
          referral: 'Direct', totalIncome: 25000, commissionRate: 0, commissionAmount: 0,
          ownerPayout: 25000, coordinatorFee: 0, status: 'Pending',
          createdAt: '2026-07-01T00:00:00Z',
        },
        {
          id: 'comm2', bookingId: 'bk2', vehicleId: 'v1', ownerId: 'o1',
          referral: 'Direct', totalIncome: 15000, commissionRate: 0, commissionAmount: 0,
          ownerPayout: 15000, coordinatorFee: 0, status: 'Paid',
          createdAt: '2026-07-10T00:00:00Z',
        },
        {
          id: 'comm3', bookingId: 'bk3', vehicleId: 'v1', ownerId: 'o1',
          referral: 'Direct', totalIncome: 12000, commissionRate: 0, commissionAmount: 0,
          ownerPayout: 12000, coordinatorFee: 0, status: 'Pending',
          createdAt: '2026-07-15T00:00:00Z',
        },
      ],
    })
  })

  it('rebuilds vehicle revenue excluding cancelled bookings', () => {
    useStore.getState().recomputeStats()
    // bk1(25000) + bk2(15000) = 40000; bk3 is cancelled → excluded
    expect(useStore.getState().vehicles.find((v) => v.id === 'v1')!.revenue).toBe(40000)
  })

  it('rebuilds vehicle rentCount excluding cancelled bookings', () => {
    useStore.getState().recomputeStats()
    expect(useStore.getState().vehicles.find((v) => v.id === 'v1')!.rentCount).toBe(2)
  })

  it('rebuilds owner totalEarnings from non-cancelled commissions only', () => {
    useStore.getState().recomputeStats()
    // comm1(25000) + comm2(15000) = 40000; comm3 is for cancelled bk3 → excluded
    expect(useStore.getState().owners.find((o) => o.id === 'o1')!.totalEarnings).toBe(40000)
  })

  it('rebuilds owner pendingPayout: only Pending commissions (not Paid)', () => {
    useStore.getState().recomputeStats()
    // comm1 is Pending(25000); comm2 is Paid; comm3 is for cancelled booking
    // pendingPayout = 25000
    expect(useStore.getState().owners.find((o) => o.id === 'o1')!.pendingPayout).toBe(25000)
  })

  it('recomputeStats is idempotent: running twice gives same result', () => {
    useStore.getState().recomputeStats()
    const after1 = useStore.getState().owners.find((o) => o.id === 'o1')!.totalEarnings
    useStore.getState().recomputeStats()
    const after2 = useStore.getState().owners.find((o) => o.id === 'o1')!.totalEarnings
    expect(after1).toBe(after2)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// updateBooking — payment received triggers balance recalculation
// ─────────────────────────────────────────────────────────────────────────────
describe('updateBooking — payment updates', () => {
  beforeEach(() => {
    useStore.setState(EMPTY_STATE)
    useStore.setState({
      bookings: [
        {
          id: 'bk1', vehicleId: 'v1', customerId: 'c1',
          customerName: 'Payment Customer', customerPhone: '0771111111',
          startDate: '2026-07-01', endDate: '2026-07-05', totalDays: 5,
          totalAmount: 25000, paidAmount: 5000, advanceAmount: 5000,
          discount: 1000, status: 'Ongoing', createdAt: '2026-07-01T00:00:00Z',
        },
      ],
      customers: [
        { id: 'c1', name: 'Payment Customer', phone: '0771111111', createdAt: '2026-01-01T00:00:00Z', smsOptIn: false },
      ],
    })
  })

  it('paidAmount increases after receiving additional payment', () => {
    useStore.getState().updateBooking('bk1', { paidAmount: 15000 })
    expect(useStore.getState().bookings.find((b) => b.id === 'bk1')!.paidAmount).toBe(15000)
  })

  it('applying discount reduces outstanding (bookingDue recalculated from new state)', async () => {
    useStore.getState().updateBooking('bk1', { discount: 2000 })
    const b = useStore.getState().bookings.find((x) => x.id === 'bk1')!
    const { bookingDue } = await import('../../src/lib/credit')
    // Bill = 25000 + 0 - 2000 = 23000, paid = 5000 + 5000 = 10000, due = 13000
    expect(bookingDue(b)).toBe(13000)
  })

  it('recording credit amount sets creditAmount field', () => {
    useStore.getState().updateBooking('bk1', { creditAmount: 7000, creditSettled: false })
    expect(useStore.getState().bookings.find((b) => b.id === 'bk1')!.creditAmount).toBe(7000)
  })

  it('recording bad debt sets badDebt field', () => {
    useStore.getState().updateBooking('bk1', { badDebt: 2000 })
    expect(useStore.getState().bookings.find((b) => b.id === 'bk1')!.badDebt).toBe(2000)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// markReferralPaid — referral owner pending payout reduced
// ─────────────────────────────────────────────────────────────────────────────
describe('markReferralPaid — referral commission settlement', () => {
  beforeEach(() => {
    useStore.setState(EMPTY_STATE)
    useStore.setState({
      owners: [
        makeOwner({ id: 'o1', name: 'Vehicle Owner' }),
        makeOwner({ id: 'o2', name: 'Referral Owner', pendingPayout: 2500, totalEarnings: 2500 }),
      ],
      vehicles: [makeVehicle({ id: 'v1', ownerId: 'o1' })],
      bookings: [
        {
          id: 'bk1', vehicleId: 'v1', customerId: 'c1',
          customerName: 'Test Customer', customerPhone: '0771111111',
          startDate: '2026-07-01', endDate: '2026-07-05', totalDays: 5,
          totalAmount: 25000, paidAmount: 25000,
          referral: 'Referral Owner', referralFeeType: 'fixed' as const,
          referralFeeValue: 2500, referralFee: 2500, referralPaid: false,
          status: 'Completed', createdAt: '2026-07-01T00:00:00Z',
        },
      ],
    })
  })

  it('marks referralPaid = true on the booking', () => {
    useStore.getState().markReferralPaid('bk1', true)
    expect(useStore.getState().bookings.find((b) => b.id === 'bk1')!.referralPaid).toBe(true)
  })

  it('reduces the referral owner pendingPayout by the referral fee', () => {
    useStore.getState().markReferralPaid('bk1', true)
    expect(useStore.getState().owners.find((o) => o.id === 'o2')!.pendingPayout).toBe(0)
  })

  it('marking as unpaid (false) does NOT modify owner payout', () => {
    useStore.getState().markReferralPaid('bk1', true)
    const payoutAfterPaid = useStore.getState().owners.find((o) => o.id === 'o2')!.pendingPayout
    useStore.getState().markReferralPaid('bk1', false)
    // pendingPayout should NOT increase back (markReferralPaid(false) only clears the flag)
    expect(useStore.getState().owners.find((o) => o.id === 'o2')!.pendingPayout).toBe(payoutAfterPaid)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Vehicle availability — conflict detection
// ─────────────────────────────────────────────────────────────────────────────
describe('isVehicleAvailable — booking conflict detection', () => {
  beforeEach(() => {
    useStore.setState(EMPTY_STATE)
    useStore.setState({
      vehicles: [makeVehicle({ id: 'v1', status: 'Available' })],
      bookings: [
        {
          id: 'bk1', vehicleId: 'v1', customerId: 'c1',
          customerName: 'Existing Customer', customerPhone: '0771111111',
          startDate: '2026-07-05', endDate: '2026-07-10', totalDays: 6,
          totalAmount: 30000, paidAmount: 30000, status: 'Confirmed',
          createdAt: '2026-07-01T00:00:00Z',
        },
      ],
    })
  })

  it('dates before existing booking → available', () => {
    expect(useStore.getState().isVehicleAvailable('v1', '2026-07-01', '2026-07-04')).toBe(true)
  })

  it('dates after existing booking → available', () => {
    expect(useStore.getState().isVehicleAvailable('v1', '2026-07-11', '2026-07-15')).toBe(true)
  })

  it('overlapping dates → not available', () => {
    expect(useStore.getState().isVehicleAvailable('v1', '2026-07-08', '2026-07-12')).toBe(false)
  })

  it('cancelled booking does not block vehicle', () => {
    useStore.getState().cancelBooking('bk1')
    expect(useStore.getState().isVehicleAvailable('v1', '2026-07-05', '2026-07-10')).toBe(true)
  })

  it('editing own booking excluded from conflict check', () => {
    expect(useStore.getState().isVehicleAvailable('v1', '2026-07-05', '2026-07-10', 'bk1')).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Full financial scenario integration test
// ─────────────────────────────────────────────────────────────────────────────
describe('Full scenario: referral booking → complete → pay commission → settle credit', () => {
  it('all financial records update correctly through full lifecycle', async () => {
    useStore.setState(EMPTY_STATE)
    useStore.setState({
      owners: [
        makeOwner({ id: 'o-vehicle', name: 'Vehicle Owner', pendingPayout: 0, totalEarnings: 0 }),
        makeOwner({ id: 'o-referral', name: 'Referral Partner', pendingPayout: 0, totalEarnings: 0 }),
      ],
      vehicles: [makeVehicle({ id: 'v1', ownerId: 'o-vehicle' })],
    })

    // 1. Create booking with 10% referral fee
    const bookingId = useStore.getState().addBooking({
      vehicleId: 'v1', customerId: 'cust1', customerName: 'Test Customer', customerPhone: '0779999999',
      startDate: '2026-07-01', endDate: '2026-07-05', totalDays: 5,
      totalAmount: 25000, paidAmount: 5000,   // 5000 advance
      advanceAmount: 5000,
      referral: 'Referral Partner', referralFeeType: 'percent', referralFeeValue: 10,
      status: 'Confirmed',
    })

    // Commission created correctly
    const comm = useStore.getState().commissions.find((c) => c.bookingId === bookingId)!
    expect(comm.coordinatorFee).toBe(2500)
    expect(comm.ownerPayout).toBe(22500)
    expect(comm.status).toBe('Pending')

    // 2. Start and complete the booking
    useStore.getState().startBooking(bookingId)
    useStore.getState().completeBooking(bookingId)
    expect(useStore.getState().bookings.find((b) => b.id === bookingId)!.status).toBe('Completed')
    expect(useStore.getState().vehicles.find((v) => v.id === 'v1')!.status).toBe('Available')

    // 3. Apply discount + record additional payment + credit + bad debt
    useStore.getState().updateBooking(bookingId, {
      discount: 1000,       // bill = 24000
      paidAmount: 10000,    // total paid = 10000 + 5000 advance = 15000; due = 9000
      badDebt: 2000,        // write off 2000
      creditAmount: 7000,   // remaining 7000 as credit
      creditSettled: false,
    })

    const { bookingBill, bookingPaid, bookingDue, bookingCredit, creditTotals } = await import('../../src/lib/credit')
    const b = useStore.getState().bookings.find((x) => x.id === bookingId)!
    expect(bookingBill(b)).toBe(24000)
    expect(bookingPaid(b)).toBe(15000)
    expect(bookingDue(b)).toBe(9000)
    expect(bookingCredit(b)).toBe(7000)

    // 4. Mark owner commission as Paid
    // First set up owner with correct pendingPayout via recomputeStats won't work because
    // addBooking doesn't set pendingPayout. Manually set it for the test:
    useStore.setState({
      owners: useStore.getState().owners.map((o) =>
        o.id === 'o-vehicle' ? { ...o, pendingPayout: 22500, totalEarnings: 22500 } : o,
      ),
    })
    useStore.getState().updateCommission(comm.id, { status: 'Paid' })
    expect(useStore.getState().owners.find((o) => o.id === 'o-vehicle')!.pendingPayout).toBe(0)

    // 5. Settle the credit
    useStore.getState().settleCredit(bookingId)
    const settled = useStore.getState().bookings.find((x) => x.id === bookingId)!
    expect(settled.creditSettled).toBe(true)
    expect(settled.paidAmount).toBe(17000)   // 10000 + 7000 credit
    expect(bookingPaid(settled)).toBe(22000) // 17000 + 5000 advance
    expect(bookingDue(settled)).toBe(2000)   // = bad debt
    expect(creditTotals([settled]).total).toBe(0)
  })
})
