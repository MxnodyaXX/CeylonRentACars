import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Clock, FileSignature, Hourglass, Plus, ShieldCheck, Wallet, XCircle } from 'lucide-react';
import Header from '../components/layout/Header';
import Select from '../components/ui/Select';
import { useAuthStore } from '../store/useAuthStore';
import { useStore } from '../store/useStore';
import { toast } from '../store/useToast';
import {
  AGREEMENT_STATUS, eag, eagEnabled, eagError, lk, loadPolicy,
  type Dashboard, type ExceptionRow, type Policy, type Template,
} from '../lib/eagreement';
import { askText } from '../lib/dialog';

type Tab = 'overview' | 'exceptions' | 'policy' | 'wording';
const card = 'card !p-4 md:!p-5';

/** Booking e-Agreements: what needs attention, audited exceptions, and (admins) the policy and wording */
export default function Agreements() {
  const isAdmin = useAuthStore((s) => s.currentUser?.role === 'admin');
  const [tab, setTab] = useState<Tab>('overview');
  const tabs: [Tab, string][] = [['overview', 'Overview'], ['exceptions', 'Exceptions'], ...(isAdmin ? [['policy', 'Policy'], ['wording', 'Wording']] as [Tab, string][] : [])];
  return (
    <div>
      <Header title="e-Agreements" subtitle="Booking e-Agreement (CRC-AGR-003): acceptance before any advance is requested" />
      {!eagEnabled ? <p className="card text-sm text-navy-500">e-Agreements need the live database — not available in demo mode.</p> : (
        <>
          <div className="flex gap-1.5 mb-4 flex-wrap" role="tablist">
            {tabs.map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
                      className={`px-3 py-1.5 rounded-xl text-sm font-semibold ${tab === id ? 'bg-navy-800 text-white' : 'bg-white border border-navy-100 text-navy-600 hover:bg-navy-50'}`}>{label}</button>
            ))}
          </div>
          {tab === 'overview' && <OverviewTab />}
          {tab === 'exceptions' && <ExceptionsTab />}
          {tab === 'policy' && isAdmin && <PolicyTab />}
          {tab === 'wording' && isAdmin && <WordingTab />}
        </>
      )}
    </div>
  );
}

/* ── Overview: the operational counts (kept apart from booking counts) + the latest agreements ── */
export function AgreementCounts({ compact = false }: { compact?: boolean }) {
  const [d, setD] = useState<Dashboard | null>(null);
  useEffect(() => { if (eagEnabled) eag.dashboard().then(setD).catch(() => setD(null)); }, []);
  if (!d) return null;
  const items: [string, number, typeof Clock, string][] = [
    ['Awaiting acceptance', d.awaiting_acceptance, Hourglass, 'text-sky-700'],
    ['Accepted — awaiting advance', d.accepted_awaiting_advance, Wallet, 'text-emerald-700'],
    ['Expiring within 24 h', d.expiring_soon, Clock, 'text-amber-700'],
    ['Priority holds near expiry', d.holds_near_expiry, AlertTriangle, 'text-amber-700'],
    ['Payments to verify', d.payments_to_verify, ShieldCheck, 'text-indigo-700'],
    ['Declined (30 days)', d.declined_30d, XCircle, 'text-red-600'],
    ['Expired (30 days)', d.expired_30d, Clock, 'text-navy-500'],
    ['Exceptions to decide', d.exceptions_pending, ShieldCheck, 'text-navy-700'],
  ];
  return (
    <div className={`grid gap-2 ${compact ? 'grid-cols-2 md:grid-cols-4' : 'grid-cols-2 md:grid-cols-4'}`}>
      {items.map(([label, n, Icon, cls]) => (
        <div key={label} className="rounded-xl border border-navy-100 bg-white px-3 py-2.5">
          <p className={`flex items-center gap-1.5 text-xs font-semibold ${cls}`}><Icon size={13} /> {label}</p>
          <p className="text-xl font-bold text-navy-900 mt-0.5">{n}</p>
        </div>
      ))}
    </div>
  );
}

function OverviewTab() {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof eag.recent>>>([]);
  const [err, setErr] = useState('');
  useEffect(() => { eag.recent(30).then(setRows).catch((e) => setErr(eagError(e).message)); }, []);
  return (
    <div className="space-y-4">
      <AgreementCounts />
      <section className={card}>
        <h2 className="text-sm font-bold text-navy-800 mb-3 flex items-center gap-2"><FileSignature size={16} className="text-brand-500" /> Latest agreements</h2>
        {err ? <p className="text-sm text-red-700">{err}</p> : rows.length === 0 ? <p className="text-sm text-navy-500">No agreements sent yet. Start from an inquiry → Booking e-Agreement.</p> : (
          <ul className="divide-y divide-navy-50">
            {rows.map((r) => {
              const st = AGREEMENT_STATUS[r.status] ?? { label: r.status, cls: 'bg-navy-100' };
              return (
                <li key={r.id} className="py-2 flex flex-wrap items-center gap-2 justify-between text-sm">
                  <Link to={`/inquiries/${r.inquiry_id}#eagreement`} className="font-semibold text-navy-800 hover:underline">{r.customer} <span className="font-normal text-navy-400">· {r.reference} · {r.vehicle}</span></Link>
                  <span className="flex items-center gap-2 text-xs text-navy-500">
                    {r.decided_at ? `decided ${lk(r.decided_at)}` : `open until ${lk(r.expires_at)}`}
                    <span className={`font-bold px-2 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

/* ── Exceptions: asked by staff, decided by a business approver who didn't ask ── */
function ExceptionsTab() {
  const navigate = useNavigate();
  const { vehicles } = useStore();
  const isAdmin = useAuthStore((s) => s.currentUser?.role === 'admin');
  const me = useAuthStore((s) => s.currentUser?.name);
  const canBook = useAuthStore((s) => s.can('canBookCreate'));
  const [rows, setRows] = useState<ExceptionRow[]>([]);
  const [busy, setBusy] = useState('');
  const [asking, setAsking] = useState(false);
  const [f, setF] = useState({ vehicle_id: '', start_date: '', start_time: '', end_date: '', end_time: '', total: '', reason: '' });
  const load = useCallback(() => eag.exceptions().then(setRows).catch((e) => toast.error('Exceptions', eagError(e).message)), []);
  useEffect(() => { load(); }, [load]);

  const act = async (id: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(id);
    try { await fn(); toast.success(ok); await load(); } catch (e) { toast.error('Not done', eagError(e).message); } finally { setBusy(''); }
  };
  const useIt = (x: ExceptionRow) => act(x.id, async () => {
    const t = await eag.useExemption(x.id);
    const d = x.details as Record<string, string>;
    navigate('/bookings', { state: { fromInquiry: {
      customerName: '', customerPhone: '', notes: `Gate exemption approved by ${x.decided_by}: ${x.reason}`,
      vehicleId: t.vehicle_id, startDate: d.start_date, endDate: d.end_date, startTime: d.start_time || undefined, endTime: d.end_time || undefined,
      totalAmount: Number(d.total) || undefined,
      allocation: { booking_id: t.booking_id, vehicle_id: t.vehicle_id, start_date: d.start_date, start_time: d.start_time || '00:00', end_date: d.end_date, end_time: d.end_time || '23:59', total: Number(d.total) || 0, advance: 0, deposit: 0, rental_type: 'Daily' },
    } } });
  }, 'Exemption used — save the booking');

  return (
    <div className="space-y-4">
      <section className={card}>
        <div className="flex items-center justify-between gap-2 mb-2">
          <h2 className="text-sm font-bold text-navy-800 flex items-center gap-2"><ShieldCheck size={16} className="text-brand-500" /> Audited exceptions</h2>
          {canBook && <button type="button" className="text-sm font-semibold text-brand-500 flex items-center gap-1" onClick={() => setAsking((a) => !a)}><Plus size={14} /> Booking without an inquiry</button>}
        </div>
        <p className="text-xs text-navy-500 mb-3">A booking that can’t go through an inquiry and e-Agreement (for example an owner using their own car) needs an exemption approved by the Managing Director — never by the person who asked. Manual acceptance is asked for from the inquiry’s e-Agreement panel.</p>
        {asking && (
          <div className="rounded-xl border border-navy-100 p-3 mb-3 space-y-2 text-sm">
            <Select value={f.vehicle_id} onChange={(v) => setF({ ...f, vehicle_id: v })} options={vehicles.map((v) => ({ value: v.id, label: `${v.brand} ${v.model} (${v.vehicleNumber})` }))} placeholder="Vehicle" searchable />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <label>From<input className="input mt-1" type="date" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} /></label>
              <label>Time<input className="input mt-1" type="time" value={f.start_time} onChange={(e) => setF({ ...f, start_time: e.target.value })} /></label>
              <label>To<input className="input mt-1" type="date" value={f.end_date} onChange={(e) => setF({ ...f, end_date: e.target.value })} /></label>
              <label>Time<input className="input mt-1" type="time" value={f.end_time} onChange={(e) => setF({ ...f, end_time: e.target.value })} /></label>
            </div>
            <label className="block">Booking total (Rs)<input className="input mt-1" inputMode="numeric" value={f.total} onChange={(e) => setF({ ...f, total: e.target.value })} /></label>
            <label className="block">Why can’t it go through an e-Agreement?<textarea className="input mt-1" rows={2} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></label>
            <button type="button" className="px-4 py-2 rounded-xl text-sm font-semibold bg-navy-800 text-white disabled:opacity-50"
                    disabled={!f.vehicle_id || !f.start_date || !f.end_date || f.total === '' || f.reason.trim().length < 10 || busy === 'ask'}
                    onClick={() => act('ask', () => eag.requestException('GATE_EXEMPT_BOOKING', null, null, f.reason, { vehicle_id: f.vehicle_id, start_date: f.start_date, start_time: f.start_time || null, end_date: f.end_date, end_time: f.end_time || null, total: Number(f.total) || 0 }), 'Asked — waiting for approval').then(() => setAsking(false))}>Ask for approval</button>
          </div>
        )}
        {rows.length === 0 ? <p className="text-sm text-navy-500">No exceptions.</p> : (
          <ul className="divide-y divide-navy-50">
            {rows.map((x) => (
              <li key={x.id} className="py-2.5 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold text-navy-800">{x.kind.replace(/_/g, ' ').toLowerCase()}{x.customer ? ` · ${x.customer}` : ''}</p>
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${x.status === 'PENDING' ? 'bg-amber-100 text-amber-800' : x.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-800' : x.status === 'USED' ? 'bg-navy-100 text-navy-600' : 'bg-red-100 text-red-700'}`}>{x.status.toLowerCase()}</span>
                </div>
                <p className="text-navy-600">{x.reason}</p>
                <p className="text-xs text-navy-400">Asked by {x.requested_by} · {lk(x.requested_at)}{x.decided_by ? ` · decided by ${x.decided_by} ${lk(x.decided_at)}` : ''}{x.decision_note ? ` — ${x.decision_note}` : ''}</p>
                <div className="flex gap-2 mt-1.5">
                  {x.status === 'PENDING' && isAdmin && x.requested_by !== me && (
                    <>
                      <button type="button" disabled={busy === x.id} className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-emerald-600 text-white" onClick={() => act(x.id, () => eag.decideException(x.id, true, ''), 'Approved')}><CheckCircle2 size={12} className="inline" /> Approve</button>
                      <button type="button" disabled={busy === x.id} className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-red-600 text-white" onClick={async () => { const n = await askText('Why is it rejected?') ?? ''; act(x.id, () => eag.decideException(x.id, false, n), 'Rejected'); }}><XCircle size={12} className="inline" /> Reject</button>
                    </>
                  )}
                  {x.status === 'APPROVED' && x.kind === 'GATE_EXEMPT_BOOKING' && canBook && (
                    <button type="button" disabled={busy === x.id} className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-navy-800 text-white" onClick={() => useIt(x)}>Create this booking</button>
                  )}
                  {x.inquiry_id && <Link to={`/inquiries/${x.inquiry_id}#eagreement`} className="text-xs font-semibold text-brand-500 hover:underline">Open inquiry</Link>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/* ── Policy: the values Brian approves (blank = not approved → nothing can be sent) ── */
const HOURS: { k: keyof Policy; label: string; hint: string }[] = [
  { k: 'quotation_valid_hours', label: 'Quotation valid for', hint: 'After it is sent, the customer can accept it for this long.' },
  { k: 'agreement_deadline_hours', label: 'Time to accept the agreement', hint: 'Stage A — the car is held while the customer reads and accepts.' },
  { k: 'advance_deadline_hours', label: 'Time to pay the advance', hint: 'Stage B — counted from the moment they accept.' },
  { k: 'verification_deadline_hours', label: 'Finance verification', hint: 'Stage C — after the customer reports a payment.' },
  { k: 'hold_max_hours', label: 'Longest priority in total', hint: 'A cap on stages A + B + C together.' },
  { k: 'link_valid_hours', label: 'Agreement link open for', hint: 'The secure link stops working after this.' },
];
const REQUIRED: (keyof Policy)[] = ['quotation_valid_hours', 'agreement_deadline_hours', 'advance_deadline_hours', 'verification_deadline_hours',
  'hold_max_hours', 'turnaround_minutes', 'link_valid_hours', 'advance_rule', 'collection_account_id', 'cancellation_policy_version', 'cancellation_policy_text'];
const isSet = (v: unknown) => v !== null && v !== undefined && v !== '' && !(typeof v === 'object' && !(v as { value?: number }).value);

/** plain: a group of buttons / a picker — not a <label> (a label would send clicks on its text to the first button) */
function PField({ label, hint, children, wide, plain }: { label: string; hint?: string; children: React.ReactNode; wide?: boolean; plain?: boolean }) {
  const Tag = plain ? 'div' : 'label';
  return (
    <Tag className={`block ${wide ? 'sm:col-span-2' : ''}`} {...(plain ? { role: 'group', 'aria-label': label } : {})}>
      <span className="block text-sm font-semibold text-navy-800">{label}</span>
      <span className="block mt-1.5">{children}</span>
      {hint && <span className="block text-xs text-navy-400 mt-1 leading-snug">{hint}</span>}
    </Tag>
  );
}

/** a number input with its unit inside, on the right */
function UnitInput({ value, unit, onChange, placeholder = 'Not set', disabled }: { value: string; unit: string; onChange: (v: string) => void; placeholder?: string; disabled?: boolean }) {
  return (
    <span className={`flex items-stretch rounded-xl border bg-white overflow-hidden focus-within:ring-2 focus-within:ring-brand-500/30 ${value ? 'border-navy-200' : 'border-amber-300 bg-amber-50/40'} ${disabled ? 'opacity-50' : ''}`}>
      <input className="flex-1 min-w-0 px-3 py-2.5 text-sm bg-transparent outline-none placeholder:text-amber-700/60" inputMode="decimal" value={value}
             placeholder={placeholder} disabled={disabled} onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ''))} />
      <span className="px-3 grid place-items-center text-xs font-semibold text-navy-500 bg-navy-50 border-l border-navy-100">{unit}</span>
    </span>
  );
}

function PCard({ title, sub, done, children, className = '' }: { title: string; sub?: string; done?: boolean; children: React.ReactNode; className?: string }) {
  return (
    <section className={`card !p-5 ${className}`}>
      <div className="flex items-start justify-between gap-3 mb-4">
        <div><h3 className="text-base font-bold text-navy-900">{title}</h3>{sub && <p className="text-xs text-navy-500 mt-0.5">{sub}</p>}</div>
        {done !== undefined && (
          <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${done ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{done ? 'Set' : 'Needs approval'}</span>
        )}
      </div>
      {children}
    </section>
  );
}

function PolicyTab() {
  const isApprover = useAuthStore((s) => s.currentUser?.role === 'admin');
  const [saved, setSaved] = useState<Policy | null>(null);
  const [p, setP] = useState<Policy | null>(null);
  const [accounts, setAccounts] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    loadPolicy().then((x) => { setSaved(x); setP(x); }).catch(() => { setSaved({}); setP({}); });
    eag.accounts().then(setAccounts).catch(() => {});
  }, []);
  if (!p || !saved) return <p className="text-sm text-navy-400">Loading…</p>;

  const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));
  const set = (patch: Partial<Policy>) => setP({ ...p, ...patch });
  const num = (v: string) => (v.trim() === '' ? null : Number(v));
  const doneCount = REQUIRED.filter((k) => isSet(p[k])).length;
  const dirty = JSON.stringify(p) !== JSON.stringify(saved);
  const rule = p.advance_rule;
  const example = 20000;
  const exampleAdvance = rule?.value ? (rule.type === 'percent' ? Math.round(example * rule.value / 100) : Math.min(rule.value, example)) : 0;
  const lists = (v: number[] | undefined) => (v ?? []).join(', ');
  const parseList = (v: string) => v.split(/[,\s]+/).map((x) => Number(x)).filter((x) => x > 0);
  const localIso = (iso?: string | null) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');

  const save = async () => {
    setBusy(true);
    try {
      const patch: Partial<Policy> = {};
      HOURS.forEach(({ k }) => { (patch as Record<string, unknown>)[k] = p[k] ?? null; });
      Object.assign(patch, {
        turnaround_minutes: p.turnaround_minutes ?? null, advance_rule: rule?.value ? rule : null,
        collection_account_id: p.collection_account_id || null, cancellation_policy_version: p.cancellation_policy_version?.trim() || null,
        cancellation_policy_text: p.cancellation_policy_text?.trim() || null, reminders: p.reminders ?? null,
        enforce_from: p.enforce_from || null, split_admin_approvals: !!p.split_admin_approvals,
      });
      const next = await eag.savePolicy(patch);
      setSaved(next); setP(next);
      toast.success('Policy saved', 'Each change is kept on the record.');
    } catch (e) { toast.error('Not saved', eagError(e).message); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4 pb-24">
      {/* status */}
      <div className="card !p-4 flex flex-wrap items-center gap-4 justify-between">
        <div className="flex items-center gap-3">
          <div className="relative w-12 h-12">
            <svg viewBox="0 0 36 36" className="w-12 h-12 -rotate-90"><circle cx="18" cy="18" r="15" fill="none" stroke="#e5e7eb" strokeWidth="4" />
              <circle cx="18" cy="18" r="15" fill="none" stroke={doneCount === REQUIRED.length ? '#059669' : '#d97706'} strokeWidth="4" strokeLinecap="round"
                      strokeDasharray={`${(doneCount / REQUIRED.length) * 94.2} 94.2`} /></svg>
            <span className="absolute inset-0 grid place-items-center text-xs font-bold text-navy-800">{doneCount}/{REQUIRED.length}</span>
          </div>
          <div>
            <p className="font-bold text-navy-900">{doneCount === REQUIRED.length ? 'Every policy value is approved' : `${REQUIRED.length - doneCount} value${REQUIRED.length - doneCount === 1 ? '' : 's'} still to approve`}</p>
            <p className="text-xs text-navy-500">A blank value means “not approved yet” — quotations and agreements can’t be sent until the values they need are set. Nothing here is filled in by the system.</p>
          </div>
        </div>
        <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${p.enforce_from ? 'bg-emerald-100 text-emerald-800' : 'bg-navy-100 text-navy-600'}`}>
          Booking gate: {p.enforce_from ? `on from ${lk(p.enforce_from)}` : 'off'}
        </span>
      </div>

      <div className="grid lg:grid-cols-2 gap-4 items-start">
        <PCard title="Priority & deadlines" sub="How long each step may take before the car is released to others."
               done={HOURS.every(({ k }) => isSet(p[k])) && isSet(p.turnaround_minutes)}>
          <div className="grid sm:grid-cols-2 gap-x-4 gap-y-4">
            {HOURS.map(({ k, label, hint }) => (
              <PField key={k} label={label} hint={hint}>
                <UnitInput value={s(p[k])} unit="hours" onChange={(v) => set({ [k]: num(v) } as Partial<Policy>)} />
              </PField>
            ))}
            <PField label="Turnaround buffer" hint="Kept free before and after a held period (0 = none).">
              <UnitInput value={s(p.turnaround_minutes)} unit="minutes" onChange={(v) => set({ turnaround_minutes: num(v) })} />
            </PField>
          </div>
          {(() => {
            // how the values work together in the database (files 23–24)
            const A = Number(p.agreement_deadline_hours) || 0, B = Number(p.advance_deadline_hours) || 0, C = Number(p.verification_deadline_hours) || 0;
            const Q = Number(p.quotation_valid_hours) || 0, cap = Number(p.hold_max_hours) || 0, link = Number(p.link_valid_hours) || 0;
            const warn: string[] = [];
            if (Q && A && B && C && Q < A + B + C) warn.push(`The quotation (${Q} h) ends before the steps can finish (${A} + ${B} + ${C} = ${A + B + C} h). The advance request and the booking are refused once the quotation has expired — make it at least ${A + B + C} h.`);
            if (cap && A && B && C && cap < A + B + C) warn.push(`The longest priority (${cap} h) is shorter than the steps (${A + B + C} h) — the last step gets cut short.`);
            if (cap && A && B && C && cap === A + B + C) warn.push('The longest priority equals the steps exactly — no slack if anything runs late.');
            if (C && C < 8) warn.push(`Finance has only ${C} h to verify a reported payment. If it isn’t verified in time the hold is released and the car can go to someone else, even though the customer paid (e.g. a payment reported in the evening).`);
            if (link && A && link < A) warn.push(`The link (${link} h) stops working before the time to accept (${A} h) ends.`);
            if (Q && link && Q < link) warn.push(`The link is also cut to the quotation’s end (${Q} h).`);
            return warn.length > 0 && (
              <ul className="mt-4 space-y-1.5 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                {warn.map((w, i) => <li key={i} className="flex gap-1.5"><AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />{w}</li>)}
              </ul>
            );
          })()}
        </PCard>

        <div className="space-y-4">
          <PCard title="Advance payment" sub="What the customer pays to secure the booking, and where it goes." done={isSet(rule) && isSet(p.collection_account_id)}>
            <div className="space-y-4">
              <PField label="Advance rule" plain>
                <span className="grid grid-cols-3 gap-1.5">
                  {([['', 'Not set'], ['percent', '% of the total'], ['fixed', 'Fixed amount']] as const).map(([v, l]) => (
                    <button key={v} type="button" onClick={() => set({ advance_rule: v ? { type: v, value: rule?.value ?? 0 } : null })}
                            className={`px-2 py-2 rounded-xl text-sm font-semibold border ${(rule?.type ?? '') === v ? 'bg-navy-800 text-white border-navy-800' : 'bg-white text-navy-600 border-navy-100 hover:bg-navy-50'}`}>{l}</button>
                  ))}
                </span>
              </PField>
              {rule && (
                <PField label={rule.type === 'percent' ? 'Percentage' : 'Amount'}
                        hint={exampleAdvance ? `Example: on a Rs ${example.toLocaleString('en-LK')} booking the advance is Rs ${exampleAdvance.toLocaleString('en-LK')}.` : undefined}>
                  <UnitInput value={rule.value ? String(rule.value) : ''} unit={rule.type === 'percent' ? '%' : 'Rs'} onChange={(v) => set({ advance_rule: { ...rule, value: Number(v) || 0 } })} />
                </PField>
              )}
              <PField label="Collection account" hint="Shown to the customer only after the advance is requested." plain>
                <Select value={p.collection_account_id ?? ''} onChange={(v) => set({ collection_account_id: v })} options={accounts.map((a) => ({ value: a.id, label: a.name }))} placeholder="Choose the account" />
              </PField>
            </div>
          </PCard>

          <PCard title="Reminders" sub="SMS to the customer before a deadline. Leave empty for none.">
            <div className="grid sm:grid-cols-2 gap-4">
              <PField label="Before the agreement expires" hint="Hours, e.g. 24, 2">
                <UnitInput value={lists(p.reminders?.agreement)} unit="hours" placeholder="None" onChange={(v) => set({ reminders: { ...p.reminders, agreement: parseList(v) } })} />
              </PField>
              <PField label="Before the advance is due" hint="Hours, e.g. 6">
                <UnitInput value={lists(p.reminders?.advance)} unit="hours" placeholder="None" onChange={(v) => set({ reminders: { ...p.reminders, advance: parseList(v) } })} />
              </PField>
            </div>
          </PCard>
        </div>

        <PCard title="Cancellation & refunds" sub="Shown to the customer word for word, and kept with every agreement they accept." className="lg:col-span-2"
               done={isSet(p.cancellation_policy_text) && isSet(p.cancellation_policy_version)}>
          <div className="grid sm:grid-cols-[220px_1fr] gap-4">
            <PField label="Version" hint="Change it whenever the wording changes.">
              <input className={`input ${p.cancellation_policy_version ? '' : '!border-amber-300 !bg-amber-50/40'}`} value={p.cancellation_policy_version ?? ''} onChange={(e) => set({ cancellation_policy_version: e.target.value })} placeholder="e.g. CP-2026-01" />
            </PField>
            <PField label="Terms" hint="Use the approved percentages, charges and deadlines only.">
              <textarea className={`input min-h-[140px] ${p.cancellation_policy_text ? '' : '!border-amber-300 !bg-amber-50/40'}`} rows={6} value={p.cancellation_policy_text ?? ''}
                        onChange={(e) => set({ cancellation_policy_text: e.target.value })} placeholder="Not set — paste the approved cancellation and refund terms" />
            </PField>
          </div>
        </PCard>

        <PCard title="Go-live" sub="Switch on the booking gate once the wording is approved and staff have rehearsed." className="lg:col-span-2 !border-amber-200 !bg-amber-50/40">
          <div className="grid md:grid-cols-[280px_1fr] gap-4 items-start">
            <PField label="Booking gate from" hint="Leave empty to keep it off.">
              <input className="input" type="datetime-local" value={localIso(p.enforce_from)} onChange={(e) => set({ enforce_from: e.target.value ? new Date(e.target.value).toISOString() : null })} />
            </PField>
            <div className="space-y-3 text-sm text-navy-700">
              <p className="flex gap-2"><AlertTriangle size={16} className="text-amber-600 flex-shrink-0 mt-0.5" /> From this time every new booking must come through an accepted e-Agreement and a Finance-verified advance — or an approved exemption. Walk-ins accept on their own phone at the counter.</p>
              <label className="flex items-start gap-2 cursor-pointer">
                <input type="checkbox" className="mt-0.5" checked={!!p.split_admin_approvals} onChange={(e) => set({ split_admin_approvals: e.target.checked })} />
                <span>Only the Managing Director approves <span className="text-navy-500">— the IT admin can no longer approve payments, wording or exceptions. Mark Brian’s login as business approver first (deploy checklist, Part 23).</span></span>
              </label>
            </div>
          </div>
        </PCard>
      </div>

      {/* save bar */}
      <div className="fixed bottom-0 left-0 right-0 z-30 lg:left-[var(--sidebar-w,240px)] pointer-events-none">
        <div className="max-w-5xl mx-auto px-4 pb-[84px] md:pb-4">
          <div className={`pointer-events-auto flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 shadow-card-hover backdrop-blur ${dirty ? 'bg-white/95 border-brand-200' : 'bg-white/80 border-navy-100'}`}>
            <p className="text-sm text-navy-600">{dirty ? 'You have unsaved changes.' : 'All changes saved.'} {!isApprover && <span className="text-red-600">Only the business approver can save.</span>}</p>
            <div className="flex gap-2">
              {dirty && <button type="button" className="btn-secondary" onClick={() => setP(saved)}>Undo changes</button>}
              <button type="button" className="px-4 py-2 rounded-xl text-sm font-semibold bg-navy-800 text-white disabled:opacity-50" disabled={busy || !dirty} onClick={save}>{busy ? 'Saving…' : 'Save policy'}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Wording: versions of CRC-AGR-003 (draft by an admin, approved by the business approver) ── */
const FIELDS_HELP = '{{customer.name}} {{customer.mobile}} {{vehicle.make_model}} {{vehicle.registration}} {{rental.pickup}} {{rental.return}} {{rental.pickup_location}} {{rental.return_location}} {{rental.duration}} {{rental.included_km}} {{rental.extra_km_rate}} {{rental.conditions}} {{payment.total}} {{payment.advance}} {{payment.balance}} {{payment.deposit}} {{payment.advance_deadline}} {{policy.cancellation}} {{policy.cancellation_version}} {{agreement.reference}} {{agreement.expires_at}} {{ids.quotation}}';

function WordingTab() {
  const [list, setList] = useState<Template[]>([]);
  const [draft, setDraft] = useState<{ title: string; sections: { heading: string; body: string }[]; statement: string } | null>(null);
  const [busy, setBusy] = useState('');
  const load = useCallback(() => eag.templates().then(setList).catch((e) => toast.error('Wording', eagError(e).message)), []);
  useEffect(() => { load(); }, [load]);
  const startFrom = (t?: Template) => setDraft({
    title: t?.title ?? 'Booking Acceptance & Advance Payment e-Agreement',
    sections: t?.sections ?? [{ heading: 'Booking', body: 'Agreement {{agreement.reference}} between Ceylon Rent A Cars and {{customer.name}} ({{customer.mobile}}).' }],
    statement: t?.acceptance_statement ?? '',
  });
  const act = async (label: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(label);
    try { await fn(); toast.success(ok); await load(); return true; } catch (e) { toast.error('Not done', eagError(e).message); return false; } finally { setBusy(''); }
  };
  return (
    <div className="space-y-4 max-w-3xl">
      <section className={card}>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-bold text-navy-800">Wording versions</h2>
          {!draft && <button type="button" className="text-sm font-semibold text-brand-500" onClick={() => startFrom(list[0])}>+ New version</button>}
        </div>
        <p className="text-xs text-navy-500 mb-3">The legally operative wording must be approved (lawyer + Managing Director) before customers see it. An approved version can’t be edited — make a new one. Accepted agreements keep the exact version they were shown.</p>
        <ul className="divide-y divide-navy-50 text-sm">
          {list.map((t) => (
            <li key={t.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
              <span><b>v{t.version}</b> · {t.title} <span className="text-xs text-navy-400">· by {t.created_by} {lk(t.created_at)}{t.approved_by ? ` · approved by ${t.approved_by} ${lk(t.approved_at)}` : ''}</span></span>
              <span className="flex items-center gap-2">
                <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${t.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-800' : t.status === 'DRAFT' ? 'bg-amber-100 text-amber-800' : 'bg-navy-100 text-navy-500'}`}>{t.status.toLowerCase()}</span>
                {t.status === 'DRAFT' && <button type="button" disabled={busy === t.id} className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-emerald-600 text-white" onClick={() => act(t.id, () => eag.approveTemplate(t.id), 'Approved — new agreements use this wording')}>Approve</button>}
                <button type="button" className="text-xs font-semibold text-navy-600 hover:underline" onClick={() => startFrom(t)}>Copy into a new version</button>
              </span>
            </li>
          ))}
          {list.length === 0 && <li className="py-2 text-navy-500">No wording yet.</li>}
        </ul>
      </section>
      {draft && (
        <section className={`${card} space-y-3 text-sm`}>
          <label className="block">Title<input className="input mt-1" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></label>
          {draft.sections.map((s, i) => (
            <div key={i} className="rounded-xl border border-navy-100 p-3 space-y-2">
              <div className="flex gap-2">
                <input className="input" value={s.heading} placeholder="Heading" onChange={(e) => setDraft({ ...draft, sections: draft.sections.map((x, j) => (j === i ? { ...x, heading: e.target.value } : x)) })} />
                <button type="button" className="text-xs text-red-600" onClick={() => setDraft({ ...draft, sections: draft.sections.filter((_, j) => j !== i) })}>Remove</button>
              </div>
              <textarea className="input font-mono text-xs" rows={5} value={s.body} onChange={(e) => setDraft({ ...draft, sections: draft.sections.map((x, j) => (j === i ? { ...x, body: e.target.value } : x)) })} />
            </div>
          ))}
          <button type="button" className="text-sm font-semibold text-brand-500" onClick={() => setDraft({ ...draft, sections: [...draft.sections, { heading: '', body: '' }] })}>+ Add a section</button>
          <p className="text-[11px] text-navy-400 break-words">Fields you can use: {FIELDS_HELP}</p>
          <label className="block">Customer acceptance statement (exact words the customer ticks)
            <textarea className="input mt-1" rows={4} value={draft.statement} onChange={(e) => setDraft({ ...draft, statement: e.target.value })}
                      placeholder="I confirm that I have reviewed the booking details, rental charges, advance payment requirements, cancellation and refund conditions, and applicable terms. I agree to these terms and understand that my booking becomes confirmed only after CRC verifies the required advance payment and successfully allocates the vehicle." /></label>
          <div className="flex gap-2">
            <button type="button" className="px-4 py-2 rounded-xl text-sm font-semibold bg-navy-800 text-white disabled:opacity-50" disabled={busy === 'save'}
                    onClick={() => act('save', () => eag.saveTemplate(draft.title, draft.sections.filter((x) => x.heading.trim() || x.body.trim()), draft.statement), 'Saved as a draft — approve it to use it').then((ok) => ok && setDraft(null))}>Save as draft</button>
            <button type="button" className="btn-secondary" onClick={() => setDraft(null)}>Cancel</button>
          </div>
        </section>
      )}
    </div>
  );
}
