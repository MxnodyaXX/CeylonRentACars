import type { Booking, KmMeter, VehicleHandover } from '../types';
import type { BdSwap } from './breakdowns';

/* A car's dashboard has the main odometer and trip meters (Trip A / B / C) the driver can reset.
   A reading says which one it came from; km are only worked out between readings of the same meter. */
export const METER_LABEL: Record<KmMeter, string> = { odo: 'Odometer', A: 'Trip A', B: 'Trip B', C: 'Trip C' };
export const meterOf = (m?: string): KmMeter => (m === 'A' || m === 'B' || m === 'C' ? m : 'odo');
/** "24,708 km" or "559 km (Trip B)" */
export const kmWithMeter = (km?: number, m?: KmMeter) => (km == null ? '—' : `${km.toLocaleString('en-LK')} km${meterOf(m) !== 'odo' ? ` (${METER_LABEL[meterOf(m)]})` : ''}`);
/** Swap meters with the plain-odometer entries left out; undefined when none is a trip meter */
export function cleanMeters<T extends Record<string, KmMeter | undefined>>(m?: T): T | undefined {
  const out = Object.fromEntries(Object.entries(m ?? {}).filter(([, v]) => v && v !== 'odo')) as T;
  return Object.keys(out).length ? out : undefined;
}

/*
 * Kilometres over the whole trip, across every car the customer drove — not just the final one.
 *
 *   pickup ──► breakdown │ replacement out ──► in │ original back ──► return
 *   booked car            replacement car          booked car again
 *
 * Earlier cars of an "Exchange vehicle" keep their own km (Exchange.kmDriven). Breakdown swaps
 * (breakdown_vehicle_swaps) add a replacement leg each; a replacement swapped for another
 * replacement ("replaced") just adds the next one. Km the booked car did at the garage (between
 * the breakdown and going back to the customer) is not the customer's and is left out.
 */

export type ReadingField = 'pickup' | 'return' | 'originalOdometer' | 'replacementOdometerOut' | 'replacementOdometerIn' | 'originalOdometerBack';

export interface MissingReading {
  field: ReadingField;
  swapId?: string;
  incidentId?: string;
  vehicleId?: string;
  /** e.g. "CBU-0649 odometer when handed over" */
  label: string;
  /** A value found in other records (breakdown report, the car's handovers) — to check, never applied silently */
  suggest?: { km: number; from: string };
}

export interface KmLeg {
  vehicleId?: string;
  /** car number / partner car */
  car: string;
  role: 'booked' | 'replacement' | 'earlier';
  from?: number;
  to?: number;
  km?: number;
  /** "Pickup → breakdown", "Replacement (BD-…)" … */
  part: string;
  swapId?: string;
  /** the end reading is lower than the start */
  wrong?: boolean;
  /** which meter each reading was taken from */
  fromMeter?: KmMeter;
  toMeter?: KmMeter;
  /** start and end were read from different meters — the km can't be worked out */
  mismatch?: boolean;
  /** 1, 2, 3 … in the order the customer had the cars */
  phase: number;
  /** when this phase began / ended (ISO; end undefined = still going) */
  start?: string;
  end?: string;
  days?: number;
  /** where each reading is kept — so it can be corrected */
  startRef?: ReadingRef;
  endRef?: ReadingRef;
  /** a reading that looks like it belongs to another car or another moment */
  suspect?: string;
}

export type SwapField = 'originalOdometer' | 'replacementOdometerOut' | 'replacementOdometerIn' | 'originalOdometerBack';
export type ReadingRef = { swapId: string; field: SwapField } | { swapId?: undefined; field: 'pickup' | 'return' };

export interface TripKm {
  legs: KmLeg[];
  missing: MissingReading[];
  /** every leg is known and none is wrong */
  complete: boolean;
  /** sum of the legs that are known */
  known: number;
  /** = known when complete */
  total?: number;
  /** km the booked car did between the breakdown and going back to the customer (not billed) */
  garageKm: number;
  /** the trip ended in a replacement — the booked car's return reading doesn't count */
  endedInReplacement: boolean;
}

export interface TripKmInput {
  booking: Booking;
  swaps: BdSwap[];
  /** odometer of the booked car at pickup (or at the last exchange) */
  startKm?: number;
  /** odometer of the booked car at the return */
  returnKm?: number;
  /** the meter those two were read from (default: the odometer) */
  startMeter?: KmMeter;
  returnMeter?: KmMeter;
  carNumber: (vehicleId?: string) => string;
  /** incident id → ref, for labels */
  incidentRef?: (incidentId: string) => string | undefined;
  /** reported mileage at the breakdown, per incident */
  incidentMileage?: (incidentId: string) => number | undefined;
  handovers?: VehicleHandover[];
}

const swapCar = (w: BdSwap, carNumber: (id?: string) => string) =>
  w.source === 'fleet' ? carNumber(w.replacementVehicleId) : [w.partnerVehicle, w.partnerReg].filter(Boolean).join(' ') || `${w.partnerName ?? 'Partner'}'s car`;

const delta = (a?: number, b?: number) => (a != null && b != null ? b - a : undefined);
const sm = (w: BdSwap, f: SwapField) => meterOf(w.meters?.[f]);
/** A phase between two readings: km only when both come from the same meter */
function span(from: number | undefined, fm: KmMeter, to: number | undefined, tm: KmMeter) {
  const mismatch = from != null && to != null && fm !== tm;
  return { from, to, fromMeter: fm, toMeter: tm, km: mismatch ? undefined : delta(from, to), ...(mismatch ? { mismatch: true } : {}) };
}
const mismatchNote = (car: string, fm: KmMeter, tm: KmMeter) =>
  `${car}: the start was read from ${METER_LABEL[fm]} and the end from ${METER_LABEL[tm]} — different meters can't be compared. Correct one so both come from the same meter.`;

/** The last reading of a car at or before a time, and the first one after — from the handover records */
function readingBefore(handovers: VehicleHandover[] | undefined, vehicleId: string | undefined, atIso: string) {
  if (!handovers || !vehicleId) return undefined;
  const t = new Date(atIso).getTime();
  return handovers.filter((h) => h.vehicleId === vehicleId && new Date(h.dateTime).getTime() <= t && h.mileage > 0)
    .sort((a, b) => b.dateTime.localeCompare(a.dateTime))[0];
}
function readingAfter(handovers: VehicleHandover[] | undefined, vehicleId: string | undefined, atIso: string) {
  if (!handovers || !vehicleId) return undefined;
  const t = new Date(atIso).getTime();
  return handovers.filter((h) => h.vehicleId === vehicleId && new Date(h.dateTime).getTime() >= t && h.mileage > 0)
    .sort((a, b) => a.dateTime.localeCompare(b.dateTime))[0];
}
const dmy = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
/** started 24-hour periods (as for a replacement's days) */
const daysBetween = (a?: string, b?: string) =>
  a && b ? Math.max(1, Math.ceil((new Date(b).getTime() - new Date(a).getTime()) / 864e5 - 0.01)) : undefined;
const fmtKm = (n: number) => `${n.toLocaleString('en-LK')} km`;
/** more km than this between the breakdown and going back to the customer is worth a second look */
const GARAGE_KM_CHECK = 150;

export function tripKm(x: TripKmInput): TripKm {
  const b = x.booking;
  const legs: Omit<KmLeg, 'phase'>[] = [];
  const missing: MissingReading[] = [];
  let garageKm = 0;
  const booked = x.carNumber(b.vehicleId);
  const ref = (w: BdSwap) => x.incidentRef?.(w.incidentId) ?? 'breakdown';
  const r = (swapId: string, field: SwapField): ReadingRef => ({ swapId, field });

  // earlier cars of an "Exchange vehicle"
  (b.exchanges ?? []).forEach((e, i, all) => legs.push({
    vehicleId: e.fromVehicleId, car: x.carNumber(e.fromVehicleId), role: 'earlier', km: e.kmDriven,
    to: e.returned.odometer, part: 'Before the vehicle exchange', start: i ? all[i - 1].at : b.pickupAt, end: e.at, days: e.fromDays,
  }));
  const lastExchange = b.exchanges?.length ? new Date(b.exchanges[b.exchanges.length - 1].at).getTime() : -Infinity;

  const swaps = x.swaps.filter((w) => w.bookingId === b.id).sort((a, c) => a.outAt.localeCompare(c.outAt));
  // swaps of a car that was exchanged away later: their replacement km only (the exchange has that car's own km)
  for (const w of swaps.filter((w) => new Date(w.outAt).getTime() < lastExchange)) {
    legs.push({ vehicleId: w.replacementVehicleId, car: swapCar(w, x.carNumber), role: 'replacement', swapId: w.id,
      ...span(w.replacementOdometerOut, sm(w, 'replacementOdometerOut'), w.replacementOdometerIn, sm(w, 'replacementOdometerIn')), part: `Replacement (${ref(w)})`,
      start: w.outAt, end: w.backAt, days: w.days ?? daysBetween(w.outAt, w.backAt),
      startRef: r(w.id, 'replacementOdometerOut'), endRef: r(w.id, 'replacementOdometerIn') });
  }

  // the booked car's current phase: where it started (pickup, or back from the garage)
  let cursor = x.startKm;
  let cursorMeter = meterOf(x.startMeter);
  let cursorAt: string | undefined = b.checklists?.pickup?.at ?? (b.exchanges?.length ? b.exchanges[b.exchanges.length - 1].at : b.pickupAt);
  let cursorRef: ReadingRef = { field: 'pickup' };
  let cursorSuspect: string | undefined;
  let bookedWithCustomer = true;
  let endedInReplacement = false;
  let partStart = 'Pickup';

  if (x.startKm == null) missing.push({ field: 'pickup', vehicleId: b.vehicleId, label: `${booked} odometer at pickup` });

  for (const w of swaps.filter((w) => new Date(w.outAt).getTime() >= lastExchange)) {
    const repl = swapCar(w, x.carNumber);
    if (bookedWithCustomer) {
      legs.push({ vehicleId: b.vehicleId, car: booked, role: 'booked', ...span(cursor, cursorMeter, w.originalOdometer, sm(w, 'originalOdometer')),
        part: `${partStart} → breakdown ${ref(w)}`, start: cursorAt, end: w.outAt, days: daysBetween(cursorAt, w.outAt),
        startRef: cursorRef, endRef: r(w.id, 'originalOdometer'), suspect: cursorSuspect });
      if (w.originalOdometer == null) {
        const reported = x.incidentMileage?.(w.incidentId);
        missing.push({ field: 'originalOdometer', swapId: w.id, incidentId: w.incidentId, vehicleId: b.vehicleId,
          label: `${booked} odometer at the breakdown (${ref(w)})`, ...(reported != null ? { suggest: { km: reported, from: 'mileage on the breakdown report' } } : {}) });
      }
    }
    // each car has its own odometer: a replacement handed over at the booked car's reading was probably typed in the wrong box
    const replSuspect = w.replacementOdometerOut != null && w.replacementOdometerOut === w.originalOdometer && sm(w, 'replacementOdometerOut') === sm(w, 'originalOdometer')
      ? `${repl} was handed over at ${fmtKm(w.replacementOdometerOut)} — the same as ${booked} at the breakdown. Each car has its own odometer: check it is ${repl}'s reading.` : undefined;
    legs.push({ vehicleId: w.replacementVehicleId, car: repl, role: 'replacement', swapId: w.id,
      ...span(w.replacementOdometerOut, sm(w, 'replacementOdometerOut'), w.replacementOdometerIn, sm(w, 'replacementOdometerIn')), part: `Replacement · ${dmy(w.outAt)}${w.backAt ? ` – ${dmy(w.backAt)}` : ' – still out'}`,
      start: w.outAt, end: w.backAt, days: w.days ?? daysBetween(w.outAt, w.backAt),
      startRef: r(w.id, 'replacementOdometerOut'), endRef: r(w.id, 'replacementOdometerIn'), suspect: replSuspect });
    if (w.replacementOdometerOut == null) {
      const h = w.source === 'fleet' ? readingBefore(x.handovers, w.replacementVehicleId, w.outAt) : undefined;
      missing.push({ field: 'replacementOdometerOut', swapId: w.id, incidentId: w.incidentId, vehicleId: w.replacementVehicleId,
        label: `${repl} odometer when handed to the customer`, ...(h ? { suggest: { km: h.mileage, from: `its last ${h.type} on ${dmy(h.dateTime)} — check it was not driven since` } } : {}) });
    }
    if (w.status === 'closed' && w.replacementOdometerIn == null) {
      const h = w.source === 'fleet' && w.backAt ? readingAfter(x.handovers, w.replacementVehicleId, w.backAt) : undefined;
      missing.push({ field: 'replacementOdometerIn', swapId: w.id, incidentId: w.incidentId, vehicleId: w.replacementVehicleId,
        label: `${repl} odometer when collected from the customer`, ...(h ? { suggest: { km: h.mileage, from: `its next ${h.type} on ${dmy(h.dateTime)} — the reading then, check it was not driven in between` } } : {}) });
    }
    if (w.status === 'active') { bookedWithCustomer = false; break; }
    if (w.outcome === 'swapped_back') {
      cursorSuspect = undefined;
      if (w.originalOdometerBack == null) {
        missing.push({ field: 'originalOdometerBack', swapId: w.id, incidentId: w.incidentId, vehicleId: b.vehicleId,
          label: `${booked} odometer when it went back to the customer`,
          ...(w.originalOdometer != null ? { suggest: { km: w.originalOdometer, from: `${booked}'s own reading at the breakdown — only if it was not driven at the garage` } } : {}) });
      } else if (w.originalOdometer != null && sm(w, 'originalOdometerBack') === sm(w, 'originalOdometer') && w.originalOdometerBack > w.originalOdometer) {
        // (readings from different meters — e.g. Trip A at the breakdown, Trip B going back — say nothing about the garage km)
        const gap = w.originalOdometerBack - w.originalOdometer;
        garageKm += gap;
        // the booked car starts again from ITS OWN reading — not where the replacement ended
        if (w.replacementOdometerIn != null && sm(w, 'replacementOdometerIn') === sm(w, 'originalOdometerBack') && Math.abs(w.originalOdometerBack - w.replacementOdometerIn) <= 5) {
          cursorSuspect = `${booked} went back at ${fmtKm(w.originalOdometerBack)} — that is ${repl}'s reading when it was collected. ${booked} continues from its own odometer (${fmtKm(w.originalOdometer)} at the breakdown + any garage km).`;
        } else if (gap > GARAGE_KM_CHECK) {
          cursorSuspect = `${booked} went back at ${fmtKm(w.originalOdometerBack)}, ${fmtKm(gap)} more than at the breakdown (${fmtKm(w.originalOdometer)}). Check the reading — garage km are not charged.`;
        }
      }
      cursor = w.originalOdometerBack; cursorMeter = sm(w, 'originalOdometerBack'); cursorAt = w.backAt; cursorRef = r(w.id, 'originalOdometerBack');
      bookedWithCustomer = true; partStart = 'Back from repair';
    } else if (w.outcome === 'customer_kept') {
      bookedWithCustomer = false; endedInReplacement = true;
      break;
    } else {
      // 'replaced' — the next swap is the next replacement; the booked car is still at the garage
      bookedWithCustomer = false;
    }
  }

  if (bookedWithCustomer) {
    const end = b.checklists?.return?.at;
    legs.push({ vehicleId: b.vehicleId, car: booked, role: 'booked', ...span(cursor, cursorMeter, x.returnKm, meterOf(x.returnMeter)), part: `${partStart} → return`,
      start: cursorAt, end, days: daysBetween(cursorAt, end), startRef: cursorRef, endRef: { field: 'return' }, suspect: cursorSuspect });
    if (x.returnKm == null) missing.push({ field: 'return', vehicleId: b.vehicleId, label: `${booked} odometer at the return` });
  }

  const phases: KmLeg[] = legs.map((l, i) => ({ ...l, phase: i + 1, ...(l.km != null && l.km < 0 ? { wrong: true } : {}),
    ...(l.mismatch ? { suspect: mismatchNote(l.car, l.fromMeter!, l.toMeter!) } : {}) }));
  const known = phases.reduce((s, l) => s + (l.km != null && l.km > 0 ? l.km : 0), 0);
  // an earlier car of an old exchange without a km figure doesn't hold up the bill (as before)
  const complete = phases.every((l) => (l.km != null || l.role === 'earlier') && !l.wrong);
  return { legs: phases, missing, complete, known, total: complete ? known : undefined, garageKm, endedInReplacement };
}

/** Incident id given to replacements typed in with a manual booking (there is no breakdown record) */
export const MANUAL_INCIDENT = 'manual';

/** A manual booking's replacements as closed swaps, so tripKm() counts them like live ones */
export function manualSwaps(b: Booking): BdSwap[] {
  return (b.checklists?.replacements ?? []).map((r) => ({
    id: `man-${r.id}`, incidentId: MANUAL_INCIDENT, solutionId: '', bookingId: b.id, originalVehicleId: b.vehicleId,
    source: r.source, replacementVehicleId: r.replacementVehicleId, partnerName: r.partnerName, partnerVehicle: r.partnerVehicle, partnerReg: r.partnerReg,
    status: 'closed', outAt: r.outAt, outBy: '', backAt: r.backAt, outcome: r.outcome,
    originalOdometer: r.originalOdometer, replacementOdometerOut: r.replacementOdometerOut, replacementOdometerIn: r.replacementOdometerIn,
    originalOdometerBack: r.outcome === 'swapped_back' ? r.originalOdometerBack : undefined,
    meters: r.meters, createdAt: r.outAt, updatedAt: r.outAt,
  }));
}

/** Readings that must be entered before the bill — without the booked car's own return reading (typed in the return form) */
export const missingSwapReadings = (t: TripKm) => t.missing.filter((m) => m.swapId);

/** Extra km already dealt with on the bill — charged ("Extra km: N km × Rs R", live charges only) or given free at the
 *  return ("− M km given free" in the charge, or "Extra km not charged: M km given free"), so they aren't offered again */
export const chargedExtraKm = (b: Booking) => {
  const n = (re: RegExp, t?: string) => Number(re.exec(t ?? '')?.[1]?.replace(/,/g, '')) || 0;
  const charged = (b.charges ?? []).filter((c) => c.status === 'Charged' && /^extra km/i.test(c.note ?? ''))
    .reduce((s, c) => s + n(/extra km:\s*([\d,]+)\s*km/i, c.note) + n(/−\s*([\d,]+)\s*km given free/i, c.note), 0);
  const free = (b.activity ?? []).reduce((s, a) => s + n(/Extra km not charged:\s*([\d,]+)\s*km given free/i, a.text), 0);
  return charged + free;
};

/** Filled in by the breakdown store, so plain modules (the invoice) get the whole-trip km without importing stores */
export const tripKmProvider: { of?: (b: Booking) => TripKm } = {};
