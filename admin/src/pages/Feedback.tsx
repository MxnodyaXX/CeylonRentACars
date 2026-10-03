import { useEffect, useMemo, useState } from 'react';
import { Star, Check, EyeOff, Trash2, Copy, MessageCircle, Link2, Inbox, Globe, Send, AlertTriangle } from 'lucide-react';
import Header from '../components/layout/Header';
import { useStore } from '../store/useStore';
import { supabase, supabaseEnabled } from '../lib/supabase';
import { toast } from '../store/useToast';

const WEBSITE_URL = ((import.meta.env.VITE_WEBSITE_URL as string | undefined) ?? 'http://localhost:5173').replace(/\/$/, '');

type Kind = 'service' | 'vehicle';
interface Item {
  id: string;
  kind: Kind;
  name: string;
  country?: string;
  vehicleId?: string;
  rating: number;
  comment?: string;
  published: boolean;
  createdAt: string;
}

function Stars({ value }: { value: number }) {
  return (
    <span className="inline-flex gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} size={14} className={n <= value ? 'fill-amber-400 text-amber-400' : 'text-navy-200'} />
      ))}
    </span>
  );
}

/* Feedback link for one rental: prefills the vehicle and the customer's first name */
const linkFor = (vehicleId: string, customerName: string) =>
  `${WEBSITE_URL}/feedback?v=${encodeURIComponent(vehicleId)}&n=${encodeURIComponent(customerName.trim().split(' ')[0])}`;

/* WhatsApp wants international digits only (Sri Lankan 07x… → 947x…) */
const waNumber = (phone: string) => {
  const d = phone.replace(/\D/g, '');
  return d.startsWith('0') ? `94${d.slice(1)}` : d;
};

export default function Feedback() {
  const vehicles = useStore((s) => s.vehicles);
  const bookings = useStore((s) => s.bookings);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [tab, setTab] = useState<'pending' | 'published' | 'request'>('pending');

  const vehicleName = (id?: string) => {
    const v = vehicles.find((x) => x.id === id);
    return v ? `${v.brand} ${v.model}` : undefined;
  };

  const load = async () => {
    if (!supabaseEnabled) { setLoading(false); return; }
    setLoading(true);
    const [s, v] = await Promise.all([
      supabase.from('service_reviews').select('*').order('created_at', { ascending: false }),
      supabase.from('vehicle_reviews').select('*').eq('source', 'customer').order('created_at', { ascending: false }),
    ]);
    if (s.error || v.error) {
      const msg = (s.error ?? v.error)!.message;
      if (/service_reviews|vehicle_reviews|source/.test(msg)) setMissing(true);
      else toast.error('Could not load feedback', msg);
      setLoading(false);
      return;
    }
    const map = (kind: Kind) => (r: Record<string, unknown>): Item => ({
      id: r.id as string, kind,
      name: r.customer_name as string, country: (r.country as string) ?? undefined,
      vehicleId: (r.vehicle_id as string) ?? undefined, rating: Number(r.rating),
      comment: (r.comment as string) ?? undefined, published: r.published === true, createdAt: r.created_at as string,
    });
    setItems([...(s.data ?? []).map(map('service')), ...(v.data ?? []).map(map('vehicle'))]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    setLoading(false);
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const table = (k: Kind) => (k === 'service' ? 'service_reviews' : 'vehicle_reviews');

  const setPublished = async (it: Item, published: boolean) => {
    const { error } = await supabase.from(table(it.kind)).update({ published }).eq('id', it.id);
    if (error) { toast.error('Could not update', error.message); return; }
    setItems((l) => l.map((x) => (x.id === it.id && x.kind === it.kind ? { ...x, published } : x)));
    toast.success(published ? 'Published' : 'Hidden', published ? 'It now shows on the website.' : 'Removed from the website.');
  };

  const remove = async (it: Item) => {
    if (!confirm(`Delete ${it.name}'s ${it.kind} review?`)) return;
    const { error } = await supabase.from(table(it.kind)).delete().eq('id', it.id);
    if (error) { toast.error('Could not delete', error.message); return; }
    setItems((l) => l.filter((x) => !(x.id === it.id && x.kind === it.kind)));
  };

  const pending = items.filter((i) => !i.published);
  const published = items.filter((i) => i.published);
  const svc = published.filter((i) => i.kind === 'service');
  const avg = svc.length ? svc.reduce((a, i) => a + i.rating, 0) / svc.length : 0;

  // Completed rentals, newest first — the people to ask for feedback
  const completed = useMemo(
    () => bookings.filter((b) => b.status === 'Completed').sort((a, b) => b.endDate.localeCompare(a.endDate)),
    [bookings],
  );

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast.success('Link copied', 'Paste it in an SMS, email or chat.'); }
    catch { prompt('Copy this link:', text); }
  };

  const list = tab === 'pending' ? pending : published;

  return (
    <div>
      <Header title="Customer Feedback" subtitle="Approve reviews for the website and ask past customers for feedback" />

      {!supabaseEnabled && (
        <div className="card !p-4 mb-4 border border-amber-200 bg-amber-50 text-sm text-amber-800">Feedback needs Supabase to be connected.</div>
      )}
      {missing && (
        <div className="card !p-4 mb-4 border border-amber-200 bg-amber-50 text-sm text-amber-800 flex gap-2">
          <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
          Run <code className="mx-1">admin/supabase/website.sql</code> in the Supabase SQL Editor to enable customer feedback.
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <div className="stat-card"><span className="text-xs text-navy-400">Waiting for approval</span><b className="text-2xl text-navy-800">{pending.length}</b></div>
        <div className="stat-card"><span className="text-xs text-navy-400">Published reviews</span><b className="text-2xl text-navy-800">{published.length}</b></div>
        <div className="stat-card"><span className="text-xs text-navy-400">Service rating (published)</span>
          <b className="text-2xl text-navy-800 flex items-center gap-2">{svc.length ? avg.toFixed(1) : '—'} {svc.length > 0 && <Stars value={Math.round(avg)} />}</b></div>
        <div className="stat-card"><span className="text-xs text-navy-400">Public feedback page</span>
          <button onClick={() => copy(`${WEBSITE_URL}/feedback`)} className="text-sm font-semibold text-brand-500 hover:underline flex items-center gap-1 text-left">
            <Link2 size={14} /> Copy general link</button></div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-4 overflow-x-auto no-scrollbar">
        {([
          ['pending', `Waiting for approval (${pending.length})`, Inbox],
          ['published', `Published (${published.length})`, Globe],
          ['request', 'Request feedback', Send],
        ] as const).map(([id, label, Icon]) => (
          <button key={id} onClick={() => setTab(id)}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold whitespace-nowrap transition-colors ${
                    tab === id ? 'bg-navy-700 text-white' : 'bg-white text-navy-500 border border-navy-100 hover:bg-navy-50'}`}>
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      {tab !== 'request' && (
        loading ? <div className="card text-sm text-navy-400">Loading feedback…</div> :
        list.length === 0 ? (
          <div className="card text-center py-10 text-sm text-navy-400">
            {tab === 'pending' ? 'No new feedback waiting. Use “Request feedback” to ask past customers.' : 'Nothing published yet.'}
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-3">
            {list.map((it) => (
              <div key={`${it.kind}-${it.id}`} className="card !p-4 flex flex-col gap-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-navy-800 truncate">{it.name}{it.country && <span className="font-normal text-navy-400"> · {it.country}</span>}</p>
                    <p className="text-xs text-navy-400">{new Date(it.createdAt).toLocaleString()}</p>
                  </div>
                  <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full flex-shrink-0 ${
                    it.kind === 'service' ? 'bg-navy-700 text-white' : 'bg-brand-50 text-brand-600'}`}>
                    {it.kind === 'service' ? 'Service' : vehicleName(it.vehicleId) ?? 'Vehicle'}
                  </span>
                </div>
                <Stars value={it.rating} />
                {it.comment ? <p className="text-sm text-navy-600 leading-relaxed">“{it.comment}”</p> : <p className="text-xs text-navy-300">No comment</p>}
                {it.kind === 'service' && it.vehicleId && <p className="text-xs text-navy-400">Rented: {vehicleName(it.vehicleId) ?? '—'}</p>}
                <div className="flex gap-2 mt-auto pt-2">
                  {it.published ? (
                    <button onClick={() => setPublished(it, false)} className="btn-secondary !py-1.5 text-xs flex items-center gap-1"><EyeOff size={13} /> Hide</button>
                  ) : (
                    <button onClick={() => setPublished(it, true)} className="btn-primary !py-1.5 text-xs flex items-center gap-1"><Check size={13} /> Approve & publish</button>
                  )}
                  <button onClick={() => remove(it)} className="btn-danger !py-1.5 text-xs flex items-center gap-1 ml-auto"><Trash2 size={13} /> Delete</button>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {tab === 'request' && (
        <div className="card !p-0 overflow-hidden">
          <p className="text-sm text-navy-500 px-5 py-4 border-b border-navy-100">
            Send each customer their own link — it opens the feedback page with their name and vehicle already filled in.
          </p>
          {completed.length === 0 ? (
            <p className="text-sm text-navy-400 px-5 py-8 text-center">No completed rentals yet.</p>
          ) : (
            <ul className="divide-y divide-navy-100">
              {completed.slice(0, 50).map((b) => {
                const url = linkFor(b.vehicleId, b.customerName);
                const msg = `Hi ${b.customerName.split(' ')[0]}, thank you for renting with Ceylon Rent A Cars! We'd love your feedback on our service and the ${vehicleName(b.vehicleId) ?? 'vehicle'}: ${url}`;
                return (
                  <li key={b.id} className="flex items-center gap-3 px-5 py-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-navy-800 truncate">{b.customerName}</p>
                      <p className="text-xs text-navy-400 truncate">{vehicleName(b.vehicleId) ?? 'Vehicle'} · {b.startDate} → {b.endDate}</p>
                    </div>
                    <button onClick={() => copy(url)} className="btn-secondary !px-3 !py-1.5 text-xs flex items-center gap-1"><Copy size={13} /> Copy link</button>
                    {b.customerPhone && (
                      <a href={`https://wa.me/${waNumber(b.customerPhone)}?text=${encodeURIComponent(msg)}`} target="_blank" rel="noreferrer"
                         className="btn-primary !px-3 !py-1.5 text-xs flex items-center gap-1"><MessageCircle size={13} /> WhatsApp</a>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
