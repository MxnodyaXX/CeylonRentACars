import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle, ClipboardCheck, Copy, ExternalLink, FileText, Flag, Inbox, Mail, MessageCircle, MessageSquare, Phone, PhoneCall, Printer, RefreshCw, Send, Upload, XCircle } from 'lucide-react';
import Header from '../components/layout/Header';
import Modal from '../components/ui/Modal';
import { supabaseEnabled } from '../lib/supabase';
import { useAuthStore } from '../store/useAuthStore';
import { toast } from '../store/useToast';
import {
  approveApplication, DOC_LABELS, fileUrl, uploadForApplication, loadApplications, localPhone, partnerSms, updateApplication, type ApproveResult,
} from '../lib/partnerApplications';
import { printPartnerAgreement } from '../lib/printPartnerAgreement';
import { flagged, missingForApproval, type Missing } from '../lib/partnerVerification';
import OwnerCall from '../components/partners/OwnerCall';
import type { InspectionMethod, PartnerApplication, PartnerAppStatus, PartnerInspection } from '../types';

/* Vehicle owners who applied on the website ("List your vehicle"): review, inspect, agree the
   price, then approve (creates the owner, the vehicle and their login) or decline. */

const TONE: Record<PartnerAppStatus, string> = {
  Pending: 'bg-blue-50 text-blue-700', 'Under review': 'bg-violet-50 text-violet-700', 'Needs info': 'bg-amber-50 text-amber-700',
  Approved: 'bg-emerald-50 text-emerald-700', Rejected: 'bg-red-50 text-red-700', Withdrawn: 'bg-navy-50 text-navy-500',
};
const TABS: { id: string; label: string; match: PartnerAppStatus[] }[] = [
  { id: 'open', label: 'To review', match: ['Pending', 'Under review'] },
  { id: 'info', label: 'Waiting for applicant', match: ['Needs info'] },
  { id: 'approved', label: 'Approved', match: ['Approved'] },
  { id: 'closed', label: 'Declined', match: ['Rejected', 'Withdrawn'] },
];
const METHODS: InspectionMethod[] = ['Physical', 'Video call', 'Photos & documents', 'Other'];

const rs = (n?: number) => (n ? `Rs ${Math.round(n).toLocaleString('en-LK')}` : '—');
const asked = (a: PartnerApplication) => [a.askingDaily && `${rs(a.askingDaily)}/day`, a.askingMonthly && `${rs(a.askingMonthly)}/month`].filter(Boolean).join(' · ') || '—';
const when = (d: string) => new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

function Badge({ status }: { status: PartnerAppStatus }) {
  return <span className={`badge ${TONE[status]}`}>{status}</span>;
}

function KV({ k, v }: { k: string; v?: string | number }) {
  return <div><p className="text-[11px] text-navy-400">{k}</p><p className="text-sm text-navy-800 break-words">{v ?? '—'}</p></div>;
}

/* Private files open through short-lived links */
function Photos({ paths, onAdd, busy }: { paths: string[]; onAdd?: (files: File[]) => void; busy?: boolean }) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    let live = true;
    Promise.all(paths.map(async (p) => [p, await fileUrl(p)] as const))
      .then((l) => live && setUrls(Object.fromEntries(l.filter(([, u]) => u) as [string, string][])));
    return () => { live = false; };
  }, [paths]);
  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
      {paths.map((p) => (
        <a key={p} href={urls[p]} target="_blank" rel="noreferrer" className="block aspect-[4/3] rounded-lg overflow-hidden bg-navy-50">
          {urls[p] && (/\.pdf$/i.test(p)
            ? <span className="flex h-full items-center justify-center text-xs text-navy-500"><FileText size={16} /> PDF</span>
            : <img src={urls[p]} alt="" className="w-full h-full object-cover" />)}
        </a>
      ))}
      {onAdd && (
        <label className={`aspect-[4/3] rounded-lg border border-dashed border-navy-200 flex flex-col items-center justify-center gap-1 text-[11px] text-navy-400 ${busy ? 'opacity-50' : 'cursor-pointer hover:bg-navy-50'}`}>
          <Upload size={15} /> {busy ? 'Uploading…' : 'Add photos'}
          <input type="file" accept="image/*" multiple className="hidden" disabled={busy} onChange={(e) => { onAdd(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
        </label>
      )}
      {!paths.length && !onAdd && <p className="text-sm text-navy-400 col-span-full">No photos.</p>}
    </div>
  );
}

function Docs({ docs, onAdd, busy }: { docs: PartnerApplication['documents']; onAdd?: (kind: keyof typeof DOC_LABELS, file: File) => void; busy?: boolean }) {
  const open = async (path: string) => {
    const u = await fileUrl(path);
    if (u) window.open(u, '_blank', 'noopener'); else toast.error('File not opened', 'Check that 13_partner_applications.sql has been run.');
  };
  return (
    <div className="grid sm:grid-cols-2 gap-2">
      {(Object.keys(DOC_LABELS) as (keyof typeof DOC_LABELS)[]).map((k) => (
        docs[k]
          ? <button key={k} type="button" onClick={() => open(docs[k]!)} className="flex items-center gap-2 rounded-lg border border-navy-100 px-3 py-2 text-sm text-navy-700 hover:bg-navy-50 text-left">
              <FileText size={15} className="text-emerald-600 flex-shrink-0" /> {DOC_LABELS[k]} <ExternalLink size={12} className="ml-auto text-navy-300" /></button>
          : <label key={k} className={`flex items-center gap-2 rounded-lg border border-dashed border-red-200 bg-red-50/40 px-3 py-2 text-sm text-red-700 ${onAdd && !busy ? 'cursor-pointer hover:bg-red-50' : ''}`}>
              <FileText size={15} className="flex-shrink-0" /> <span className="flex-1">{DOC_LABELS[k]} — not sent</span>
              {onAdd && <><Upload size={13} className="text-red-400" /><input type="file" accept="image/*,application/pdf" className="hidden" disabled={busy}
                onChange={(e) => { const file = e.target.files?.[0]; if (file) onAdd(k, file); e.target.value = ''; }} /></>}
            </label>
      ))}
    </div>
  );
}

function Detail({ app, onChange, onClose }: { app: PartnerApplication; onChange: (a: PartnerApplication) => void; onClose: () => void }) {
  const by = useAuthStore((s) => s.currentUser?.name ?? 'Admin');
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState(app.reviewNotes ?? '');
  const [insp, setInsp] = useState<PartnerInspection>(app.inspection ?? { method: 'Physical', status: 'Planned' });
  const [action, setAction] = useState<'' | 'info' | 'reject' | 'approve'>('');
  const [ask, setAsk] = useState('');
  const [reason, setReason] = useState('');
  const [notify, setNotify] = useState(true);
  const [daily, setDaily] = useState(String(app.agreedDaily ?? app.askingDaily ?? ''));
  const [monthly, setMonthly] = useState(String(app.agreedMonthly ?? app.askingMonthly ?? ''));
  const [commission, setCommission] = useState(String(app.commissionRate ?? ''));
  const [createLogin, setCreateLogin] = useState(true);
  const [result, setResult] = useState<ApproveResult | null>(null);
  const [callOpen, setCallOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const missing = missingForApproval(app);
  const blockers = missing.filter((m) => m.critical);
  const flags = flagged(app.verification);
  const open = !['Approved', 'Rejected', 'Withdrawn'].includes(app.status);

  const run = async (fn: () => Promise<PartnerApplication>, done: string) => {
    setBusy(true);
    try { onChange(await fn()); toast.success(done); setAction(''); }
    catch (e) { toast.error('Not saved', (e as Error).message); }
    finally { setBusy(false); }
  };

  const saveNotes = () => run(() => updateApplication(app, { review_notes: notes.trim() || null }, by), 'Notes saved');
  const saveInspection = () => run(() => updateApplication(app, { inspection: { ...insp, by }, ...(app.status === 'Pending' ? { status: 'Under review' as const } : {}) }, by,
    `Inspection ${insp.status === 'Done' ? `done (${insp.method}${insp.result ? `: ${insp.result}` : ''})` : `planned (${insp.method}${insp.date ? `, ${insp.date}` : ''})`}${insp.notes ? ` — ${insp.notes}` : ''}`), 'Inspection saved');
  const startReview = () => run(() => updateApplication(app, { status: 'Under review' }, by, 'Review started'), 'Marked under review');
  const askInfo = () => {
    if (ask.trim().length < 3) return toast.error('Say what you need from the applicant');
    run(async () => {
      const a = await updateApplication(app, { status: 'Needs info', info_request: ask.trim() }, by, `Asked the applicant: ${ask.trim()}`);
      if (notify) partnerSms.needsInfo(a, ask.trim());
      return a;
    }, 'Sent to the applicant');
  };
  const reject = () => {
    if (reason.trim().length < 3) return toast.error('Give a reason (the applicant sees it)');
    run(async () => {
      const a = await updateApplication(app, { status: 'Rejected', decision_reason: reason.trim(), decided_by: by, decided_at: new Date().toISOString() }, by, `Declined: ${reason.trim()}`);
      if (notify) partnerSms.rejected(a);
      return a;
    }, 'Application declined');
  };
  const approve = async () => {
    const d = Number(daily), m = Number(monthly) || undefined, c = Number(commission);
    if (!(d > 0)) return toast.error('Enter the agreed price per day');
    if (commission.trim() === '' || !(c >= 0 && c <= 100)) return toast.error('Enter the commission % (0–100)');
    setBusy(true);
    try {
      const r = await approveApplication(app, { agreedDaily: d, agreedMonthly: m, commissionRate: c, createLogin, notify }, by);
      onChange(r.app); setResult(r); setAction('');
      toast.success('Approved', `${app.vehicleNumber} is in the fleet. Set it up on the Website page to list it.`);
    } catch (e) { toast.error('Not approved', (e as Error).message); }
    finally { setBusy(false); }
  };

  // files the owner sent on WhatsApp / email: staff add them here
  const addDoc = async (kind: keyof typeof DOC_LABELS, file: File) => {
    setUploading(true);
    try {
      const path = await uploadForApplication(app, file, kind);
      onChange(await updateApplication(app, { documents: { ...app.documents, [kind]: path } }, by, `${DOC_LABELS[kind]} added by staff`));
      toast.success(`${DOC_LABELS[kind]} added`);
    } catch (e) { toast.error('Not uploaded', (e as Error).message); }
    finally { setUploading(false); }
  };
  const addPhotos = async (files: File[]) => {
    if (!files.length) return;
    setUploading(true);
    try {
      const paths: string[] = [];
      for (const [i, file] of files.entries()) paths.push(await uploadForApplication(app, file, `photo${app.photos.length + i + 1}`));
      onChange(await updateApplication(app, { photos: [...app.photos, ...paths] }, by, `${paths.length} photo(s) added by staff`));
    } catch (e) { toast.error('Not uploaded', (e as Error).message); }
    finally { setUploading(false); }
  };
  const jump = (m: Missing) => {
    if (m.where === 'call') setCallOpen(true);
    else document.getElementById(`pa-${m.where === 'photos' ? 'docs' : m.where}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  const copyPhone = async () => {
    try { await navigator.clipboard.writeText(localPhone(app.phone)); toast.success('Number copied'); } catch { prompt('Copy:', localPhone(app.phone)); }
  };
  const wa = `https://wa.me/${app.phone}?text=${encodeURIComponent(`Hi ${app.name.split(' ')[0]}, this is Ceylon Rent A Cars about your vehicle ${app.vehicleNumber} (${app.id}).`)}`;
  const v = app.verification;
  return (
    <>
    <Modal open onClose={onClose} title={`${app.name} — ${app.brand} ${app.model} (${app.vehicleNumber})`} width="max-w-5xl" maxHeight="max-h-[94vh]"
           headerActions={<button type="button" onClick={() => printPartnerAgreement(app, by) || toast.error('Allow pop-ups to print')} className="btn-secondary !py-1.5 text-xs flex items-center gap-1"><Printer size={13} /> Agreement</button>}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge status={app.status} />
          <span className="text-navy-400">{app.id} · sent {when(app.createdAt)}</span>
          <div className="flex flex-wrap gap-1.5 ml-auto">
            <a href={`tel:+${app.phone}`} className="btn-secondary !py-1 !px-2.5 text-xs flex items-center gap-1"><Phone size={13} /> Call {localPhone(app.phone)}</a>
            <a href={wa} target="_blank" rel="noreferrer" className="btn-secondary !py-1 !px-2.5 text-xs flex items-center gap-1"><MessageCircle size={13} /> WhatsApp</a>
            <a href={`sms:+${app.phone}`} className="btn-secondary !py-1 !px-2.5 text-xs flex items-center gap-1"><MessageSquare size={13} /> SMS</a>
            {app.email && <a href={`mailto:${app.email}?subject=${encodeURIComponent(`Your vehicle ${app.vehicleNumber} — Ceylon Rent A Cars`)}`} className="btn-secondary !py-1 !px-2.5 text-xs flex items-center gap-1"><Mail size={13} /> Email</a>}
            <button type="button" onClick={copyPhone} className="btn-secondary !py-1 !px-2.5 text-xs flex items-center gap-1" aria-label="Copy number" title="Copy number"><Copy size={13} /></button>
          </div>
        </div>

        {/* what still stops approval — like the "To complete" list on bookings */}
        {missing.length > 0 && (
          <div className={`rounded-xl border px-3 py-2.5 ${blockers.length ? 'border-red-200 bg-red-50/70' : 'border-amber-200 bg-amber-50/70'}`}>
            <p className={`text-xs font-bold flex items-center gap-1.5 mb-1.5 ${blockers.length ? 'text-red-700' : 'text-amber-800'}`}>
              <AlertTriangle size={13} /> To complete before approval ({missing.length}){blockers.length ? ` — ${blockers.length} must be done first` : ''}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {missing.map((m) => (
                <button key={m.label} type="button" onClick={() => jump(m)}
                        className={`rounded-full px-2.5 py-1 text-[11px] font-semibold bg-white ring-1 ring-inset ${m.critical ? 'text-red-700 ring-red-200 hover:bg-red-100' : 'text-amber-800 ring-amber-200 hover:bg-amber-100'}`}>{m.label} →</button>
              ))}
            </div>
          </div>
        )}

        {/* the owner check call */}
        {(open || v) && (
          <section className={`card !p-4 flex flex-wrap items-center gap-3 ${v?.finishedAt ? (v.verdict?.startsWith('Not') ? '!border-red-200' : flags.length ? '!border-amber-200' : '!border-emerald-200') : '!border-brand-200'}`}>
            <span className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${v?.finishedAt ? 'bg-emerald-50 text-emerald-600' : 'bg-brand-50 text-brand-500'}`}><PhoneCall size={18} /></span>
            <div className="min-w-0 flex-1">
              <p className="section-title">Owner check call</p>
              <p className="text-xs text-navy-500">
                {v?.finishedAt ? <>{v.verdict} · {when(v.finishedAt)} · {v.finishedBy}{flags.length > 0 && <span className="text-red-600 font-semibold"> · <Flag size={11} className="inline" /> {flags.length} warning sign{flags.length === 1 ? '' : 's'}</span>}</>
                  : v?.startedAt ? <>Started {when(v.startedAt)} by {v.startedBy} — not finished</>
                  : v?.attempts.length ? <>{v.attempts.length} call attempt{v.attempts.length === 1 ? '' : 's'}, last: {v.attempts[v.attempts.length - 1].result.toLowerCase()}</>
                  : <>Call the owner and go through the questions before approving — we become responsible for the car and our customers.</>}
              </p>
              {v?.summary && <p className="text-sm text-navy-700 mt-1">“{v.summary}”</p>}
            </div>
            <button type="button" className={v?.finishedAt ? 'btn-secondary text-sm' : 'btn-primary text-sm flex items-center gap-1.5'} onClick={() => setCallOpen(true)}>
              {v?.finishedAt ? 'View answers' : v?.startedAt ? 'Continue the call' : <><PhoneCall size={14} /> Start</>}
            </button>
          </section>
        )}

        {result && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 space-y-1">
            <p className="font-semibold flex items-center gap-1.5"><CheckCircle size={16} /> Approved — {result.newOwner ? 'new owner added' : 'added to the existing owner'}, vehicle added to the fleet.</p>
            {result.login && <p>Owner login: <b>{result.login.username}</b> · temporary password <b className="font-mono">{result.login.password}</b> — shown only now{notify ? ' (also sent by SMS)' : ''}. They change it at first sign-in.</p>}
            <p>Next: add the vehicle's images and insurance on the Vehicles page, then list it on the Website page.</p>
          </div>
        )}
        {app.applicantReply && app.status === 'Pending' && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><b>Applicant replied:</b> {app.applicantReply}</div>
        )}

        <div className="grid lg:grid-cols-2 gap-4">
          <section className="card !p-4 space-y-3">
            <p className="section-title">Applicant</p>
            <div className="grid grid-cols-2 gap-3">
              <KV k="Name" v={app.name} /><KV k="NIC" v={app.nic} />
              <KV k="Email" v={app.email} /><KV k="Address" v={[app.address, app.city].filter(Boolean).join(', ')} />
            </div>
            <p className="section-title pt-1">Vehicle</p>
            <div className="grid grid-cols-2 gap-3">
              <KV k="Number" v={app.vehicleNumber} /><KV k="Make / model / year" v={`${app.brand} ${app.model}${app.year ? ` · ${app.year}` : ''}`} />
              <KV k="Category" v={app.category} /><KV k="Seats" v={app.seats} />
              <KV k="Transmission / fuel" v={[app.transmission, app.fuelType].filter(Boolean).join(' · ')} /><KV k="Colour" v={app.color} />
              <KV k="Mileage" v={app.mileage ? `${app.mileage.toLocaleString()} km` : undefined} /><KV k="Available from" v={app.availableFrom} />
            </div>
            <p className="section-title pt-1">Asking price</p>
            <p className="text-lg font-semibold text-navy-800">{asked(app)}</p>
            {app.priceNotes && <p className="text-sm text-navy-600">“{app.priceNotes}”</p>}
            {app.status === 'Approved' && <p className="text-sm text-emerald-700">Agreed: {rs(app.agreedDaily)}/day{app.agreedMonthly ? ` · ${rs(app.agreedMonthly)}/month` : ''} · commission {app.commissionRate}%</p>}
          </section>

          <section className="card !p-4 space-y-3">
            <p className="section-title">Photos</p>
            <Photos paths={app.photos} onAdd={open ? addPhotos : undefined} busy={uploading} />
            <p className="section-title pt-1" id="pa-docs">Documents {open && <span className="text-xs font-normal text-navy-400">— got one on WhatsApp? Click it to upload</span>}</p>
            <Docs docs={app.documents} onAdd={open ? addDoc : undefined} busy={uploading} />
            <p className="section-title pt-1">Signed agreement</p>
            <div className="flex items-center gap-3">
              {app.agreement?.signature && <img src={app.agreement.signature} alt="Signature" className="h-14 rounded-lg border border-navy-100 bg-white px-2" />}
              <p className="text-xs text-navy-500">{app.agreement?.name} · {app.agreement?.acceptedAt ? when(app.agreement.acceptedAt) : '—'} · {app.agreement?.version}</p>
            </div>
          </section>
        </div>

        <div className="grid lg:grid-cols-2 gap-4">
          <section className="card !p-4 space-y-2">
            <p className="section-title flex items-center gap-1.5" id="pa-inspection"><ClipboardCheck size={16} /> Inspection</p>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-navy-500">Method
                <select className="input mt-1" value={insp.method} onChange={(e) => setInsp({ ...insp, method: e.target.value as InspectionMethod })} disabled={!open}>
                  {METHODS.map((m) => <option key={m}>{m}</option>)}</select></label>
              <label className="text-xs text-navy-500">Date
                <input type="date" className="input mt-1" value={insp.date ?? ''} onChange={(e) => setInsp({ ...insp, date: e.target.value || undefined })} disabled={!open} /></label>
              <label className="text-xs text-navy-500">Stage
                <select className="input mt-1" value={insp.status} onChange={(e) => setInsp({ ...insp, status: e.target.value as PartnerInspection['status'] })} disabled={!open}>
                  <option>Planned</option><option>Done</option></select></label>
              <label className="text-xs text-navy-500">Result
                <select className="input mt-1" value={insp.result ?? ''} onChange={(e) => setInsp({ ...insp, result: (e.target.value || undefined) as PartnerInspection['result'] })} disabled={!open || insp.status !== 'Done'}>
                  <option value="">—</option><option>Passed</option><option>Needs work</option><option>Failed</option></select></label>
            </div>
            <textarea className="input min-h-[60px]" value={insp.notes ?? ''} onChange={(e) => setInsp({ ...insp, notes: e.target.value })} disabled={!open} placeholder="What was checked, condition, anything to fix" />
            {open && <button type="button" className="btn-secondary !py-1.5 text-xs" disabled={busy} onClick={saveInspection}>Save inspection</button>}
          </section>
          <section className="card !p-4 space-y-2">
            <p className="section-title">Review notes <span className="text-xs font-normal text-navy-400">(staff only — price talks, calls…)</span></p>
            <textarea className="input min-h-[120px]" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Called 3 Nov — asks Rs 9,000/day, agreed Rs 8,000 with 20% commission" />
            <button type="button" className="btn-secondary !py-1.5 text-xs" disabled={busy || notes === (app.reviewNotes ?? '')} onClick={saveNotes}>Save notes</button>
          </section>
        </div>

        {open && (
          <section className="card !p-4 space-y-3">
            <div className="flex flex-wrap gap-2">
              {app.status === 'Pending' && <button type="button" className="btn-secondary text-sm" disabled={busy} onClick={startReview}>Start review</button>}
              <button type="button" className={`btn-secondary text-sm flex items-center gap-1 ${action === 'info' ? '!border-amber-400' : ''}`} onClick={() => setAction(action === 'info' ? '' : 'info')}><Send size={14} /> Ask for more info</button>
              <button type="button" className={`btn-danger text-sm flex items-center gap-1 ${action === 'reject' ? 'ring-2 ring-red-200' : ''}`} onClick={() => setAction(action === 'reject' ? '' : 'reject')}><XCircle size={14} /> Decline</button>
              <button type="button" className="btn-primary text-sm flex items-center gap-1 ml-auto disabled:opacity-40 disabled:cursor-not-allowed" disabled={blockers.length > 0}
                      title={blockers.length ? `First: ${blockers.map((m) => m.label).join(', ')}` : undefined}
                      onClick={() => setAction(action === 'approve' ? '' : 'approve')}><CheckCircle size={14} /> Approve</button>
            </div>
            {action === 'info' && (
              <div className="space-y-2">
                <textarea className="input min-h-[70px]" value={ask} onChange={(e) => setAsk(e.target.value)} placeholder="e.g. A clear photo of the insurance certificate and the interior" />
                <p className="text-[11px] text-navy-400">The applicant sees this on the website and can reply there with files.</p>
                <button type="button" className="btn-dark text-sm" disabled={busy} onClick={askInfo}>Send request</button>
              </div>
            )}
            {action === 'reject' && (
              <div className="space-y-2">
                <textarea className="input min-h-[70px]" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. We only list vehicles from 2012 or newer" />
                <p className="text-[11px] text-navy-400">Shown to the applicant on the website.</p>
                <button type="button" className="btn-danger text-sm" disabled={busy} onClick={reject}>Decline application</button>
              </div>
            )}
            {action === 'approve' && (
              <div className="space-y-3">
                <div className="grid sm:grid-cols-3 gap-3">
                  <label className="text-xs text-navy-500">Agreed price per day (Rs) *<input className="input mt-1" inputMode="numeric" value={daily} onChange={(e) => setDaily(e.target.value.replace(/\D/g, ''))} /></label>
                  <label className="text-xs text-navy-500">Agreed price per month (Rs)<input className="input mt-1" inputMode="numeric" value={monthly} onChange={(e) => setMonthly(e.target.value.replace(/\D/g, ''))} /></label>
                  <label className="text-xs text-navy-500">Commission (%) *<input className="input mt-1" inputMode="decimal" value={commission} onChange={(e) => setCommission(e.target.value.replace(/[^\d.]/g, ''))} /></label>
                </div>
                <label className="flex items-center gap-2 text-sm text-navy-700"><input type="checkbox" checked={createLogin} onChange={(e) => setCreateLogin(e.target.checked)} /> Create their owner login (new owners only)</label>
                <p className="text-xs text-navy-500">Adds the owner (or uses the existing owner with this phone) and the vehicle. It is <b>not on the website</b> until you list it on the Website page.</p>
                <button type="button" className="btn-primary text-sm" disabled={busy} onClick={approve}>{busy ? 'Approving…' : 'Approve and add to the fleet'}</button>
              </div>
            )}
            {action && <label className="flex items-center gap-2 text-sm text-navy-700"><input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Text the applicant (SMS)</label>}
          </section>
        )}

        <section className="card !p-4">
          <p className="section-title mb-2">History</p>
          <ul className="space-y-1.5">
            {[...app.history].reverse().map((h, i) => (
              <li key={i} className="text-sm text-navy-600"><span className="text-xs text-navy-400">{when(h.at)} · {h.by}</span><br />{h.text}</li>
            ))}
          </ul>
        </section>
      </div>
    </Modal>
    {/* outside the application window: inside it, the window's opening animation would trap the call window */}
    {callOpen && <OwnerCall app={app} by={by} onChange={onChange} onClose={() => setCallOpen(false)} />}
    </>
  );
}

export default function PartnerApplications() {
  const [apps, setApps] = useState<PartnerApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [tab, setTab] = useState('open');
  const [openId, setOpenId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try { setApps(await loadApplications()); setMissing(false); }
    catch (e) {
      const msg = (e as Error).message;
      if (/partner_applications/.test(msg)) setMissing(true); else toast.error('Could not load applications', msg);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const counts = useMemo(() => Object.fromEntries(TABS.map((t) => [t.id, apps.filter((a) => t.match.includes(a.status)).length])), [apps]);
  const list = apps.filter((a) => TABS.find((t) => t.id === tab)!.match.includes(a.status));
  const current = apps.find((a) => a.id === openId);

  return (
    <div>
      <Header title="Partner applications" subtitle="Vehicle owners who applied on the website to list their vehicles" />
      {!supabaseEnabled && <div className="card !p-4 mb-4 border border-amber-200 bg-amber-50 text-sm text-amber-800">Applications need Supabase to be connected.</div>}
      {missing && (
        <div className="card !p-4 mb-4 border border-amber-200 bg-amber-50 text-sm text-amber-800 flex gap-2">
          <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
          <span>Run <code className="mx-1">admin/supabase/security/13_partner_applications.sql</code> in the Supabase SQL Editor to turn on partner applications.</span>
        </div>
      )}

      <div className="flex gap-2 mb-4 overflow-x-auto no-scrollbar">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
                  className={`px-4 py-2 rounded-xl text-sm font-semibold whitespace-nowrap transition-colors ${tab === t.id ? 'bg-navy-700 text-white' : 'bg-white text-navy-500 border border-navy-100 hover:bg-navy-50'}`}>
            {t.label} ({counts[t.id] ?? 0})
          </button>
        ))}
        <button onClick={load} className="btn-secondary !px-3 ml-auto flex items-center gap-1 text-sm" aria-label="Refresh"><RefreshCw size={14} /></button>
      </div>

      {loading ? <div className="card text-sm text-navy-400">Loading applications…</div> : list.length === 0 ? (
        <div className="card text-center py-10 text-sm text-navy-400 flex flex-col items-center gap-2"><Inbox size={22} />
          {tab === 'open' ? 'No applications to review. The form is at ceylonrentacars.com/list-your-vehicle.' : 'Nothing here.'}</div>
      ) : (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
          {list.map((a) => (
            <button key={a.id} type="button" onClick={() => setOpenId(a.id)} className="card !p-4 text-left hover:border-navy-300 transition-colors flex flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-navy-800 truncate">{a.brand} {a.model}{a.year ? ` (${a.year})` : ''}</p>
                  <p className="text-xs text-navy-400 truncate">{a.vehicleNumber} · {a.name} · {localPhone(a.phone)}</p>
                </div>
                <Badge status={a.status} />
              </div>
              <p className="text-sm text-navy-700">Asks {asked(a)}</p>
              <p className="text-xs text-navy-400 mt-auto">{a.id} · {when(a.createdAt)}{a.inspection ? ` · inspection ${a.inspection.status.toLowerCase()}` : ''}{a.applicantReply && a.status === 'Pending' ? ' · replied' : ''}</p>
            </button>
          ))}
        </div>
      )}

      {current && <Detail app={current} onClose={() => setOpenId(null)} onChange={(a) => setApps((l) => l.map((x) => (x.id === a.id ? a : x)))} />}
    </div>
  );
}
