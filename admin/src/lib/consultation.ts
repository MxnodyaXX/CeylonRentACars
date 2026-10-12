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
  /** One natural opening question that covers route, people and bags for this kind of trip */
  opener: string;
  /** What to listen for in the answer */
  listen: string;
  recommend: string;
  kmPerDay: [number, number];
  weights: { eco?: number; cost?: number; comfort?: number; luxury?: number; small?: number; luggage?: number; hill?: number };
}
export const PURPOSES: Purpose[] = [
  { id: 'Holiday / tour', hint: 'Tourists & visitors touring the island',
    opener: 'Which places are you planning to visit, and how many people and bags will be travelling?',
    listen: 'Ella, Nuwara Eliya or Kandy → hill country: vehicles not suited to hill roads are flagged.',
    recommend: 'A comfortable vehicle with luggage space that handles hill roads. Foreign visitors without an IDP need a driver.',
    kmPerDay: [150, 250], weights: { comfort: 8, luggage: 2, hill: 8, eco: 3 } },
  { id: 'Business / company', hint: 'Company staff, sales & marketing teams on field work',
    opener: 'Which company is this for, how many staff will use the vehicle, and roughly how many km a day?',
    listen: 'Company invoice, weekly / monthly use, mostly city or long distance.',
    recommend: 'Fuel-efficient, reliable vehicles with the lowest total cost. Offer weekly / monthly rates for longer contracts.',
    kmPerDay: [100, 200], weights: { eco: 12, cost: 10 } },
  { id: 'Daily use (1 day)', hint: 'Errands, appointments or a single day out',
    opener: 'What time do you need it from and until, and will it be mostly city driving?',
    listen: 'Short city trips → small, economical car.',
    recommend: 'A small, economical, easy-to-park car at the lowest price.',
    kmPerDay: [50, 120], weights: { cost: 12, small: 8, eco: 4 } },
  { id: 'Airport transfer', hint: 'Arrival or departure at Colombo airport (CMB)',
    opener: 'What is your flight number and landing time, and how many people and bags are arriving?',
    listen: 'Bags matter more than seats here; an onward trip after the airport → ask the route.',
    recommend: 'Enough luggage space for everyone; usually with a driver or meet & greet.',
    kmPerDay: [60, 150], weights: { luggage: 3, comfort: 4 } },
  { id: 'Wedding / event', hint: 'Weddings, homecomings, functions, VIP use',
    opener: 'When and where is the event, and will you need a chauffeur and decorations?',
    listen: 'Timing on the day, decorations, bridal / VIP car.',
    recommend: 'A luxury or premium car, usually with a chauffeur. Confirm decorations and timing.',
    kmPerDay: [40, 120], weights: { luxury: 15, comfort: 6 } },
  { id: 'Visiting family', hint: 'Sri Lankans living abroad visiting home',
    opener: 'How many of the family will travel together, and will you mostly stay around home or tour the island too?',
    listen: 'Elderly parents or small children → comfort and child seats; touring → ask the route.',
    recommend: 'Space for the family and their luggage, comfortable for long drives home and around.',
    kmPerDay: [100, 200], weights: { comfort: 6, luggage: 2, eco: 4 } },
  { id: 'Long-term (monthly)', hint: 'A month or longer',
    opener: 'How many months do you need it for, roughly how many km a month, and is it personal or company use?',
    listen: 'Company use → invoice; high monthly km → fuel economy.',
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
    c.largeBags || c.smallBags ? `${c.largeBags ?? 0} large + ${c.smallBags ?? 0} small bags` : c.largeBags === 0 ? 'hand luggage only' : '',
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
  const later = askLater(inq, c);
  if (later.length) lines.push(`To confirm before quotation / booking: ${later.join(', ')}`);
  if (c.leadQuality) lines.push(`Lead quality: ${c.leadQuality}`);
  if (c.nextAction) lines.push(`Next action: ${c.nextAction}${c.nextFollowUpAt ? ` — ${fmt(c.nextFollowUpAt)}` : ''}`);
  if (c.customerNotes) { lines.push(''); lines.push(`Customer notes: ${c.customerNotes}`); }
  if (c.capture?.trim()) { lines.push(''); lines.push(`Customer said: "${c.capture.trim()}"`); }
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

/* =====================================================================
   Guided conversation — a few natural questions, not a questionnaire.
   A question is "answered" as soon as its field is filled (by staff or by
   the quick capture); staff can also mark it Not required or Ask later.
   ===================================================================== */

export type QStatus = 'answered' | 'na' | 'later';
export interface Question {
  id: string;
  label: string;      // short name for lists ("Luggage")
  ask: string;        // how staff can phrase it to the customer
  why?: string;       // what the answer is used for
  core?: boolean;     // one of the 7 main questions
  required?: boolean; // must be answered, marked not required or left for later before finishing
  filled: boolean;    // the field behind it already has a value
}

export function questionsFor(inq: Inquiry, c: Consultation): Question[] {
  const pax = passengers(c);
  const kids = (c.children ?? 0) + (c.infants ?? 0);
  const q: Question[] = [
    { id: 'purpose', core: true, required: true, label: 'Travel purpose', ask: 'What is the rental for — a holiday, business, an airport transfer…?', why: 'Changes what a good vehicle is', filled: !!c.purpose },
    { id: 'passengers', core: true, required: true, label: 'Passengers', ask: 'How many people are travelling, including children?', why: 'Seating capacity', filled: pax > 0 },
    { id: 'route', core: true, required: true, label: 'Route', ask: 'Where are you planning to travel?', why: 'Terrain (hill country) and mileage', filled: !!c.areas?.trim() },
    { id: 'luggage', core: true, required: true, label: 'Luggage', ask: 'How much luggage will you carry?', why: 'Boot capacity', filled: c.largeBags !== undefined || c.smallBags !== undefined },
    { id: 'mode', core: true, required: true, label: 'Self drive / driver', ask: 'Would you like to drive yourself, or have a driver?', why: 'Rental type and licence check', filled: !!c.mode },
    { id: 'vehicle', core: true, label: 'Preferred vehicle / budget', ask: 'Do you have a preferred vehicle or a budget in mind?', why: 'Narrows the options', filled: !!(c.requirement?.trim() || c.budgetPerDay || c.budgetMaxPerDay || c.priorities?.length) },
    { id: 'special', core: true, label: 'Special requirements', ask: 'Anything else we should know — child seats, accessibility, extra comfort?', why: 'Extras and comfort', filled: !!(c.special?.length || c.specialNotes?.trim()) },
    // ---- follow-ups: only shown when they apply ----
    { id: 'dates', required: true, label: 'Pickup & return time', ask: 'What date and time do you need it from, and until?', why: 'Availability and days charged', filled: !!(c.pickupAt && c.returnAt) },
    { id: 'pickupPoint', required: true, label: 'Exact pickup point', ask: 'Where exactly should we hand over the vehicle — hotel, address or landmark?', why: 'Delivery planning', filled: !!c.pickupLocation?.trim() },
    { id: 'distance', required: true, label: 'Expected km', ask: 'Roughly how many kilometres will you drive in total?', why: 'Extra-km cost in the quotation', filled: !!c.distanceKm },
  ];
  if (c.mode === 'Self drive') q.push({ id: 'licence', required: true, label: 'Driving licence', ask: 'Which driving licence do you hold — Sri Lankan or foreign?', why: 'Who can legally self-drive', filled: !!c.licence });
  if (c.mode === 'Self drive' && c.licence === 'Foreign') q.push({ id: 'idp', required: true, label: 'International Driving Permit', ask: 'Do you have an International Driving Permit?', why: 'Required to self-drive with a foreign licence', filled: c.idp === true });
  if (c.purpose === 'Airport transfer' || c.airportDelivery || c.mode === 'Airport pickup') q.push({ id: 'flight', label: 'Flight details', ask: 'What is your flight number and landing time?', why: 'Pickup timing if the flight is late', filled: false });
  if (c.purpose === 'Business / company') q.push({ id: 'company', label: 'Company & invoice', ask: 'Which company is it for, and do you need a company invoice?', why: 'Invoicing', filled: !!c.companyName?.trim() });
  if (c.purpose === 'Wedding / event') q.push({ id: 'event', label: 'Event details', ask: 'What time is the event, where, and are decorations needed?', why: 'Timing on the day', filled: false });
  if (c.purpose === 'Long-term (monthly)') q.push({ id: 'months', label: 'Months & use', ask: 'How many months, and is it personal or company use?', why: 'Monthly rate', filled: false });
  if (kids) q.push({ id: 'childSeats', label: 'Child seats', ask: `Will you need ${kids === 1 ? 'a child seat' : 'child seats'} for the ${kids === 1 ? 'little one' : `${kids} children`}?`, why: 'Safety and extras', filled: !!c.special?.includes('Child seat') || !!c.childSeats });
  if (pax > 9) q.push({ id: 'bigGroup', label: 'One vehicle or two', ask: `For ${pax} people, is one large van fine, or would two vehicles suit you better?`, why: 'Large groups', filled: false });
  if (isHillTrip(c)) q.push({ id: 'hillStay', label: 'Steep / remote stays', ask: 'Are you staying anywhere steep or remote — an estate bungalow, Knuckles, Horton Plains?', why: 'Hill-road suitability', filled: false });
  return q;
}
/** Effective status: a filled field always counts as answered; otherwise what staff set */
export const statusOf = (q: Question, c: Consultation): QStatus | undefined => (q.filled ? 'answered' : c.questions?.[q.id]);

/** The next thing staff could ask, phrased naturally — combines several open questions where it can */
export function nextAsk(inq: Inquiry, c: Consultation): { text: string; listen?: string } | undefined {
  const qs = questionsFor(inq, c);
  const open = qs.filter((q) => !statusOf(q, c));
  if (!open.length) return undefined;
  const isOpen = (id: string) => open.some((q) => q.id === id);
  if (isOpen('purpose')) return { text: 'How can we help — what is the trip for, and how many people will be travelling?', listen: 'One answer usually covers purpose, people and places — use Quick capture.' };
  const p = purposeOf(c);
  if (p && ['route', 'passengers', 'luggage'].filter(isOpen).length >= 2) return { text: p.opener, listen: p.listen };
  const [a, b] = [...open.filter((q) => q.core), ...open.filter((q) => !q.core)];
  return { text: b ? `${a.ask} ${b.ask}` : a.ask, listen: p?.listen };
}

/* ---------- Luggage ---------- */

export const LUGGAGE_PRESETS = [
  { label: 'Hand luggage only', large: 0 },
  { label: '1–2 suitcases', large: 2 },
  { label: '3–4 suitcases', large: 4 },
  { label: '5+ suitcases', large: 6 },
] as const;
export const luggagePreset = (large?: number) =>
  large === undefined ? undefined : large === 0 ? 0 : large <= 2 ? 1 : large <= 4 ? 2 : 3;
/** What kind of vehicle the bags need (matches luggageOf) */
export function luggageNeeds(large?: number) {
  if (!large) return 'Any vehicle';
  if (large <= 2) return 'Any car — even a hatchback takes about 2';
  if (large === 3) return 'Sedan, SUV or 7-seater';
  if (large === 4) return '5-seat SUV or a van';
  return 'Van — about 6 large bags';
}

/* ---------- Quick capture: "We're four people travelling to Ella for five days with three suitcases" ---------- */

const WORD_NUM: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, twenty: 20, couple: 2, 'couple of': 2,
};
const NUM = '(\\d+|couple of|an?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|twenty)';
const toNum = (s: string) => (/^\d+$/.test(s) ? Number(s) : WORD_NUM[s] ?? 0);
const grab = (t: string, re: string) => { const m = t.match(new RegExp(`\\b${NUM}\\s+${re}`, 'i')); return m ? toNum(m[1].toLowerCase()) : undefined; };

/** Places customers mention most — kept in the order they appear in the text */
const PLACES = [
  'Colombo', 'Negombo', 'Airport', 'Kandy', 'Nuwara Eliya', 'Ella', 'Haputale', 'Bandarawela', 'Badulla', 'Hatton', 'Horton Plains',
  "Adam's Peak", 'Knuckles', 'Kitulgala', 'Sigiriya', 'Dambulla', 'Habarana', 'Anuradhapura', 'Polonnaruwa', 'Trincomalee', 'Pasikudah',
  'Batticaloa', 'Arugam Bay', 'Jaffna', 'Yala', 'Udawalawe', 'Tissamaharama', 'Tangalle', 'Mirissa', 'Matara', 'Weligama', 'Galle',
  'Unawatuna', 'Hikkaduwa', 'Bentota', 'Beruwala', 'Kalutara', 'Wilpattu', 'Kalpitiya', 'Pinnawala', 'Ratnapura',
];
const placeRe = (p: string) => new RegExp(`\\b${p.replace(/'/g, "'?").replace(/\s+/g, '\\s*')}\\b`, 'i');

const pad = (n: number) => String(n).padStart(2, '0');
const localDt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

/**
 * Read what the customer said and fill the matching fields. Only fills what it finds —
 * staff can always correct a field afterwards. `start` is the known pickup (for "for five days").
 */
export function parseCapture(text: string, c: Consultation, start?: string): { patch: Partial<Consultation>; found: string[] } {
  const t = ` ${text.toLowerCase().replace(/[’`]/g, "'")} `;
  const patch: Partial<Consultation> = {};
  const found: string[] = [];

  // ---- people ----
  const adults = grab(t, '(?:adults?|grown[- ]?ups?)');
  const children = grab(t, '(?:kids?|children|child)');
  let infants = grab(t, '(?:infants?|babies|baby|toddlers?)');
  if (infants === undefined && /\b(baby|infant|toddler)\b/.test(t)) infants = 1;
  let total = grab(t, '(?:people|persons?|pax|passengers?|travell?ers|of us|guests|staff|members|family members)')
    ?? (t.match(new RegExp(`\\b(?:we are|we're|family of|group of|party of)\\s+${NUM}\\b`)) ? toNum(t.match(new RegExp(`\\b(?:we are|we're|family of|group of|party of)\\s+${NUM}\\b`))![1]) : undefined);
  if (total === undefined && adults === undefined && /\b(honeymoon|my (wife|husband|partner) and i|me and my (wife|husband|partner)|a couple\b(?! of))/.test(t)) total = 2;
  if (adults !== undefined || total !== undefined || children !== undefined || infants !== undefined) {
    const k = (children ?? 0) + (infants ?? 0);
    const a = adults ?? (total !== undefined ? Math.max(1, total - k) : c.adults);
    if (a !== undefined) patch.adults = a;
    if (children !== undefined) patch.children = children;
    if (infants !== undefined) patch.infants = infants;
    const sum = (a ?? 0) + (children ?? c.children ?? 0) + (infants ?? c.infants ?? 0);
    found.push(`${sum} passenger${sum === 1 ? '' : 's'}${k ? ` (${[children ? `${children} child${children === 1 ? '' : 'ren'}` : '', infants ? `${infants} infant${infants === 1 ? '' : 's'}` : ''].filter(Boolean).join(', ')})` : ''}`);
  }

  // ---- luggage ----
  if (/\b(hand luggage only|only hand luggage|no (big )?(luggage|suitcases)|just (a )?backpacks?|travell?ing light)\b/.test(t)) {
    patch.largeBags = 0; found.push('Hand luggage only');
  }
  const large = grab(t, '(?:large |big |check(?:ed)?[- ]?in )?(?:suitcases?|bags?|luggage|cases)');
  if (large !== undefined) { patch.largeBags = large; found.push(`${large} large bag${large === 1 ? '' : 's'}`); }
  const small = grab(t, '(?:small bags?|backpacks?|hand ?bags?|carry[- ]?ons?|cabin bags?)');
  if (small !== undefined) { patch.smallBags = small; found.push(`${small} small bag${small === 1 ? '' : 's'}`); }

  // ---- route ----
  const places = PLACES.map((p) => ({ p, i: t.search(placeRe(p)) })).filter((x) => x.i >= 0).sort((a, b) => a.i - b.i).map((x) => x.p);
  if (places.length) {
    const have = c.areas ?? '';
    const add = places.filter((p) => !placeRe(p).test(have));
    if (add.length) patch.areas = [have.trim(), ...add].filter(Boolean).join(' → ');
    found.push(`Route: ${places.join(', ')}${HILL_PLACES.test(places.join(' ')) ? ' (hill country)' : ''}`);
  }

  // ---- days ----
  // "a day" is a rate ("100 km a day"), not a length — but "a week" / "a month" are lengths
  const m = [...t.matchAll(new RegExp(`\\b${NUM}\\s+(days?|nights?|weeks?|months?)\\b`, 'g'))]
    .find((x) => !/^an?$/.test(x[1]) || /week|month/.test(x[2]));
  if (m) {
    const n = toNum(m[1]);
    const days = /week/.test(m[2]) ? n * 7 : /month/.test(m[2]) ? n * 30 : n;
    if (days > 0) {
      if (start) {
        const from = new Date(start.length > 10 ? start : `${start}T10:00`);
        patch.returnAt = localDt(new Date(from.getTime() + days * 864e5));
        found.push(`${days} day${days === 1 ? '' : 's'} (return set)`);
      } else found.push(`${days} day${days === 1 ? '' : 's'} — set the pickup date`);
      if (/month/.test(m[2]) && !c.purpose) patch.purpose = 'Long-term (monthly)';
    }
  }

  // ---- self drive / driver ----
  if (/\bself[\s-]?driv|drive (it )?(ourselves|myself|themselves|on our own)|without (a )?driver|no driver\b/.test(t)) { patch.mode = 'Self drive'; found.push('Self drive'); }
  else if (/\bwith (a )?driver|chauffeur|driver included|need a driver|want a driver/.test(t)) { patch.mode = 'With driver'; found.push('With driver'); }

  // ---- purpose (only when not chosen yet) ----
  if (!c.purpose && !patch.purpose) {
    const touring = places.filter((p) => !/colombo|negombo|airport/i.test(p)).length > 0;
    const p = /\b(wedding|homecoming|bridal|event)\b/.test(t) ? 'Wedding / event'
      : /\b(business|company|office|field work|sales team|corporate)\b/.test(t) ? 'Business / company'
      : /\b(visiting (my |our )?(family|relatives|parents)|home ?town|back home)\b/.test(t) ? 'Visiting family'
      : /\b(airport|flight|landing|arriv(e|ing|al))\b/.test(t) && !touring ? 'Airport transfer'
      : /\b(holiday|tour|trip|vacation|honeymoon|sightseeing|safari)\b/.test(t) || touring ? 'Holiday / tour'
      : undefined;
    if (p) patch.purpose = p;
  }
  if (patch.purpose) found.push(`Purpose: ${patch.purpose}`);
  if (/\b(pick(ed)? ?up (from|at) (the )?airport|from the airport|airport (pickup|delivery)|meet (us )?at the airport)\b/.test(t)) { patch.airportDelivery = true; found.push('Airport delivery'); }

  // ---- distance & budget ----
  const km = t.match(/\b([\d,]+)\s*km\b(\s*(per|a|\/)\s*day)?/);
  if (km) {
    const n = Number(km[1].replace(/,/g, ''));
    const daysForKm = m ? (/week/.test(m[2]) ? toNum(m[1]) * 7 : /month/.test(m[2]) ? toNum(m[1]) * 30 : toNum(m[1])) : 1;
    if (n) { patch.distanceKm = km[2] ? n * Math.max(1, daysForKm) : n; found.push(`About ${patch.distanceKm.toLocaleString('en-LK')} km`); }
  }
  const money = t.match(/(?:rs\.?|lkr)\s*([\d,]+(?:\.\d+)?)\s*(k\b)?|\b([\d,]+(?:\.\d+)?)\s*(k)?\s*(?:rs|lkr|rupees)\b|\b(\d+(?:\.\d+)?)\s*k\s*(?:per|a|\/)\s*day/);
  if (money && /budget|max|per day|a day|\/day|daily|around|about|under|below/.test(t)) {
    const raw = money[1] ?? money[3] ?? money[5];
    const k = !!(money[2] || money[4] || money[5]);
    const n = Math.round(Number(raw.replace(/,/g, '')) * (k ? 1000 : 1));
    if (n) {
      if (/\b(max|maximum|under|below|not more than|up to)\b/.test(t)) patch.budgetMaxPerDay = n; else patch.budgetPerDay = n;
      found.push(`Budget Rs ${n.toLocaleString('en-LK')}/day`);
    }
  }

  // ---- vehicle wishes & extras ----
  const pri = new Set(c.priorities ?? []);
  if (/\bautomatic\b|\bauto (car|gear|transmission)\b/.test(t)) pri.add('Automatic transmission');
  if (/\bsuv\b/.test(t)) pri.add('SUV');
  if (/\b(cheap|cheapest|low budget|economical|affordable)\b/.test(t)) pri.add('Budget');
  if (/\b(comfortable|comfort)\b/.test(t)) pri.add('Comfort');
  if (/\b(luxury|premium)\b/.test(t)) pri.add('Luxury');
  if (pri.size !== (c.priorities ?? []).length) { patch.priorities = [...pri]; found.push(`Priorities: ${[...pri].filter((p) => !(c.priorities ?? []).includes(p)).join(', ')}`); }
  if (!c.requirement) {
    const want = t.match(/\b(kdh|hiace|van|prius|axio|aqua|vitz|yaris|wagon ?r|alto|premio|allion|montero|prado|land cruiser|noah|voxy|vezel|grace|fit|x-?trail|benz|bmw)\b/);
    if (want) { patch.requirement = `Asked for ${want[1].replace(/\b\w/g, (x) => x.toUpperCase())}`; found.push(patch.requirement); }
  }
  const special = new Set(c.special ?? []);
  if (/\b(child seats?|baby seats?|car seats?|booster)\b/.test(t)) special.add('Child seat');
  if (/\b(wheelchair|elderly|disabled|accessib|mobility)\b/.test(t)) special.add('Accessibility needs');
  if (/\b(roof rack|surf ?boards?|bicycles?|bikes)\b/.test(t)) special.add('Roof rack / extra luggage');
  if (special.size !== (c.special ?? []).length) { patch.special = [...special]; found.push(`Special: ${[...special].filter((s) => !(c.special ?? []).includes(s)).join(', ')}`); }

  return { patch, found };
}

/** Questions left for later — confirmed before the quotation or booking */
export const askLater = (inq: Inquiry, c: Consultation) => questionsFor(inq, c).filter((q) => statusOf(q, c) === 'later').map((q) => q.label);

/** What is still missing before the consultation can be finished (questions marked Not required / Ask later don't count) */
export function missing(inq: Inquiry, c?: Consultation) {
  if (!c) return ['Start the consultation'];
  const m = questionsFor(inq, c).filter((q) => q.required && !statusOf(q, c)).map((q) => q.label);
  if (!c.leadQuality) m.push('Lead quality');
  if (!c.nextAction) m.push('Next action');
  if (c.nextAction && c.nextAction !== 'Other' && !c.nextFollowUpAt && c.leadQuality !== 'Not interested') m.push('Next follow-up date');
  return m;
}
