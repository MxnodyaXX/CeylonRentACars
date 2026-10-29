import { describe, it, expect } from 'vitest'
import { invoiceHtml, invoiceNo } from '../../src/lib/printInvoice'
import { priceBreakdown } from '../../src/lib/bookingRecord'
import type { Booking, Vehicle } from '../../src/types'

const vehicle = { id: 'v1', brand: 'Nissan', model: 'Clipper', vehicleNumber: 'PI-1061', dailyRent: 5000, extraKmRate: 40, includedKmPerDay: 100 } as unknown as Vehicle
const booking = {
  id: 'abcd1234wxyz', createdAt: '2026-10-15T08:00:00Z', vehicleId: 'v1', customerName: 'P. Hrsha <script>', customerPhone: '0771112223',
  startDate: '2026-10-15', endDate: '2026-10-19', totalDays: 4, totalAmount: 20000, paidAmount: 26000, advanceAmount: 0,
  extraCharges: 7000, discount: 0, status: 'Completed',
  charges: [
    { id: 'c1', kind: 'Other', amount: 6000, date: '2026-10-19', note: 'Extra km: 150 km × Rs 40', status: 'Charged', by: 'A', at: '2026-10-19T11:00:00Z' },
    { id: 'c2', kind: 'Fuel', amount: 1000, date: '2026-10-19', note: 'Top-up', status: 'Charged', by: 'A', at: '2026-10-19T11:00:00Z' },
  ],
  payments: [
    { id: 'p1', at: '2026-10-15T08:00:00Z', kind: 'Payment', amount: 20000, method: 'Cash', by: 'A' },
    { id: 'p2', at: '2026-10-19T11:00:00Z', kind: 'Payment', amount: 6000, method: 'Card', receiptNo: 'R-77', by: 'A', note: 'Collected at return' },
  ],
  checklists: {
    pickup: { at: '2026-10-15T08:00:00Z', by: 'A', odometer: 10000, fuel: 'Full', items: {} },
    return: { at: '2026-10-19T11:00:00Z', by: 'A', odometer: 10550, fuel: '3/4', items: {} },
  },
} as unknown as Booking

describe('customer invoice', () => {
  const html = invoiceHtml(booking, vehicle)
  it('numbers the invoice from the booking', () => {
    expect(invoiceNo(booking)).toMatch(/^INV-2026-/)
    expect(html).toContain(invoiceNo(booking))
  })
  it('lists the rental, extra km and other charges, with mileage', () => {
    expect(html).toContain('4 days × Rs 5,000')
    expect(html).toContain('Extra km<div')
    expect(html).toContain('150 km × Rs 40')
    expect(html).toContain('Top-up')
    expect(html).toContain('550 km driven · 400 km included')
  })
  it('shows total, paid and what is still owed', () => {
    expect(html).toContain('Rs 27,000')            // 20,000 + 6,000 + 1,000
    expect(html).toContain('Rs 26,000')
    expect(html).toContain('Rs 1,000')             // balance due
    expect(html).toContain('R-77')
  })
  it('escapes customer-entered text', () => {
    expect(html).toContain('P. Hrsha &lt;script&gt;')
    expect(html).not.toContain('Hrsha <script>')
  })
})

describe('price lines after a return with deductions', () => {
  const ch = (id: string, kind: string, amount: number, note: string) => ({ id, kind, amount, date: '2026-10-23', note, status: 'Charged', by: 'A', at: '2026-10-23T16:00:00Z' })
  const charges = [
    ch('k', 'Other', 36100, 'Extra km: 722 km × Rs 50 (2,922 km driven in CBU-0745 + CBU-0649)'),
    ch('t', 'Deduction', -38500, 'Tyres paid by the customer — Front Two Tyres'),
    ch('d', 'Deduction', -15000, 'Other paid by the customer — Discount on Free 300km'),
  ]
  const returned = (extraCharges: number) => ({ ...booking, totalDays: 22, totalAmount: 110000, extraCharges, charges } as unknown as Booking)

  it('gives each charge a short title and its detail, grouped as rent, charges and deductions', () => {
    const p = priceBreakdown(returned(36100 - 38500 - 15000), vehicle)
    expect(p.unlisted).toBe(0)
    expect(p.lines.map((l) => [l.group, l.label, l.detail ?? ''])).toEqual([
      ['rent', '22 days × Rs 5,000', ''],
      ['charge', 'Extra km', '722 km × Rs 50 · 2,922 km driven in CBU-0745 + CBU-0649'],
      ['deduction', 'Tyres', 'Front Two Tyres'],
      ['deduction', 'Discount on Free 300km', ''],
    ])
    expect(p.bill).toBe(110000 + 36100 - 38500 - 15000)
  })
  it('shows a bill total that no listed charge explains on its own line', () => {
    const p = priceBreakdown(returned(36100 - 38500), vehicle)   // the last deduction's total never saved
    expect(p.unlisted).toBe(15000)
    expect(p.lines.find((l) => l.label === 'Other extra charges')).toMatchObject({ amount: 15000, group: 'charge' })
  })
})
