import { describe, it, expect } from 'vitest'
import { ALL_QUESTIONS, fill, flagged, missingForApproval, unanswered, type Verification } from '../../src/lib/partnerVerification'
import type { PartnerApplication } from '../../src/types'

const base = {
  id: 'PA-ABC123', applicantType: 'individual', status: 'Pending', phone: '94779726761', name: 'Nimal Perera', nic: '199012345678',
  address: 'Panadura', vehicleNumber: 'CBU-0745', brand: 'Toyota', model: 'Yaris', askingDaily: 8000, photos: [], documents: {},
  agreement: { version: 'v1', text: '', name: 'Nimal Perera', signature: 'x', acceptedAt: '' }, history: [], createdAt: '', updatedAt: '',
} as unknown as PartnerApplication

// every required question answered with the "good" answer
const allGood = (): Verification => ({
  attempts: [], startedAt: '2026-11-01T10:00:00Z',
  answers: Object.fromEntries(ALL_QUESTIONS.map((q) => [q.id, {
    value: q.kind === 'yesno' ? (q.flag?.('Yes') ? 'No' : 'Yes') : q.options ? q.options.find((o) => !q.flag?.(o))! : q.kind === 'number' ? '7500' : q.kind === 'date' ? '2027-03-01' : 'noted',
  }])),
})

describe('owner check call', () => {
  it('fills the applicant into the wording', () => {
    expect(fill('Am I speaking with {name}? You asked {asking}.', base)).toBe('Am I speaking with Nimal Perera? You asked Rs 8,000 a day.')
  })

  it('lists required questions not answered yet', () => {
    expect(unanswered(undefined).length).toBe(ALL_QUESTIONS.filter((q) => q.required).length)
    expect(unanswered(allGood())).toEqual([])
  })

  it('flags warning answers: not the registered owner, on finance, rental not covered', () => {
    const v = allGood()
    expect(flagged(v)).toEqual([])
    v.answers.ownership = { value: 'Leased / on finance', details: 'People\'s Leasing' }
    v.answers.finance = { value: 'Yes' }
    v.answers.insuranceRental = { value: 'Not sure' }
    expect(flagged(v).map((q) => q.id)).toEqual(['ownership', 'finance', 'insuranceRental'])
  })
})

describe('what is missing before approval', () => {
  it('a fresh application: the call, the inspection and every document block approval', () => {
    const m = missingForApproval(base)
    expect(m.filter((x) => x.critical).map((x) => x.label)).toEqual([
      'Owner check call', 'Inspection', 'CR copy', 'NIC front', 'NIC back', 'Insurance certificate', 'Revenue licence',
    ])
    expect(m.find((x) => x.where === 'photos')?.critical).toBe(false)
  })

  it('a started call must be finished; a "not verified" verdict still blocks', () => {
    expect(missingForApproval({ ...base, verification: allGood() })[0].label).toBe('Finish the owner check call')
    const notOk = { ...allGood(), finishedAt: 'x', verdict: 'Not verified — do not list' as const }
    expect(missingForApproval({ ...base, verification: notOk })[0].label).toBe('Owner not verified')
  })

  it('an inspection must be done and passed', () => {
    const insp = (o: object) => missingForApproval({ ...base, inspection: { method: 'Physical', status: 'Done', ...o } as PartnerApplication['inspection'] })
      .find((x) => x.where === 'inspection')?.label
    expect(insp({ result: 'Needs work' })).toBe('Inspection: needs work')
    expect(insp({ result: 'Passed' })).toBeUndefined()
  })

  it('everything done → nothing blocks (bank details only a reminder)', () => {
    const done: PartnerApplication = {
      ...base, photos: ['a', 'b', 'c', 'd'],
      documents: { cr: 'x', nicFront: 'x', nicBack: 'x', insurance: 'x', revenueLicence: 'x' },
      inspection: { method: 'Video call', status: 'Done', result: 'Passed' },
      verification: { ...allGood(), finishedAt: 'x', verdict: 'Verified — OK to continue' },
    }
    expect(missingForApproval(done).filter((x) => x.critical)).toEqual([])
    expect(missingForApproval({ ...done, status: 'Approved' })).toEqual([])
  })
})
