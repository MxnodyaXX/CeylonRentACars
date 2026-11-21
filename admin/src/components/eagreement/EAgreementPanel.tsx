import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertTriangle, BadgeCheck, CalendarDays, CheckCircle2, Clock, Copy, Download, Eye, FileSignature, History, Lock, MessageCircle,
  Send, ShieldCheck, Smartphone, Undo2, Wallet, XCircle,
} from 'lucide-react';
import type { Inquiry } from '../../types';
import { useStore } from '../../store/useStore';
import { useAuthStore } from '../../store/useAuthStore';
import { toast } from '../../store/useToast';
import Modal from '../ui/Modal';
import Select from '../ui/Select';
import { bookingFromAgreement } from '../../lib/consultation';
import { toWhatsAppPhone } from '../../lib/whatsapp';
import {
  AGREEMENT_STATUS, EVENT_LABEL, GATE_BANNER, SITE_URL, downloadPdf, eag, eagEnabled, eagError, lk, sendBySms,
  type Agreement, type Overview, type Quotation,
} from '../../lib/eagreement';
import { askText } from '../../lib/dialog';

const rs = (n?: number | null) => `Rs ${Math.round(Number(n) || 0).toLocaleString('en-LK')}`;
const btn = 'inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold disabled:opacity-50';
const primary = `${btn} bg-brand-500 text-white hover:bg-brand-600`;
const dark = `${btn} bg-navy-800 text-white hover:bg-navy-900`;
const soft = `${btn} bg-white border border-navy-100 text-navy-700 hover:bg-navy-50`;

/** The inquiry's booking e-Agreement: quotation versions → priority → agreement → advance → booking */
export default function EAgreementPanel({ inquiry }: { inquiry: Inquiry }) {
  const navigate = useNavigate();
  const { vehicles } = useStore();
  const can = useAuthStore((s) => s.can);
  const [ov, setOv] = useState<Overview | null>(null);
  const [loadErr, setLoadErr] = useState('');
  const [busy, setBusy] = useState('');
  const [modal, setModal] = useState<null | 'quote' | 'preview' | 'link' | 'revoke' | 'release' | 'receipt' | 'evidence' | 'manual'>(null);
  const [preview, setPreview] = useState<Agreement | null>(null);
  const [link, setLink] = useState<{ url: string; expires: string; reference: string } | null>(null);
  const [reason, setReason] = useState('');
  const [disclose, setDisclose] = useState(false);

  const load = useCallback(async () => {
    if (!eagEnabled) return;
    try { setOv(await eag.overview(inquiry.id)); setLoadErr(''); }
    catch (e) { setLoadErr(eagError(e).message); }
  }, [inquiry.id]);
  useEffect(() => { load(); }, [load]);

  const act = async (label: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(label);
    try { await fn(); if (ok) toast.success(ok); await load(); return true; }
    catch (e) { toast.error('Not done', eagError(e).message); return false; }
    finally { setBusy(''); }
  };

  if (!eagEnabled) {
    return <p className="text-sm text-navy-500">The booking e-Agreement needs the live database — it isn’t available in demo mode.</p>;
  }
  if (loadErr) return <p className="text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">{loadErr} <button type="button" className="underline" onClick={load}>Try again</button></p>;
  if (!ov) return <p className="text-sm text-navy-400">Loading…</p>;

  const g = ov.gate;
  const banner = GATE_BANNER[g.state];
  const q = ov.quotations[0];
  const hold = ov.holds.find((h) => h.status === 'ACTIVE') ?? ov.holds[0];
  const ag = ov.agreements[0];
  const open = ag && ['DRAFT', 'SENT', 'VIEWED'].includes(ag.status) && ag.status !== 'SUPERSEDED';
  const waiting = ov.waitlist.find((w) => w.status === 'WAITING' || w.status === 'OFFERED');
  const manualOk = ov.exceptions.find((x) => x.kind === 'MANUAL_ACCEPTANCE' && x.status === 'APPROVED');
  const mayQuote = can('canSendAgreements'), mayAdvance = can('canRequestAdvance'), mayBook = can('canBookCreate'), mayPay = can('canTakePayments') || can('canVerifyPayments');
  const holdLive = hold?.status === 'ACTIVE';

  /* ── sending ── */
  const sendLink = async (channel: 'whatsapp_link' | 'copy' | 'in_person') => {
    setBusy(channel);
    try {
      const r = await eag.send(ag!.id, channel);
      const url = `${SITE_URL}${r.path}`;
      setLink({ url, expires: r.expires_at, reference: r.reference });
      if (channel === 'whatsapp_link') {
        const first = inquiry.customerName.trim().split(/\s+/)[0];
        const text = `Hi ${first}, here is your booking agreement ${r.reference} from Ceylon Rent A Cars: ${url}\nPlease review it — you'll confirm with a one-time SMS code. It's open until ${lk(r.expires_at)}. We will never ask you for the code.`;
        window.open(`https://wa.me/${toWhatsAppPhone(inquiry.customerPhone)}?text=${encodeURIComponent(text)}`, '_blank');
      }
      if (channel === 'copy') await navigator.clipboard.writeText(url).catch(() => {});
      setModal('link');
      await load();
    } catch (e) { toast.error('Not sent', eagError(e).message); }
    finally { setBusy(''); }
  };

  const allocate = () => act('allocate', async () => {
    const t = await eag.allocate(inquiry.id);
    const agreed = inquiry.consultation?.agreement;
    const base = agreed ? bookingFromAgreement(inquiry, agreed) : { customerName: inquiry.customerName, customerPhone: inquiry.customerPhone, source: inquiry.referral, notes: '' };
    navigate('/bookings', { state: { fromInquiry: {
      ...base, inquiryId: inquiry.id, vehicleId: t.vehicle_id, startDate: t.start_date, endDate: t.end_date, startTime: t.start_time, endTime: t.end_time,
      pickupLocation: t.pickup_location ?? undefined, dropLocation: t.return_location ?? t.pickup_location ?? undefined, totalAmount: t.total,
      paidAmount: t.advance, depositAmount: t.deposit || undefined,
      notes: [`Booking e-Agreement ${ag?.reference} accepted · advance ${rs(t.advance)} verified by Finance.`, base.notes].filter(Boolean).join('\n'),
      allocation: t,
    } } });
  });

  return (
    <div className="space-y-4">
      {/* gate banner */}
      <div className={`rounded-xl border-2 px-3 py-2.5 ${banner.cls}`}>
        <p className="font-bold text-sm flex items-center gap-1.5">{g.state === 'ELIGIBLE' || g.state === 'CONFIRMED' || g.state === 'PAYMENT_VERIFIED' ? <BadgeCheck size={15} /> : <Lock size={15} />} {banner.title}</p>
        {g.problems.length > 0 && g.state !== 'CONFIRMED' && (
          <ul className="mt-1 text-xs space-y-0.5 list-disc pl-5">{g.problems.map((p, i) => <li key={i}>{p}</li>)}</ul>
        )}
        {holdLive && hold && (
          <p className="mt-1 text-xs flex items-center gap-1"><Clock size={12} /> Priority: {hold.stage.replace(/_/g, ' ').toLowerCase()} · this step until {lk(hold.stage_deadline)} · ends {lk(hold.expires_at)}</p>
        )}
        {waiting && <p className="mt-1 text-xs">On the waiting list for this car{waiting.status === 'OFFERED' ? ' — the car became free: offer it now' : ''}.</p>}
      </div>

      {/* the next step */}
      <div className="flex flex-wrap gap-2">
        {mayQuote && g.state !== 'CONFIRMED' && (
          <button type="button" className={!q ? primary : soft} onClick={() => setModal('quote')}>
            <FileSignature size={15} /> {q ? `Send revised quotation (v${q.version + 1})` : 'Send quotation'}
          </button>
        )}
        {mayQuote && q && q.status === 'SENT' && (
          <button type="button" className={primary} disabled={!!busy} onClick={() => act('acceptq', async () => {
            const r = await eag.acceptQuotation(q.id);
            if (r.status === 'WAITLISTED') toast.warning('Put on the waiting list', `${r.reason}${r.kept_hold ? ' The earlier priority is kept.' : ''}`);
            else toast.success('Priority assigned', `The car is held until ${lk(r.expires_at)}.`);
          })}><CheckCircle2 size={15} /> Customer accepted v{q.version} — hold the car</button>
        )}
        {mayQuote && holdLive && hold?.stage === 'AWAITING_AGREEMENT' && (!ag || !open || (ag && ag.quotation_version !== q?.version)) && (
          <span className="inline-flex items-center gap-2">
            <button type="button" className={primary} disabled={!!busy} onClick={() => act('gen', () => eag.generate(inquiry.id, disclose), 'e-Agreement generated — preview and send it')}><FileSignature size={15} /> Generate e-Agreement</button>
            <label className="text-xs text-navy-600 flex items-center gap-1"><input type="checkbox" checked={disclose} onChange={(e) => setDisclose(e.target.checked)} /> show number plate</label>
          </span>
        )}
        {mayQuote && open && ag && (
          <>
            <button type="button" className={soft} onClick={() => { setPreview(ag); setModal('preview'); }}><Eye size={15} /> Preview</button>
            <button type="button" className={ag.status === 'DRAFT' ? primary : soft} disabled={!!busy} onClick={() => act('sms', async () => { const r = await sendBySms(ag.id); if (!r.ok) throw new Error(r.error); }, 'Sent by SMS — delivery shows below once Text.lk confirms')}>
              <Smartphone size={15} /> {ag.status === 'DRAFT' ? 'Send by SMS' : 'Resend by SMS'}
            </button>
            <button type="button" className={soft} disabled={!!busy} onClick={() => sendLink('whatsapp_link')}><MessageCircle size={15} /> {ag.status === 'DRAFT' ? 'Send' : 'Resend'} by WhatsApp</button>
            <button type="button" className={soft} disabled={!!busy} onClick={() => sendLink('copy')}><Copy size={15} /> Copy secure link</button>
            <button type="button" className={soft} disabled={!!busy} onClick={() => sendLink('in_person')} title="Walk-in: open the link on the customer's own phone"><Send size={15} /> At the counter</button>
            <button type="button" className={`${soft} !text-red-600`} onClick={() => { setReason(''); setModal('revoke'); }}><XCircle size={15} /> Revoke</button>
            {ag.status !== 'DRAFT' && (manualOk
              ? <button type="button" className={soft} onClick={() => { setReason(''); setModal('manual'); }}><ShieldCheck size={15} /> Record manual acceptance</button>
              : <button type="button" className={soft} disabled={!!busy} title="Only if the agreement page can't be used — a business approver must approve it"
                        onClick={async () => { const why = await askText('Why can’t the customer accept online? (an approver must agree — at least 10 characters)'); if (why) act('ask', () => eag.requestException('MANUAL_ACCEPTANCE', inquiry.id, null, why), 'Asked for approval — see e-Agreements → Exceptions'); }}>
                  <ShieldCheck size={15} /> Ask for manual acceptance</button>)}
          </>
        )}
        {mayAdvance && g.state === 'ELIGIBLE' && (
          <button type="button" className={primary} disabled={!!busy} onClick={() => act('adv', () => eag.requestAdvance(inquiry.id), 'Advance requested — the customer now sees the payment details on their agreement page')}>
            <Wallet size={15} /> Request advance {rs(g.advance)}
          </button>
        )}
        {mayPay && ['ADVANCE_REQUESTED', 'PAYMENT_REPORTED', 'PRIORITY_EXPIRED'].includes(g.state) && ov.requests.length > 0 && (
          <button type="button" className={soft} onClick={() => setModal('receipt')}><Wallet size={15} /> Record money received</button>
        )}
        {g.state === 'PAYMENT_REPORTED' && <Link to="/payment-checks" className={soft}><ShieldCheck size={15} /> Finance: payment checks</Link>}
        {mayBook && g.state === 'PAYMENT_VERIFIED' && (
          <button type="button" className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`} disabled={!!busy} onClick={allocate}><CalendarDays size={15} /> Create the booking</button>
        )}
        {ov.booking_id && g.state === 'CONFIRMED' && <Link to={`/bookings/${ov.booking_id}`} className={soft}><CalendarDays size={15} /> Open the booking</Link>}
        {mayQuote && holdLive && hold?.stage !== 'ALLOCATING' && (
          <button type="button" className={`${soft} !text-navy-500`} onClick={() => { setReason(''); setModal('release'); }}><Undo2 size={15} /> Release priority</button>
        )}
      </div>

      {/* agreement(s) */}
      {ov.agreements.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-navy-400 mb-1.5">e-Agreement</p>
          <ul className="space-y-2">
            {ov.agreements.map((a) => {
              const st = AGREEMENT_STATUS[a.status] ?? { label: a.status, cls: 'bg-navy-100 text-navy-600' };
              return (
                <li key={a.id} className="rounded-xl border border-navy-100 px-3 py-2.5 text-sm">
                  <div className="flex flex-wrap items-center gap-2 justify-between">
                    <p className="font-semibold text-navy-800">{a.reference} <span className="font-normal text-navy-400">· v{a.version} · quotation v{a.quotation_version} · wording v{a.template_version}</span></p>
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>
                  </div>
                  <p className="text-xs text-navy-500 mt-1">
                    Generated by {a.generated_by} · {lk(a.created_at)}{a.sent_at ? ` · sent ${lk(a.sent_at)}` : ''}{a.first_viewed_at ? ` · first viewed ${lk(a.first_viewed_at)}` : ''}
                    {a.decided_at ? ` · ${a.status === 'DECLINED' ? 'declined' : 'decided'} ${lk(a.decided_at)}` : ''} · open until {lk(a.expires_at)} · {a.links} link{a.links === 1 ? '' : 's'}, opened {a.opens}×
                  </p>
                  {a.acceptance && (
                    <p className="text-xs mt-1 text-emerald-800">
                      {a.acceptance.decision === 'ACCEPTED' ? 'Accepted' : 'Declined'} via {a.acceptance.verification_method === 'SMS_OTP_PORTAL_LOGIN' ? 'SMS code to the customer’s number' : `manual acceptance approved by ${a.acceptance.reviewed_by}`}
                      {a.acceptance.decline_reason ? ` — “${a.acceptance.decline_reason}”` : ''}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    <button type="button" className="text-xs font-semibold text-navy-600 hover:underline inline-flex items-center gap-1" onClick={() => { setPreview(a); setModal('preview'); }}><Eye size={12} /> {a.status === 'ACCEPTED' ? 'View accepted agreement' : 'View'}</button>
                    {a.status !== 'DRAFT' && <button type="button" className="text-xs font-semibold text-navy-600 hover:underline inline-flex items-center gap-1" onClick={() => act(`pdf${a.id}`, () => downloadPdf(a.id, a.reference))}><Download size={12} /> PDF</button>}
                    {a.acceptance && <button type="button" className="text-xs font-semibold text-navy-600 hover:underline inline-flex items-center gap-1" onClick={() => { setPreview(a); setModal('evidence'); }}><ShieldCheck size={12} /> Acceptance evidence</button>}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* quotation versions */}
      {ov.quotations.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-navy-400 mb-1.5">Quotation versions</p>
          <ul className="space-y-1">
            {ov.quotations.map((x) => (
              <li key={x.id} className="text-xs text-navy-600 flex flex-wrap gap-x-2">
                <b className="text-navy-800">{x.reference} v{x.version}</b>
                <span>{x.vehicle_label}</span><span>{lk(x.pickup_at)} → {lk(x.return_at)}</span>
                <span>{rs(x.total)} · advance {rs(x.advance_required)}</span>
                <span className="font-semibold">{x.status.toLowerCase()}</span><span>valid until {lk(x.valid_until)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* money */}
      {(ov.requests.length > 0 || ov.receipts.length > 0) && (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-navy-400 mb-1.5">Advance payment</p>
          <ul className="space-y-1 text-xs text-navy-600">
            {ov.requests.map((r) => <li key={r.id}>Requested {rs(r.amount)} by {r.requested_by} · due {lk(r.deadline)} · <b>{r.status.toLowerCase()}</b></li>)}
            {ov.receipts.map((r) => <li key={r.id}>{r.reported_by_customer ? 'Customer reported' : `Recorded by ${r.created_by}`} {rs(r.amount)}{r.bank_reference ? ` (ref ${r.bank_reference})` : ''} · <b>{r.status.toLowerCase()}</b>{r.verified_by ? ` by ${r.verified_by} ${lk(r.verified_at)}` : ''}</li>)}
          </ul>
        </div>
      )}

      {/* timeline */}
      {ov.events.length > 0 && (
        <details>
          <summary className="text-xs font-semibold text-navy-500 cursor-pointer flex items-center gap-1"><History size={13} /> Timeline ({ov.events.length})</summary>
          <ol className="mt-2 space-y-1 border-l-2 border-navy-100 pl-3">
            {ov.events.map((e) => (
              <li key={e.id} className="text-xs text-navy-600">
                <span className="text-navy-400">{lk(e.at)}</span> · <b className="text-navy-800">{EVENT_LABEL[e.event_type] ?? e.event_type}</b>
                {e.actor_type === 'staff' && e.actor_id ? ` · ${e.actor_id}` : e.actor_type === 'customer' ? ' · customer' : ''}
                {typeof e.metadata?.message === 'string' ? <span className="block text-navy-500">“{e.metadata.message}”</span> : null}
                {typeof e.metadata?.reason === 'string' ? <span className="block text-navy-500">{e.metadata.reason}</span> : null}
              </li>
            ))}
          </ol>
        </details>
      )}

      {/* ── modals ── */}
      {modal === 'quote' && <QuoteModal inquiry={inquiry} last={q} vehicles={vehicles} onClose={() => setModal(null)}
        onSave={(body) => act('quote', () => eag.freezeQuotation(inquiry.id, body), 'Quotation version sent (frozen)').then((ok) => { if (ok) setModal(null); })} busy={busy === 'quote'} />}

      <Modal open={modal === 'preview' && !!preview} onClose={() => setModal(null)} title={`${preview?.reference ?? ''} — as the customer sees it`} width="max-w-3xl">
        <div className="eag-doc text-sm leading-relaxed space-y-3 [&_h1]:text-lg [&_h1]:font-bold [&_h2]:font-bold [&_h2]:mt-3 [&_section]:border-t [&_section]:border-navy-100 [&_section]:pt-2"
             dangerouslySetInnerHTML={{ __html: preview?.rendered_html ?? '' }} />
        <p className="text-[11px] text-navy-400 mt-3 break-all">SHA-256 {preview?.document_hash}</p>
      </Modal>

      <Modal open={modal === 'evidence' && !!preview?.acceptance} onClose={() => setModal(null)} title="Acceptance evidence">
        {preview?.acceptance && (
          <dl className="text-sm grid grid-cols-[150px_1fr] gap-x-3 gap-y-1.5">
            <dt className="text-navy-400">Agreement</dt><dd>{preview.reference} v{preview.version}</dd>
            <dt className="text-navy-400">Decision</dt><dd>{preview.acceptance.decision} · {lk(preview.acceptance.decided_at)}</dd>
            <dt className="text-navy-400">Verified by</dt><dd>{preview.acceptance.verification_method === 'SMS_OTP_PORTAL_LOGIN' ? 'One-time SMS code (portal sign-in)' : 'Manual acceptance (approved exception)'}</dd>
            <dt className="text-navy-400">Number</dt><dd>+{preview.acceptance.verified_phone_key}</dd>
            {preview.acceptance.reviewed_by && <><dt className="text-navy-400">Approved by</dt><dd>{preview.acceptance.reviewed_by}</dd></>}
            <dt className="text-navy-400">Statement</dt><dd>{preview.acceptance.statement_version}</dd>
            <dt className="text-navy-400">Document</dt><dd className="break-all text-xs">{preview.acceptance.accepted_document_hash}</dd>
            {preview.pdf_hash && <><dt className="text-navy-400">Stored PDF</dt><dd className="break-all text-xs">{preview.pdf_hash}</dd></>}
            <dt className="text-navy-400">Device</dt><dd className="text-xs">{String(preview.acceptance.evidence?.ip ?? '')} · {String(preview.acceptance.evidence?.user_agent ?? '')}</dd>
          </dl>
        )}
      </Modal>

      <Modal open={modal === 'link' && !!link} onClose={() => setModal(null)} title="The customer's secure link">
        {link && (
          <div className="space-y-3 text-sm">
            <p className="text-navy-600">This link is shown <b>only now</b> — it isn’t stored. Older links for {link.reference} stopped working. Open until {lk(link.expires)}.</p>
            <input className="input font-mono text-xs" readOnly value={link.url} onFocus={(e) => e.target.select()} />
            <div className="flex gap-2">
              <button type="button" className={soft} onClick={() => navigator.clipboard.writeText(link.url).then(() => toast.success('Link copied'))}><Copy size={14} /> Copy</button>
              <a className={soft} href={link.url} target="_blank" rel="noreferrer">Open</a>
            </div>
            <p className="text-xs text-navy-500">At the counter: open it on the <b>customer’s own phone</b>. They confirm with the SMS code sent to their number — staff must never type the code.</p>
          </div>
        )}
      </Modal>

      <ReasonModal open={modal === 'revoke'} title="Revoke the e-Agreement" label="Why? (kept on the record)" value={reason} onChange={setReason}
        busy={busy === 'revoke'} onClose={() => setModal(null)} danger
        onConfirm={() => act('revoke', () => eag.revoke(ag!.id, reason), 'Revoked — its links no longer work').then((ok) => ok && setModal(null))} />
      <ReasonModal open={modal === 'release'} title="Release the priority hold" label="Why? (the car becomes free for others)" value={reason} onChange={setReason}
        busy={busy === 'release'} onClose={() => setModal(null)} danger
        onConfirm={() => act('release', () => eag.releaseHold(inquiry.id, reason), 'Priority released').then((ok) => ok && setModal(null))} />
      <ReasonModal open={modal === 'manual'} title="Record manual acceptance" label="Evidence: who accepted, how, and where the signed copy is kept" value={reason} onChange={setReason}
        busy={busy === 'manual'} onClose={() => setModal(null)}
        onConfirm={() => act('manual', () => eag.manualAcceptance(ag!.id, manualOk!.id, reason), 'Manual acceptance recorded').then((ok) => ok && setModal(null))} />
      {modal === 'receipt' && <ReceiptModal inquiryId={inquiry.id} amount={g.advance ?? 0} onClose={() => setModal(null)} onDone={() => { setModal(null); load(); }} />}
    </div>
  );
}

function ReasonModal({ open, title, label, value, onChange, onClose, onConfirm, busy, danger }: {
  open: boolean; title: string; label: string; value: string; onChange: (v: string) => void; onClose: () => void; onConfirm: () => void; busy: boolean; danger?: boolean;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="space-y-3">
        <label className="block text-sm text-navy-600">{label}
          <textarea className="input mt-1" rows={3} value={value} onChange={(e) => onChange(e.target.value)} autoFocus />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" disabled={busy || value.trim().length < 3} onClick={onConfirm}
                  className={`px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 ${danger ? 'bg-red-600 hover:bg-red-700' : 'bg-navy-800 hover:bg-navy-900'}`}>{busy ? 'Saving…' : 'Confirm'}</button>
        </div>
      </div>
    </Modal>
  );
}

/* ── Send a quotation version (frozen as sent) ── */
/** whole days between the inquiry's dates (at least 1), or undefined when they're missing */
const daysBetween = (from?: string, to?: string) => {
  if (!from || !to) return undefined;
  const d = Math.round((new Date(`${to}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime()) / 86400000);
  return Number.isFinite(d) ? Math.max(1, d) : undefined;
};

function QuoteModal({ inquiry, last, vehicles, onClose, onSave, busy }: {
  inquiry: Inquiry; last?: Quotation; vehicles: ReturnType<typeof useStore.getState>['vehicles']; onClose: () => void;
  onSave: (body: Record<string, unknown>) => void; busy: boolean;
}) {
  const agreed = inquiry.consultation?.agreement;
  const iq = inquiry.quote;
  const lkDate = (iso?: string) => (iso ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Colombo' }).format(new Date(iso)) : '');
  const lkTime = (iso?: string) => (iso ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Colombo', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso)) : '');
  const [f, setF] = useState(() => ({
    vehicle_id: last?.vehicle_id ?? agreed?.vehicleId ?? inquiry.vehicleId ?? '',
    pickup_date: last ? lkDate(last.pickup_at) : agreed?.pickupAt?.slice(0, 10) ?? inquiry.startDate ?? '',
    pickup_time: last ? lkTime(last.pickup_at) : agreed?.pickupAt?.slice(11, 16) ?? '09:00',
    return_date: last ? lkDate(last.return_at) : agreed?.returnAt?.slice(0, 10) ?? inquiry.endDate ?? '',
    return_time: last ? lkTime(last.return_at) : agreed?.returnAt?.slice(11, 16) ?? '09:00',
    pickup_location: last?.pickup_location ?? agreed?.pickupLocation ?? '',
    return_location: last?.return_location ?? agreed?.returnLocation ?? agreed?.pickupLocation ?? '',
    rental_type: last?.rental_type ?? 'Daily',
    rate: String(last?.rate ?? agreed?.dailyRate ?? iq?.dailyRate ?? ''),
    units: String(last?.units ?? agreed?.days ?? iq?.days ?? daysBetween(inquiry.startDate, inquiry.endDate) ?? ''),
    included_km: String(last?.included_km ?? ''),
    extra_km_rate: String(last?.extra_km_rate ?? ''),
    extras: (last?.extras ?? iq?.extras ?? []).map((e) => ({ label: e.label, amount: String(e.amount) })),
    discount: String(last?.discount ?? agreed?.discount ?? iq?.discount ?? 0),
    deposit: String(last?.deposit ?? agreed?.depositAmount ?? iq?.deposit ?? 0),
    specific: '',
    alternatives: '',
  }));
  const v = vehicles.find((x) => x.id === f.vehicle_id);
  useEffect(() => {
    if (!v) return;
    setF((s) => ({
      ...s,
      rate: s.rate || String(v.webPrice ?? v.dailyRent ?? ''),
      included_km: s.included_km || (v.includedKmPerDay && s.units ? String(v.includedKmPerDay * Number(s.units)) : ''),
      extra_km_rate: s.extra_km_rate || (v.extraKmRate ? String(v.extraKmRate) : ''),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.vehicle_id]);
  const num = (x: string) => Number(x) || 0;
  const extrasSum = f.extras.reduce((s, e) => s + num(e.amount), 0);
  const total = Math.max(0, num(f.rate) * num(f.units) + extrasSum - num(f.discount));
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const options = useMemo(() => vehicles.map((x) => ({ value: x.id, label: `${x.brand} ${x.model}${x.vehicleNumber ? ` (${x.vehicleNumber})` : ''}`, sub: `${rs(x.webPrice ?? x.dailyRent)}/day` })), [vehicles]);
  const ok = f.vehicle_id && f.pickup_date && f.return_date && total > 0;
  return (
    <Modal open onClose={onClose} title={last ? `Revised quotation (v${last.version + 1})` : 'Send quotation'} width="max-w-2xl">
      <div className="space-y-3 text-sm">
        <p className="text-xs text-navy-500">The quotation is <b>frozen</b> when sent: a change later is a new version, and any agreement for the old version is replaced. The advance comes from the approved policy.</p>
        <div><p className="label">Vehicle</p><Select value={f.vehicle_id} onChange={(x) => setF({ ...f, vehicle_id: x })} options={options} searchable /></div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <label>Pickup date<input className="input mt-1" type="date" value={f.pickup_date} onChange={set('pickup_date')} /></label>
          <label>Time<input className="input mt-1" type="time" value={f.pickup_time} onChange={set('pickup_time')} /></label>
          <label>Return date<input className="input mt-1" type="date" value={f.return_date} onChange={set('return_date')} /></label>
          <label>Time<input className="input mt-1" type="time" value={f.return_time} onChange={set('return_time')} /></label>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label>Pickup location<input className="input mt-1" value={f.pickup_location} onChange={set('pickup_location')} /></label>
          <label>Return location<input className="input mt-1" value={f.return_location} onChange={set('return_location')} /></label>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <label>Package<select className="input mt-1" value={f.rental_type} onChange={(e) => setF({ ...f, rental_type: e.target.value })}><option>Daily</option><option>Monthly</option><option>Hourly</option></select></label>
          <label>Rate (Rs)<input className="input mt-1" inputMode="numeric" value={f.rate} onChange={set('rate')} /></label>
          <label>{f.rental_type === 'Daily' ? 'Days' : f.rental_type === 'Monthly' ? 'Months' : 'Hours'}<input className="input mt-1" inputMode="numeric" value={f.units} onChange={set('units')} /></label>
          <label>Discount (Rs)<input className="input mt-1" inputMode="numeric" value={f.discount} onChange={set('discount')} /></label>
          <label>Included km<input className="input mt-1" inputMode="numeric" value={f.included_km} onChange={set('included_km')} /></label>
          <label>Extra km (Rs/km)<input className="input mt-1" inputMode="numeric" value={f.extra_km_rate} onChange={set('extra_km_rate')} /></label>
          <label>Security deposit (Rs)<input className="input mt-1" inputMode="numeric" value={f.deposit} onChange={set('deposit')} /></label>
        </div>
        <div>
          <p className="label">Extras</p>
          {f.extras.map((e, i) => (
            <div key={i} className="flex gap-2 mb-1">
              <input className="input" value={e.label} placeholder="e.g. Child seat" onChange={(ev) => setF({ ...f, extras: f.extras.map((x, j) => (j === i ? { ...x, label: ev.target.value } : x)) })} />
              <input className="input !w-32" inputMode="numeric" value={e.amount} onChange={(ev) => setF({ ...f, extras: f.extras.map((x, j) => (j === i ? { ...x, amount: ev.target.value } : x)) })} />
              <button type="button" className="text-red-600 text-xs" onClick={() => setF({ ...f, extras: f.extras.filter((_, j) => j !== i) })}>Remove</button>
            </div>
          ))}
          <button type="button" className="text-xs font-semibold text-brand-500" onClick={() => setF({ ...f, extras: [...f.extras, { label: '', amount: '' }] })}>+ Add an extra</button>
        </div>
        <label className="block">Vehicle-specific conditions (shown in the agreement)<textarea className="input mt-1" rows={2} value={f.specific} onChange={set('specific')} placeholder="e.g. no off-road use; max 7 passengers" /></label>
        <label className="block">Allowed alternatives / substitution<input className="input mt-1" value={f.alternatives} onChange={set('alternatives')} placeholder="e.g. a same-class car only with the customer's agreement" /></label>
        <div className="rounded-xl bg-navy-50 px-3 py-2 flex justify-between font-semibold"><span>Total</span><span>{rs(total)}</span></div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="px-4 py-2 rounded-xl text-sm font-semibold bg-brand-500 text-white disabled:opacity-50" disabled={!ok || busy}
            onClick={() => onSave({
              vehicle_id: f.vehicle_id, pickup_date: f.pickup_date, pickup_time: f.pickup_time, return_date: f.return_date, return_time: f.return_time,
              pickup_location: f.pickup_location, return_location: f.return_location, rental_type: f.rental_type, rate: num(f.rate), units: num(f.units),
              included_km: f.included_km ? num(f.included_km) : null, extra_km_rate: f.extra_km_rate ? num(f.extra_km_rate) : null,
              extras: f.extras.filter((e) => e.label.trim() && num(e.amount)).map((e) => ({ label: e.label.trim(), amount: num(e.amount) })),
              discount: num(f.discount), total, deposit: num(f.deposit),
              conditions: f.specific.trim() ? { specific: f.specific.trim() } : {}, alternatives: f.alternatives.trim() || null,
            })}>{busy ? 'Sending…' : 'Freeze and send'}</button>
        </div>
      </div>
    </Modal>
  );
}

/* ── Money that arrived (Finance verifies it separately) ── */
function ReceiptModal({ inquiryId, amount, onClose, onDone }: { inquiryId: string; amount: number; onClose: () => void; onDone: () => void }) {
  const [accounts, setAccounts] = useState<{ id: string; name: string }[]>([]);
  const [f, setF] = useState({ amount: String(amount || ''), account: '', reference: '', at: new Date().toISOString().slice(0, 16), note: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => { eag.accounts().then(setAccounts).catch((e) => toast.error('Accounts', eagError(e).message)); }, []);
  const save = async () => {
    setBusy(true);
    try { await eag.recordReceipt(inquiryId, Number(f.amount), f.account, f.reference, new Date(f.at).toISOString(), f.note); toast.success('Recorded', 'Finance will verify it before the booking can be made.'); onDone(); }
    catch (e) { toast.error('Not recorded', eagError(e).message); }
    finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="Record money received">
      <div className="space-y-3 text-sm">
        <p className="text-xs text-navy-500 flex gap-1.5"><AlertTriangle size={14} className="flex-shrink-0 mt-0.5" /> This only records it. Finance checks it against the bank / cash box — a screenshot is not proof — and someone other than you must verify it.</p>
        <label className="block">Amount (Rs)<input className="input mt-1" inputMode="numeric" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></label>
        <div><p className="label">Into which account</p><Select value={f.account} onChange={(x) => setF({ ...f, account: x })} options={accounts.map((a) => ({ value: a.id, label: a.name }))} placeholder="Choose the account" /></div>
        <label className="block">Bank / receipt reference<input className="input mt-1" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></label>
        <label className="block">When it arrived<input className="input mt-1" type="datetime-local" value={f.at} onChange={(e) => setF({ ...f, at: e.target.value })} /></label>
        <label className="block">Note<input className="input mt-1" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></label>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="px-4 py-2 rounded-xl text-sm font-semibold bg-navy-800 text-white disabled:opacity-50" disabled={busy || !(Number(f.amount) > 0) || !f.account} onClick={save}>{busy ? 'Saving…' : 'Record'}</button>
        </div>
      </div>
    </Modal>
  );
}
