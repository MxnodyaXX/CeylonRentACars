/* =====================================================================
   Inquiry Consultation — rules and helpers
   Original inquiry (what the customer submitted) → Confirmed requirement
   (what staff found out) → Proposal (vehicles suggested) → Outcome.
   The suitability check is system-generated, not staff judgment.
   ===================================================================== */
import type { BookingAgreement, Consultation, Inquiry, InquiryStage, Vehicle } from '../types';

export const CONTACT_METHODS = ['WhatsApp call', 'Normal call', 'WhatsApp chat', 'Other'] as const;
export const CONTACT_STATUSES = ['Connected', 'No answer', 'Busy', 'Call back requested', 'Wrong number'] as const;
export const PRIORITIES = ['Budget', 'Passenger capacity', 'Fuel economy', 'Comfort', 'Luxury', 'Luggage space', 'Automatic transmission', 'Specific model', 'SUV'] as const;
export const SPECIAL = ['Child seat', 'Extra driver', 'Airport pickup', 'Driver service', 'Wedding / event', 'Long-distance tour', 'Roof rack / extra luggage', 'Accessibility needs'] as const;
/**
 * Why the customer is renting — this changes what a good vehicle is. Each purpose gives staff
 * what to ask, what to recommend, a typical daily distance, and how suggestions are ranked.
 */
export interface Purpose {
  id: string;
  hint: string;
  ask: string[];
  recommend: string;
  kmPerDay: [number, number];
  weights: { eco?: number; cost?: number; comfort?: number; luxury?: number; small?: number; luggage?: number; hill?: number };
}
export const PURPOSES: Purpose[] = [
  { id: 'Holiday / tour', hint: 'Tourists & visitors touring the island',
    ask: ['Which places and hotels are on the route?', 'Self drive, or would they prefer a driver?', 'How much luggage per person?'],
    recommend: 'A comfortable vehicle with luggage space that handles hill roads. Foreign visitors without an IDP need a driver.',
    kmPerDay: [150, 250], weights: { comfort: 8, luggage: 2, hill: 8, eco: 3 } },
  { id: 'Business / company', hint: 'Company staff, sales & marketing teams on field work',
    ask: ['Company name — and is a company invoice needed?', 'How many staff will use it, and for how long?', 'Roughly how many km a day?'],
    recommend: 'Fuel-efficient, reliable vehicles with the lowest total cost. Offer weekly / monthly rates for longer contracts.',
    kmPerDay: [100, 200], weights: { eco: 12, cost: 10 } },
  { id: 'Daily use (1 day)', hint: 'Errands, appointments or a single day out',
    ask: ['Exact pickup and return times?', 'Mostly city driving?'],
    recommend: 'A small, economical, easy-to-park car at the lowest price.',
    kmPerDay: [50, 120], weights: { cost: 12, small: 8, eco: 4 } },
  { id: 'Airport transfer', hint: 'Arrival or departure at Colombo airport (CMB)',
    ask: ['Flight number and landing time?', 'How many bags?', 'Meet & greet with a driver?'],
    recommend: 'Enough luggage space for everyone; usually with a driver or meet & greet.',
    kmPerDay: [60, 150], weights: { luggage: 3, comfort: 4 } },
  { id: 'Wedding / event', hint: 'Weddings, homecomings, functions, VIP use',
    ask: ['Event date, venue and timing?', 'Decorations allowed or needed?', 'With a chauffeur?'],
    recommend: 'A luxury or premium car, usually with a chauffeur. Confirm decorations and timing.',
    kmPerDay: [40, 120], weights: { luxury: 15, comfort: 6 } },
  { id: 'Visiting family', hint: 'Sri Lankans living abroad visiting home',
    ask: ['How many family members will travel together?', 'Mostly home town or touring too?'],
    recommend: 'Space for the family and their luggage, comfortable for long drives home and around.',
    kmPerDay: [100, 200], weights: { comfort: 6, luggage: 2, eco: 4 } },
  { id: 'Long-term (monthly)', hint: 'A month or longer',
    ask: ['Start date and how many months?', 'Monthly km estimate?', 'Personal or company use?'],
    recommend: 'An economical, reliable car. Offer a monthly rate and a service plan.',
    kmPerDay: [60, 120], weights: { eco: 10, cost: 10 } },
];
export const purposeOf = (c?: Consultation) => PURPOSES.find((p) => p.id === c?.purpose);

export const LEAD_QUALITY =['Hot', 'Warm', 'Cold', 'Follow-up required', 'Not interested'] as const;
export const NEXT_ACTIONS = [
  'Send quotation', 'Wait for customer confirmation', 'Call again', 'Customer will WhatsApp documents',
  'Vehicle owner confirmation required', 'Management approval required', 'Send payment link', 'Other',
];
export const LOST_REASONS = [
  'Price too high', 'Vehicle unavailable', 'Customer changed plans', 'Went with a competitor',
  "Requirement couldn't be fulfilled", 'No response', 'Other',
];

export const STAGES: { id: InquiryStage; label: string; cls: string }[] = [
  { id: 'NEW', label: 'New', cls: 'bg-brand-500 text-white' },
  { id: 'CONTACTING', label: 'Contacting', cls: 'bg-amber-100 text-amber-800' },
  { id: 'CONSULTATION', label: 'Consultation', cls: 'bg-violet-100 text-violet-700' },
  { id: 'OPTIONS_SENT', label: 'Options sent', cls: 'bg-sky-100 text-sky-700' },
  { id: 'QUOTATION_SENT', label: 'Quotation sent', cls: 'bg-blue-100 text-blue-700' },
  { id: 'CUSTOMER_DECISION', label: 'Awaiting decision', cls: 'bg-indigo-100 text-indigo-700' },
  { id: 'CONFIRMED', label: 'Confirmed — ready to book', cls: 'bg-teal-100 text-teal-700' },
  { id: 'BOOKED', label: 'Booked', cls: 'bg-emerald-100 text-emerald-700' },
  { id: 'FOLLOW_UP_REQUIRED', label: 'Follow-up required', cls: 'bg-orange-100 text-orange-700' },
  { id: 'NO_RESPONSE', label: 'No response', cls: 'bg-navy-100 text-navy-600' },
  { id: 'CANCELLED', label: 'Cancelled', cls: 'bg-navy-100 text-navy-600' },
  { id: 'LOST', label: 'Lost', cls: 'bg-red-100 text-red-700' },
];
/** Order of the main path (for "only move forward" when stages are set automatically) */
const PATH: InquiryStage[] = ['NEW', 'CONTACTING', 'CONSULTATION', 'OPTIONS_SENT', 'QUOTATION_SENT', 'CUSTOMER_DECISION', 'CONFIRMED', 'BOOKED'];

export const PAYMENT_METHODS = ['Cash', 'Bank transfer', 'Card', 'Online payment'] as const;
export const BALANCE_DUE = ['Before pickup', 'At pickup', 'At return'] as const;
export const CONFIRMED_VIA = ['Call', 'WhatsApp', 'Email', 'In person'] as const;

/**
 * The customer's CURRENT vehicle choice. Staff picks (choiceLog) and website picks
 * (the /alternatives page moves the inquiry's vehicle and records vehicleHistory) are
 * compared by time — the latest one wins, so a change of mind on the website is never missed.
 */
export function currentChoice(inq: Inquiry): { vehicleId?: string; source?: 'Staff' | 'Website'; at?: string } {
  const c = inq.consultation;
  const staff = c?.choiceLog?.[c.choiceLog.length - 1];
  const webAt = inq.vehicleHistory?.length ? inq.vehicleHistory[inq.vehicleHistory.length - 1].replacedAt : undefined;
  if (webAt && (!staff || webAt > staff.at)) return { vehicleId: inq.vehicleId, source: 'Website', at: webAt };
  if (staff) return { vehicleId: staff.vehicleId, source: 'Staff', at: staff.at };
  return { vehicleId: c?.selectedVehicleId ?? inq.vehicleId };
}

export const stageOf = (inq: Inquiry): InquiryStage =>
  inq.status === 'Converted' ? 'BOOKED' : inq.status === 'Lost' ? (inq.stage === 'CANCELLED' || inq.stage === 'NO_RESPONSE' ? inq.stage : 'LOST') : inq.stage ?? 'NEW';
export const stageInfo = (s: InquiryStage) => STAGES.find((x) => x.id === s) ?? STAGES[0];

/** Move along the main path automatically, but never backwards (side branches are set by staff) */
export function advance(current: InquiryStage | undefined, to: InquiryStage): InquiryStage {
  const a = PATH.indexOf(current ?? 'NEW'), b = PATH.indexOf(to);
  if (a < 0) return to;              // was on a side branch (e.g. follow-up) → back on the path
  return b > a ? to : (current ?? 'NEW');
}

export const emptyConsultation = (by: string): Consultation => ({ startedAt: new Date().toISOString(), startedBy: by, attempts: [] });

export const passengers = (c?: Consultation) => (c?.adults ?? 0) + (c?.children ?? 0) + (c?.infants ?? 0);
const rate = (v: Vehicle) => v.webPrice ?? v.dailyRent ?? 0;
const nameOf = (v: Vehicle) => `${v.brand} ${v.model}`;

/** Days between the confirmed pickup and return (falls back to the original dates) */
export function consultDays(inq: Inquiry, c?: Consultation) {
  const from = c?.pickupAt ?? (inq.startDate ? `${inq.startDate}T10:00` : '');
  const to = c?.returnAt ?? (inq.endDate ? `${inq.endDate}T10:00` : '');
  if (!from || !to) return 1;
  return Math.max(1, Math.ceil((new Date(to).getTime() - new Date(from).getTime()) / 864e5));
}
export const consultDates = (inq: Inquiry, c?: Consultation) => ({
  start: (c?.pickupAt ?? inq.startDate ?? '').slice(0, 10),
  end: (c?.returnAt ?? inq.endDate ?? '').slice(0, 10),
});

/**
 * Typical luggage capacity in large suitcases — the fleet has no luggage field, so it is
 * estimated from category and seats (a van takes far more than a hatchback).
 */
export function luggageOf(v: Vehicle): number {
  const cat = (v.webCategory ?? '').toLowerCase();
  const seats = v.seats ?? 5;
  if (cat === 'van' || seats >= 9) return 6;
  if (cat === 'suv') return seats >= 7 ? 3 : 4;
  if (seats >= 7) return 3;               // 7-seat MPV with all rows up
  if (cat === 'luxury' || cat === 'sedan') return 3;
  return 2;                                // economy / hatchback / kei car
}
/* ---------- Trip cost: daily rate × days + extra km ---------- */

export interface TripCost {
  rate: number; days: number; base: number;
  includedKm: number; km: number; extraKm: number; extraRate: number; extraCost: number; total: number;
}
/** Same defaults as the rest of the admin: 100 included km per day, Rs 50 per extra km */
export function tripCost(v: Vehicle, days: number, km?: number): TripCost {
  const rate = v.webPrice ?? v.dailyRent ?? 0;
  const base = rate * days;
  const includedKm = (v.includedKmPerDay ?? 100) * days;
  const extraKm = Math.max(0, (km ?? 0) - includedKm);
  const extraRate = v.extraKmRate ?? 50;
  const extraCost = extraKm * extraRate;
  return { rate, days, base, includedKm, km: km ?? 0, extraKm, extraRate, extraCost, total: base + extraCost };
}
const rsN = (n: number) => `Rs ${Math.round(n).toLocaleString('en-LK')}`;
/** "Rs 6,500 × 5 days = Rs 32,500 + 300 km × Rs 50 = Rs 15,000 → Rs 47,500" */
export function costLine(t: TripCost) {
  const base = `${rsN(t.rate)} × ${t.days} day${t.days === 1 ? '' : 's'} = ${rsN(t.base)}`;
  if (!t.km) return base;
  if (!t.extraKm) return `${base} · ${t.km.toLocaleString('en-LK')} km within the ${t.includedKm.toLocaleString('en-LK')} km included`;
  return `${base} + ${t.extraKm.toLocaleString('en-LK')} extra km × ${rsN(t.extraRate)} = ${rsN(t.extraCost)}`;
}

/* ---------- Hill country ---------- */

const HILL_PLACES = /kandy|nuwara\s*eliya|ella\b|haputale|bandarawela|badulla|hatton|horton|knuckles|adam'?s\s*peak|sri\s*pada|welimada|talawakele|maskeliya|kitulgala|nanu\s*oya|hill/i;
/** Trip goes into the hill country — set by staff, or detected from the route */
export const isHillTrip = (c?: Consultation) => c?.hillCountry ?? HILL_PLACES.test(c?.areas ?? '');
export const hillDetected = (c?: Consultation) => HILL_PLACES.test(c?.areas ?? '');
/** Kei cars / very small engines — usually struggle loaded on steep hill roads (used when the vehicle isn't set) */
const SMALL_CAR = /wagon\s*r|alto|clipper|every|hustler|spacia|mira|move|tanto|n-?box|celerio|cuore|dayz|viva|nano/i;

/** Seats left for passengers (a driver takes one when the customer hires with driver) */
export const passengerSeats = (v: Vehicle, c?: Consultation) => Math.max(0, (v.seats ?? 5) - (c?.mode === 'With driver' ? 1 : 0));

export interface Check { label: string; ok: boolean | null; detail: string }
export interface Suitability { vehicle: Vehicle; checks: Check[]; verdict: 'Recommended' | 'Suitable with notes' | 'Not recommended'; score: number; cost: TripCost }

/** System-generated fit of one vehicle against the confirmed requirement */
export function suitability(v: Vehicle, inq: Inquiry, c: Consultation | undefined, isAvailable: (id: string, s: string, e: string) => boolean): Suitability {
  const checks: Check[] = [];
  const pax = passengers(c);
  const seats = passengerSeats(v, c);
  if (pax) checks.push({ label: 'Passengers', ok: seats >= pax, detail: `${pax} travelling · ${seats} passenger seats${c?.mode === 'With driver' ? ' (driver takes one)' : ''}` });
  const bags = c?.largeBags ?? 0;
  if (bags) {
    const cap = luggageOf(v);
    checks.push({ label: 'Luggage', ok: cap >= bags, detail: `${bags} large bag${bags === 1 ? '' : 's'} · fits about ${cap}` });
  }
  // Budget is checked on the REAL trip cost: daily rate × days + extra km for the customer's distance
  const days = consultDays(inq, c);
  const cost = tripCost(v, days, c?.distanceKm);
  const max = c?.budgetMaxPerDay ?? c?.budgetPerDay;
  if (max) {
    const perDay = cost.total / days;
    const over = perDay > max;
    checks.push({
      label: 'Budget', ok: over ? (c?.budgetFlexible ? null : false) : true,
      detail: `${rsN(cost.total)} for the trip (${rsN(perDay)}/day${cost.extraCost ? ' incl. extra km' : ''}) · budget ${rsN(max)}/day${over && c?.budgetFlexible ? ' (flexible)' : ''}`,
    });
  }
  if (c?.distanceKm) {
    checks.push({
      label: 'Distance', ok: true,   // information only — extra km is a cost, not a reason the vehicle can't do the trip
      detail: cost.extraKm ? `${cost.extraKm.toLocaleString('en-LK')} km over the ${cost.includedKm.toLocaleString('en-LK')} km included (+${rsN(cost.extraCost)})` : `${c.distanceKm.toLocaleString('en-LK')} km — within the ${cost.includedKm.toLocaleString('en-LK')} km included`,
    });
  }
  if (isHillTrip(c)) {
    const small = SMALL_CAR.test(`${v.brand} ${v.model}`);
    checks.push(v.hillSuitable === false ? { label: 'Hill country', ok: false, detail: 'Marked not suitable for steep hill roads' }
      : v.hillSuitable === true ? { label: 'Hill country', ok: true, detail: 'Suitable for hill roads' }
      : small ? { label: 'Hill country', ok: null, detail: 'Small engine — may struggle loaded on steep roads (not set on the vehicle)' }
      : { label: 'Hill country', ok: null, detail: 'Not set on the vehicle — check before offering' });
  }
  if (c?.priorities?.includes('Automatic transmission')) {
    const auto = /auto|cvt/i.test(v.transmission ?? '');
    checks.push({ label: 'Transmission', ok: auto, detail: v.transmission || 'Unknown' });
  }
  if (c?.priorities?.includes('SUV')) checks.push({ label: 'SUV', ok: (v.webCategory ?? '').toLowerCase() === 'suv', detail: v.webCategory || 'Not set' });
  if (c?.priorities?.includes('Fuel economy')) {
    const eco = /hybrid|electric/i.test(v.fuelType ?? '') || (v.fuelEfficiency ?? 0) >= 15;
    checks.push({ label: 'Fuel economy', ok: eco ? true : null, detail: `${v.fuelType ?? '—'}${v.fuelEfficiency ? ` · ${v.fuelEfficiency} km/l` : ''}` });
  }
  const { start, end } = consultDates(inq, c);
  if (start && end) checks.push({ label: 'Availability', ok: isAvailable(v.id, start, end), detail: `${start} → ${end}` });
  if (v.status && /maint|repair|inactive/i.test(v.status)) checks.push({ label: 'Vehicle status', ok: false, detail: v.status });

  const failed = checks.filter((x) => x.ok === false).length;
  const soft = checks.filter((x) => x.ok === null).length;
  const verdict = failed ? 'Not recommended' : soft ? 'Suitable with notes' : 'Recommended';
  // score for ranking alternatives: fit first, then the customer's priorities
  let score = 100 - failed * 40 - soft * 10;
  const p = c?.priorities ?? [];
  if (p.includes('Budget') && max) score += Math.max(0, 15 - Math.round((cost.total / days / max) * 10));
  if (isHillTrip(c) && v.hillSuitable === true) score += 8;
  // Travel purpose: what a "good" vehicle means for this kind of trip
  const w = purposeOf(c)?.weights;
  if (w) {
    const cat = (v.webCategory ?? '').toLowerCase();
    const eco = /hybrid|electric/i.test(v.fuelType ?? '') || (v.fuelEfficiency ?? 0) >= 15;
    if (w.eco && eco) score += w.eco;
    if (w.cost) score += Math.max(0, w.cost - Math.round(cost.total / days / 2000));   // cheaper per day → higher
    if (w.comfort && /luxury|suv|sedan|van/.test(cat)) score += w.comfort;
    if (w.luxury && /luxury/.test(cat)) score += w.luxury;
    if (w.small && (v.seats ?? 5) <= 5 && /economy|hybrid|^$/.test(cat)) score += w.small;
    if (w.luggage) score += luggageOf(v) * w.luggage;
    if (w.hill && v.hillSuitable === true) score += w.hill;
  }
  if (p.includes('Comfort') || p.includes('Luxury')) score += /luxury|suv|sedan/i.test(v.webCategory ?? '') ? 10 : 0;
  if (p.includes('Luggage space')) score += luggageOf(v) * 2;
  if (p.includes('Passenger capacity') && pax) score += Math.min(6, seats - pax) >= 0 ? 4 : 0;
  // don't over-size: a 14-seat van for 2 people is not a good suggestion
  if (pax && seats - pax > 4) score -= (seats - pax - 4) * 3;
  return { vehicle: v, checks, verdict, score, cost };
}

/** Best vehicles in the fleet for the confirmed requirement (available, fitting, ranked by priorities) */
export function recommend(inq: Inquiry, c: Consultation | undefined, vehicles: Vehicle[], isAvailable: (id: string, s: string, e: string) => boolean, excludeId?: string, n = 3) {
  return vehicles
    .filter((v) => v.id !== excludeId)
    .map((v) => suitability(v, inq, c, isAvailable))
    .filter((s) => s.verdict !== 'Not recommended')
    .sort((a, b) => b.score - a.score || a.cost.total - b.cost.total)
    .slice(0, n);
}

/** What changed between what the customer submitted and what staff confirmed */
export function requirementDiff(c?: Consultation) {
  if (!c) return [];
  const pax = passengers(c);
  return [
    pax ? `${pax} passengers${c.largeBags ? ` + ${c.largeBags} large bag${c.largeBags === 1 ? '' : 's'}` : ''}` : '',
    c.requirement ?? '',
  ].filter(Boolean);
}

const fmt = (d?: string) => (d ? new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '');

/** Clean, permanent consultation summary attached to the inquiry (and carried into the booking) */
export function buildSummary(inq: Inquiry, c: Consultation, vehicles: Vehicle[], fit?: Suitability) {
  const v = (id?: string) => vehicles.find((x) => x.id === id);
  const lines: string[] = [];
  const pax = passengers(c);
  lines.push(`CONSULTATION — ${fmt(c.completedAt ?? new Date().toISOString())} by ${c.startedBy}`);
  lines.push('');
  lines.push(`Original inquiry: ${inq.requestedVehicle}${inq.startDate ? ` · ${inq.startDate} → ${inq.endDate}` : ''}`);
  if (c.purpose) lines.push(`Travel purpose: ${c.purpose}${c.companyName ? ` — ${c.companyName}` : ''}${c.invoiceRequired ? ' (company invoice required)' : ''}`);
  const req = [
    pax ? `${pax} passengers (${c.adults ?? 0} adults${c.children ? `, ${c.children} children` : ''}${c.infants ? `, ${c.infants} infants` : ''})` : '',
    c.largeBags || c.smallBags ? `${c.largeBags ?? 0} large + ${c.smallBags ?? 0} small bags` : '',
    c.mode ?? '',
    c.usage ? `${c.usage.toLowerCase()} travel` : '',
    c.areas ? `route: ${c.areas}` : '',
  ].filter(Boolean);
  if (req.length) lines.push(`Confirmed requirement: ${req.join(' · ')}`);
  if (c.requirement) lines.push(`Requirement note: ${c.requirement}`);
  if (c.pickupLocation || c.pickupAt) lines.push(`Pickup: ${[c.pickupLocation, fmt(c.pickupAt)].filter(Boolean).join(' · ')}${c.airportDelivery ? ' (airport delivery)' : ''}`);
  if (c.returnLocation || c.returnAt) lines.push(`Return: ${[c.differentReturn ? c.returnLocation : c.returnLocation || 'same as pickup', fmt(c.returnAt)].filter(Boolean).join(' · ')}`);
  if (c.priorities?.length) lines.push(`Priorities: ${c.priorities.join(', ')}`);
  if (c.budgetPerDay || c.budgetMaxPerDay) {
    const parts = [
      c.budgetPerDay ? `about Rs ${c.budgetPerDay.toLocaleString('en-LK')}/day` : '',
      c.budgetMaxPerDay ? `max Rs ${c.budgetMaxPerDay.toLocaleString('en-LK')}/day` : '',
    ].filter(Boolean);
    lines.push(`Budget: ${parts.join(', ')}${c.budgetFlexible ? ' (flexible)' : ''}`);
  }
  if (c.distanceKm) lines.push(`Expected distance: about ${c.distanceKm.toLocaleString('en-LK')} km${isHillTrip(c) ? ' · includes hill country' : ''}`);
  else if (isHillTrip(c)) lines.push('Route includes hill country');
  const quoted = v(c.selectedVehicleId) ?? fit?.vehicle;
  if (quoted) {
    const t = tripCost(quoted, consultDays(inq, c), c.distanceKm);
    lines.push(`Estimated cost (${nameOf(quoted)}): ${costLine(t)} → ${rsN(t.total)}`);
  }
  if (c.mode === 'Self drive') lines.push(`Driving: ${c.licence ?? 'licence not confirmed'} licence${c.licence === 'Foreign' ? (c.idp ? ' + IDP' : ' — IDP NOT confirmed') : ''}${c.nationality ? ` · ${c.nationality}` : ''}`);
  if (c.special?.length || c.specialNotes) lines.push(`Special: ${[...(c.special ?? []), c.specialNotes].filter(Boolean).join(', ')}`);
  if (fit) lines.push(`Original vehicle suitability: ${fit.verdict}${fit.checks.filter((x) => x.ok === false).length ? ` (${fit.checks.filter((x) => x.ok === false).map((x) => x.label.toLowerCase()).join(', ')})` : ''}`);
  if (c.suggested?.length) lines.push(`Suggested: ${c.suggested.map((id) => v(id) ? nameOf(v(id)!) : id).join(', ')}`);
  if (c.selectedVehicleId) lines.push(`Customer selected: ${v(c.selectedVehicleId) ? nameOf(v(c.selectedVehicleId)!) : c.selectedVehicleId}`);
  if (inq.quote) lines.push(`Quotation: Rs ${inq.quote.total.toLocaleString('en-LK')} (deposit Rs ${inq.quote.deposit.toLocaleString('en-LK')}) — ${inq.quote.status}`);
  if (c.mode === 'Self drive') lines.push('Documents required: driving licence' + (c.licence === 'Foreign' ? ', International Driving Permit, passport' : ', NIC'));
  if (c.leadQuality) lines.push(`Lead quality: ${c.leadQuality}`);
  if (c.nextAction) lines.push(`Next action: ${c.nextAction}${c.nextFollowUpAt ? ` — ${fmt(c.nextFollowUpAt)}` : ''}`);
  if (c.customerNotes) { lines.push(''); lines.push(`Customer notes: ${c.customerNotes}`); }
  return lines.join('\n');
}

/** Price of an agreement: rate × days + extra km + extras − discount */
export const agreementTotal = (a: Pick<BookingAgreement, 'dailyRate' | 'days' | 'extraKmCost' | 'extras' | 'discount'>) =>
  Math.max(0, a.dailyRate * a.days + a.extraKmCost + a.extras - a.discount);

/** Booking-form prefill from the agreed terms (Bookings page reads this as location.state.fromInquiry) */
export function bookingFromAgreement(inq: Inquiry, a: BookingAgreement, email?: string) {
  const hm = (dt?: string) => (dt && dt.length >= 16 ? dt.slice(11, 16) : undefined);
  const fmtDt = (dt?: string) => (dt ? new Date(dt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '');
  return {
    customerName: inq.customerName,
    customerPhone: inq.customerPhone,
    customerEmail: email,
    vehicleId: a.vehicleId,
    startDate: a.pickupAt?.slice(0, 10) || inq.startDate,
    endDate: a.returnAt?.slice(0, 10) || inq.endDate,
    startTime: hm(a.pickupAt),
    endTime: hm(a.returnAt),
    pickupLocation: a.pickupLocation,
    dropLocation: a.returnLocation || a.pickupLocation,
    totalAmount: a.total,
    paidAmount: a.advanceAmount,
    depositAmount: a.depositAmount,
    depositType: a.depositType,
    totalKm: a.distanceKm,
    notes: [
      `AGREED TERMS (confirmed via ${a.confirmedVia}, ${fmtDt(a.confirmedAt)} by ${a.confirmedBy})`,
      `${a.vehicle}${a.mode ? ` · ${a.mode}` : ''}`,
      `${rsN(a.dailyRate)} × ${a.days} day${a.days === 1 ? '' : 's'}${a.extraKmCost ? ` + extra km ${rsN(a.extraKmCost)}` : ''}${a.extras ? ` + extras ${rsN(a.extras)}` : ''}${a.discount ? ` − discount ${rsN(a.discount)}` : ''} = ${rsN(a.total)}`,
      a.distanceKm ? `Expected distance: about ${a.distanceKm.toLocaleString('en-LK')} km` : '',
      `Advance: ${rsN(a.advanceAmount)} by ${a.paymentMethod} · balance ${rsN(Math.max(0, a.total - a.advanceAmount))} due ${a.balanceDue.toLowerCase()}`,
      a.depositAmount ? `Refundable deposit: ${rsN(a.depositAmount)} (${a.depositType})` : '',
      a.notes ? `Notes: ${a.notes}` : '',
      inq.consultation?.summary ? `\n${inq.consultation.summary}` : '',
    ].filter(Boolean).join('\n'),
  };
}

/** What is still missing before the consultation can be finished */
export function missing(c?: Consultation) {
  const m: string[] = [];
  if (!c) return ['Start the consultation'];
  if (!c.purpose) m.push('Travel purpose');
  if (!passengers(c)) m.push('Passengers');
  if (!c.distanceKm) m.push('Expected km');
  if (!c.mode) m.push('Self drive / with driver');
  if (!c.pickupLocation) m.push('Exact pickup location');
  if (!c.leadQuality) m.push('Lead quality');
  if (!c.nextAction) m.push('Next action');
  if (c.nextAction && c.nextAction !== 'Other' && !c.nextFollowUpAt && c.leadQuality !== 'Not interested') m.push('Next follow-up date');
  return m;
}
