import { describe, it, expect } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// Pure business logic extracted for isolated testing
// (mirrors the logic inside useStore addBooking and related helpers)
// ─────────────────────────────────────────────────────────────────────────────

function calcCommission(totalAmount: number, ratePercent: number) {
  return totalAmount * (ratePercent / 100)
}

function calcOwnerPayout(totalAmount: number, ratePercent: number) {
  return totalAmount * (1 - ratePercent / 100)
}

function calcTotalAmount(dailyRent: number, days: number) {
  return dailyRent * days
}

function calcDays(startDate: string, endDate: string): number {
  const start = new Date(startDate).getTime()
  const end   = new Date(endDate).getTime()
  return Math.max(0, Math.ceil((end - start) / (1000 * 60 * 60 * 24)))
}

function calcExtraKmCharge(actualKm: number, includedKmPerDay: number, days: number, extraKmRate: number) {
  const freeKm   = includedKmPerDay * days
  const extraKm  = Math.max(0, actualKm - freeKm)
  return extraKm * extraKmRate
}

function calcFinalAmount(baseAmount: number, extraKmCharge: number) {
  return baseAmount + extraKmCharge
}

function calcNetRevenue(totalRevenue: number, totalCommission: number) {
  return totalRevenue - totalCommission
}

function calcNetProfit(totalRevenue: number, totalExpenses: number, totalCommission: number) {
  return totalRevenue - totalExpenses - totalCommission
}

// ─────────────────────────────────────────────────────────────────────────────
// COMMISSION CALCULATIONS
// ─────────────────────────────────────────────────────────────────────────────
describe('Commission calculations', () => {
  it('calculates 15% commission on 16500 → 2475', () => {
    expect(calcCommission(16500, 15)).toBe(2475)
  })

  it('calculates 15% commission on 18000 → 2700', () => {
    expect(calcCommission(18000, 15)).toBe(2700)
  })

  it('calculates 12% commission on 10000 → 1200', () => {
    expect(calcCommission(10000, 12)).toBe(1200)
  })

  it('calculates 0% commission → 0', () => {
    expect(calcCommission(50000, 0)).toBe(0)
  })

  it('calculates 100% commission → full amount', () => {
    expect(calcCommission(5000, 100)).toBe(5000)
  })

  it('handles decimal commission rates (12.5%)', () => {
    expect(calcCommission(8000, 12.5)).toBe(1000)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// OWNER PAYOUT CALCULATIONS
// ─────────────────────────────────────────────────────────────────────────────
describe('Owner payout calculations', () => {
  it('owner payout at 15% rate on 16500 → 14025', () => {
    expect(calcOwnerPayout(16500, 15)).toBeCloseTo(14025)
  })

  it('owner payout at 15% rate on 18000 → 15300', () => {
    expect(calcOwnerPayout(18000, 15)).toBeCloseTo(15300)
  })

  it('owner payout at 12% rate on 10500 → 9240', () => {
    expect(calcOwnerPayout(10500, 12)).toBeCloseTo(9240)
  })

  it('owner payout = totalAmount - commission', () => {
    const total = 20000
    const rate  = 15
    expect(calcOwnerPayout(total, rate)).toBeCloseTo(total - calcCommission(total, rate))
  })

  it('0% commission rate → full amount goes to owner', () => {
    expect(calcOwnerPayout(15000, 0)).toBe(15000)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// BOOKING AMOUNT CALCULATIONS
// ─────────────────────────────────────────────────────────────────────────────
describe('Booking amount calculations', () => {
  it('3 days at Rs 5500/day = 16500', () => {
    expect(calcTotalAmount(5500, 3)).toBe(16500)
  })

  it('4 days at Rs 4500/day = 18000', () => {
    expect(calcTotalAmount(4500, 4)).toBe(18000)
  })

  it('1 day at Rs 3800/day = 3800', () => {
    expect(calcTotalAmount(3800, 1)).toBe(3800)
  })

  it('0 days = 0 amount', () => {
    expect(calcTotalAmount(5000, 0)).toBe(0)
  })

  it('large fleet booking: 30 days × Rs 6000 = 180000', () => {
    expect(calcTotalAmount(6000, 30)).toBe(180000)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// DATE / DAYS CALCULATIONS
// ─────────────────────────────────────────────────────────────────────────────
describe('Days between dates', () => {
  it('3-day trip: 2026-05-25 to 2026-05-28 = 3 days', () => {
    expect(calcDays('2026-05-25', '2026-05-28')).toBe(3)
  })

  it('4-day trip: 2026-05-22 to 2026-05-26 = 4 days', () => {
    expect(calcDays('2026-05-22', '2026-05-26')).toBe(4)
  })

  it('1-day trip: same day returns 0 (not counted)', () => {
    expect(calcDays('2026-06-01', '2026-06-01')).toBe(0)
  })

  it('end before start returns 0', () => {
    expect(calcDays('2026-06-05', '2026-06-01')).toBe(0)
  })

  it('month-spanning trip: 2026-05-28 to 2026-06-07 = 10 days', () => {
    expect(calcDays('2026-05-28', '2026-06-07')).toBe(10)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// EXTRA KM CHARGE
// ─────────────────────────────────────────────────────────────────────────────
describe('Extra km charge calculations', () => {
  it('no extra km when within free limit', () => {
    // 3 days × 100 km free = 300 km free; actual 280 km → no charge
    expect(calcExtraKmCharge(280, 100, 3, 15)).toBe(0)
  })

  it('50 extra km at Rs 15/km = Rs 750', () => {
    // 3 days × 100 km = 300 free; actual 350 km → 50 extra × 15 = 750
    expect(calcExtraKmCharge(350, 100, 3, 15)).toBe(750)
  })

  it('exactly at free limit → 0 charge', () => {
    expect(calcExtraKmCharge(300, 100, 3, 15)).toBe(0)
  })

  it('1 km over limit → 1 × rate', () => {
    expect(calcExtraKmCharge(301, 100, 3, 15)).toBe(15)
  })

  it('large overage: 200 extra km × Rs 20/km = Rs 4000', () => {
    expect(calcExtraKmCharge(700, 100, 5, 20)).toBe(4000)  // 500 free, 200 extra
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// FINAL AMOUNT (base + extra km)
// ─────────────────────────────────────────────────────────────────────────────
describe('Final booking amount', () => {
  it('no extra km → final = base', () => {
    expect(calcFinalAmount(16500, 0)).toBe(16500)
  })

  it('adds extra km charge to base amount', () => {
    expect(calcFinalAmount(16500, 750)).toBe(17250)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// NET REVENUE & PROFIT
// ─────────────────────────────────────────────────────────────────────────────
describe('Revenue and profit calculations', () => {
  it('net revenue = total - commission', () => {
    expect(calcNetRevenue(61800, 9270)).toBeCloseTo(52530)
  })

  it('net profit deducts both expenses and commission', () => {
    // 61800 revenue, 49500 expenses, 9270 commission
    expect(calcNetProfit(61800, 49500, 9270)).toBeCloseTo(3030)
  })

  it('handles zero expenses', () => {
    expect(calcNetProfit(50000, 0, 7500)).toBe(42500)
  })

  it('loss scenario: expenses > revenue', () => {
    expect(calcNetProfit(10000, 15000, 1500)).toBe(-6500)
  })

  // ── Sample data totals ───────────────────────────────────────────────────
  it('sample data: total bookings revenue = 61800', () => {
    const bookings = [
      { totalAmount: 16500 },
      { totalAmount: 18000 },
      { totalAmount: 10500 },
      { totalAmount: 16800 },
    ]
    const total = bookings.reduce((s, b) => s + b.totalAmount, 0)
    expect(total).toBe(61800)
  })

  it('sample data: total commission (15% of 61800) = 9270', () => {
    const totalRevenue = 61800
    const commission   = calcCommission(totalRevenue, 15)
    expect(commission).toBe(9270)
  })

  it('sample data: total expenses = 49500', () => {
    const expenses = [18500, 6500, 22000, 2500]
    const total    = expenses.reduce((s, e) => s + e, 0)
    expect(total).toBe(49500)
  })
})
