import { Gauge, Plus, Trash2, Wrench, AlertCircle } from 'lucide-react';
import KmReading from './KmReading';
import Select from './Select';
import { MANUAL_INCIDENT, manualSwaps, tripKm, type TripKm } from '../../lib/tripKm';
import type { Booking, HandoverChecklist, KmMeter, ManualReplacement, Vehicle } from '../../types';

/* Mileage of a past booking typed in by hand: pickup and return readings, and any breakdown
   replacements on the way. The replacements are kept on the booking (checklists.replacements) and
   counted by tripKm() like live breakdown swaps — the booking, the usage phases and the invoice
   all show the km of every car. */

type Reading = 'originalOdometer' | 'replacementOdometerOut' | 'replacementOdometerIn' | 'originalOdometerBack';

export interface ReplacementDraft {
  id: string;
  source: 'fleet' | 'partner';
  vehicleId: string;
  partnerName: string;
  partnerReg: string;
  outAt: string;      // yyyy-MM-ddTHH:mm
  backAt: string;
  outcome: 'swapped_back' | 'customer_kept';
  km: Record<Reading, string>;
  meters: Record<Reading, KmMeter>;
  reason: string;
  /** what the replacement's owner is paid (fleet cars) */
  payout: string;
}

export interface MileageDraft {
  pickupKm: string; pickupMeter: KmMeter;
  returnKm: string; returnMeter: KmMeter;
  replacements: ReplacementDraft[];
  rate: string;
  chargeKm: boolean;
}

/** Extra km charges on the bill ("Extra km: N km × Rs R …"), live ones only */
export const extraKmCharges = (b: Booking) => (b.charges ?? []).filter((c) => c.status === 'Charged' && /^extra km/i.test(c.note ?? ''));

/** A saved booking's readings and replacements, back in the form (for correcting it) */
export function mileageDraftOf(b: Booking): MileageDraft {
  const p = b.checklists?.pickup, r = b.checklists?.return;
  const km = extraKmCharges(b);
  const rate = /× Rs ([\d,]+)/.exec(km[0]?.note ?? '')?.[1]?.replace(/,/g, '') ?? '';
  const s = (n?: number) => (n == null ? '' : String(n));
  return {
    pickupKm: s(p?.odometer), pickupMeter: p?.meter ?? 'odo',
    returnKm: s(r?.odometer), returnMeter: r?.meter ?? 'odo',
    replacements: (b.checklists?.replacements ?? []).map((x) => ({
      id: x.id, source: x.source, vehicleId: x.replacementVehicleId ?? '', partnerName: x.partnerName ?? '', partnerReg: x.partnerReg ?? '',
      outAt: x.outAt.slice(0, 16), backAt: x.backAt.slice(0, 16), outcome: x.outcome, reason: x.reason ?? '', payout: s(x.payout),
      km: { originalOdometer: s(x.originalOdometer), replacementOdometerOut: s(x.replacementOdometerOut), replacementOdometerIn: s(x.replacementOdometerIn), originalOdometerBack: s(x.originalOdometerBack) },
      meters: { originalOdometer: x.meters?.originalOdometer ?? 'odo', replacementOdometerOut: x.meters?.replacementOdometerOut ?? 'odo',
        replacementOdometerIn: x.meters?.replacementOdometerIn ?? 'odo', originalOdometerBack: x.meters?.originalOdometerBack ?? 'odo' },
    })),
    rate,
    // only charge extra km on a correction when the bill already had it — never added silently
    chargeKm: km.length > 0,
  };
}

export const emptyMileage = (): MileageDraft =>({ pickupKm: '', pickupMeter: 'odo', returnKm: '', returnMeter: 'odo', replacements: [], rate: '', chargeKm: true });

const blankReplacement = (outAt: string, backAt: string): ReplacementDraft => ({
  id: Math.random().toString(36).slice(2, 10), source: 'fleet', vehicleId: '', partnerName: '', partnerReg: '', outAt, backAt,
  outcome: 'swapped_back', reason: '', payout: '',
  km: { originalOdometer: '', replacementOdometerOut: '', replacementOdometerIn: '', originalOdometerBack: '' },
  meters: { originalOdometer: 'odo', replacementOdometerOut: 'odo', replacementOdometerIn: 'odo', originalOdometerBack: 'odo' },
});

interface Ctx {
  vehicles: Vehicle[];
  vehicleId: string;
  status: string;
  startDate: string; startTime: string; endDate: string; endTime: string;
  totalDays: number;
  by: string;
}

const num = (s: string) => (s.trim() === '' ? undefined : Math.max(0, Number(s) || 0));
const at = (date: string, time: string) => (date ? `${date}T${time || '00:00'}` : '');
const daysBetween = (a: string, b: string) => Math.max(1, Math.ceil((new Date(b).getTime() - new Date(a).getTime()) / 864e5 - 0.01));
const rs = (n: number) => `Rs ${Math.round(n).toLocaleString('en-LK')}`;

export interface Mileage {
  /** what goes onto the booking */
  checklists?: Booking['checklists'];
  trip?: TripKm;
  includedKm: number;
  extraKm: number;
  rate: number;
  /** extra km charge to add to the bill (0 = none) */
  charge: number;
  chargeNote: string;
  /** owner payouts for fleet replacements */
  payouts: { id: string; vehicleId: string; amount: number; note: string }[];
  /** readings to put on the cars (never lowered) */
  carReadings: { vehicleId: string; km: number }[];
  problems: string[];
}

/** The booking's readings, the km per car and the extra km charge, from what was typed */
export function mileageOf(d: MileageDraft, c: Ctx): Mileage {
  const car = (id?: string) => c.vehicles.find((v) => v.id === id);
  const carNo = (id?: string) => car(id)?.vehicleNumber ?? 'Vehicle';
  const booked = car(c.vehicleId);
  const completed = c.status === 'Completed';
  const live = completed || c.status === 'Ongoing';
  const startAt = at(c.startDate, c.startTime), endAt = at(c.endDate, c.endTime);
  const rate = d.rate.trim() === '' ? booked?.extraKmRate ?? 50 : Math.max(0, Number(d.rate) || 0);
  const includedKm = (booked?.includedKmPerDay ?? 100) * (c.totalDays || 1);
  const none: Mileage = { includedKm, extraKm: 0, rate, charge: 0, chargeNote: '', payouts: [], carReadings: [], problems: [] };
  if (!live || !c.vehicleId) return none;

  const problems: string[] = [];
  const reps: ManualReplacement[] = completed ? d.replacements.map((r) => {
    const meters = Object.fromEntries(Object.entries(r.meters).filter(([, m]) => m !== 'odo')) as ManualReplacement['meters'];
    return {
      id: r.id, source: r.source,
      ...(r.source === 'fleet' ? { replacementVehicleId: r.vehicleId || undefined } : { partnerName: r.partnerName.trim() || undefined, partnerReg: r.partnerReg.trim() || undefined }),
      outAt: r.outAt, backAt: r.backAt, outcome: r.outcome,
      originalOdometer: num(r.km.originalOdometer), replacementOdometerOut: num(r.km.replacementOdometerOut), replacementOdometerIn: num(r.km.replacementOdometerIn),
      ...(r.outcome === 'swapped_back' ? { originalOdometerBack: num(r.km.originalOdometerBack) } : {}),
      ...(meters && Object.keys(meters).length ? { meters } : {}),
      ...(r.reason.trim() ? { reason: r.reason.trim() } : {}),
      ...(r.source === 'fleet' && num(r.payout) ? { payout: num(r.payout), payoutId: `man-pay-${r.id}` } : {}),
    };
  }) : [];

  reps.forEach((r, i) => {
    const n = `Replacement ${i + 1}`;
    if (r.source === 'fleet' && !r.replacementVehicleId) problems.push(`${n}: choose the replacement car.`);
    if (r.source === 'fleet' && r.replacementVehicleId === c.vehicleId) problems.push(`${n}: the replacement must be a different car from the booked one.`);
    if (r.source === 'partner' && !r.partnerName && !r.partnerReg) problems.push(`${n}: enter whose car it was or its number.`);
    if (!r.outAt || !r.backAt) problems.push(`${n}: enter when it was handed over and when it was taken back.`);
    else if (r.backAt <= r.outAt) problems.push(`${n}: it must be taken back after it was handed over.`);
    else if ((startAt && r.outAt < startAt) || (endAt && r.backAt > endAt)) problems.push(`${n}: its dates must be within the booking (${c.startDate} → ${c.endDate}).`);
    if (i > 0 && r.outAt && reps[i - 1].backAt && r.outAt < reps[i - 1].backAt) problems.push(`${n}: starts before replacement ${i} was taken back.`);
    if (i < reps.length - 1 && r.outcome === 'customer_kept') problems.push(`${n}: the customer kept it to the end, so there can't be another replacement after it.`);
  });

  const pickupKm = num(d.pickupKm);
  const endedInReplacement = reps[reps.length - 1]?.outcome === 'customer_kept';
  const returnKm = completed && !endedInReplacement ? num(d.returnKm) : undefined;
  const check = (km: number, meter: KmMeter, when: string, time: string): HandoverChecklist =>
    ({ at: time || new Date().toISOString(), by: c.by, odometer: km, ...(meter !== 'odo' ? { meter } : {}), fuel: '—', items: {}, notes: `${when} — entered with the manual booking` });
  const checklists: Booking['checklists'] = {
    ...(pickupKm != null ? { pickup: check(pickupKm, d.pickupMeter, 'Pickup reading', startAt) } : {}),
    ...(returnKm != null ? { return: check(returnKm, d.returnMeter, 'Return reading', endAt) } : {}),
    ...(reps.length ? { replacements: reps } : {}),
  };
  const hasAny = pickupKm != null || returnKm != null || reps.length > 0;
  if (!hasAny) return { ...none, problems };

  const draft = { id: 'draft', vehicleId: c.vehicleId, pickupAt: startAt, checklists } as Booking;
  const trip = tripKm({
    booking: draft, swaps: manualSwaps(draft), startKm: pickupKm, returnKm, startMeter: d.pickupMeter, returnMeter: d.returnMeter,
    carNumber: carNo, incidentRef: (id) => (id === MANUAL_INCIDENT ? '' : undefined),
  });
  trip.legs.filter((l) => l.wrong).forEach((l) => problems.push(`${l.car} (phase ${l.phase}): the end reading is lower than the start — check the readings.`));
  trip.legs.filter((l) => l.mismatch).forEach((l) => problems.push(`${l.car} (phase ${l.phase}): the start and end were read from different meters — they can't be compared.`));

  const extraKm = completed && trip.total != null ? Math.max(0, trip.total - includedKm) : 0;
  const cars = [...new Set(trip.legs.filter((l) => l.km).map((l) => l.car))];
  const charge = d.chargeKm ? Math.round(extraKm * rate) : 0;
  // (only known once every reading is in — a half-filled form must still render)
  const chargeNote = `Extra km: ${extraKm.toLocaleString()} km × Rs ${rate.toLocaleString()}${cars.length > 1 && trip.total != null ? ` (${trip.total.toLocaleString()} km driven in ${cars.join(' + ')})` : ''}`;
  const payouts = reps.filter((r) => r.payout && r.replacementVehicleId).map((r) => ({
    id: r.payoutId!, vehicleId: r.replacementVehicleId!, amount: r.payout!,
    note: `Breakdown replacement for ${carNo(c.vehicleId)} — ${daysBetween(r.outAt, r.backAt)} day(s), ${r.outAt.slice(0, 10)} → ${r.backAt.slice(0, 10)} (entered with a past booking)`,
  }));
  // the cars' own mileage follows their last odometer reading
  const carReadings = [
    ...(returnKm != null && d.returnMeter === 'odo' ? [{ vehicleId: c.vehicleId, km: returnKm }] : []),
    ...reps.filter((r) => r.replacementVehicleId && r.replacementOdometerIn != null && !r.meters?.replacementOdometerIn).map((r) => ({ vehicleId: r.replacementVehicleId!, km: r.replacementOdometerIn! })),
  ];
  return { checklists, trip, includedKm, extraKm, rate, charge, chargeNote, payouts, carReadings, problems };
}

export default function ManualMileageFields({ value: d, onChange, ctx, mileage: m }: {
  value: MileageDraft; onChange: (d: MileageDraft) => void; ctx: Ctx; mileage: Mileage;
}) {
  const set = (patch: Partial<MileageDraft>) => onChange({ ...d, ...patch });
  const setRep = (id: string, patch: Partial<ReplacementDraft>) => set({ replacements: d.replacements.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
  const completed = ctx.status === 'Completed';
  const booked = ctx.vehicles.find((v) => v.id === ctx.vehicleId);
  const carNo = (id?: string) => ctx.vehicles.find((v) => v.id === id)?.vehicleNumber ?? 'Vehicle';
  const endedInReplacement = d.replacements[d.replacements.length - 1]?.outcome === 'customer_kept';
  const startAt = at(ctx.startDate, ctx.startTime), endAt = at(ctx.endDate, ctx.endTime);

  if (ctx.status !== 'Completed' && ctx.status !== 'Ongoing') {
    return <p className="text-xs text-navy-400">Mileage is recorded for rentals that have started (Ongoing) or finished (Completed).</p>;
  }
  if (!ctx.vehicleId) return <p className="text-xs text-navy-400">Choose the vehicle first.</p>;

  const label = 'block text-[11px] font-medium text-navy-500 mb-1';
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <span className={label}>{booked?.vehicleNumber} at pickup</span>
          <KmReading value={d.pickupKm} onChange={(v) => set({ pickupKm: v })} meter={d.pickupMeter} onMeter={(x) => set({ pickupMeter: x })} placeholder="e.g. 48,250" />
        </div>
        {completed && (
          endedInReplacement
            ? <p className="text-xs text-navy-500 self-end pb-2">The customer kept the last replacement to the end — its reading when collected is the return.</p>
            : <div>
                <span className={label}>{booked?.vehicleNumber} at return</span>
                <KmReading value={d.returnKm} onChange={(v) => set({ returnKm: v })} meter={d.returnMeter} onMeter={(x) => set({ returnMeter: x })} placeholder="e.g. 50,120" />
              </div>
        )}
      </div>

      {/* breakdown replacements on the way */}
      {completed && (
        <div className="space-y-3">
          {d.replacements.map((r, i) => {
            const read = (k: Reading, text: string) => (
              <div>
                <span className={label}>{text}</span>
                <KmReading small value={r.km[k]} onChange={(v) => setRep(r.id, { km: { ...r.km, [k]: v } })} meter={r.meters[k]} onMeter={(x) => setRep(r.id, { meters: { ...r.meters, [k]: x } })} />
              </div>
            );
            const repl = r.source === 'fleet' ? (r.vehicleId ? carNo(r.vehicleId) : 'the replacement') : (r.partnerReg || r.partnerName || 'the partner car');
            const replCar = ctx.vehicles.find((v) => v.id === r.vehicleId);
            const days = r.outAt && r.backAt && r.backAt > r.outAt ? daysBetween(r.outAt, r.backAt) : undefined;
            const suggested = days && replCar ? days * replCar.dailyRent : undefined;
            return (
              <div key={r.id} className="rounded-xl border border-amber-200 bg-amber-50/40 p-3 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-amber-900 flex items-center gap-1.5"><Wrench size={13} /> Breakdown replacement {i + 1}</p>
                  <button type="button" onClick={() => set({ replacements: d.replacements.filter((x) => x.id !== r.id) })} className="text-navy-400 hover:text-red-600 p-1" aria-label="Remove"><Trash2 size={14} /></button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="sm:col-span-2 flex gap-1.5">
                    {(['fleet', 'partner'] as const).map((s) => (
                      <button key={s} type="button" onClick={() => setRep(r.id, { source: s })}
                        className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${r.source === s ? 'bg-navy-700 text-white' : 'bg-white border border-navy-200 text-navy-600'}`}>
                        {s === 'fleet' ? 'Our car' : "Another company's car"}
                      </button>
                    ))}
                  </div>
                  {r.source === 'fleet' ? (
                    <div className="sm:col-span-2">
                      <span className={label}>Replacement car</span>
                      <Select searchable searchPlaceholder="Search model or number…" value={r.vehicleId} onChange={(v) => setRep(r.id, { vehicleId: v })} placeholder="Select vehicle…"
                        options={ctx.vehicles.filter((v) => v.id !== ctx.vehicleId).map((v) => ({ value: v.id, label: `${v.vehicleNumber} — ${v.brand} ${v.model}`, sub: `Rs ${v.dailyRent.toLocaleString()}/day` }))} />
                    </div>
                  ) : (
                    <>
                      <label className={label}>Company / owner<input className="input mt-1" value={r.partnerName} onChange={(e) => setRep(r.id, { partnerName: e.target.value })} /></label>
                      <label className={label}>Car number<input className="input mt-1" value={r.partnerReg} onChange={(e) => setRep(r.id, { partnerReg: e.target.value })} placeholder="e.g. CAB-1234" /></label>
                    </>
                  )}
                  <label className={label}>Handed to the customer<input type="datetime-local" className="input mt-1" min={startAt || undefined} max={endAt || undefined} value={r.outAt} onChange={(e) => setRep(r.id, { outAt: e.target.value })} /></label>
                  <label className={label}>Taken back from the customer<input type="datetime-local" className="input mt-1" min={r.outAt || startAt || undefined} max={endAt || undefined} value={r.backAt} onChange={(e) => setRep(r.id, { backAt: e.target.value })} /></label>
                  <div className="sm:col-span-2 flex flex-wrap gap-1.5">
                    {([['swapped_back', `${booked?.vehicleNumber} came back to the customer`], ['customer_kept', `The customer kept ${repl} to the end`]] as const).map(([k, text]) => (
                      <button key={k} type="button" onClick={() => setRep(r.id, { outcome: k })}
                        className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${r.outcome === k ? 'bg-navy-700 text-white' : 'bg-white border border-navy-200 text-navy-600'}`}>{text}</button>
                    ))}
                  </div>
                  {i === 0 || d.replacements[i - 1].outcome === 'swapped_back' ? read('originalOdometer', `${booked?.vehicleNumber} at the breakdown`) : <span />}
                  {read('replacementOdometerOut', `${repl} when handed over`)}
                  {read('replacementOdometerIn', `${repl} when taken back`)}
                  {r.outcome === 'swapped_back' && read('originalOdometerBack', `${booked?.vehicleNumber} going back to the customer`)}
                  <label className={`${label} sm:col-span-2`}>What happened<input className="input mt-1" value={r.reason} onChange={(e) => setRep(r.id, { reason: e.target.value })} placeholder="e.g. gearbox failure near Kandy" /></label>
                  {r.source === 'fleet' && (
                    <label className={label}>{replCar ? `${replCar.vehicleNumber}'s owner is paid (Rs)` : 'Replacement owner is paid (Rs)'}
                      <input className="input mt-1" type="number" min="0" value={r.payout} onChange={(e) => setRep(r.id, { payout: e.target.value })} placeholder="0" />
                      {suggested != null && !r.payout && (
                        <button type="button" onClick={() => setRep(r.id, { payout: String(suggested) })} className="mt-1 text-[11px] text-navy-600 underline">
                          Use {days} day{days === 1 ? '' : 's'} × {rs(replCar!.dailyRent)} = {rs(suggested)}
                        </button>
                      )}
                    </label>
                  )}
                  {r.source === 'partner' && <p className="text-[11px] text-navy-400 self-end">Record what the other company charged under Expenses.</p>}
                </div>
              </div>
            );
          })}
          {!endedInReplacement && (
            <button type="button" onClick={() => {
              const last = d.replacements[d.replacements.length - 1];
              set({ replacements: [...d.replacements, blankReplacement(last?.backAt ?? startAt, '')] });
            }} className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 hover:bg-amber-100 rounded-lg px-3 py-1.5">
              <Plus size={13} /> Add a breakdown replacement
            </button>
          )}
        </div>
      )}

      {/* km per car and the extra km */}
      {m.trip && (
        <div className="rounded-xl border border-navy-100 bg-white p-3 space-y-2 text-xs">
          <p className="font-semibold text-navy-700 flex items-center gap-1.5"><Gauge size={13} /> Km per car</p>
          <table className="w-full">
            <tbody>
              {m.trip.legs.map((l) => (
                <tr key={l.phase} className="border-t border-navy-50">
                  <td className="py-1 pr-2 text-navy-400">{l.phase}</td>
                  <td className="py-1 pr-2"><b className="text-navy-800">{l.car}</b> <span className="text-navy-400">{l.role === 'replacement' ? 'replacement' : 'booked car'}</span></td>
                  <td className="py-1 pr-2 text-navy-500">{l.from?.toLocaleString('en-LK') ?? '?'} → {l.to?.toLocaleString('en-LK') ?? '?'}</td>
                  <td className={`py-1 text-right font-semibold ${l.wrong || l.mismatch ? 'text-red-600' : l.km == null ? 'text-amber-700' : 'text-navy-800'}`}>
                    {l.wrong ? 'check' : l.mismatch ? 'meters differ' : l.km == null ? 'missing' : `${l.km.toLocaleString('en-LK')} km`}
                  </td>
                </tr>
              ))}
              <tr className="border-t-2 border-navy-100">
                <td colSpan={3} className="py-1.5 text-navy-600">Total{m.trip.garageKm > 0 ? ` · ${m.trip.garageKm.toLocaleString('en-LK')} km at the garage not counted` : ''} · {m.includedKm.toLocaleString('en-LK')} km included ({booked?.includedKmPerDay ?? 100}/day)</td>
                <td className="py-1.5 text-right font-bold text-navy-900">{m.trip.total != null ? `${m.trip.total.toLocaleString('en-LK')} km` : `${m.trip.known.toLocaleString('en-LK')}+ km`}</td>
              </tr>
            </tbody>
          </table>
          {completed && m.trip.total != null && (
            m.extraKm > 0 ? (
              <div className="flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 px-2.5 py-2 text-amber-900">
                <label className="flex items-center gap-1.5"><input type="checkbox" checked={d.chargeKm} onChange={(e) => set({ chargeKm: e.target.checked })} />
                  Charge <b>{m.extraKm.toLocaleString('en-LK')} extra km</b> ×</label>
                <input className="input !w-20 !py-0.5 text-xs" type="number" min="0" value={d.rate === '' ? String(m.rate) : d.rate} onChange={(e) => set({ rate: e.target.value })} />
                <span>= <b>{rs(m.extraKm * m.rate)}</b> {d.chargeKm ? 'added to the bill' : '(not charged)'}</span>
              </div>
            ) : <p className="text-emerald-700">Within the included km — no extra km charge.</p>
          )}
        </div>
      )}
      {m.problems.length > 0 && (
        <ul className="space-y-1">
          {m.problems.map((p) => <li key={p} className="text-xs text-red-600 flex items-start gap-1.5"><AlertCircle size={12} className="mt-0.5 flex-shrink-0" />{p}</li>)}
        </ul>
      )}
    </div>
  );
}
