/* =====================================================================
   Owner check call for partner applications — before a stranger's vehicle joins the
   fleet, staff call the owner and go through a fixed set of questions. Answers are saved
   on the application (partner_applications.verification) as the call goes on, and the
   call ends with a verdict. Also: what is still missing before an application can be approved.
   ===================================================================== */
import type { PartnerApplication } from '../types';

export type QKind = 'yesno' | 'choice' | 'text' | 'date' | 'number';
export interface Question {
  id: string;
  q: string;                 // what staff ask (spoken wording)
  hint?: string;             // what to listen for / why it matters
  kind: QKind;
  options?: string[];
  required?: boolean;
  /** an answer that is a warning sign — shown in red and listed at the end */
  flag?: (value: string) => boolean;
  /** ask for details when the answer is one of these */
  detailsWhen?: string[];
  detailsLabel?: string;
}
export interface Section { id: string; title: string; intro: string; questions: Question[] }

export const CALL_METHODS = ['Normal call', 'WhatsApp call', 'In person', 'Other'] as const;
export const CALL_RESULTS = ['Connected', 'No answer', 'Busy', 'Call back later', 'Wrong number'] as const;
export const VERDICTS = ['Verified — OK to continue', 'Verified with concerns', 'Not verified — do not list'] as const;
export type Verdict = typeof VERDICTS[number];

const yes = (v: string) => v === 'Yes';
const no = (v: string) => v === 'No';

export const SECTIONS: Section[] = [
  { id: 'identity', title: 'Identity & ownership', intro: 'Make sure you are talking to the real owner and that they may rent the car out.', questions: [
    { id: 'isApplicant', kind: 'yesno', required: true, flag: no,
      q: 'Am I speaking with {name}? Please confirm your NIC number.', hint: 'The NIC they say must match {nic}.' },
    { id: 'ownership', kind: 'choice', required: true,
      options: ['Registered owner (name on the CR)', 'Family member of the owner', 'Company vehicle', 'Leased / on finance', 'Other'],
      flag: (v) => v !== 'Registered owner (name on the CR)', detailsWhen: ['Family member of the owner', 'Company vehicle', 'Leased / on finance', 'Other'],
      detailsLabel: 'Whose name is on the CR, and do they agree in writing?',
      q: 'Is the vehicle registered in your name?', hint: 'If not, we need the registered owner\'s written permission (and the finance company\'s, if leased).' },
    { id: 'finance', kind: 'yesno', required: true, flag: yes, detailsWhen: ['Yes'], detailsLabel: 'Finance company, and does it allow renting?',
      q: 'Is there any lease or loan on the vehicle?', hint: 'A finance company can repossess the car — rental use must be allowed.' },
    { id: 'otherPlatforms', kind: 'yesno', detailsWhen: ['Yes'], detailsLabel: 'Where, and will it stay there?',
      q: 'Is the car rented out anywhere else right now (another company, Uber / PickMe)?' },
  ] },
  { id: 'condition', title: 'Vehicle history & condition', intro: 'We are responsible for the customer\'s safety — find out about the car honestly.', questions: [
    { id: 'accidents', kind: 'yesno', required: true, flag: yes, detailsWhen: ['Yes'], detailsLabel: 'What happened, and what was repaired?',
      q: 'Has the vehicle had any accidents, flood damage or major repairs?' },
    { id: 'faults', kind: 'yesno', required: true, flag: yes, detailsWhen: ['Yes'], detailsLabel: 'Which faults / warning lights?',
      q: 'Any problems right now — warning lights, noises, AC, brakes, battery?' },
    { id: 'lastService', kind: 'text', required: true,
      q: 'When was it last serviced, and at what mileage?', hint: 'e.g. Sep 2026 at 84,000 km, Toyota Lanka' },
    { id: 'tyres', kind: 'choice', options: ['Good', 'OK', 'Need replacing soon'], flag: (v) => v === 'Need replacing soon',
      q: 'How are the tyres (including the spare)?' },
    { id: 'kit', kind: 'yesno', flag: no, detailsWhen: ['No'], detailsLabel: 'What is missing?',
      q: 'Does it have a spare wheel, jack and wheel spanner?' },
  ] },
  { id: 'papers', title: 'Insurance & documents', intro: 'No valid insurance for rental use means we cannot list the car.', questions: [
    { id: 'insuranceType', kind: 'choice', required: true, options: ['Comprehensive (full)', 'Third party only', 'None / expired'],
      flag: (v) => v !== 'Comprehensive (full)', q: 'What kind of insurance does the vehicle have?' },
    { id: 'insuranceRental', kind: 'choice', required: true, options: ['Yes', 'No', 'Not sure'], flag: (v) => v !== 'Yes',
      q: 'Does the policy cover rental / hire use?', hint: 'Many private policies don\'t — "not sure" means checking the policy before approval.' },
    { id: 'insurer', kind: 'text', required: true, q: 'Which insurance company, and when does the policy expire?' },
    { id: 'licenceExpiry', kind: 'date', required: true, q: 'When does the revenue licence expire?' },
    { id: 'emission', kind: 'yesno', flag: no, q: 'Is the emission test certificate valid?' },
  ] },
  { id: 'terms', title: 'Rental terms', intro: 'Agree how the car may be used so there are no surprises later.', questions: [
    { id: 'lowestPrice', kind: 'number', required: true,
      q: 'You asked {asking}. What is the lowest daily price you would accept?', hint: 'Our commission comes from the rental price — note the room to agree.' },
    { id: 'use', kind: 'choice', required: true, options: ['Self-drive and with driver', 'With our driver only', 'Self-drive only'],
      q: 'May customers drive it themselves, or only with a driver?' },
    { id: 'areas', kind: 'choice', options: ['Anywhere in Sri Lanka', 'No hill country', 'Western Province only', 'Other'], detailsWhen: ['Other'], detailsLabel: 'Which limits?',
      q: 'Anywhere it should NOT go (hill country, long distance)?' },
    { id: 'availability', kind: 'text', required: true,
      q: 'When is the car free to rent, and are there days you need it back?', hint: 'e.g. Available from 5 Nov, needs it every Poya day' },
    { id: 'notice', kind: 'choice', options: ['1 day', '3 days', '1 week', '2 weeks'],
      q: 'How much notice do you need to take the car back for your own use?' },
    { id: 'keptAt', kind: 'text', required: true, q: 'Where is the car kept, and where can we collect and return it?' },
  ] },
  { id: 'contact', title: 'Contacts & payouts', intro: 'Someone must answer when there is a breakdown or accident.', questions: [
    { id: 'altContact', kind: 'text', required: true,
      q: 'If we can\'t reach you during a rental, who should we call? (name and number)' },
    { id: 'maintenance', kind: 'choice', options: ['Owner arranges repairs', 'Company arranges, owner pays', 'Discuss case by case'],
      q: 'If it breaks down, who arranges the repairs?' },
    { id: 'bankName', kind: 'text', q: 'Which bank should we pay you into? (bank and branch)' },
    { id: 'bankAccount', kind: 'text', q: 'Account number and the name on the account', hint: 'Saved to the owner record when the application is approved.' },
  ] },
  { id: 'consent', title: 'Responsibilities explained', intro: 'Read these out and make sure the owner agrees.', questions: [
    { id: 'explainedVerify', kind: 'yesno', required: true, flag: no,
      q: 'We check every customer\'s NIC / passport and driving licence and record the car\'s condition at every handover. Is that clear?' },
    { id: 'explainedDamage', kind: 'yesno', required: true, flag: no,
      q: 'Damage during a rental is claimed from the customer and the insurance; we help with the claim. Do you agree?' },
    { id: 'explainedPayout', kind: 'yesno', required: true, flag: no,
      q: 'You are paid the agreed rental income minus our commission after each completed rental. Do you agree?' },
    { id: 'inspectionOk', kind: 'yesno', required: true, flag: no, detailsWhen: ['Yes'], detailsLabel: 'How and when? (e.g. physical, Sat 10am at Panadura)',
      q: 'Can we inspect the vehicle before it is listed?' },
  ] },
];
export const ALL_QUESTIONS = SECTIONS.flatMap((s) => s.questions);

/** {name}, {nic}, {asking} in the wording → the applicant's details */
export function fill(text: string, a: PartnerApplication) {
  const asking = [a.askingDaily && `Rs ${a.askingDaily.toLocaleString('en-LK')} a day`, a.askingMonthly && `Rs ${a.askingMonthly.toLocaleString('en-LK')} a month`].filter(Boolean).join(' / ') || 'a price';
  return text.replace('{name}', a.name).replace('{nic}', a.nic).replace('{asking}', asking);
}

export interface Answer { value: string; details?: string }
export interface CallAttempt { at: string; by: string; method: string; result: string; note?: string }
export interface Verification {
  attempts: CallAttempt[];
  startedAt?: string;
  startedBy?: string;
  method?: string;
  answers: Record<string, Answer>;
  section?: number;            // where the call got to (resume after a dropped call)
  finishedAt?: string;
  finishedBy?: string;
  verdict?: Verdict;
  summary?: string;
}
export const emptyVerification = (): Verification => ({ attempts: [], answers: {} });

export const answered = (v: Verification | undefined, q: Question) => !!v?.answers[q.id]?.value?.trim();
export const flagged = (v: Verification | undefined) =>
  ALL_QUESTIONS.filter((q) => q.flag && answered(v, q) && q.flag(v!.answers[q.id].value));
export const unanswered = (v: Verification | undefined, section?: Section) =>
  (section ? section.questions : ALL_QUESTIONS).filter((q) => q.required && !answered(v, q));

export interface Missing { label: string; critical: boolean; where: 'call' | 'docs' | 'photos' | 'inspection' }

/** What still stops approval (critical) or should be collected (not critical) */
export function missingForApproval(a: PartnerApplication): Missing[] {
  if (a.status === 'Approved' || a.status === 'Rejected' || a.status === 'Withdrawn') return [];
  const v = a.verification;
  const out: Missing[] = [];
  if (!v?.finishedAt) out.push({ label: v?.startedAt ? 'Finish the owner check call' : 'Owner check call', critical: true, where: 'call' });
  else if (v.verdict === 'Not verified — do not list') out.push({ label: 'Owner not verified', critical: true, where: 'call' });
  if (a.inspection?.status !== 'Done') out.push({ label: 'Inspection', critical: true, where: 'inspection' });
  else if (a.inspection.result !== 'Passed') out.push({ label: a.inspection.result ? `Inspection: ${a.inspection.result.toLowerCase()}` : 'Inspection result', critical: true, where: 'inspection' });
  const doc = (k: keyof PartnerApplication['documents'], label: string, critical = true) => { if (!a.documents[k]) out.push({ label, critical, where: 'docs' }); };
  doc('cr', 'CR copy'); doc('nicFront', 'NIC front'); doc('nicBack', 'NIC back');
  doc('insurance', 'Insurance certificate'); doc('revenueLicence', 'Revenue licence');
  if (a.photos.length < 4) out.push({ label: `Vehicle photos (${a.photos.length} of 4)`, critical: false, where: 'photos' });
  if (v?.finishedAt && !v.answers.bankAccount?.value) out.push({ label: 'Bank details for payouts', critical: false, where: 'call' });
  return out;
}
