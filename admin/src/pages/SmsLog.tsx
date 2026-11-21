import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCheck, Check, ChevronDown, Download, Loader2, MessageSquareText, RefreshCw, Search, Slash, XCircle, Clock } from 'lucide-react';
import Header from '../components/layout/Header';
import Select from '../components/ui/Select';
import { supabase, supabaseEnabled } from '../lib/supabase';
import { normalizeLkPhone } from '../lib/sms';
import { useStore } from '../store/useStore';
import { toast } from '../store/useToast';

/*
 * Every text the system sent, from the sms_log table: the send-sms function (the app, reminders),
 * the e-Agreement texts and the customer-portal codes all write a row; Text.lk's delivery report
 * then marks it delivered or failed. Read-only. The database lets the admin and team members
 * with the Inquiries ability read it (16_staff_roles.sql).
 */

export interface SmsRow {
  id: string; recipient: string; message: string; category: string | null; recipient_role: string | null;
  related_id: string | null; status: string; provider_uid: string | null; cost: number | null; error: string | null;
  created_at: string; updated_at: string;
}

const PAGE = 100;

/** Readable names for the category keys the senders use */
export const SMS_CATEGORY: Record<string, string> = {
  bookingConfirmation: 'Booking confirmed', bookingModified: 'Booking changed', bookingCancelled: 'Booking cancelled',
  paymentReceived: 'Payment received', paymentReminder: 'Payment reminder', pickupReminder: 'Pickup reminder',
  vehicleHandedOver: 'Vehicle handed over', returnReminder: 'Return reminder', overdueReturn: 'Overdue return',
  extraCharge: 'Extra charge', depositRefund: 'Deposit refund', pickupOtp: 'Pickup code', thankYouFeedback: 'Thank you / feedback',
  customerDetailsRequest: 'Details request', creditReminder: 'Credit reminder', creditOtp: 'Credit code',
  ownerVehicleBooked: 'Owner: car booked', ownerHandover: 'Owner: handover', ownerPayoutSettled: 'Owner: payout settled',
  ownerPayout: 'Owner: payout sent', ownerStatement: 'Owner: statement', ownerInsuranceExpiry: 'Owner: insurance expiry',
  ownerInsuranceMissing: 'Owner: insurance missing', insuranceMissing: 'Owner: insurance missing', ownerExpenseLogged: 'Owner: expense logged',
  referralPayout: 'Referral payout due', referralConverted: 'Referral earned', referralReceived: 'Referral paid', referralSummary: 'Referral summary',
  driverAssigned: 'Driver assigned', driverSchedule: 'Driver schedule', driverLicenseExpiry: 'Driver licence expiry',
  adminNewBooking: 'Team: new booking', adminNewInquiry: 'Team: new inquiry', adminOverdueReturn: 'Team: overdue return',
  adminPaymentOverdue: 'Team: payment overdue', adminInsuranceDue: 'Team: insurance due', adminDamageReported: 'Team: damage reported',
  adminDailySummary: 'Team: daily summary', adminReferralUnsettled: 'Team: referral unsettled',
  partnerApplication: 'Partner application', profileOtp: 'Profile code', portalOtp: 'Customer portal code',
  eagreementLink: 'e-Agreement link', eagreementReminder: 'e-Agreement reminder', eagreementAdvanceReminder: 'Advance reminder',
};
export const categoryLabel = (c: string | null) => (c ? SMS_CATEGORY[c] ?? c.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (x) => x.toUpperCase()) : 'Other');

/** One-time codes are never shown again: anyone reading the log could otherwise use a code still valid */
export const isCode = (c: string | null) => !!c && /otp$/i.test(c);
export const shownMessage = (r: Pick<SmsRow, 'message' | 'category'>) => (isCode(r.category) ? r.message.replace(/\d{4,8}/g, '••••') : r.message);

/** 94771234567 → 077 123 4567 */
export const localPhone = (p: string) => {
  const d = (p ?? '').replace(/\D/g, '');
  const l = d.startsWith('94') && d.length === 11 ? '0' + d.slice(2) : d;
  return l.length === 10 ? `${l.slice(0, 3)} ${l.slice(3, 6)} ${l.slice(6)}` : p;
};

const STATUS: Record<string, { label: string; cls: string; Icon: typeof Check }> = {
  delivered: { label: 'Delivered', cls: 'bg-emerald-100 text-emerald-800', Icon: CheckCheck },
  sent:      { label: 'Sent',      cls: 'bg-sky-100 text-sky-800',         Icon: Check },
  queued:    { label: 'Queued',    cls: 'bg-navy-100 text-navy-700',       Icon: Clock },
  failed:    { label: 'Failed',    cls: 'bg-red-100 text-red-700',         Icon: XCircle },
  skipped:   { label: 'Not sent',  cls: 'bg-amber-100 text-amber-800',     Icon: Slash },
};
const ROLE: Record<string, string> = { customer: 'Customer', owner: 'Owner', referrer: 'Referrer', driver: 'Driver', admin: 'Team' };

export const PERIODS = [
  { value: 'today', label: 'Today' }, { value: '7', label: 'Last 7 days' }, { value: '30', label: 'Last 30 days' },
  { value: 'month', label: 'This month' }, { value: 'lastMonth', label: 'Last month' }, { value: 'all', label: 'All time' },
  { value: 'custom', label: 'Pick dates' },
];

/** [from, to) as ISO strings for a period choice (local time) */
export function periodRange(p: string, from: string, to: string, now = new Date()): [string | null, string | null] {
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const today = day(now);
  const add = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  switch (p) {
    case 'today': return [today.toISOString(), null];
    case '7': return [add(today, -6).toISOString(), null];
    case '30': return [add(today, -29).toISOString(), null];
    case 'month': return [new Date(now.getFullYear(), now.getMonth(), 1).toISOString(), null];
    case 'lastMonth': return [new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString(), new Date(now.getFullYear(), now.getMonth(), 1).toISOString()];
    case 'custom': return [from ? new Date(`${from}T00:00:00`).toISOString() : null, to ? add(new Date(`${to}T00:00:00`), 1).toISOString() : null];
    default: return [null, null];
  }
}

const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });

export default function SmsLog() {
  const customers = useStore((s) => s.customers);
  const owners = useStore((s) => s.owners);
  const drivers = useStore((s) => s.drivers);
  const bookings = useStore((s) => s.bookings);
  const inquiries = useStore((s) => s.inquiries);

  const [rows, setRows] = useState<SmsRow[]>([]);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [counts, setCounts] = useState<{ total: number; byStatus: Record<string, number>; units: number } | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');           // q, applied after typing stops
  const [status, setStatus] = useState('');
  const [role, setRole] = useState('');
  const [category, setCategory] = useState('');
  const [period, setPeriod] = useState('30');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  useEffect(() => { const t = setTimeout(() => setQuery(q.trim()), 350); return () => clearTimeout(t); }, [q]);

  /** phone (94…) → the person's name, from customers, owners, drivers and bookings */
  const names = useMemo(() => {
    const m = new Map<string, string>();
    const put = (phone: string | undefined, name: string | undefined) => {
      const n = normalizeLkPhone(phone ?? '');
      if (n && name && !m.has(n)) m.set(n, name);
    };
    owners.forEach((o) => put(o.phone, o.name));
    drivers.forEach((d) => put(d.phone, d.name));
    customers.forEach((c) => put(c.phone, c.name));
    bookings.forEach((b) => put(b.customerPhone, b.customerName));
    inquiries.forEach((i) => put(i.customerPhone, i.customerName));
    return m;
  }, [customers, owners, drivers, bookings, inquiries]);

  const bookingIds = useMemo(() => new Set(bookings.map((b) => b.id)), [bookings]);
  const inquiryIds = useMemo(() => new Set(inquiries.map((i) => i.id)), [inquiries]);

  // the filters, applied to any sms_log query
  const filtered = useCallback(<T,>(base: T): T => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let x = base as any;
    const [a, b] = periodRange(period, from, to);
    if (a) x = x.gte('created_at', a);
    if (b) x = x.lt('created_at', b);
    if (status) x = x.eq('status', status);
    if (role) x = x.eq('recipient_role', role);
    if (category) x = x.eq('category', category);
    if (query) {
      const safe = query.replace(/[,()*%\\]/g, ' ').trim();
      const ors = [`message.ilike.*${safe}*`, `related_id.ilike.*${safe}*`];
      const phone = normalizeLkPhone(safe);
      if (phone) ors.push(`recipient.eq.${phone}`);
      else if (/^\d{3,}$/.test(safe.replace(/\s/g, ''))) ors.push(`recipient.ilike.*${safe.replace(/\s/g, '').replace(/^0/, '')}*`);
      // a name: the phones of the people with that name
      const byName = [...names].filter(([, n]) => n.toLowerCase().includes(safe.toLowerCase())).map(([p]) => p).slice(0, 80);
      if (byName.length) ors.push(`recipient.in.(${byName.join(',')})`);
      x = x.or(ors.join(','));
    }
    return x as T;
  }, [period, from, to, status, role, category, query, names]);

  const load = useCallback(async () => {
    if (!supabaseEnabled) { setLoading(false); return; }
    setLoading(true); setOpen(null);
    try {
      const list = await filtered(supabase.from('sms_log').select('*')).order('created_at', { ascending: false }).range(0, PAGE);
      if (list.error) throw list.error;
      const got = (list.data ?? []) as SmsRow[];
      setRows(got.slice(0, PAGE)); setMore(got.length > PAGE);
      // the totals: the database hands back at most 1,000 rows at a time, so read status + units page by page
      const byStatus: Record<string, number> = {};
      let units = 0, total = 0;
      for (let at = 0; at < 200_000; at += 1000) {
        const { data, error } = await filtered(supabase.from('sms_log').select('status,cost')).order('id').range(at, at + 999);
        if (error) throw error;
        const part = (data ?? []) as { status: string; cost: number | null }[];
        part.forEach((r) => { byStatus[r.status] = (byStatus[r.status] ?? 0) + 1; units += Number(r.cost) || 0; });
        total += part.length;
        if (part.length < 1000) break;
      }
      setCounts({ total, byStatus, units });
    } catch (e) {
      toast.error('SMS log', (e as Error).message);
    } finally { setLoading(false); }
  }, [filtered]);
  useEffect(() => { load(); }, [load]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const { data, error } = await filtered(supabase.from('sms_log').select('*')).order('created_at', { ascending: false }).range(rows.length, rows.length + PAGE);
      if (error) throw error;
      const got = (data ?? []) as SmsRow[];
      setRows((r) => [...r, ...got.slice(0, PAGE)]); setMore(got.length > PAGE);
    } catch (e) { toast.error('SMS log', (e as Error).message); } finally { setLoadingMore(false); }
  };

  const exportCsv = () => {
    const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['Sent at', 'To', 'Name', 'Recipient', 'Type', 'Status', 'Units', 'Related', 'Message', 'Error'].map(cell).join(',')];
    rows.forEach((r) => lines.push([when(r.created_at), localPhone(r.recipient), names.get(r.recipient) ?? '', ROLE[r.recipient_role ?? ''] ?? r.recipient_role ?? '',
      categoryLabel(r.category), STATUS[r.status]?.label ?? r.status, r.cost ?? '', r.related_id ?? '', shownMessage(r), r.error ?? ''].map(cell).join(',')));
    const url = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `sms-log-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const related = (id: string | null) => {
    if (!id) return null;
    if (bookingIds.has(id)) return <Link to={`/bookings/${id}`} className="text-brand-500 font-semibold hover:underline">Booking {id}</Link>;
    if (inquiryIds.has(id)) return <Link to={`/inquiries/${id}`} className="text-brand-500 font-semibold hover:underline">Inquiry</Link>;
    if (id.startsWith('eag:')) return <Link to="/agreements" className="text-brand-500 font-semibold hover:underline">e-Agreement</Link>;
    return <span className="text-navy-400">{id}</span>;
  };

  const categoryOptions = useMemo(() => Object.entries(SMS_CATEGORY)
    .filter(([k], i, all) => all.findIndex(([, l]) => l === SMS_CATEGORY[k]) === i)
    .map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label)), []);

  if (!supabaseEnabled) return <div><Header title="SMS log" /><p className="card text-sm text-navy-500">Needs the live database — not available in demo mode.</p></div>;

  const tile = (label: string, value: number | string, cls: string, onClick?: () => void, active?: boolean) => (
    <button type="button" onClick={onClick} disabled={!onClick}
            className={`text-left p-3 rounded-2xl border bg-white shadow-card transition ${active ? 'border-navy-800 ring-1 ring-navy-800' : 'border-gray-100'} ${onClick ? 'hover:border-navy-200' : 'cursor-default'}`}>
      <p className="text-[11px] text-navy-400">{label}</p>
      <p className={`text-lg font-bold ${cls}`}>{value}</p>
    </button>
  );
  const c = counts?.byStatus ?? {};
  const pick = (s: string) => () => setStatus((x) => (x === s ? '' : s));

  return (
    <div>
      <Header title="SMS log" subtitle="Every text the system sent — to whom, what it said, and whether it arrived" />

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-4">
        {tile('All texts', counts ? counts.total.toLocaleString() : '…', 'text-navy-800', status ? () => setStatus('') : undefined, false)}
        {tile('Delivered', (c.delivered ?? 0).toLocaleString(), 'text-emerald-700', pick('delivered'), status === 'delivered')}
        {tile('Sent, no report yet', (c.sent ?? 0).toLocaleString(), 'text-sky-700', pick('sent'), status === 'sent')}
        {tile('Failed', (c.failed ?? 0).toLocaleString(), 'text-red-600', pick('failed'), status === 'failed')}
        {tile('Not sent', (c.skipped ?? 0).toLocaleString(), 'text-amber-700', pick('skipped'), status === 'skipped')}
        {tile('Units used', counts ? counts.units.toLocaleString() : '…', 'text-navy-800')}
      </div>

      <div className="card !p-3 mb-4 flex flex-wrap items-center gap-2">
        <label className="relative flex-1 min-w-[200px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-navy-300" />
          <input className="input !pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, phone, booking or words in the text" />
        </label>
        <Select className="w-40" value={period} onChange={setPeriod} options={PERIODS} />
        {period === 'custom' && (
          <>
            <input type="date" className="input !w-auto" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
            <input type="date" className="input !w-auto" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" />
          </>
        )}
        <Select className="w-36" value={status} onChange={setStatus} nullable placeholder="Any status"
                options={Object.entries(STATUS).map(([value, s]) => ({ value, label: s.label }))} />
        <Select className="w-36" value={role} onChange={setRole} nullable placeholder="Anyone"
                options={Object.entries(ROLE).map(([value, label]) => ({ value, label }))} />
        <Select className="w-48" value={category} onChange={setCategory} nullable searchable placeholder="Any kind of text" options={categoryOptions} />
        <button type="button" onClick={load} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold bg-white border border-navy-100 text-navy-700"><RefreshCw size={14} /> Refresh</button>
        <button type="button" onClick={exportCsv} disabled={!rows.length} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold bg-white border border-navy-100 text-navy-700 disabled:opacity-40"><Download size={14} /> CSV</button>
      </div>

      <section className="card !p-0 overflow-hidden">
        {loading ? <p className="p-6 text-sm text-navy-400 flex items-center gap-2"><Loader2 size={15} className="animate-spin" /> Loading…</p>
          : rows.length === 0 ? (
            <div className="p-10 text-center">
              <MessageSquareText size={28} className="mx-auto text-navy-200 mb-2" />
              <p className="text-sm text-navy-500">No texts match these filters.</p>
            </div>
          ) : (
            <ul className="divide-y divide-navy-50">
              {rows.map((r) => {
                const s = STATUS[r.status] ?? { label: r.status, cls: 'bg-navy-100 text-navy-700', Icon: Check };
                const name = names.get(r.recipient);
                const isOpen = open === r.id;
                const text = shownMessage(r);
                return (
                  <li key={r.id}>
                    <button type="button" onClick={() => setOpen(isOpen ? null : r.id)} className="w-full text-left p-3 sm:p-4 hover:bg-navy-50/40 flex gap-3 items-start">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="font-semibold text-navy-800 text-sm">{name ?? localPhone(r.recipient)}</span>
                          {name && <span className="text-xs text-navy-400">{localPhone(r.recipient)}</span>}
                          {r.recipient_role && <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-navy-50 text-navy-500">{ROLE[r.recipient_role] ?? r.recipient_role}</span>}
                          <span className="text-xs text-navy-500">· {categoryLabel(r.category)}</span>
                        </div>
                        <p className={`text-xs text-navy-600 mt-1 ${isOpen ? 'whitespace-pre-wrap' : 'truncate'}`}>{text}</p>
                      </div>
                      <div className="flex flex-col items-end gap-1 flex-shrink-0">
                        <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full ${s.cls}`}><s.Icon size={11} /> {s.label}</span>
                        <span className="text-[11px] text-navy-400 whitespace-nowrap">{when(r.created_at)}</span>
                      </div>
                      <ChevronDown size={15} className={`text-navy-300 mt-1 flex-shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {isOpen && (
                      <div className="px-3 sm:px-4 pb-4 -mt-1 text-xs text-navy-500 grid gap-1 sm:grid-cols-2">
                        {r.related_id && <p>For: {related(r.related_id)}</p>}
                        {r.cost != null && <p>Units: {r.cost}</p>}
                        {r.updated_at && r.updated_at !== r.created_at && <p>Status updated {when(r.updated_at)}</p>}
                        {r.provider_uid && <p className="break-all">Text.lk id: {r.provider_uid}</p>}
                        {isCode(r.category) && <p className="sm:col-span-2 text-navy-400">Codes are hidden in the log so nobody can reuse one.</p>}
                        {r.error && <p className="sm:col-span-2 text-red-600 break-words">Why: {r.error}</p>}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        {more && !loading && (
          <div className="p-3 border-t border-navy-50 text-center">
            <button type="button" onClick={loadMore} disabled={loadingMore} className="px-4 py-2 rounded-xl text-sm font-semibold bg-white border border-navy-100 text-navy-700 disabled:opacity-50">
              {loadingMore ? 'Loading…' : `Show ${PAGE} more`}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
