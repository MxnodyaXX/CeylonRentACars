import { useState } from 'react';
import { AlertCircle, Camera, CheckCircle, Loader2, PlayCircle, X } from 'lucide-react';
import Modal from './Modal';
import SignaturePad from './SignaturePad';
import { useStore } from '../../store/useStore';
import { useAuthStore } from '../../store/useAuthStore';
import { toast } from '../../store/useToast';
import { CHECK_ITEMS, FUEL_LEVELS, rs, uploadBookingFile } from '../../lib/bookingRecord';
import type { Booking, HandoverChecklist } from '../../types';

const pad = (n: number) => String(n).padStart(2, '0');
const localNow = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };

/**
 * Pickup / return handover: odometer, fuel, checklist, damage photos and the customer's
 * signature. Saving starts (pickup) or completes (return) the rental.
 */
export default function HandoverModal({ booking: b, kind, onClose, onDone }: { booking: Booking; kind: 'pickup' | 'return'; onClose: () => void; onDone?: () => void }) {
  const { vehicles, recordHandover } = useStore();
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

  // Km for the return: driven vs included, with the extra-km cost
  const driven = kind === 'return' && pickup && odometer !== '' ? Number(odometer) - pickup.odometer : undefined;
  const includedKm = (vehicle?.includedKmPerDay ?? 100) * (b.totalDays || 1);
  const extraKm = driven !== undefined ? Math.max(0, driven - includedKm) : 0;

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
    if (kind === 'return' && pickup && Number(odometer) < pickup.odometer) return setError(`The odometer can't be lower than at pickup (${pickup.odometer.toLocaleString()} km).`);
    const list: HandoverChecklist = {
      at: new Date(at).toISOString(), by, odometer: Number(odometer), fuel, items,
      damage: damage.trim() || undefined, notes: notes.trim() || undefined,
      photos: photos.length ? photos : undefined, signature,
    };
    recordHandover(b.id, kind, list, location.trim() || undefined);
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
            {extraKm > 0 && <> · <b>{extraKm.toLocaleString()} extra km</b> ≈ {rs(extraKm * (vehicle?.extraKmRate ?? 50))} — add it as a charge in Payments</>}
          </div>
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
            {kind === 'pickup' ? <><PlayCircle size={15} /> Start rental</> : <><CheckCircle size={15} /> Complete rental</>}
          </button>
        </div>
      </div>
    </Modal>
  );
}
