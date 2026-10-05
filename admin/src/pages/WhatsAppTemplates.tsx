import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Plus, RefreshCw, Trash2, Loader2, CheckCircle2, Clock, XCircle, Sparkles, Info } from 'lucide-react';
import Header from '../components/layout/Header';
import { toast } from '../store/useToast';
import { AUTO_VARS, WaTemplate, createTemplate, deleteTemplate, loadTemplates, varsIn, whatsappDemo } from '../lib/whatsappInbox';

/** Ready-made car-rental templates (Utility = cheapest, approved fastest) */
const STARTERS: { title: string; name: string; body: string }[] = [
  { title: 'Booking confirmed', name: 'booking_confirmed',
    body: 'Dear {{name}}, your booking {{reference}} for the {{vehicle}} ({{dates}}) is confirmed. Thank you for choosing Ceylon Rent A Cars. Reply to this message if you have any questions.' },
  { title: 'Pickup reminder', name: 'pickup_reminder',
    body: 'Dear {{name}}, this is a reminder that your {{vehicle}} will be ready for pickup on {{pickup_time}} at {{pickup_location}} (booking {{reference}}). Reply to this message if anything changes.' },
  { title: 'Return reminder', name: 'return_reminder',
    body: 'Dear {{name}}, a reminder that the {{vehicle}} (booking {{reference}}) is due back on {{return_time}}. Reply to this message if you would like to extend your rental.' },
  { title: 'Payment received', name: 'payment_received',
    body: 'Dear {{name}}, we have received your payment of {{amount}} for booking {{reference}}. Thank you for choosing Ceylon Rent A Cars.' },
  { title: 'Alternative vehicles', name: 'vehicle_alternatives',
    body: 'Dear {{name}}, the {{vehicle}} is not available for {{dates}}. Please see the vehicles we can offer instead for request {{reference}} here: {{link}} and reply to this message with any questions.' },
  { title: 'Feedback request', name: 'feedback_request',
    body: 'Dear {{name}}, thank you for renting the {{vehicle}} with Ceylon Rent A Cars (booking {{reference}}). Please share your feedback here: {{link}} and reply to this message if you need anything.' },
];

const SAMPLES: Record<string, string> = {
  name: 'Manodya', vehicle: 'Toyota Raize', dates: '8 Oct 2026 - 9 Oct 2026', reference: 'CRC-5D453B',
  pickup_time: '8 Oct, 9:00 AM', pickup_location: 'Bandaranaike Airport', return_time: '9 Oct, 6:00 PM',
  amount: 'LKR 25,000', link: 'https://ceylon-rent-a-cars.vercel.app',
};

const STATUS: Record<string, { cls: string; icon: JSX.Element; label: string }> = {
  APPROVED: { cls: 'bg-emerald-50 text-emerald-700', icon: <CheckCircle2 size={13} />, label: 'Approved' },
  PENDING:  { cls: 'bg-amber-50 text-amber-700',     icon: <Clock size={13} />,        label: 'In review' },
  REJECTED: { cls: 'bg-red-50 text-red-700',         icon: <XCircle size={13} />,      label: 'Rejected' },
};

const slug = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);

/** Problems Meta would reject the template for — checked before sending */
function problems(name: string, body: string, existing: WaTemplate[]) {
  const out: string[] = [];
  const t = body.trim();
  if (!/^[a-z0-9_]+$/.test(name)) out.push('Name: use lowercase letters, numbers and _ only.');
  if (existing.some((x) => x.name === name)) out.push('A template with this name already exists.');
  if (/^\{\{/.test(t)) out.push("The message can't start with a variable — begin with text, e.g. \"Dear {{name}}\".");
  if (/\}\}[.!?\s]*$/.test(t)) out.push("The message can't end with a variable — add a few words after it.");
  if (/\}\}\s*\{\{/.test(t)) out.push('Two variables next to each other — put some words between them.');
  if (/\{\{(?![a-z0-9_]+\}\})/.test(t)) out.push('Variables must look like {{name}} (lowercase, numbers, _).');
  const words = t.replace(/\{\{[^}]+\}\}/g, '').split(/\s+/).filter(Boolean).length;
  if (varsIn(t).length && words < varsIn(t).length * 3) out.push('Too many variables for the amount of text — add more words.');
  return out;
}

export default function WhatsAppTemplates() {
  const [list, setList] = useState<WaTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [title, setTitle] = useState('');
  const [name, setName] = useState('');
  const [nameEdited, setNameEdited] = useState(false);
  const [category, setCategory] = useState<'UTILITY' | 'MARKETING'>('UTILITY');
  const [body, setBody] = useState('');
  const [samples, setSamples] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [custom, setCustom] = useState('');
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const refresh = () => {
    setLoading(true); setError('');
    loadTemplates().then(setList).catch((e) => setError(e.message)).finally(() => setLoading(false));
  };
  useEffect(refresh, []);
  // Re-check while something is in review
  useEffect(() => {
    if (!list.some((t) => t.status === 'PENDING')) return;
    const t = setInterval(() => loadTemplates().then(setList).catch(() => {}), 10000);
    return () => clearInterval(t);
  }, [list]);

  const vars = useMemo(() => varsIn(body), [body]);
  const issues = useMemo(() => (body.trim() ? problems(name, body, list) : []), [name, body, list]);
  const preview = vars.reduce((s, v) => s.split(`{{${v}}}`).join(samples[v] || SAMPLES[v] || `[${v}]`), body);

  const insert = (v: string) => {
    const el = bodyRef.current; const token = `{{${v}}}`;
    if (!el) { setBody((b) => b + token); return; }
    const a = el.selectionStart ?? body.length, b = el.selectionEnd ?? body.length;
    setBody(body.slice(0, a) + token + body.slice(b));
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(a + token.length, a + token.length); });
  };

  const applyStarter = (s: (typeof STARTERS)[number]) => {
    setTitle(s.title); setName(s.name); setNameEdited(false); setBody(s.body); setCategory('UTILITY'); setSamples({});
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const submit = async () => {
    setSaving(true);
    try {
      const examples = Object.fromEntries(vars.map((v) => [v, samples[v] || SAMPLES[v] || v.replace(/_/g, ' ')]));
      const r = await createTemplate({ name, category, body: body.trim(), examples });
      toast.success('Template sent to Meta for review', r?.category && r.category !== category
        ? `Meta filed it as ${r.category}.` : 'Usually approved within minutes — the status updates here.');
      setTitle(''); setName(''); setBody(''); setSamples({}); setNameEdited(false);
      refresh();
    } catch (e) {
      toast.error('Template not created', (e as Error).message);
    } finally { setSaving(false); }
  };

  const remove = async (t: WaTemplate) => {
    if (!confirm(`Delete the template "${t.label}"? The name can't be reused for 30 days.`)) return;
    try { await deleteTemplate(t.name); toast.success('Template deleted', t.label); refresh(); }
    catch (e) { toast.error('Could not delete', (e as Error).message); }
  };

  return (
    <div>
      <Header title="Message templates" subtitle="Messages you can send any time — even when the 24-hour chat window is closed" />
      <Link to="/messages" className="inline-flex items-center gap-1 text-sm text-navy-500 hover:text-navy-800 mb-3"><ArrowLeft size={15} /> Messages</Link>
      {whatsappDemo && <p className="card !p-3 mb-3 text-sm bg-sky-50 border border-sky-200 text-sky-800">Demo mode — templates are not sent to Meta; new ones are "approved" after a few seconds.</p>}

      <div className="grid xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4 items-start">
        {/* Create */}
        <section className="card !p-5 space-y-4">
          <h2 className="font-bold text-navy-800 flex items-center gap-2"><Plus size={18} /> New template</h2>

          <div className="grid sm:grid-cols-2 gap-3">
            <label className="text-sm">
              <span className="label block">Title</span>
              <input className="input" placeholder="e.g. Pickup reminder" value={title}
                     onChange={(e) => { setTitle(e.target.value); if (!nameEdited) setName(slug(e.target.value)); }} />
            </label>
            <label className="text-sm">
              <span className="label block">Template name (for Meta)</span>
              <input className="input font-mono" placeholder="pickup_reminder" value={name}
                     onChange={(e) => { setName(slug(e.target.value)); setNameEdited(true); }} />
            </label>
          </div>

          <div className="flex gap-2">
            {(['UTILITY', 'MARKETING'] as const).map((c) => (
              <button key={c} type="button" onClick={() => setCategory(c)}
                      className={`flex-1 text-left rounded-xl border px-3 py-2 ${category === c ? 'border-emerald-600 bg-emerald-50' : 'border-navy-100 hover:bg-navy-50'}`}>
                <p className="text-sm font-semibold text-navy-800">{c === 'UTILITY' ? 'Utility' : 'Marketing'}</p>
                <p className="text-[11px] text-navy-500">{c === 'UTILITY' ? 'About a specific booking — ≈ US$0.011 each' : 'Offers & promotions — ≈ US$0.084 each'}</p>
              </button>
            ))}
          </div>

          <div>
            <span className="label block">Message</span>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {Object.entries(AUTO_VARS).map(([v, label]) => (
                <button key={v} type="button" onClick={() => insert(v)} title="Filled in automatically from the inquiry"
                        className="text-xs px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 font-semibold hover:bg-emerald-100">+ {label}</button>
              ))}
              <form className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); const v = slug(custom); if (v) { insert(v); setCustom(''); } }}>
                <input className="input !py-1 !text-xs w-36" placeholder="other variable…" value={custom} onChange={(e) => setCustom(e.target.value)} />
                <button type="submit" className="text-xs px-2.5 py-1 rounded-full bg-navy-50 text-navy-700 font-semibold hover:bg-navy-100">+ Add</button>
              </form>
            </div>
            <textarea ref={bodyRef} className="input min-h-[120px]" placeholder="Dear {{name}}, …" value={body} onChange={(e) => setBody(e.target.value)} />
            <p className="text-[11px] text-navy-400 mt-1">Green variables fill in from the inquiry. Other variables (e.g. pickup time) are typed by staff when sending.</p>
          </div>

          {vars.length > 0 && (
            <div>
              <span className="label block">Example values (Meta uses these to review)</span>
              <div className="grid sm:grid-cols-2 gap-2">
                {vars.map((v) => (
                  <label key={v} className="text-[11px] text-navy-500">{AUTO_VARS[v] ?? v.replace(/_/g, ' ')}
                    <input className="input !py-1.5 mt-0.5" placeholder={SAMPLES[v] ?? ''} value={samples[v] ?? ''}
                           onChange={(e) => setSamples((s) => ({ ...s, [v]: e.target.value }))} />
                  </label>
                ))}
              </div>
            </div>
          )}

          {body.trim() && (
            <div className="rounded-xl p-3 bg-[#efeae2]">
              <div className="max-w-[85%] ml-auto rounded-2xl rounded-tr-sm px-3 py-2 bg-[#d9fdd3] text-sm text-navy-800 whitespace-pre-wrap shadow-sm">{preview}</div>
            </div>
          )}

          {issues.length > 0 && (
            <ul className="text-xs text-red-700 bg-red-50 rounded-lg px-3 py-2 space-y-0.5">{issues.map((i) => <li key={i}>• {i}</li>)}</ul>
          )}

          <button type="button" onClick={submit} disabled={saving || !name || !body.trim() || issues.length > 0}
                  className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50">
            {saving ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />} Submit to Meta for approval
          </button>

          <div className="border-t border-navy-100 pt-4">
            <p className="text-sm font-semibold text-navy-800 flex items-center gap-1.5 mb-2"><Sparkles size={15} className="text-amber-500" /> Ready-made templates — click to use</p>
            <div className="grid sm:grid-cols-2 gap-2">
              {STARTERS.map((s) => {
                const exists = list.some((t) => t.name === s.name);
                return (
                  <button key={s.name} type="button" disabled={exists} onClick={() => applyStarter(s)}
                          className="text-left rounded-xl border border-navy-100 px-3 py-2 hover:bg-navy-50 disabled:opacity-50">
                    <p className="text-sm font-semibold text-navy-800">{s.title} {exists && <span className="text-[10px] text-emerald-700">· added</span>}</p>
                    <p className="text-[11px] text-navy-500 line-clamp-2">{s.body}</p>
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        {/* Existing */}
        <section className="card !p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-navy-800">Your templates</h2>
            <button type="button" onClick={refresh} className="btn-secondary !py-1.5 text-xs flex items-center gap-1">
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
          </div>
          {error && (
            <p className="text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2 mb-3 flex gap-2"><Info size={15} className="flex-shrink-0 mt-0.5" />
              <span>{error}<br /><span className="text-xs">Deploy <code>whatsapp-templates</code> and set the <code>WHATSAPP_WABA_ID</code> secret (WHATSAPP.md, step 8).</span></span></p>
          )}
          {!loading && !error && list.length === 0 && <p className="text-sm text-navy-400">No templates yet — create one on the left.</p>}
          <ul className="space-y-2">
            {list.map((t) => {
              const st = STATUS[t.status ?? ''] ?? { cls: 'bg-navy-50 text-navy-600', icon: <Info size={13} />, label: t.status ?? '' };
              return (
                <li key={`${t.name}-${t.language}`} className="rounded-xl border border-navy-100 p-3">
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-navy-800 text-sm">{t.label}</p>
                      <p className="text-[11px] text-navy-400 font-mono">{t.name} · {t.language} · {t.category?.toLowerCase()}</p>
                    </div>
                    <span className={`text-[11px] font-semibold rounded-full px-2 py-0.5 flex items-center gap-1 ${st.cls}`}>{st.icon} {st.label}</span>
                    <button type="button" onClick={() => remove(t)} className="p-1 rounded-lg text-navy-400 hover:text-red-600 hover:bg-red-50" aria-label="Delete template"><Trash2 size={15} /></button>
                  </div>
                  <p className="text-xs text-navy-600 mt-2 whitespace-pre-wrap">{t.text}</p>
                  {t.status === 'REJECTED' && (
                    <p className="text-[11px] text-red-700 mt-1">Rejected{t.rejectedReason ? ` (${t.rejectedReason.replace(/_/g, ' ').toLowerCase()})` : ''} — delete it and create it again with clearer wording about a booking.</p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </div>
  );
}
