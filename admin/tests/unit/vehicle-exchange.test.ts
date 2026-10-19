/**
 * Store tests — mid-trip vehicle exchange
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
// Mid-trip vehicle exchange (Booking → Exchange vehicle)
//   booked car earns the agreed price for its days (minus referral fee);
//   a replacement earns its own daily rent × its days; the company keeps / covers the difference
// ─────────────────────────────────────────────────────────────────────────────
import { legsOf, mainCommission, previewExchange } from '../../src/lib/exchange'
import type { ExchangeInput } from '../../src/types'

const at = (d: string) => new Date(d).toISOString()

function setup(bookingOverrides: Partial<Booking> = {}) {
  useStore.setState(EMPTY_STATE)
  useStore.setState({
    owners: [makeOwner({ id: 'oA', name: 'Owner A' }), makeOwner({ id: 'oB', name: 'Owner B' }), makeOwner({ id: 'oC', name: 'Owner C' })],
    vehicles: [
      makeVehicle({ id: 'vA', ownerId: 'oA', vehicleNumber: 'CBU-0745', dailyRent: 12000 }),
      makeVehicle({ id: 'vB', ownerId: 'oB', vehicleNumber: 'CBB-2222', dailyRent: 10000 }),
      makeVehicle({ id: 'vC', ownerId: 'oC', vehicleNumber: 'CCC-3333', dailyRent: 15000 }),
    ],
  })
  // 7-day trip at Rs 12,000/day, already on the road
  const id = useStore.getState().addBooking(makeBookingInput({
    vehicleId: 'vA', startDate: '2026-07-01', endDate: '2026-07-07', totalDays: 7, totalAmount: 84000, status: 'Ongoing',
    checklists: { pickup: { at: at('2026-07-01T09:00:00'), by: 'Staff', odometer: 10000, fuel: 'Full', items: {} } },
    ...bookingOverrides,
  }))
  useStore.setState((s) => ({ vehicles: s.vehicles.map((v) => (v.id === 'vA' ? { ...v, status: 'Ongoing' as const } : v)) }))
  return id
}

const input = (o: Partial<ExchangeInput> = {}): ExchangeInput => ({
  at: at('2026-07-05T10:00:00'), by: 'Staff', toVehicleId: 'vB', fromDays: 4, reason: 'Accident',
  returned: { odometer: 10800, fuel: '1/2', damage: 'Front bumper' }, delivered: { odometer: 5000, fuel: 'Full' },
  oldCarTo: 'Maintenance', ...o,
})
const st = () => useStore.getState()
const veh = (id: string) => st().vehicles.find((v) => v.id === id)!
const own = (id: string) => st().owners.find((o) => o.id === id)!
const book = (id: string) => st().bookings.find((b) => b.id === id)!

describe('exchangeVehicle — owner split by days', () => {
  it('your example: 7 days at Rs 12,000, exchanged after 4 days to a Rs 10,000/day car', () => {
    const id = setup()
    expect(previewExchange(book(id), 4, 10000)).toMatchObject({ fromPayout: 48000, toDays: 3, toPayout: 30000, company: 6000 })
    expect(st().exchangeVehicle(id, input())).toBeNull()

    const b = book(id)
    expect(b.vehicleId).toBe('vB')
    expect(b.exchanges).toHaveLength(1)
    const comms = st().commissions.filter((c) => c.bookingId === id)
    expect(comms).toHaveLength(2)
    const a = comms.find((c) => c.ownerId === 'oA')!, bb = comms.find((c) => c.ownerId === 'oB')!
    expect(a).toMatchObject({ vehicleId: 'vA', totalIncome: 48000, ownerPayout: 48000, status: 'Pending' })
    expect(bb).toMatchObject({ vehicleId: 'vB', ownerPayout: 30000, totalIncome: 36000 })
    expect(mainCommission(st().commissions, b)?.id).toBe(bb.id)
    expect(own('oA')).toMatchObject({ totalEarnings: 48000, pendingPayout: 48000 })
    expect(own('oB')).toMatchObject({ totalEarnings: 30000, pendingPayout: 30000 })
    expect(veh('vA')).toMatchObject({ revenue: 48000, status: 'Maintenance', mileage: 10800 })
    expect(veh('vB')).toMatchObject({ revenue: 36000, status: 'Ongoing', rentCount: 1 })
  })

  it('a pricier replacement: the company covers the difference', () => {
    const id = setup()
    expect(previewExchange(book(id), 4, 15000).company).toBe(84000 - 48000 - 45000)   // −9,000
    expect(st().exchangeVehicle(id, input({ toVehicleId: 'vC' }))).toBeNull()
    expect(own('oC').totalEarnings).toBe(45000)
  })

  it('referral fee comes off the booked car only', () => {
    const id = setup({ referral: 'Agent', referralFeeType: 'fixed', referralFeeValue: 4000 })
    expect(book(id).referralFee).toBe(4000)
    expect(st().exchangeVehicle(id, input())).toBeNull()
    const comms = st().commissions.filter((c) => c.bookingId === id)
    expect(comms.find((c) => c.ownerId === 'oA')).toMatchObject({ ownerPayout: 44000, coordinatorFee: 4000 })
    expect(comms.find((c) => c.ownerId === 'oB')).toMatchObject({ ownerPayout: 30000, coordinatorFee: 0 })
  })

  it('moves the old car\'s pickup into the exchange and starts the replacement at its own odometer', () => {
    const id = setup()
    st().exchangeVehicle(id, input())
    const b = book(id)
    expect(b.checklists?.pickup?.odometer).toBe(5000)
    expect(b.exchanges![0].pickup?.odometer).toBe(10000)
    expect(b.exchanges![0].kmDriven).toBe(800)
    expect(b.activity?.at(-1)?.type).toBe('Swapped')
    expect(st().handovers.filter((h) => h.bookingId === id).map((h) => `${h.vehicleId}:${h.type}`)).toEqual(['vA:return', 'vB:delivery'])
  })

  it('extending the trip afterwards adds days to the replacement only', () => {
    const id = setup()
    st().exchangeVehicle(id, input())
    st().editBooking(id, { endDate: '2026-07-09', totalDays: 9, totalAmount: 108000 }, { by: 'Staff', changes: ['Extended'] })
    const legs = legsOf(book(id))
    expect(legs.map((l) => [l.vehicleId, l.days, l.revenue, l.payout])).toEqual([['vA', 4, 48000, 48000], ['vB', 5, 60000, 50000]])
    expect(own('oA').totalEarnings).toBe(48000)
    expect(own('oB').totalEarnings).toBe(50000)
    expect(veh('vB').revenue).toBe(60000)
    expect(mainCommission(st().commissions, book(id))).toMatchObject({ ownerPayout: 50000, totalIncome: 60000 })
  })

  it('Recalculate statistics keeps the split', () => {
    const id = setup()
    st().exchangeVehicle(id, input())
    st().recomputeStats()
    expect(veh('vA').revenue).toBe(48000)
    expect(veh('vB').revenue).toBe(36000)
    expect(own('oA').totalEarnings).toBe(48000)
    expect(own('oB').totalEarnings).toBe(30000)
  })

  it('a second exchange pays the first replacement its own rate', () => {
    const id = setup()
    st().exchangeVehicle(id, input())
    expect(st().exchangeVehicle(id, input({ at: at('2026-07-07T08:00:00'), toVehicleId: 'vC', fromDays: 2 }))).toBeNull()
    const legs = legsOf(book(id))
    expect(legs.map((l) => [l.vehicleId, l.days, l.payout])).toEqual([['vA', 4, 48000], ['vB', 2, 20000], ['vC', 1, 15000]])
    expect(st().commissions.filter((c) => c.bookingId === id)).toHaveLength(3)
    expect(own('oB').totalEarnings).toBe(20000)
    expect(own('oC').totalEarnings).toBe(15000)
  })
})

describe('exchangeVehicle — damage and compensation', () => {
  it('customer pays the damage: added to the booking as a Damage charge', () => {
    const id = setup()
    st().exchangeVehicle(id, input({ damage: { description: 'Front bumper', payer: 'Customer', amount: 20000 } }))
    const b = book(id)
    expect(b.charges?.find((c) => c.kind === 'Damage')).toMatchObject({ amount: 20000, status: 'Charged' })
    expect(b.extraCharges).toBe(20000)
    expect(st().expenses).toHaveLength(0)
  })

  it('company pays the damage: a Damage expense on the damaged car', () => {
    const id = setup()
    st().exchangeVehicle(id, input({ damage: { description: 'Front bumper', payer: 'Company', amount: 35000 } }))
    expect(st().expenses).toHaveLength(1)
    expect(st().expenses[0]).toMatchObject({ vehicleId: 'vA', category: 'Damage', amount: 35000 })
    expect(book(id).charges ?? []).toHaveLength(0)
  })

  it('compensation for lost days is added to the booked car\'s owner', () => {
    const id = setup()
    st().exchangeVehicle(id, input({ compensation: { amount: 6000, paidBy: 'Company' } }))
    expect(own('oA').totalEarnings).toBe(54000)
    expect(st().commissions.find((c) => c.ownerId === 'oA')?.ownerPayout).toBe(54000)
  })

  it('compensation paid by the customer is also charged to the booking', () => {
    const id = setup()
    st().exchangeVehicle(id, input({ compensation: { amount: 6000, paidBy: 'Customer' } }))
    expect(book(id).charges?.some((c) => c.kind === 'Other' && c.amount === 6000)).toBe(true)
    expect(own('oA').totalEarnings).toBe(54000)
  })
})

describe('exchangeVehicle — availability and checks', () => {
  it('each car is busy only for its own part of the trip', () => {
    const id = setup()
    st().exchangeVehicle(id, input())
    const free = st().isVehicleAvailable
    expect(free('vB', '2026-07-02', '2026-07-03', undefined, '09:00', '18:00')).toBe(true)    // before the exchange
    expect(free('vB', '2026-07-06', '2026-07-06', undefined, '09:00', '18:00')).toBe(false)   // after it
    expect(free('vA', '2026-07-06', '2026-07-06', undefined, '09:00', '18:00')).toBe(false)   // under maintenance: no new bookings
    expect(id).toBeTruthy()
  })

  it('refuses a replacement that is booked for the rest of the trip', () => {
    const id = setup()
    useStore.getState().addBooking(makeBookingInput({ vehicleId: 'vB', startDate: '2026-07-06', endDate: '2026-07-06', totalDays: 1, totalAmount: 10000 }))
    expect(st().exchangeVehicle(id, input())).toMatch(/not free/)
    expect(book(id).vehicleId).toBe('vA')
  })

  it('refuses when the owner payout was already marked paid', () => {
    const id = setup()
    useStore.setState((s) => ({ commissions: s.commissions.map((c) => (c.bookingId === id ? { ...c, status: 'Paid' as const } : c)) }))
    expect(st().exchangeVehicle(id, input())).toMatch(/already marked paid/)
  })

  it('only a rental in progress can be exchanged', () => {
    const id = setup({ status: 'Confirmed' })
    expect(st().exchangeVehicle(id, input())).toMatch(/in progress/)
  })
})

describe('exchangeVehicle — older data', () => {
  it('a booking without a commission row gets one for the replacement', () => {
    const id = setup()
    useStore.setState((s) => ({ commissions: s.commissions.filter((c) => c.bookingId !== id) }))
    expect(st().exchangeVehicle(id, input())).toBeNull()
    const comms = st().commissions.filter((c) => c.bookingId === id)
    expect(comms.map((c) => [c.vehicleId, c.ownerPayout]).sort()).toEqual([['vA', 48000], ['vB', 30000]])
    expect(mainCommission(st().commissions, book(id))?.vehicleId).toBe('vB')
  })

  it('suggests leaving the replacement at least one day, even on an overdue trip', async () => {
    const { suggestedDays } = await import('../../src/lib/exchange')
    const id = setup()
    expect(suggestedDays(book(id), at('2026-07-05T10:00:00'))).toBe(4)
    expect(suggestedDays(book(id), at('2026-09-30T10:00:00'))).toBe(6)   // long overdue: 7-day trip → 6 + 1
  })
})
