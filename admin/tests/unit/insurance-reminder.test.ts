import { describe, it, expect, vi, beforeEach } from 'vitest'

const sent: string[] = []
vi.mock('../../src/lib/sms', () => ({
  sendSms: (phone: string) => { sent.push(phone) },
  smsTemplates: { ownerInsuranceMissing: () => 'Please add your insurance details' },
}))

import { runInsuranceReminders } from '../../src/lib/insuranceReminder'
import type { Notification, Owner, Vehicle } from '../../src/types'

const owner = { id: 'o1', name: 'Manodya', phone: '0771234567', smsOptIn: true } as Owner
const car = { id: 'v1', ownerId: 'o1', brand: 'Toyota', model: 'Yaris', vehicleNumber: 'CBU-0745', insurance: undefined } as unknown as Vehicle
const insured = { ...car, id: 'v2', insurance: { provider: 'SLIC', policyNumber: 'P1', expiryDate: '2027-01-01', premium: 40000 } } as unknown as Vehicle
const daysAgo = (d: number) => new Date(Date.now() - d * 864e5).toISOString()

function run(notifications: Notification[], sendTexts = true) {
  const added: Omit<Notification, 'id' | 'createdAt' | 'read'>[] = []
  runInsuranceReminders({ vehicles: [car, insured], owners: [owner], notifications, addNotification: (n) => added.push(n), sendTexts })
  return added
}

describe('insurance reminders', () => {
  beforeEach(() => { sent.length = 0; localStorage.clear() })

  it('reminds the owner once (alert + SMS) for incomplete insurance only', () => {
    const added = run([])
    expect(added).toHaveLength(1)
    expect(added[0]).toMatchObject({ relatedId: 'ins-missing:v1', ownerId: 'o1' })
    expect(sent).toEqual(['0771234567'])
  })

  it('no second reminder within a week — even if the alert was read or this is another browser', () => {
    const earlier = { id: 'n1', type: 'InsuranceExpiry', title: 'x', message: 'x', relatedId: 'ins-missing:v1', read: true, createdAt: daysAgo(2) } as Notification
    localStorage.clear()   // a fresh browser / dev-server port
    expect(run([earlier])).toHaveLength(0)
    expect(sent).toHaveLength(0)
  })

  it('reminds again after a week', () => {
    const old = { id: 'n1', type: 'InsuranceExpiry', title: 'x', message: 'x', relatedId: 'ins-missing:v1', read: true, createdAt: daysAgo(8) } as Notification
    expect(run([old])).toHaveLength(1)
    expect(sent).toHaveLength(1)
  })

  it('local development: in-app alert only, no SMS', () => {
    expect(run([], false)).toHaveLength(1)
    expect(sent).toHaveLength(0)
  })
})
