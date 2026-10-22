import { useState } from 'react';
import { AlertTriangle, Pencil } from 'lucide-react';
import { useBreakdownStore } from '../../store/useBreakdownStore';
import { useAuthStore } from '../../store/useAuthStore';
import { toast } from '../../store/useToast';
import type { BdSwap } from '../../lib/breakdowns';
import type { KmLeg, SwapField, TripKm } from '../../lib/tripKm';
import { ErrorLine } from './bdui';

/*
 * Vehicle usage phases of a booking: every car the customer had, in order, with its OWN odometer
 * readings — the final bill adds the km of all phases. Shown on the breakdown (Vehicles tab), the
 * booking (Vehicle tab) and the return form. Admins can correct a swap's readings (logged, with the old value).
 */

const d = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '…');
const n = (v?: number) => (v == null ? '?' : v.toLocaleString('en-LK'));
const ROLE: Record<KmLeg['role'], string> = { booked: 'Booked car', replacement: 'Replacement', earlier: 'Earlier car' };

export default function UsagePhases({ trip, includedKm, kmRate, editable = true }: { trip: TripKm; includedKm?: number; kmRate?: number; editable?: boolean }) {
  const swaps = useBreakdownStore((s) => s.swaps);
  const isAdmin = useAuthStore((s) => s.isAdmin());
  const [editing, setEditing] = useState<string | null>(null);
  const extra = trip.total != null && includedKm != null ? Math.max(0, trip.total - includedKm) : undefined;
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="w-full text-xs min-w-[520px]">
          <thead>
            <tr className="text-navy-400 text-left">
              <th className="font-medium py-1 pr-2">Phase</th><th className="font-medium pr-2">Car</th><th className="font-medium pr-2">Period</th>
              <th className="font-medium text-right pr-2">Odometer (start → end)</th><th className="font-medium text-right">Km</th>
            </tr>
          </thead>
          <tbody>
            {trip.legs.map((l) => {
              // the swap whose readings this phase uses (a booked-car phase starts or ends at one)
              const sid = l.swapId ?? l.endRef?.swapId ?? l.startRef?.swapId;
              const w = sid ? swaps.find((x) => x.id === sid) : undefined;
              const canEdit = editable && isAdmin && !!w;
              return (
                <PhaseRow key={l.phase} l={l} canEdit={canEdit} open={editing === `${l.phase}` && !!w} onEdit={() => setEditing(editing === `${l.phase}` ? null : `${l.phase}`)}>
                  {w && <ReadingsEditor w={w} withOriginal={w.originalOdometer != null || trip.legs.some((x) => x.endRef?.swapId === w.id && x.endRef.field === 'originalOdometer')} onDone={() => setEditing(null)} />}
                </PhaseRow>
              );
            })}
            <tr className="border-t-2 border-navy-200">
              <td colSpan={4} className="py-1.5 text-navy-600">
                Total, all phases{trip.garageKm > 0 ? ` · ${trip.garageKm.toLocaleString('en-LK')} km at the garage not counted` : ''}
                {includedKm != null && <> · {includedKm.toLocaleString('en-LK')} km included</>}
              </td>
              <td className="text-right font-bold text-navy-900 whitespace-nowrap">{trip.total != null ? trip.total.toLocaleString('en-LK') : `${trip.known.toLocaleString('en-LK')}+`}</td>
            </tr>
            {extra != null && extra > 0 && kmRate != null && (
              <tr><td colSpan={4} className="pb-1 text-amber-800">Extra km: {extra.toLocaleString('en-LK')} km × Rs {kmRate.toLocaleString('en-LK')}</td>
                <td className="text-right font-semibold text-amber-800 whitespace-nowrap">Rs {(extra * kmRate).toLocaleString('en-LK')}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-navy-400">Each car has its own odometer — a phase runs from that car's reading when the customer got it to its reading when it was taken back.</p>
    </div>
  );
}

function PhaseRow({ l, canEdit, open, onEdit, children }: { l: KmLeg; canEdit: boolean; open: boolean; onEdit: () => void; children: React.ReactNode }) {
  return (
    <>
      <tr className="border-t border-navy-100/70 align-top">
        <td className="py-1.5 pr-2 font-semibold text-navy-500 whitespace-nowrap">{l.phase}</td>
        <td className="pr-2 py-1.5"><b className="text-navy-800 whitespace-nowrap">{l.car}</b><span className="block text-[10px] text-navy-400">{ROLE[l.role]}</span></td>
        <td className="pr-2 py-1.5 text-navy-600">{l.part.replace(/^Replacement · .*/, 'Replacement')}<span className="block text-[10px] text-navy-400">{d(l.start)} – {l.end ? d(l.end) : 'now'}{l.days ? ` · ${l.days} day${l.days === 1 ? '' : 's'}` : ''}</span></td>
        <td className="pr-2 py-1.5 text-right text-navy-600 whitespace-nowrap">
          {l.role === 'earlier' ? '—' : `${n(l.from)} → ${n(l.to)}`}
          {canEdit && <button type="button" onClick={onEdit} className="ml-1.5 inline-flex items-center gap-0.5 text-[10px] text-navy-500 underline hover:text-navy-800"><Pencil size={10} />{open ? 'Close' : 'Correct'}</button>}
        </td>
        <td className={`py-1.5 text-right font-semibold whitespace-nowrap ${l.wrong ? 'text-red-600' : l.km == null ? 'text-amber-700' : 'text-navy-800'}`}>
          {l.wrong ? 'check' : l.km == null ? (l.endRef?.field === 'return' && l.to == null ? 'at return' : 'missing') : l.km.toLocaleString('en-LK')}
        </td>
      </tr>
      {l.suspect && (
        <tr><td colSpan={5} className="pb-1.5"><p className="rounded-lg bg-amber-50 text-amber-900 px-2 py-1 text-[11px] flex gap-1.5"><AlertTriangle size={12} className="mt-0.5 flex-none" />{l.suspect}</p></td></tr>
      )}
      {open && <tr><td colSpan={5} className="pb-2">{children}</td></tr>}
    </>
  );
}

/** Correct a swap's readings (admin): every change is logged on the breakdown and the booking with the old value */
function ReadingsEditor({ w, withOriginal, onDone }: { w: BdSwap; withOriginal: boolean; onDone: () => void }) {
  const store = useBreakdownStore();
  const by = useAuthStore((s) => s.currentUser?.name) ?? 'Admin';
  const isAdmin = useAuthStore((s) => s.isAdmin());
  const fields: [SwapField, string][] = [
    ...(withOriginal ? [['originalOdometer', 'Booked car at the breakdown'] as [SwapField, string]] : []),
    ['replacementOdometerOut', 'Replacement handed over'],
    ...(w.status === 'closed' ? [['replacementOdometerIn', 'Replacement collected'] as [SwapField, string]] : []),
    ...(w.outcome === 'swapped_back' ? [['originalOdometerBack', 'Booked car back to the customer'] as [SwapField, string]] : []),
  ];
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(fields.map(([k]) => [k, w[k] != null ? String(w[k]) : ''])));
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const save = () => {
    const changed = Object.fromEntries(fields.filter(([k]) => vals[k].trim() !== '' && Number(vals[k]) !== w[k]).map(([k]) => [k, Number(vals[k])]));
    if (!Object.keys(changed).length) { setErr('Nothing changed.'); return; }
    const e = store.fillSwapReadings(w.id, changed, reason, by, isAdmin);
    setErr(e);
    if (!e) { toast.success('Readings corrected', 'The km of every phase are worked out again.'); onDone(); }
  };
  return (
    <div className="rounded-xl border border-navy-100 bg-navy-50/50 p-2.5 space-y-2">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {fields.map(([k, label]) => (
          <label key={k} className="text-[11px] text-navy-600">{label} (km)
            <input className="input !py-1 mt-0.5 text-sm" type="number" min="0" value={vals[k]} onChange={(e) => setVals((x) => ({ ...x, [k]: e.target.value }))} />
          </label>
        ))}
      </div>
      <input className="input !py-1 text-sm" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why the change? e.g. 3,000 was CBU-0649's reading — CBU-0745's dashboard photo shows 2,400" />
      <ErrorLine msg={err} />
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary !py-1 text-xs" onClick={onDone}>Cancel</button>
        <button type="button" className="btn-primary !py-1 text-xs" onClick={save}>Save readings</button>
      </div>
    </div>
  );
}
