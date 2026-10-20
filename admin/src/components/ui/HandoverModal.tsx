import { useState } from 'react';
import { AlertCircle, Camera, CheckCircle, Loader2, PlayCircle, Plus, Receipt, Trash2, X } from 'lucide-react';
import Modal from './Modal';
import SignaturePad from './SignaturePad';
import { useStore } from '../../store/useStore';
import { useAuthStore } from '../../store/useAuthStore';
import { toast } from '../../store/useToast';
import { CHECK_ITEMS, FUEL_LEVELS, depositHeld, priceBreakdown, rs, uploadBookingFile } from '../../lib/bookingRecord';
import { earlierKm } from '../../lib/exchange';
import { printInvoice } from '../../lib/printInvoice';
import type { Booking, ChargeKind, HandoverChecklist } from '../../types';

const EXTRA_KINDS: ChargeKind[] = ['Fuel', 'Late return', 'Damage', 'Cleaning', 'Traffic fine', 'Toll', 'Parking', 'Other'];
const METHODS = ['Cash', 'Bank transfer', 'Card', 'Online'];
const today = () => new Date().toLocaleDateString('en-CA');

const pad = (n: number) => String(n).padStart(2, '0');
const localNow = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };

/**
 * Pickup / return handover: odometer, fuel, checklist, damage photos and the customer's
 * signature. Saving starts (pickup) or completes (return) the rental.
 */
export default function HandoverModal({ booking: b, kind, onClose, onDone }: { booking: Booking; kind: 'pickup' | 'return'; onClose: () => void; onDone?: () => void }) {
  const { vehicles, recordHandover, addCharge, recordPayment, settleDeposit, updateVehicle } = useStore();
  const by = useAuthStore((s) => s.currentUser?.name) ?? 'Staff';
  const vehicle = vehicles.find((v) => v.id === b.vehicleId);
  const pickup = b.checklists?.pickup;
  const [at, setAt] = useState(localNow());
  const [location, setLocation] = useState((kind === 'pickup' ? b.pickupLocation : b.dropLocation) ?? '');
  const [odometer, setOdometer] = useState<number | ''>(kind === 'return' ? '' : vehicle?.mileage ?? '');
  const [fuel, setFuel] = useState<string>(kind === 'return' ? '' : 'Full');
  const [items, setItems] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(CHECK_ITEMS.map((i) => [i, kind === 'return' ? pickup?.items?.[i] ?? true : true])));
  const [damage, setDamage] = useState('');
  const [notes, setNotes] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [signature, setSignature] = useState<string>();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  // Km for the return: driven (incl. any earlier car of a mid-trip exchange) vs included, with the extra-km cost
  // older bookings may have no pickup reading saved — then it can be typed in from the agreement
  const [pickupKmIn, setPickupKmIn] = useState('');
  const startKm = pickup?.odometer ?? (pickupKmIn.trim() !== '' ? Number(pickupKmIn) : undefined);
  const driven = kind === 'return' && startKm !== undefined && odometer !== '' ? Number(odometer) - startKm + earlierKm(b) : undefined;
  const includedKm = (vehicle?.includedKmPerDay ?? 100) * (b.totalDays || 1);
  const extraKm = driven !== undefined ? Math.max(0, driven - includedKm) : 0;

  // ── Settlement at return: rent so far, extra km, other charges, deposit, payment collected ──
  const isReturn = kind === 'return';
  const price = priceBreakdown(b, vehicle);
  const kmAlreadyCharged = (b.charges ?? []).some((c) => c.status === 'Charged' && /extra km/i.test(c.note ?? ''));
  const [kmRate, setKmRate] = useState(String(vehicle?.extraKmRate ?? 50));
  const [saveRate, setSaveRate] = useState(false);
  const [chargeKm, setChargeKm] = useState(true);
  const [extras, setExtras] = useState<{ kind: ChargeKind; amount: string; note: string }[]>([]);
  const held = depositHeld(b);
  const [depKeep, setDepKeep] = useState('');
  const [depNote, setDepNote] = useState('');
  const [settleDep, setSettleDep] = useState(held > 0);
  const [collect, setCollect] = useState<string | null>(null);   // null = follow the balance
  const [method, setMethod] = useState('Cash');
  const [receiptNo, setReceiptNo] = useState('');
  const [invoice, setInvoice] = useState(true);
  const rate = Math.max(0, Number(kmRate) || 0);
  const kmCharge = isReturn && chargeKm && !kmAlreadyCharged ? Math.round(extraKm * rate) : 0;
  const extrasTotal = extras.reduce((s, x) => s + Math.max(0, Number(x.amount) || 0), 0);
  const newBill = price.bill + kmCharge + extrasTotal;
  const dueNow = Math.max(0, newBill - price.paid);
  const collectAmt = collect === null ? dueNow : Math.max(0, Number(collect) || 0);
  const remaining = Math.max(0, newBill - price.paid - collectAmt);
  const keep = Math.min(held, Math.max(0, Number(depKeep) || 0));

  const addPhotos = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const f of Array.from(files)) {
        const path = await uploadBookingFile(b.id, f);
        setPhotos((p) => [...p, path]);
        setPreviews((p) => [...p, URL.createObjectURL(f)]);
      }
    } catch (e) {
      toast.error('Photo not uploaded', (e as Error).message);
    } finally { setUploading(false); }
  };

  const save = () => {
    setError('');
    if (odometer === '' || Number(odometer) <= 0) return setError('Enter the odometer reading.');
    if (!fuel) return setError('Choose the fuel level.');
    if (kind === 'return' && startKm !== undefined && Number(odometer) < startKm) return setError(`The odometer can't be lower than at pickup (${startKm.toLocaleString()} km).`);
    const list: HandoverChecklist = {
      at: new Date(at).toISOString(), by, odometer: Number(odometer), fuel, items,
      damage: damage.trim() || undefined, notes: notes.trim() || undefined,
      photos: photos.length ? photos : undefined, signature,
    };
    if (isReturn && settleDep && keep > 0 && !depNote.trim()) return setError('Say why part of the deposit is kept.');
    if (isReturn && extras.some((x) => (Number(x.amount) || 0) > 0 && x.kind === 'Other' && !x.note.trim())) return setError('Describe each "Other" charge.');
    recordHandover(b.id, kind, list, location.trim() || undefined);
    if (isReturn) {
      // only if the rental really completed (e.g. not blocked by a breakdown replacement still out)
      const done = useStore.getState().bookings.find((x) => x.id === b.id);
      if (done?.status !== 'Completed') return;
      // a pickup reading typed in now (none was saved at pickup) is kept, so the booking and invoice show the km
      if (!pickup && startKm !== undefined) {
        useStore.getState().logBookingActivity(b.id, { by, type: 'Handover', text: `Pickup odometer ${startKm.toLocaleString()} km entered at return (from the agreement)` }, {
          checklists: { ...(done.checklists ?? {}), pickup: { at: b.pickupAt ?? new Date(`${b.startDate}T${b.startTime ?? '09:00'}`).toISOString(), by, odometer: startKm, fuel: '—', items: {}, notes: 'Entered at return from the agreement' } },
        });
      }
      if (saveRate && vehicle && rate !== (vehicle.extraKmRate ?? 50)) updateVehicle(vehicle.id, { extraKmRate: rate });
      if (kmCharge > 0) addCharge(b.id, { kind: 'Other', amount: kmCharge, date: today(), note: `Extra km: ${extraKm.toLocaleString()} km × Rs ${rate.toLocaleString()}`, by });
      extras.forEach((x) => {
        const amount = Math.max(0, Number(x.amount) || 0);
        if (amount > 0) addCharge(b.id, { kind: x.kind, amount, date: today(), note: x.note.trim() || undefined, by });
      });
      if (collectAmt > 0) recordPayment(b.id, { kind: 'Payment', amount: collectAmt, method, receiptNo: receiptNo.trim() || undefined, note: 'Collected at return', by });
      if (settleDep && held > 0) settleDeposit(b.id, { returned: held - keep, deduction: keep, method, notes: depNote.trim() || undefined }, by);
      if (invoice) {
        const fresh = useStore.getState().bookings.find((x) => x.id === b.id);
        if (fresh && !printInvoice(fresh, vehicle)) toast.error('Invoice not opened', 'Allow pop-ups for this site, then use "Print invoice" in the booking.');
      }
    }
    onDone?.();
    onClose();
  };

  const missingItems = CHECK_ITEMS.filter((i) => !items[i]);

  return (
    <Modal open onClose={onClose} title={kind === 'pickup' ? 'Hand over vehicle — start rental' : 'Receive vehicle — complete rental'} width="max-w-2xl">
      <div className="space-y-5">
        <div className="rounded-xl bg-navy-50/70 px-3 py-2.5 text-sm flex flex-wrap justify-between gap-2">
          <span><b className="text-navy-800">{b.customerName}</b> <span className="text-navy-500">· {vehicle ? `${vehicle.brand} ${vehicle.model} (${vehicle.vehicleNumber})` : ''}</span></span>
          {kind === 'return' && pickup && <span className="text-xs text-navy-500">At pickup: {pickup.odometer.toLocaleString()} km · fuel {pickup.fuel}</span>}
        </div>

        <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="text-xs font-medium text-navy-500">{kind === 'pickup' ? 'Handed over at' : 'Returned at'}
            <input type="datetime-local" className="input mt-1" value={at} onChange={(e) => setAt(e.target.value)} />
          </label>
          <label className="text-xs font-medium text-navy-500">Location
            <input className="input mt-1" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Colombo office / Hotel" />
          </label>
          <label className="text-xs font-medium text-navy-500">Odometer (km) *
            <input className="input mt-1" type="number" min="0" value={odometer} onChange={(e) => setOdometer(e.target.value === '' ? '' : Number(e.target.value))} placeholder="e.g. 48,250" />
          </label>
          <div className="text-xs font-medium text-navy-500">Fuel level *
            <div className="grid grid-cols-5 gap-1 mt-1">
              {FUEL_LEVELS.map((f) => (
                <button key={f} type="button" onClick={() => setFuel(f)}
                        className={`py-2 rounded-lg text-xs font-semibold border ${fuel === f ? 'bg-navy-800 text-white border-navy-800' : 'bg-white text-navy-600 border-navy-100 hover:border-navy-300'}`}>
                  {f}
                </button>
              ))}
            </div>
          </div>
        </section>

        {driven !== undefined && driven >= 0 && (
          <div className={`rounded-xl px-3 py-2.5 text-sm ${extraKm ? 'bg-amber-50 text-amber-900' : 'bg-emerald-50 text-emerald-800'}`}>
            <b>{driven.toLocaleString()} km</b> driven · {includedKm.toLocaleString()} km included
            {extraKm > 0 && <> · <b>{extraKm.toLocaleString()} extra km</b></>}
          </div>
        )}

        {isReturn && (
          <section className="rounded-2xl border border-navy-100 p-3 space-y-3">
            <p className="label !mb-0 flex items-center gap-1.5"><Receipt size={14} /> Payment &amp; settlement</p>

            {/* rent so far */}
            <div className="text-sm">
              {price.lines.map((l, i) => (
                <div key={i} className="flex justify-between gap-3 py-0.5"><span className="text-navy-600">{l.label}</span><span className={l.amount < 0 ? 'text-red-600' : 'text-navy-800'}>{l.amount < 0 ? `− ${rs(-l.amount)}` : rs(l.amount)}</span></div>
              ))}
              <div className="flex justify-between gap-3 py-0.5 border-t border-navy-50 mt-1"><span className="text-navy-500">Bill so far</span><b>{rs(price.bill)}</b></div>
              <div className="flex justify-between gap-3 py-0.5"><span className="text-navy-500">Already paid</span><span className="text-emerald-700">{rs(price.paid)}</span></div>
            </div>

            {/* extra mileage */}
            <div className="rounded-xl bg-navy-50/60 p-2.5 space-y-2">
              <p className="text-xs font-semibold text-navy-700">Extra mileage</p>
              {!kmAlreadyCharged && !pickup && (
                <label className="text-xs text-navy-500 block">No odometer reading was saved at pickup — enter it from the agreement:
                  <input className="input !py-1.5 mt-1 sm:!w-56" type="number" min="0" placeholder="Odometer at pickup (km)" value={pickupKmIn} onChange={(e) => setPickupKmIn(e.target.value)} />
                </label>
              )}
              {kmAlreadyCharged ? <p className="text-xs text-navy-500">Extra km is already on the bill.</p> : driven === undefined ? (
                <p className="text-xs text-navy-500">Enter the odometer reading{!pickup ? 's' : ' above'} to work it out.</p>
              ) : driven < 0 ? (
                <p className="text-xs text-red-600">The return reading is lower than at pickup — check both numbers.</p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 items-end">
                  <div className="text-xs text-navy-500">Extra km<p className="text-sm font-semibold text-navy-800 mt-1">{extraKm.toLocaleString()} km</p></div>
                  <label className="text-xs text-navy-500">Rate (Rs / km)
                    <input className="input !py-1.5 mt-1" type="number" min="0" value={kmRate} onChange={(e) => setKmRate(e.target.value)} />
                  </label>
                  <div className="text-xs text-navy-500">Charge<p className="text-sm font-semibold text-navy-800 mt-1">{rs(extraKm * rate)}</p></div>
                  <label className="text-xs text-navy-700 flex items-center gap-1.5 pb-2"><input type="checkbox" checked={chargeKm} onChange={(e) => setChargeKm(e.target.checked)} /> Charge it</label>
                </div>
              )}
              {vehicle && rate !== (vehicle.extraKmRate ?? 50) && (
                <label className="text-xs text-navy-700 flex items-center gap-1.5"><input type="checkbox" checked={saveRate} onChange={(e) => setSaveRate(e.target.checked)} />
                  Save Rs {rate.toLocaleString()}/km as {vehicle.vehicleNumber}'s extra km rate (now Rs {(vehicle.extraKmRate ?? 50).toLocaleString()})</label>
              )}
            </div>

            {/* other charges collected at return */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-navy-700">Other charges</p>
              {extras.map((x, i) => (
                <div key={i} className="grid grid-cols-[1fr_110px_auto] sm:grid-cols-[150px_120px_1fr_auto] gap-2 items-center">
                  <select className="input !py-1.5 text-sm" value={x.kind} onChange={(e) => setExtras((l) => l.map((y, j) => (j === i ? { ...y, kind: e.target.value as ChargeKind } : y)))}>
                    {EXTRA_KINDS.map((k) => <option key={k}>{k}</option>)}
                  </select>
                  <input className="input !py-1.5 text-sm" type="number" min="0" placeholder="Rs" value={x.amount} onChange={(e) => setExtras((l) => l.map((y, j) => (j === i ? { ...y, amount: e.target.value } : y)))} />
                  <input className="input !py-1.5 text-sm col-span-2 sm:col-span-1 order-last sm:order-none" placeholder="Details, e.g. fuel top-up 10 L" value={x.note} onChange={(e) => setExtras((l) => l.map((y, j) => (j === i ? { ...y, note: e.target.value } : y)))} />
                  <button type="button" onClick={() => setExtras((l) => l.filter((_, j) => j !== i))} className="p-1.5 text-navy-400 hover:text-red-600" aria-label="Remove charge"><Trash2 size={15} /></button>
                </div>
              ))}
              <button type="button" onClick={() => setExtras((l) => [...l, { kind: 'Fuel', amount: '', note: '' }])} className="text-xs font-semibold text-navy-600 hover:text-navy-900 inline-flex items-center gap-1"><Plus size={13} /> Add a charge (fuel, late return, damage…)</button>
            </div>

            {/* deposit */}
            {held > 0 && (
              <div className="rounded-xl bg-amber-50/70 p-2.5 space-y-2">
                <label className="text-xs font-semibold text-amber-900 flex items-center gap-1.5"><input type="checkbox" checked={settleDep} onChange={(e) => setSettleDep(e.target.checked)} /> Settle the deposit now ({rs(held)} held)</label>
                {settleDep && (
                  <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-2">
                    <label className="text-xs text-navy-500">Keep (Rs)<input className="input !py-1.5 mt-1" type="number" min="0" max={held} value={depKeep} placeholder="0" onChange={(e) => setDepKeep(e.target.value)} /></label>
                    <label className="text-xs text-navy-500">{keep > 0 ? 'Why is part kept? *' : 'Note'}<input className="input !py-1.5 mt-1" value={depNote} onChange={(e) => setDepNote(e.target.value)} /></label>
                    <p className="text-xs text-amber-900 sm:col-span-2">Return {rs(held - keep)} to the customer{keep > 0 ? `, keep ${rs(keep)}` : ''}.</p>
                  </div>
                )}
              </div>
            )}

            {/* totals and payment collected now */}
            <div className="rounded-xl bg-navy-800 text-white p-3 space-y-2">
              <div className="flex justify-between text-sm"><span className="opacity-70">Final bill</span><b>{rs(newBill)}</b></div>
              <div className="flex justify-between text-sm"><span className="opacity-70">Balance before payment</span><b>{rs(dueNow)}</b></div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
                <label className="text-[11px] opacity-80">Collected now (Rs)
                  <input className="input !py-1.5 mt-1 text-navy-900" type="number" min="0" value={collect ?? String(dueNow)} onChange={(e) => setCollect(e.target.value)} />
                </label>
                <label className="text-[11px] opacity-80">Method
                  <select className="input !py-1.5 mt-1 text-navy-900" value={method} onChange={(e) => setMethod(e.target.value)}>{METHODS.map((m) => <option key={m}>{m}</option>)}</select>
                </label>
                <label className="text-[11px] opacity-80">Receipt no.
                  <input className="input !py-1.5 mt-1 text-navy-900" value={receiptNo} onChange={(e) => setReceiptNo(e.target.value)} />
                </label>
              </div>
              <div className="flex justify-between text-sm pt-1 border-t border-white/15">
                <span className="opacity-70">Still owed after this</span>
                <b className={remaining > 0 ? 'text-amber-300' : 'text-emerald-300'}>{remaining > 0 ? rs(remaining) : 'Paid in full'}</b>
              </div>
            </div>
            <label className="text-xs text-navy-700 flex items-center gap-1.5"><input type="checkbox" checked={invoice} onChange={(e) => setInvoice(e.target.checked)} /> Open the invoice after completing (print or save as PDF)</label>
          </section>
        )}

        <section>
          <p className="label">Checklist</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {CHECK_ITEMS.map((i) => (
              <label key={i} className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm cursor-pointer ${items[i] ? 'border-emerald-200 bg-emerald-50/50 text-navy-800' : 'border-red-200 bg-red-50 text-red-700'}`}>
                <input type="checkbox" className="accent-emerald-600" checked={!!items[i]} onChange={(e) => setItems((x) => ({ ...x, [i]: e.target.checked }))} />
                {i}
              </label>
            ))}
          </div>
          {missingItems.length > 0 && <p className="text-[11px] text-red-600 mt-1">Not OK / missing: {missingItems.join(', ')}</p>}
        </section>

        <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="text-xs font-medium text-navy-500">Damage / scratches noted
            <textarea className="input mt-1 min-h-[70px]" value={damage} onChange={(e) => setDamage(e.target.value)} placeholder="e.g. Small scratch on rear bumper (left)" />
          </label>
          <label className="text-xs font-medium text-navy-500">Other notes
            <textarea className="input mt-1 min-h-[70px]" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything else to remember" />
          </label>
        </section>

        <section>
          <p className="label">Photos of the vehicle</p>
          <div className="flex flex-wrap gap-2">
            {previews.map((p, i) => (
              <div key={p} className="relative w-20 h-16 rounded-lg overflow-hidden bg-navy-50">
                <img src={p} alt="" className="w-full h-full object-cover" />
                <button type="button" onClick={() => { setPhotos((x) => x.filter((_, j) => j !== i)); setPreviews((x) => x.filter((_, j) => j !== i)); }}
                        className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center" aria-label="Remove photo"><X size={11} /></button>
              </div>
            ))}
            <label className="w-20 h-16 rounded-lg border border-dashed border-navy-200 flex flex-col items-center justify-center text-[10px] text-navy-400 cursor-pointer hover:bg-navy-50">
              {uploading ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} />}
              {uploading ? 'Uploading' : 'Add photos'}
              <input type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={(e) => addPhotos(e.target.files)} />
            </label>
          </div>
          <p className="text-[11px] text-navy-400 mt-1">Front, back, both sides and any damage — these settle deposit disputes.</p>
        </section>

        <section>
          <p className="label">Customer signature</p>
          <SignaturePad onChange={setSignature} />
          <p className="text-[11px] text-navy-400 mt-1">The customer confirms the condition, fuel and km above.</p>
        </section>

        {error && <p className="text-sm text-red-600 bg-red-50 rounded-xl px-3 py-2 flex gap-2"><AlertCircle size={15} className="mt-0.5 flex-shrink-0" />{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="button" onClick={save} disabled={uploading}
                  className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${kind === 'pickup' ? 'bg-navy-800 hover:bg-navy-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}>
            {kind === 'pickup' ? <><PlayCircle size={15} /> Start rental</> : <><CheckCircle size={15} /> Complete rental{invoice ? ' & invoice' : ''}</>}
          </button>
        </div>
      </div>
    </Modal>
  );
}
