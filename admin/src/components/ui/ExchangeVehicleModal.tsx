import { useMemo, useState } from 'react';
import { AlertCircle, ArrowLeftRight, ArrowRight, Wrench } from 'lucide-react';
import Modal from './Modal';
import Select from './Select';
import { useStore } from '../../store/useStore';
import { useAuthStore } from '../../store/useAuthStore';
import { FUEL_LEVELS } from '../../lib/bookingRecord';
import { currentLegStart, legsOf, previewExchange, suggestedDays } from '../../lib/exchange';
import type { Booking, DamagePayer } from '../../types';

const pad = (n: number) => String(n).padStart(2, '0');
const localNow = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const rs = (n: number) => `Rs ${Math.round(n).toLocaleString('en-LK')}`;
const REASONS = ['Accident', 'Breakdown', 'Damage found', 'Mechanical problem', 'Other'];
const PAYERS: [DamagePayer, string][] = [['Customer', 'Customer'], ['Insurance', 'Insurance'], ['Company', 'Company'], ['Owner', 'Vehicle owner'], ['Undecided', 'Not decided yet']];

function Chips<T extends string>({ value, options, onChange }: { value: T | ''; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(([v, label]) => (
        <button key={v} type="button" onClick={() => onChange(v)} aria-pressed={value === v}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${value === v ? 'bg-navy-800 text-white border-navy-800' : 'bg-white text-navy-600 border-navy-100 hover:border-navy-300'}`}>{label}</button>
      ))}
    </div>
  );
}

function Fuel({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="grid grid-cols-5 gap-1">
      {FUEL_LEVELS.map((f) => (
        <button key={f} type="button" onClick={() => onChange(f)}
                className={`py-2 rounded-lg text-xs font-semibold border ${value === f ? 'bg-navy-800 text-white border-navy-800' : 'bg-white text-navy-600 border-navy-100 hover:border-navy-300'}`}>{f}</button>
      ))}
    </div>
  );
}

/**
 * Mid-trip vehicle exchange: the customer gives back a damaged / broken-down car and continues in
 * another. Records both handovers, the damage and who pays, and splits the owner payout:
 * the booked car earns the agreed price for its days, the replacement its own daily rent × its days.
 */
export default function ExchangeVehicleModal({ booking: b, onClose }: { booking: Booking; onClose: () => void }) {
  const { vehicles, owners, isVehicleAvailable, exchangeVehicle } = useStore();
  const by = useAuthStore((s) => s.currentUser?.name) ?? 'Staff';
  const from = vehicles.find((v) => v.id === b.vehicleId);
  const ownerName = (vid?: string) => owners.find((o) => o.id === vehicles.find((v) => v.id === vid)?.ownerId)?.name ?? 'Owner';
  const pickupKm = b.checklists?.pickup?.odometer;
  const legStart = currentLegStart(b);
  const legsNow = legsOf(b);
  const curDays = legsNow[legsNow.length - 1].days;

  const [at, setAt] = useState(localNow());
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [retKm, setRetKm] = useState<number | ''>('');
  const [retFuel, setRetFuel] = useState('');
  const [retDamage, setRetDamage] = useState('');
  const [toId, setToId] = useState('');
  const [delKm, setDelKm] = useState<number | ''>('');
  const [delFuel, setDelFuel] = useState('Full');
  const [days, setDays] = useState<number | ''>(() => suggestedDays(b, new Date(localNow()).toISOString()));
  const [daysTouched, setDaysTouched] = useState(false);
  const [payer, setPayer] = useState<DamagePayer | ''>('');
  const [amount, setAmount] = useState<number | ''>('');
  const [comp, setComp] = useState(false);
  const [compAmount, setCompAmount] = useState<number | ''>('');
  const [compBy, setCompBy] = useState<'Customer' | 'Company'>('Company');
  const [oldCarTo, setOldCarTo] = useState<'Maintenance' | 'Available'>('Maintenance');
  const [location, setLocation] = useState('');
  const [error, setError] = useState('');

  const atIso = at ? new Date(at).toISOString() : '';
  const atDate = at.slice(0, 10), atTime = at.slice(11, 16);
  const free = useMemo(() => vehicles.filter((v) => v.id !== b.vehicleId && v.status !== 'Maintenance'
    && atDate && isVehicleAvailable(v.id, atDate, b.endDate, b.id, atTime, b.endTime)), [vehicles, b, atDate, atTime, isVehicleAvailable]);
  const to = vehicles.find((v) => v.id === toId);
  const p = to && days !== '' ? previewExchange(b, Number(days), to.dailyRent) : null;
  const compN = comp ? Number(compAmount) || 0 : 0;
  const companyNet = p ? p.company - (compBy === 'Company' ? compN : 0) : 0;

  const changeAt = (v: string) => {
    setAt(v);
    if (!daysTouched && v) setDays(suggestedDays(b, new Date(v).toISOString()));
  };
  const pickTo = (id: string) => {
    setToId(id);
    const v = vehicles.find((x) => x.id === id);
    if (v && delKm === '') setDelKm(v.mileage ?? '');
  };

  const save = () => {
    setError('');
    if (!at) return setError('Enter when the cars were exchanged.');
    if (new Date(at).getTime() > Date.now() + 5 * 60e3) return setError('The exchange time can’t be in the future.');
    if (!reason) return setError('Choose the reason for the exchange.');
    if (retKm === '' || Number(retKm) <= 0) return setError(`Enter the odometer of ${from?.vehicleNumber ?? 'the returned car'}.`);
    if (pickupKm !== undefined && Number(retKm) < pickupKm) return setError(`The odometer can’t be lower than at pickup (${pickupKm.toLocaleString()} km).`);
    if (!retFuel) return setError('Choose the fuel level of the returned car.');
    if (!toId) return setError('Choose the replacement vehicle.');
    if (delKm === '' || Number(delKm) <= 0) return setError('Enter the odometer of the replacement.');
    if (days === '' || Number(days) < 1 || Number(days) > curDays) return setError(`Days with ${from?.vehicleNumber} must be between 1 and ${curDays}.`);
    if (payer && retDamage.trim() === '' && !details.trim()) return setError('Describe the damage.');
    if (comp && !(compN > 0)) return setError('Enter the compensation amount, or untick it.');
    const err = exchangeVehicle(b.id, {
      at: atIso, by, toVehicleId: toId, fromDays: Number(days), reason, details: details.trim() || undefined,
      returned: { odometer: Number(retKm), fuel: retFuel, damage: retDamage.trim() || undefined },
      delivered: { odometer: Number(delKm), fuel: delFuel },
      location: location.trim() || undefined,
      damage: payer ? { description: retDamage.trim() || details.trim(), payer, amount: Number(amount) || undefined } : undefined,
      compensation: comp ? { amount: compN, paidBy: compBy } : undefined,
      oldCarTo,
    });
    if (err) return setError(err);
    onClose();
  };

  const section = 'rounded-xl border border-navy-100 p-4 space-y-3';
  return (
    <Modal open onClose={onClose} title="Exchange vehicle (mid-trip)" width="max-w-2xl">
      <div className="space-y-4">
        <p className="text-sm text-navy-500">
          The customer gives back <b className="text-navy-800">{from ? `${from.brand} ${from.model} (${from.vehicleNumber})` : '—'}</b> and continues in another car until{' '}
          <b className="text-navy-800">{b.endDate}{b.endTime ? ` ${b.endTime}` : ''}</b>. The customer's price stays the same.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <p className="label">Exchanged at *</p>
            <input className="input" type="datetime-local" value={at} onChange={(e) => changeAt(e.target.value)} />
          </div>
          <div>
            <p className="label">Where</p>
            <input className="input" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Kandy town" />
          </div>
        </div>
        <div>
          <p className="label">Reason *</p>
          <Chips value={reason} options={REASONS.map((r) => [r, r])} onChange={setReason} />
          <input className="input mt-2" value={details} onChange={(e) => setDetails(e.target.value)} placeholder="What happened (optional)" />
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <section className={section}>
            <p className="text-sm font-semibold text-navy-800 flex items-center gap-1.5"><Wrench size={14} /> Returned: {from?.vehicleNumber}</p>
            <div>
              <p className="label">Odometer (km) *</p>
              <input className="input" type="number" min="0" value={retKm} onChange={(e) => setRetKm(e.target.value === '' ? '' : Number(e.target.value))}
                     placeholder={pickupKm !== undefined ? `At pickup: ${pickupKm.toLocaleString()}` : ''} />
              {pickupKm !== undefined && retKm !== '' && Number(retKm) >= pickupKm && <p className="text-[11px] text-navy-400 mt-1">{(Number(retKm) - pickupKm).toLocaleString()} km driven in this car</p>}
            </div>
            <div><p className="label">Fuel *</p><Fuel value={retFuel} onChange={setRetFuel} /></div>
            <div>
              <p className="label">Damage</p>
              <textarea className="input" rows={2} value={retDamage} onChange={(e) => setRetDamage(e.target.value)} placeholder="e.g. Front bumper and left headlight broken" />
            </div>
            {from?.status === 'Maintenance' ? (
              <p className="text-[11px] text-navy-500">This car is under maintenance (breakdown hold) — it stays there until an admin confirms it ready.</p>
            ) : (
              <div>
                <p className="label">This car now goes to</p>
                <Chips value={oldCarTo} options={[['Maintenance', 'Maintenance (repair)'], ['Available', 'Available']]} onChange={setOldCarTo} />
              </div>
            )}
          </section>

          <section className={section}>
            <p className="text-sm font-semibold text-navy-800 flex items-center gap-1.5"><ArrowRight size={14} /> Replacement</p>
            <div>
              <p className="label">Vehicle * <span className="normal-case font-normal text-navy-400">(free until {b.endDate})</span></p>
              <Select searchable searchPlaceholder="Search model or number…" value={toId} onChange={pickTo} placeholder={free.length ? 'Choose a vehicle…' : 'No vehicle is free for the rest of this trip'}
                      options={free.map((v) => ({ value: v.id, label: `${v.brand} ${v.model} · ${v.vehicleNumber}`, sub: `Rs ${v.dailyRent.toLocaleString()} / day · ${ownerName(v.id)}` }))} />
            </div>
            <div>
              <p className="label">Odometer at handover (km) *</p>
              <input className="input" type="number" min="0" value={delKm} onChange={(e) => setDelKm(e.target.value === '' ? '' : Number(e.target.value))} />
            </div>
            <div><p className="label">Fuel *</p><Fuel value={delFuel} onChange={setDelFuel} /></div>
          </section>
        </div>

        <section className={section}>
          <p className="text-sm font-semibold text-navy-800">Owner payouts</p>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-navy-500">Days with {from?.vehicleNumber}:</span>
            <input className="input !w-20 !py-1.5" type="number" min="1" max={curDays} value={days}
                   onChange={(e) => { setDaysTouched(true); setDays(e.target.value === '' ? '' : Math.floor(Number(e.target.value))); }} />
            <span className="text-navy-400 text-xs">since {legStart.date}{legStart.time ? ` ${legStart.time}` : ''} · {curDays} day{curDays === 1 ? '' : 's'} left on this booking</span>
          </div>
          {p && to ? (
            <div className="rounded-lg bg-navy-50/60 divide-y divide-navy-100 text-sm">
              <div className="flex justify-between gap-3 px-3 py-2">
                <span>{ownerName(from?.id)} · {from?.vehicleNumber} · {p.fromDays} day{p.fromDays === 1 ? '' : 's'}
                  <span className="text-navy-400 text-xs"> ({p.isFirst ? `agreed price${b.referralFee ? `, less referral ${rs(b.referralFee)}` : ''}` : 'its daily rent'})</span></span>
                <b>{rs(p.fromPayout + compN)}</b>
              </div>
              <div className="flex justify-between gap-3 px-3 py-2">
                <span>{ownerName(to.id)} · {to.vehicleNumber} · {p.toDays} day{p.toDays === 1 ? '' : 's'} × {rs(to.dailyRent)}</span>
                <b>{rs(p.toPayout)}</b>
              </div>
              <div className="flex justify-between gap-3 px-3 py-2 text-navy-500">
                <span>Customer pays (unchanged)</span><span>{rs(b.totalAmount)}</span>
              </div>
              <div className={`flex justify-between gap-3 px-3 py-2 font-semibold ${companyNet >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                <span>Company {companyNet >= 0 ? 'keeps' : 'covers'}{b.exchanges?.length ? ' (whole booking)' : ''}</span><span>{rs(Math.abs(companyNet))}</span>
              </div>
            </div>
          ) : <p className="text-xs text-navy-400">Choose the replacement to see how the payout is split.</p>}
          {p && p.toDays === 0 && <p className="text-xs font-semibold text-amber-700">The replacement gets no paid days — lower the days with {from?.vehicleNumber} if it is with the customer for any part of the trip.</p>}
          <label className="flex items-center gap-2 text-sm text-navy-700 cursor-pointer">
            <input type="checkbox" className="rounded" checked={comp} onChange={(e) => setComp(e.target.checked)} />
            Compensate {ownerName(from?.id)} for the days the car can't work
          </label>
          {comp && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><p className="label">Amount (Rs)</p><input className="input" type="number" min="0" value={compAmount} onChange={(e) => setCompAmount(e.target.value === '' ? '' : Number(e.target.value))} /></div>
              <div><p className="label">Paid by</p><Chips value={compBy} options={[['Company', 'Company'], ['Customer', 'Customer (added to their bill)']]} onChange={setCompBy} /></div>
            </div>
          )}
        </section>

        <section className={section}>
          <p className="text-sm font-semibold text-navy-800">Who pays for the damage?</p>
          <Chips value={payer} options={PAYERS} onChange={setPayer} />
          {payer && payer !== 'Undecided' && (
            <div className="sm:w-1/2">
              <p className="label">Amount (Rs) <span className="normal-case font-normal text-navy-400">— optional, add later if not known</span></p>
              <input className="input" type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value === '' ? '' : Number(e.target.value))} />
            </div>
          )}
          <p className="text-[11px] text-navy-400">
            {payer === 'Customer' ? 'Added to the customer’s bill as a Damage charge.'
              : payer === 'Company' || payer === 'Owner' ? `Saved as a repair expense on ${from?.vehicleNumber}.`
              : payer === 'Insurance' ? 'Noted on the booking for the insurance claim.'
              : 'Leave empty if there was no damage (e.g. a breakdown).'}
          </p>
        </section>

        {error && <p className="text-sm text-red-600 flex gap-2"><AlertCircle size={15} className="mt-0.5 flex-shrink-0" />{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="button" onClick={save} className="btn-primary inline-flex items-center gap-1.5"><ArrowLeftRight size={15} /> Exchange vehicle</button>
        </div>
      </div>
    </Modal>
  );
}
