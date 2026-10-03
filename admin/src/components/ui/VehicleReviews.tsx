import { useEffect, useMemo, useState } from 'react';
import { Star, Eye, EyeOff, Trash2, MessageSquareQuote, Plus } from 'lucide-react';
import { supabase, supabaseEnabled } from '../../lib/supabase';
import { useStore } from '../../store/useStore';
import { toast } from '../../store/useToast';
import { VehicleReview } from '../../types';

/* Map a vehicle_reviews row (snake_case) to the app type */
const fromDb = (r: Record<string, unknown>): VehicleReview => ({
  id: r.id as string,
  vehicleId: r.vehicle_id as string,
  bookingId: (r.booking_id as string) ?? undefined,
  customerName: r.customer_name as string,
  rating: Number(r.rating),
  comment: (r.comment as string) ?? undefined,
  published: r.published !== false,
  createdAt: r.created_at as string,
});

function Stars({ value, onChange, size = 16 }: { value: number; onChange?: (n: number) => void; size?: number }) {
  return (
    <span className="inline-flex gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" disabled={!onChange} onClick={() => onChange?.(n)}
                aria-label={`${n} star${n > 1 ? 's' : ''}`}
                className={onChange ? 'cursor-pointer hover:scale-110 transition-transform' : 'cursor-default'}>
          <Star size={size} className={n <= value ? 'fill-amber-400 text-amber-400' : 'text-navy-200'} />
        </button>
      ))}
    </span>
  );
}

/**
 * Customer reviews for one vehicle. Reviews are entered here (e.g. feedback collected after a
 * completed rental) and appear on the website's vehicle details while "published".
 * The website only ever sees the reviewer as "First L." via the public_reviews view.
 */
export default function VehicleReviews({ vehicleId, canEdit }: { vehicleId: string; canEdit: boolean }) {
  const bookings = useStore((s) => s.bookings);
  const [reviews, setReviews] = useState<VehicleReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [missingTable, setMissingTable] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ bookingId: '', customerName: '', rating: 5, comment: '' });

  // Customers who completed a rental of this vehicle — the natural people to review it
  const pastCustomers = useMemo(
    () => bookings.filter((b) => b.vehicleId === vehicleId && b.status === 'Completed')
      .sort((a, b) => b.endDate.localeCompare(a.endDate)),
    [bookings, vehicleId],
  );

  const load = async () => {
    if (!supabaseEnabled) { setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase.from('vehicle_reviews').select('*')
      .eq('vehicle_id', vehicleId).order('created_at', { ascending: false });
    if (error) {
      if (/vehicle_reviews/.test(error.message)) setMissingTable(true);
      else toast.error('Could not load reviews', error.message);
    } else {
      setReviews((data ?? []).map(fromDb));
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, [vehicleId]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    const name = form.customerName.trim();
    if (!name) { toast.error('Customer name needed', 'Pick a past customer or type a name.'); return; }
    const { error } = await supabase.from('vehicle_reviews').insert({
      vehicle_id: vehicleId,
      booking_id: form.bookingId || null,
      customer_name: name,
      rating: form.rating,
      comment: form.comment.trim() || null,
    });
    if (error) { toast.error('Could not save review', error.message); return; }
    toast.success('Review added', 'It now shows on the website.');
    setForm({ bookingId: '', customerName: '', rating: 5, comment: '' });
    setAdding(false);
    load();
  };

  const togglePublished = async (r: VehicleReview) => {
    const { error } = await supabase.from('vehicle_reviews').update({ published: !r.published }).eq('id', r.id);
    if (error) { toast.error('Could not update review', error.message); return; }
    setReviews((list) => list.map((x) => (x.id === r.id ? { ...x, published: !r.published } : x)));
  };

  const remove = async (r: VehicleReview) => {
    if (!confirm(`Delete ${r.customerName}'s review?`)) return;
    const { error } = await supabase.from('vehicle_reviews').delete().eq('id', r.id);
    if (error) { toast.error('Could not delete review', error.message); return; }
    setReviews((list) => list.filter((x) => x.id !== r.id));
  };

  const published = reviews.filter((r) => r.published);
  const avg = published.length ? published.reduce((s, r) => s + r.rating, 0) / published.length : 0;

  return (
    <div className="border-t border-navy-100 pt-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <MessageSquareQuote size={15} className="text-navy-400" />
          <p className="text-xs font-semibold text-navy-500 uppercase tracking-wide">Customer reviews</p>
          {published.length > 0 && (
            <span className="text-xs text-navy-500 flex items-center gap-1">
              <Star size={12} className="fill-amber-400 text-amber-400" />
              <b className="text-navy-800">{avg.toFixed(1)}</b> ({published.length})
            </span>
          )}
        </div>
        {canEdit && supabaseEnabled && !missingTable && !adding && (
          <button type="button" onClick={() => setAdding(true)} className="btn-secondary !px-3 !py-1.5 text-xs flex items-center gap-1">
            <Plus size={13} /> Add review
          </button>
        )}
      </div>

      {!supabaseEnabled && <p className="text-xs text-navy-400">Reviews need Supabase to be connected.</p>}
      {missingTable && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
          Run <code>admin/supabase/website.sql</code> in the Supabase SQL Editor to enable reviews.
        </p>
      )}

      {adding && (
        <div className="rounded-xl border border-navy-100 bg-navy-50/50 p-3 mb-3 space-y-2.5">
          <div>
            <p className="label">Customer</p>
            <select className="input" value={form.bookingId}
                    onChange={(e) => {
                      const b = pastCustomers.find((x) => x.id === e.target.value);
                      setForm((f) => ({ ...f, bookingId: e.target.value, customerName: b ? b.customerName : f.customerName }));
                    }}>
              <option value="">Type a name below…</option>
              {pastCustomers.map((b) => (
                <option key={b.id} value={b.id}>{b.customerName} — {b.startDate} → {b.endDate}</option>
              ))}
            </select>
            <input className="input mt-2" placeholder="Customer name" value={form.customerName}
                   onChange={(e) => setForm((f) => ({ ...f, customerName: e.target.value, bookingId: '' }))} />
            <p className="text-[10.5px] text-navy-400 mt-1">The website shows only the first name and last initial.</p>
          </div>
          <div>
            <p className="label">Rating</p>
            <Stars value={form.rating} onChange={(n) => setForm((f) => ({ ...f, rating: n }))} size={22} />
          </div>
          <div>
            <p className="label">Review</p>
            <textarea className="input min-h-[72px]" placeholder="What did the customer say about this vehicle?"
                      value={form.comment} onChange={(e) => setForm((f) => ({ ...f, comment: e.target.value }))} />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary !py-1.5 text-xs" onClick={() => setAdding(false)}>Cancel</button>
            <button type="button" className="btn-primary !py-1.5 text-xs" onClick={save}>Save review</button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-xs text-navy-400">Loading reviews…</p>
      ) : reviews.length === 0 && !missingTable && supabaseEnabled ? (
        <p className="text-xs text-navy-400">No reviews yet.</p>
      ) : (
        <ul className="space-y-2 max-h-64 overflow-auto pr-1">
          {reviews.map((r) => (
            <li key={r.id} className={`rounded-xl border px-3 py-2.5 ${r.published ? 'border-navy-100 bg-white' : 'border-dashed border-navy-200 bg-navy-50/40 opacity-70'}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm font-semibold text-navy-800 truncate">{r.customerName}</span>
                  <Stars value={r.rating} size={12} />
                </div>
                {canEdit && (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button type="button" onClick={() => togglePublished(r)} title={r.published ? 'Hide from website' : 'Show on website'}
                            className="p-1.5 rounded-lg hover:bg-navy-50 text-navy-400 hover:text-navy-700">
                      {r.published ? <Eye size={14} /> : <EyeOff size={14} />}
                    </button>
                    <button type="button" onClick={() => remove(r)} title="Delete"
                            className="p-1.5 rounded-lg hover:bg-red-50 text-navy-400 hover:text-red-600">
                      <Trash2 size={14} />
                    </button>
                  </div>
                )}
              </div>
              {r.comment && <p className="text-xs text-navy-500 mt-1 leading-relaxed">{r.comment}</p>}
              <p className="text-[10px] text-navy-300 mt-1">
                {new Date(r.createdAt).toLocaleDateString()}{!r.published && ' · Hidden from website'}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
