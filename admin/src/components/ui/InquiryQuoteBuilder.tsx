import { useEffect, useMemo, useState } from 'react';
import { Plus, X, MessageCircle, Mail, Save, CheckCircle2, Clock } from 'lucide-react';
import type { Inquiry, InquiryQuote } from '../../types';
import { quoteMessage, rs, prettyDate } from '../../lib/inquiryReview';
import { intlDigits, parseRequest } from '../../lib/inquiryFollowups';

const num = (v: string) => Math.max(0, Number(v.replace(/[^\d.]/g, '')) || 0);

/**
 * Build a proper quote (rate × days, extras, discount, deposit), send it by WhatsApp/email
 * and keep it on the inquiry with its status (draft → sent → accepted).
 */
export default function InquiryQuoteBuilder({
  inquiry, defaultRate, defaultDays, staff, onSave, onSent,
}: {
  inquiry: Inquiry;
  defaultRate: number;
  defaultDays: number;
  staff: string;
  onSave: (q: InquiryQuote) => void;
  onSent: (q: InquiryQuote, via: 'WhatsApp' | 'Email') => void;   // also logs a "Quote sent" contact
}) {
  const type = parseRequest(inquiry.notes).fields.Type;
  const initial = (): InquiryQuote => inquiry.quote ?? {
    dailyRate: defaultRate,
    days: defaultDays,
    discount: 0,
    extras: [
      ...(type === 'With driver' ? [{ label: 'Driver', amount: 0 }] : []),
      ...(type === 'Airport pickup' ? [{ label: 'Airport pickup', amount: 0 }] : []),
    ],
    deposit: 0,
    total: 0,
    status: 'draft',
  };
  const [q, setQ] = useState<InquiryQuote>(initial);
  useEffect(() => { setQ(initial()); }, [inquiry.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const rental = q.dailyRate * q.days;
  const extrasTotal = q.extras.reduce((s, e) => s + (e.amount || 0), 0);
  const total = Math.max(0, rental + extrasTotal - q.discount);
  const current = useMemo(() => ({ ...q, total }), [q, total]);
  const dirty = JSON.stringify(current) !== JSON.stringify(inquiry.quote ?? null);

  const set = (patch: Partial<InquiryQuote>) => setQ((x) => ({ ...x, ...patch, status: x.status === 'accepted' ? 'accepted' : x.status }));
  const setExtra = (i: number, patch: Partial<{ label: string; amount: number }>) =>
    setQ((x) => ({ ...x, extras: x.extras.map((e, j) => (j === i ? { ...e, ...patch } : e)) }));

  const email = parseRequest(inquiry.notes).fields.Email;
  const send = (via: 'WhatsApp' | 'Email') => {
    const sent: InquiryQuote = { ...current, status: current.status === 'accepted' ? 'accepted' : 'sent', sentAt: new Date().toISOString(), sentVia: via };
    const text = quoteMessage(inquiry, sent, staff);
    if (via === 'WhatsApp') window.open(`https://wa.me/${intlDigits(inquiry.customerPhone)}?text=${encodeURIComponent(text)}`, '_blank');
    else window.location.href = `mailto:${email}?subject=${encodeURIComponent(`Your quote — Ceylon Rent A Cars`)}&body=${encodeURIComponent(text.replace(/\*/g, ''))}`;
    setQ(sent);
    onSent(sent, via);
  };

  const field = 'input !py-2 text-right tabular-nums';
  const STATUS = {
    draft: { cls: 'bg-navy-50 text-navy-500', label: 'Draft' },
    sent: { cls: 'bg-blue-50 text-blue-700', label: 'Quote sent' },
    accepted: { cls: 'bg-emerald-50 text-emerald-700', label: 'Accepted' },
  }[q.status];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className={`text-[11px] font-bold uppercase tracking-wide px-2 py-1 rounded-full ${STATUS.cls}`}>{STATUS.label}</span>
        {q.sentAt && <span className="text-[11px] text-navy-400 flex items-center gap-1"><Clock size={11} /> Sent {prettyDate(q.sentAt)} via {q.sentVia}</span>}
      </div>

      <div className="grid grid-cols-[1fr_auto_auto] gap-2 items-center text-sm">
        <span className="text-navy-600">Daily rate</span>
        <input className={`${field} w-28`} inputMode="numeric" value={q.dailyRate || ''} onChange={(e) => set({ dailyRate: num(e.target.value) })} />
        <span className="text-navy-400 text-xs w-20">× <input className="w-10 bg-transparent border-b border-navy-200 text-center text-navy-800 font-semibold outline-none" inputMode="numeric" value={q.days} onChange={(e) => set({ days: Math.max(1, num(e.target.value)) })} /> days</span>

        <span className="text-navy-600 font-semibold">Rental</span>
        <span />
        <span className="text-right font-semibold tabular-nums text-navy-800">{rs(rental)}</span>

        {q.extras.map((e, i) => (
          <div key={i} className="contents">
            <input className="input !py-2" value={e.label} placeholder="Extra (driver, child seat…)" onChange={(ev) => setExtra(i, { label: ev.target.value })} />
            <input className={`${field} w-28`} inputMode="numeric" value={e.amount || ''} placeholder="0" onChange={(ev) => setExtra(i, { amount: num(ev.target.value) })} />
            <button type="button" className="text-navy-300 hover:text-red-600 justify-self-start" onClick={() => setQ((x) => ({ ...x, extras: x.extras.filter((_, j) => j !== i) }))} aria-label="Remove line"><X size={15} /></button>
          </div>
        ))}
        <button type="button" className="col-span-3 justify-self-start text-xs font-semibold text-brand-500 flex items-center gap-1 hover:underline"
                onClick={() => setQ((x) => ({ ...x, extras: [...x.extras, { label: '', amount: 0 }] }))}>
          <Plus size={13} /> Add extra charge
        </button>

        <span className="text-navy-600">Discount</span>
        <input className={`${field} w-28`} inputMode="numeric" value={q.discount || ''} placeholder="0" onChange={(e) => set({ discount: num(e.target.value) })} />
        <span />

        <span className="text-navy-800 font-bold border-t border-navy-100 pt-2">Total</span>
        <span className="border-t border-navy-100 pt-2" />
        <span className="text-right font-extrabold text-lg tabular-nums text-navy-800 border-t border-navy-100 pt-2">{rs(total)}</span>

        <span className="text-navy-600">Refundable deposit</span>
        <input className={`${field} w-28`} inputMode="numeric" value={q.deposit || ''} placeholder="0" onChange={(e) => set({ deposit: num(e.target.value) })} />
        <span />
      </div>

      <div className="flex flex-wrap gap-2 pt-1">
        <button type="button" onClick={() => send('WhatsApp')} className="flex-1 min-w-[140px] flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700">
          <MessageCircle size={15} /> Send on WhatsApp
        </button>
        <button type="button" onClick={() => send('Email')} disabled={!email} title={email ? '' : 'No email on this inquiry'}
                className="flex-1 min-w-[120px] flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold bg-white border border-navy-100 text-navy-700 hover:bg-navy-50 disabled:opacity-40">
          <Mail size={15} /> Email
        </button>
        <button type="button" onClick={() => { onSave(current); setQ(current); }} disabled={!dirty}
                className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold bg-navy-50 text-navy-700 hover:bg-navy-100 disabled:opacity-40">
          <Save size={15} /> Save
        </button>
      </div>
      {q.status === 'sent' && (
        <button type="button" onClick={() => { const a: InquiryQuote = { ...current, status: 'accepted' }; setQ(a); onSave(a); }}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100">
          <CheckCircle2 size={15} /> Customer accepted this quote
        </button>
      )}
    </div>
  );
}
