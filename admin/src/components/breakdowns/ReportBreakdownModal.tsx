import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, ArrowRight, Camera, Loader2, MapPin, Save } from 'lucide-react';
import Modal from '../ui/Modal';
import Select from '../ui/Select';
import { useStore } from '../../store/useStore';
import { useAuthStore } from '../../store/useAuthStore';
import { useBreakdownStore } from '../../store/useBreakdownStore';
import { BdIncident, CATEGORY_LABEL, BdCategory, UNSAFE_CATEGORIES } from '../../lib/breakdowns';
import { uploadBookingFile, FUEL_LEVELS } from '../../lib/bookingRecord';
import { vehicleHistory } from '../../lib/breakdownLedger';
import { toast } from '../../store/useToast';
import { Chips, ErrorLine, Field, Grid, KV, fromLocalInput, nowLocal, rs } from './bdui';

interface Form {
  bookingId: string;
  occurredAt: string; location: string; lat?: number; lng?: number;
  reportedBy: BdIncident['reportedBy']; contactPhone: string; mileage: string; fuel: string;
  category: BdCategory | ''; description: string;
  driveable: BdIncident['driveable']; passengersSafe: BdIncident['passengersSafe']; urgency: BdIncident['urgency'];
  notes: string;
}
const blank = (bookingId = ''): Form => ({
  bookingId, occurredAt: nowLocal(), location: '', reportedBy: 'customer', contactPhone: '', mileage: '', fuel: '',
  category: '', description: '', driveable: 'unknown', passengersSafe: 'unknown', urgency: 'normal', notes: '',
});
const draftKey = (bookingId: string) => `bd-report-draft-${bookingId || 'new'}`;
const STEPS = ['Booking', 'What happened', 'Safety', 'Evidence'] as const;

/**
 * Report a breakdown — step by step. The booking, customer, vehicle and owner fill in by themselves;
 * the form is saved as a draft in this browser while you type, so nothing is lost.
 */
export default function ReportBreakdownModal({ bookingId, onClose, onCreated }: { bookingId?: string; onClose: () => void; onCreated?: (id: string) => void }) {
  const { bookings, vehicles, owners } = useStore();
  const by = useAuthStore((s) => s.currentUser?.name) ?? 'Staff';
  const report = useBreakdownStore((s) => s.report);
  const addDocument = useBreakdownStore((s) => s.addDocument);
  const incidents = useBreakdownStore((s) => s.incidents);
  const activeHold = useBreakdownStore((s) => s.activeHold);
  const [f, setF] = useState<Form>(() => {
    try { const saved = localStorage.getItem(draftKey(bookingId ?? '')); if (saved) return { ...blank(bookingId), ...JSON.parse(saved) }; } catch { /* private mode */ }
    return blank(bookingId);
  });
  const [restored] = useState(() => { try { return !!localStorage.getItem(draftKey(bookingId ?? '')); } catch { return false; } });
  const [step, setStep] = useState(bookingId ? 1 : 0);
  const [files, setFiles] = useState<File[]>([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));

  // keep a draft while typing
  useEffect(() => {
    const t = setTimeout(() => { try { localStorage.setItem(draftKey(bookingId ?? ''), JSON.stringify(f)); } catch { /* ignore */ } }, 400);
    return () => clearTimeout(t);
  }, [f, bookingId]);

  const b = bookings.find((x) => x.id === f.bookingId);
  const vehicle = vehicles.find((v) => v.id === b?.vehicleId);
  const owner = owners.find((o) => o.id === vehicle?.ownerId);
  const unsafe = (f.category && UNSAFE_CATEGORIES.includes(f.category)) || f.driveable === 'no' || f.passengersSafe === 'at_risk';
  const live = useMemo(() => bookings.filter((x) => x.status === 'Ongoing' || x.status === 'Confirmed')
    .sort((a, c) => (a.status === c.status ? a.startDate.localeCompare(c.startDate) : a.status === 'Ongoing' ? -1 : 1)), [bookings]);

  const check = (s: number): string | null => {
    if (s === 0 && !b) return 'Choose the booking.';
    if (s === 1 && !f.category) return 'Choose what kind of breakdown it is.';
    if (s === 1 && !f.description.trim()) return 'Describe the problem.';
    if (s === 1 && f.mileage !== '' && Number(f.mileage) < 0) return 'Mileage cannot be negative.';
    return null;
  };
  const next = () => { const e = check(step); if (e) { setErr(e); return; } setErr(''); setStep((x) => x + 1); };

  const locate = () => {
    if (!navigator.geolocation) { toast.warning('Location not available', 'This browser cannot share its location.'); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => { setF((x) => ({ ...x, lat: Math.round(p.coords.latitude * 1e6) / 1e6, lng: Math.round(p.coords.longitude * 1e6) / 1e6 })); setLocating(false); },
      () => { toast.warning('Location not shared', 'Type the place instead, or paste coordinates from Google Maps.'); setLocating(false); },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const submit = async () => {
    for (const s of [0, 1]) { const e = check(s); if (e) { setErr(e); setStep(s); return; } }
    setBusy(true); setErr('');
    const r = report({
      bookingId: f.bookingId, occurredAt: fromLocalInput(f.occurredAt), location: f.location, lat: f.lat, lng: f.lng,
      reportedBy: f.reportedBy, contactPhone: f.contactPhone, mileage: f.mileage === '' ? undefined : Number(f.mileage), fuel: f.fuel || undefined,
      category: f.category as BdCategory, description: f.description, driveable: f.driveable, passengersSafe: f.passengersSafe, urgency: f.urgency,
      notes: f.notes, by,
    });
    if (r.error || !r.incident) { setErr(r.error ?? 'Not saved.'); setBusy(false); return; }
    for (const file of files) {
      try {
        const path = await uploadBookingFile(f.bookingId, file);
        addDocument({ incidentId: r.incident.id, kind: file.type.startsWith('video/') ? 'video' : file.type.startsWith('image/') ? 'photo' : 'other', name: file.name, path, uploadedBy: by });
      } catch (e) { toast.error(`${file.name} not uploaded`, (e as Error).message); }
    }
    try { localStorage.removeItem(draftKey(bookingId ?? '')); } catch { /* ignore */ }
    setBusy(false);
    toast.success('Breakdown reported', `${r.incident.ref} — now choose how to solve it.`);
    onCreated?.(r.incident.id);
    onClose();
  };

  return (
    <Modal open onClose={onClose} title="Report a breakdown" width="max-w-2xl">
      <div className="space-y-4">
        <ol className="flex gap-1 text-[11px] font-semibold">
          {STEPS.map((s, i) => (
            <li key={s} className={`flex-1 rounded-lg px-2 py-1.5 text-center ${i === step ? 'bg-navy-800 text-white' : i < step ? 'bg-navy-100 text-navy-700' : 'bg-navy-50 text-navy-400'}`}>{i + 1}. {s}</li>
          ))}
        </ol>
        {restored && <p className="text-xs text-navy-500 flex items-center gap-1"><Save size={12} /> Draft restored. <button type="button" className="underline" onClick={() => { setF(blank(bookingId)); try { localStorage.removeItem(draftKey(bookingId ?? '')); } catch { /* ignore */ } }}>Start over</button></p>}

        {step === 0 && (
          <Field label="Booking *">
            <Select value={f.bookingId} onChange={(v) => set('bookingId', v)} placeholder={live.length ? 'Choose the booking…' : 'No active bookings'}
              options={live.map((x) => {
                const v = vehicles.find((y) => y.id === x.vehicleId);
                return { value: x.id, label: `${x.customerName} · ${v ? `${v.brand} ${v.model} (${v.vehicleNumber})` : '—'}`, sub: `${x.status} · ${x.startDate} → ${x.endDate}` };
              })} />
          </Field>
        )}

        {b && step > 0 && (
          <div className="rounded-xl bg-navy-50/60 px-3 py-2 grid sm:grid-cols-2 gap-x-6">
            <KV k="Customer" v={`${b.customerName} · ${b.customerPhone}`} />
            <KV k="Vehicle" v={vehicle ? `${vehicle.brand} ${vehicle.model} (${vehicle.vehicleNumber})` : '—'} />
            <KV k="Owner" v={owner?.name} />
            <KV k="Rental" v={`${b.startDate} → ${b.endDate}`} />
            <KV k="Booking value" v={rs(b.totalAmount)} />
            <KV k="Paid" v={`${rs(b.paidAmount + (b.advanceAmount ?? 0))} · ${(b.payments ?? []).length} payment(s)`} />
          </div>
        )}
        {b && step > 0 && (() => {
          const h = vehicleHistory(b.vehicleId, incidents);
          const hold = activeHold(b.vehicleId);
          return (
            <div className={`rounded-xl px-3 py-2 text-xs ${h.repeat ? 'bg-amber-50 border border-amber-200 text-amber-900' : 'bg-navy-50/60 text-navy-600'}`}>
              <p>{hold ? `${vehicle?.vehicleNumber} is already under maintenance (hold from ${hold.ref}) — this breakdown will be linked to it.` : `Reporting puts ${vehicle?.vehicleNumber ?? 'the vehicle'} under maintenance: no new bookings until an admin confirms it is safe.`}</p>
              {h.previous.length > 0 && <p className="mt-1">Earlier breakdowns: {h.previous.slice(-3).reverse().map((x) => `${x.ref} (${CATEGORY_LABEL[x.category]}, ${new Date(x.occurredAt ?? x.reportedAt).toLocaleDateString('en-GB')})`).join(' · ')}{h.previous.length > 3 ? ` + ${h.previous.length - 3} more` : ''}</p>}
              {h.repeat && <p className="mt-1 font-semibold flex items-center gap-1"><AlertTriangle size={12} /> Repeated breakdowns ({h.reason}) — plan a full inspection.</p>}
            </div>
          );
        })()}

        {step === 1 && (
          <div className="space-y-3">
            <Grid>
              <Field label="When it broke down"><input className="input" type="datetime-local" value={f.occurredAt} onChange={(e) => set('occurredAt', e.target.value)} /></Field>
              <Field label="Reported by"><Chips size="xs" value={f.reportedBy} options={[['customer', 'Customer'], ['driver', 'Driver'], ['owner', 'Owner'], ['admin', 'Admin']]} onChange={(v) => set('reportedBy', v)} /></Field>
            </Grid>
            <Field label="Location">
              <div className="flex gap-2">
                <input className="input" value={f.location} onChange={(e) => set('location', e.target.value)} placeholder="e.g. Kandy–Colombo road near Kadugannawa" />
                <button type="button" onClick={locate} className="btn-secondary !px-3 inline-flex items-center gap-1 whitespace-nowrap text-sm">{locating ? <Loader2 size={14} className="animate-spin" /> : <MapPin size={14} />} GPS</button>
              </div>
              {f.lat !== undefined && <span className="text-[11px] text-navy-500">{f.lat}, {f.lng} · <a className="underline" target="_blank" rel="noreferrer" href={`https://maps.google.com/?q=${f.lat},${f.lng}`}>open map</a></span>}
            </Field>
            <Grid cols={3}>
              <Field label="Customer contact"><input className="input" type="tel" value={f.contactPhone} onChange={(e) => set('contactPhone', e.target.value)} placeholder={b?.customerPhone} /></Field>
              <Field label="Mileage (km)"><input className="input" type="number" min="0" value={f.mileage} onChange={(e) => set('mileage', e.target.value)} /></Field>
              <Field label="Fuel"><select className="input" value={f.fuel} onChange={(e) => set('fuel', e.target.value)}><option value="">—</option>{FUEL_LEVELS.map((x) => <option key={x}>{x}</option>)}</select></Field>
            </Grid>
            <Field label="Breakdown type *"><Chips size="xs" value={f.category} options={Object.entries(CATEGORY_LABEL) as [BdCategory, string][]} onChange={(v) => set('category', v)} /></Field>
            <Field label="What happened *"><textarea className="input" rows={3} value={f.description} onChange={(e) => set('description', e.target.value)} placeholder="What the customer saw / heard, warning lights, what was tried…" /></Field>
            <p className="text-[11px] text-navy-400">The cause stays “pending” until someone qualified assesses it (Diagnosis section).</p>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <Field label="Can the vehicle be driven?"><Chips size="xs" value={f.driveable} options={[['yes', 'Yes'], ['limited', 'Only slowly / short distance'], ['no', 'No'], ['unknown', "Don't know"]]} onChange={(v) => set('driveable', v)} /></Field>
            <Field label="Are the passengers safe?"><Chips size="xs" value={f.passengersSafe} options={[['safe', 'Safe'], ['at_risk', 'At risk / need help'], ['unknown', "Don't know"]]} onChange={(v) => set('passengersSafe', v)} /></Field>
            <Field label="Urgency"><Chips size="xs" value={f.urgency} options={[['low', 'Low'], ['normal', 'Normal'], ['high', 'High'], ['emergency', 'Emergency']]} onChange={(v) => set('urgency', v)} /></Field>
            {unsafe && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800 flex gap-2">
                <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
                <span><b>Tell the customer not to drive on</b> until an authorised mechanic confirms the vehicle is safe.{f.passengersSafe === 'at_risk' ? ' If anyone is in danger, call emergency services (119 / 1990 ambulance) first.' : ''}</span>
              </div>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="space-y-3">
            <Field label="Photos, videos, documents" hint="Damage, dashboard warning lights, location, the customer's message…">
              <label className="flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-navy-200 px-3 py-4 text-sm text-navy-500 cursor-pointer hover:border-navy-500">
                <Camera size={16} /> Add files
                <input type="file" multiple accept="image/*,video/*,application/pdf" className="hidden" onChange={(e) => { setFiles((x) => [...x, ...Array.from(e.target.files ?? [])]); e.target.value = ''; }} />
              </label>
              {files.length > 0 && <ul className="mt-2 text-xs text-navy-600 space-y-0.5">{files.map((x, i) => <li key={i} className="flex justify-between"><span className="truncate">{x.name}</span><button type="button" className="text-red-600" onClick={() => setFiles((y) => y.filter((_, j) => j !== i))}>remove</button></li>)}</ul>}
            </Field>
            <Field label="Admin notes"><textarea className="input" rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
          </div>
        )}

        <ErrorLine msg={err} />
        <div className="flex justify-between gap-2">
          <button type="button" className="btn-secondary inline-flex items-center gap-1" onClick={() => (step > (bookingId ? 1 : 0) ? setStep((x) => x - 1) : onClose())}>
            {step > (bookingId ? 1 : 0) ? <><ArrowLeft size={14} /> Back</> : 'Cancel'}
          </button>
          {step < STEPS.length - 1
            ? <button type="button" className="btn-primary inline-flex items-center gap-1" onClick={next}>Next <ArrowRight size={14} /></button>
            : <button type="button" className="btn-primary inline-flex items-center gap-1" disabled={busy} onClick={submit}>{busy && <Loader2 size={14} className="animate-spin" />} Report breakdown</button>}
        </div>
      </div>
    </Modal>
  );
}
