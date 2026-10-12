import { AlertTriangle, CheckCircle2, Contact } from 'lucide-react';
import { missingInfo } from '../../lib/bookingRecord';
import type { Booking, CustomerInfo } from '../../types';

/** Licence / passport details captured while creating a booking (saved as the booking's customerInfo) */
export function CustomerIdFields({ value, onChange, selfDrive }: { value: CustomerInfo; onChange: (v: CustomerInfo) => void; selfDrive: boolean }) {
  const set = <K extends keyof CustomerInfo>(k: K, v: CustomerInfo[K]) => onChange({ ...value, [k]: v === '' ? undefined : v });
  return (
    <div className="rounded-xl border border-navy-100 bg-navy-50/40 p-3">
      <p className="text-xs font-semibold text-navy-600 flex items-center gap-1.5 mb-2">
        <Contact size={14} /> Licence & ID {selfDrive ? <span className="font-normal text-navy-400">— needed for self drive</span> : <span className="font-normal text-navy-400">— with driver, licence optional</span>}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <label className="text-[11px] font-medium text-navy-400">Licence number<input className="input !py-1.5 text-sm mt-0.5" placeholder="e.g. B1234567" value={value.licenceNumber ?? ''} onChange={(e) => set('licenceNumber', e.target.value)} /></label>
        <label className="text-[11px] font-medium text-navy-400">Licence expiry<input type="date" className="input !py-1.5 text-sm mt-0.5" value={value.licenceExpiry ?? ''} onChange={(e) => set('licenceExpiry', e.target.value)} /></label>
        <label className="text-[11px] font-medium text-navy-400">Licence type
          <select className="input !py-1.5 text-sm mt-0.5" value={value.licenceType ?? ''} onChange={(e) => set('licenceType', (e.target.value || undefined) as CustomerInfo['licenceType'])}>
            <option value="">Choose…</option><option>Sri Lankan</option><option>Foreign</option>
          </select>
        </label>
        <label className="text-[11px] font-medium text-navy-400">Passport no. <span className="font-normal">(foreign customers)</span><input className="input !py-1.5 text-sm mt-0.5" value={value.passportNumber ?? ''} onChange={(e) => set('passportNumber', e.target.value)} /></label>
        <label className="text-[11px] font-medium text-navy-400">Nationality<input className="input !py-1.5 text-sm mt-0.5" value={value.nationality ?? ''} onChange={(e) => set('nationality', e.target.value)} /></label>
        {value.licenceType === 'Foreign' ? (
          <label className="flex items-center gap-2 text-sm text-navy-700 px-1 sm:mt-4">
            <input type="checkbox" className="accent-navy-700" checked={!!value.idp} onChange={(e) => onChange({ ...value, idp: e.target.checked || undefined })} /> Has International Driving Permit
          </label>
        ) : <span className="hidden sm:block" />}
      </div>
    </div>
  );
}

/**
 * Live list of what is still empty on a booking being created — the same check the booking
 * cards use. Copies, agreement and checklists can only be done after saving, so they are listed separately.
 */
export function MissingDetailsPanel({ draft }: { draft: Partial<Booking> }) {
  const all = missingInfo({ id: 'new', createdAt: '', customerId: '', customerName: '', customerPhone: '', vehicleId: '', startDate: '', endDate: '',
    totalDays: 0, totalAmount: 0, paidAmount: 0, status: 'Confirmed', ...draft } as Booking);
  const now = all.filter((i) => !i.after);
  const later = all.filter((i) => i.after);
  const critical = now.some((i) => i.critical);
  return (
    <div className={`rounded-xl border px-3 py-2.5 text-xs ${now.length ? (critical ? 'border-red-200 bg-red-50/70' : 'border-amber-200 bg-amber-50/70') : 'border-emerald-200 bg-emerald-50/70'}`}>
      {now.length ? (
        <>
          <p className={`font-bold flex items-center gap-1.5 ${critical ? 'text-red-700' : 'text-amber-800'}`}>
            <AlertTriangle size={13} /> Still missing ({now.length}) — you can save now and fill these in later
          </p>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {now.map((i) => (
              <span key={i.label} className={`rounded-full bg-white px-2 py-0.5 font-semibold ring-1 ring-inset ${i.critical ? 'text-red-700 ring-red-200' : 'text-amber-800 ring-amber-200'}`}>{i.label}</span>
            ))}
          </div>
        </>
      ) : (
        <p className="font-bold text-emerald-700 flex items-center gap-1.5"><CheckCircle2 size={13} /> All booking details filled in</p>
      )}
      {later.length > 0 && (
        <p className="text-navy-500 mt-1.5">After saving: {later.map((i) => i.label.toLowerCase()).join(', ')} — in Booking details.</p>
      )}
    </div>
  );
}
