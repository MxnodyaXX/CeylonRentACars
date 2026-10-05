import { useEffect, useMemo, useRef, useState } from 'react';
import { Send, Check, CheckCheck, Clock, AlertTriangle, FileText, MapPin, Lock, MessageCircle, Image as ImageIcon, Paperclip, X, Loader2 } from 'lucide-react';
import { toast } from '../../store/useToast';
import { useAuthStore } from '../../store/useAuthStore';
import {
  AUTO_VARS, WaMessage, fileLimitMb, useApprovedTemplates, fillTemplate, loadMessages, markRead, mediaUrl, sendFile, sendTemplate, sendText,
  subscribeMessages, upsertMessage, waPhone, windowInfo,
} from '../../lib/whatsappInbox';

const ACCEPT = 'image/jpeg,image/png,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,video/mp4,audio/*';
const size = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);

const time = (d: string) => new Date(d).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit' });
const day = (d: string) => new Date(d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

function Ticks({ m }: { m: WaMessage }) {
  if (m.direction === 'in') return null;
  if (m.status === 'failed') return <AlertTriangle size={13} className="text-red-500" />;
  if (m.status === 'read') return <CheckCheck size={14} className="text-sky-500" />;
  if (m.status === 'delivered') return <CheckCheck size={14} className="text-navy-400" />;
  if (m.status === 'sent') return <Check size={14} className="text-navy-400" />;
  return <Clock size={12} className="text-navy-300" />;
}

/* WhatsApp-style *bold* / _italic_ and clickable links */
function Rich({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/\S+|\*[^*\n]+\*|_[^_\n]+_)/g);
  return (
    <>
      {parts.map((p, i) => {
        if (/^https?:\/\//.test(p)) return <a key={i} href={p} target="_blank" rel="noreferrer" className="text-sky-700 underline break-all">{p}</a>;
        if (/^\*[^*]+\*$/.test(p)) return <b key={i}>{p.slice(1, -1)}</b>;
        if (/^_[^_]+_$/.test(p)) return <i key={i}>{p.slice(1, -1)}</i>;
        return <span key={i}>{p}</span>;
      })}
    </>
  );
}

function Bubble({ m }: { m: WaMessage }) {
  const out = m.direction === 'out';
  const isImage = m.mediaId && (m.kind === 'image' || m.mediaMime?.startsWith('image/'));
  return (
    <div className={`flex ${out ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[80%] rounded-2xl px-3 py-2 shadow-sm ${out ? 'bg-[#d9fdd3] rounded-tr-sm' : 'bg-white rounded-tl-sm'} ${m.status === 'failed' ? 'ring-1 ring-red-300' : ''}`}>
        {m.kind === 'template' && <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-700 mb-0.5">Template · {m.template}</p>}
        {isImage && (
          <a href={mediaUrl(m.mediaId!)} target="_blank" rel="noreferrer" className="block mb-1">
            <img src={mediaUrl(m.mediaId!)} alt="Photo from customer" className="rounded-lg max-h-64 object-cover" loading="lazy" />
          </a>
        )}
        {m.mediaId && !isImage && (
          <a href={mediaUrl(m.mediaId)} target="_blank" rel="noreferrer"
             className="flex items-center gap-2 mb-1 rounded-lg bg-black/5 px-3 py-2 text-sm font-semibold text-navy-700 hover:bg-black/10">
            <FileText size={16} /> {m.mediaName ?? `${m.kind} file`}
          </a>
        )}
        {m.kind === 'location' && <MapPin size={14} className="inline mr-1 text-brand-500" />}
        {m.body && <p className="text-sm text-navy-800 whitespace-pre-wrap break-words"><Rich text={m.body} /></p>}
        <div className="flex items-center justify-end gap-1 mt-0.5 text-[10px] text-navy-400">
          {out && m.staff && <span className="mr-1">{m.staff}</span>}
          {time(m.createdAt)} <Ticks m={m} />
        </div>
        {m.status === 'failed' && m.error && <p className="text-[11px] text-red-600 mt-1">{m.error}</p>}
      </div>
    </div>
  );
}

/**
 * WhatsApp conversation with one customer: live messages, delivery ticks, photos/documents,
 * free-form replies inside the 24-hour window and approved templates outside it.
 */
export default function WhatsAppChat({
  phone, context = {}, draft, onDraftUsed, height = 'h-[520px]',
}: {
  phone: string;
  context?: Record<string, string>;     // values for template placeholders: name, vehicle, dates, reference
  draft?: string;                        // text to put in the composer (e.g. a quick reply)
  onDraftUsed?: () => void;
  height?: string;
}) {
  const staff = useAuthStore((s) => s.currentUser?.name) ?? 'Ceylon Rent A Cars';
  const to = waPhone(phone);
  const [messages, setMessages] = useState<WaMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const templates = useApprovedTemplates();
  const [tplName, setTplName] = useState('');
  const [vars, setVars] = useState<Record<string, string>>({});   // values typed by staff
  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const preview = useMemo(() => (file && /^image\//.test(file.type) ? URL.createObjectURL(file) : ''), [file]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const pick = (f?: File | null) => {
    if (!f) return;
    if (f.size > fileLimitMb(f) * 1024 * 1024) { toast.error('File too large', `WhatsApp allows up to ${fileLimitMb(f)} MB for this type.`); return; }
    setFile(f);
  };

  useEffect(() => {
    let alive = true;
    setLoading(true);
    loadMessages(to)
      .then((l) => { if (alive) setMessages(l); })
      .catch((e) => toast.error('Could not load WhatsApp messages', e.message))
      .finally(() => alive && setLoading(false));
    const off = subscribeMessages((m) => { if (m.phone === to) setMessages((l) => upsertMessage(l, m)); });
    return () => { alive = false; off(); };
  }, [to]);

  // Opening the chat (and every new message while it's open) marks it read
  useEffect(() => {
    if (!messages.length) return;
    markRead(to).then(() => window.dispatchEvent(new Event('wa:read'))).catch(() => {});
  }, [messages.length, to]);

  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [messages.length, loading]);

  useEffect(() => { if (draft) { setText(draft); onDraftUsed?.(); } }, [draft]); // eslint-disable-line react-hooks/exhaustive-deps

  const win = useMemo(() => windowInfo(messages), [messages]);
  const tpl = templates.find((t) => t.name === tplName) ?? templates[0];
  const values: Record<string, string> = { ...context, ...vars };
  const missing = tpl ? tpl.params.filter((p) => !values[p]?.trim()) : [];

  const send = async () => {
    const body = text.trim();
    if (!body && !file) return;
    setSending(true);
    try {
      const m = file ? await sendFile(to, file, body, staff) : await sendText(to, body, staff);
      if (m) setMessages((l) => upsertMessage(l, m));
      setText(''); setFile(null);
    } catch (e) {
      toast.error('WhatsApp message not sent', (e as Error).message);
    } finally { setSending(false); }
  };

  const sendTpl = async () => {
    setSending(true);
    try {
      const m = await sendTemplate(to, tpl, values, staff);
      if (m) setMessages((l) => upsertMessage(l, m));
      toast.success('Template sent', 'You can chat freely once the customer replies.');
    } catch (e) {
      toast.error('Template not sent', (e as Error).message);
    } finally { setSending(false); }
  };

  // group by day
  let lastDay = '';

  return (
    <div className={`relative flex flex-col ${height} rounded-xl overflow-hidden border border-navy-100`}
         onDragOver={(e) => { if (win.open && e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragging(true); } }}
         onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }}
         onDrop={(e) => { if (!win.open) return; e.preventDefault(); setDragging(false); pick(e.dataTransfer.files?.[0]); }}>
      {dragging && (
        <div className="absolute inset-0 z-10 bg-emerald-600/15 border-2 border-dashed border-emerald-600 rounded-xl flex items-center justify-center pointer-events-none">
          <p className="bg-white rounded-xl px-4 py-2 text-sm font-semibold text-emerald-700 shadow">Drop to attach</p>
        </div>
      )}
      {/* Thread */}
      <div ref={listRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2 bg-[#efeae2]"
           style={{ backgroundImage: 'radial-gradient(rgba(0,0,0,.035) 1px, transparent 1px)', backgroundSize: '14px 14px' }}>
        {loading && <p className="text-center text-xs text-navy-400 py-6">Loading messages…</p>}
        {!loading && messages.length === 0 && (
          <div className="text-center py-10 text-navy-500">
            <MessageCircle size={28} className="mx-auto mb-2 text-emerald-600" />
            <p className="text-sm font-semibold">No WhatsApp messages yet</p>
            <p className="text-xs text-navy-400 mt-1">Start the conversation with an approved template below.</p>
          </div>
        )}
        {messages.map((m) => {
          const d = day(m.createdAt);
          const sep = d !== lastDay; lastDay = d;
          return (
            <div key={m.id}>
              {sep && <div className="text-center my-2"><span className="text-[11px] font-semibold text-navy-500 bg-white/80 rounded-full px-3 py-1 shadow-sm">{d}</span></div>}
              <Bubble m={m} />
            </div>
          );
        })}
      </div>

      {/* Composer */}
      <div className="border-t border-navy-100 bg-white p-2.5 space-y-2">
        {win.open ? (
          <>
            <p className="text-[11px] text-emerald-700 flex items-center gap-1">
              <Clock size={11} /> Chat window open — free replies until {win.closesAt!.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
            </p>
            {file && (
              <div className="flex items-center gap-3 rounded-xl bg-navy-50 p-2">
                {preview
                  ? <img src={preview} alt="" className="w-14 h-14 rounded-lg object-cover flex-shrink-0" />
                  : <span className="w-14 h-14 rounded-lg bg-white flex items-center justify-center flex-shrink-0"><FileText size={22} className="text-brand-500" /></span>}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-navy-800 truncate">{file.name}</p>
                  <p className="text-[11px] text-navy-400">{size(file.size)} · {preview ? 'Photo' : 'Document'} — type a caption below (optional)</p>
                </div>
                <button type="button" onClick={() => setFile(null)} className="p-1.5 rounded-lg hover:bg-white" aria-label="Remove attachment"><X size={16} /></button>
              </div>
            )}
            <div className="flex items-end gap-2">
              <input ref={fileRef} type="file" accept={ACCEPT} className="hidden"
                     onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
              <button type="button" onClick={() => fileRef.current?.click()} disabled={sending} aria-label="Attach photo or document" title="Attach photo or document"
                      className="w-11 h-11 flex-shrink-0 rounded-full text-navy-500 flex items-center justify-center hover:bg-navy-50 disabled:opacity-40">
                <Paperclip size={19} />
              </button>
              <textarea
                className="input resize-none !py-2 max-h-40" rows={Math.min(6, Math.max(1, text.split('\n').length))}
                placeholder={file ? 'Add a caption…' : 'Type a message…  (Enter to send, Shift+Enter for a new line)'}
                value={text} onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                onPaste={(e) => { const f = Array.from(e.clipboardData.files)[0]; if (f) { e.preventDefault(); pick(f); } }}
              />
              <button type="button" onClick={send} disabled={sending || (!text.trim() && !file)} aria-label="Send"
                      className="w-11 h-11 flex-shrink-0 rounded-full bg-emerald-600 text-white flex items-center justify-center hover:bg-emerald-700 disabled:opacity-40">
                {sending ? <Loader2 size={17} className="animate-spin" /> : <Send size={17} />}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-[11px] text-amber-700 flex items-center gap-1">
              <Lock size={11} /> {win.lastIn ? 'More than 24 hours since the customer last wrote' : 'The customer hasn’t messaged yet'} — WhatsApp only allows an approved template. Free chat opens when they reply.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <select className="input !py-2 flex-1 min-w-[200px]" value={tpl?.name ?? ''} onChange={(e) => { setTplName(e.target.value); setVars({}); }}>
                {templates.map((t) => <option key={t.name} value={t.name}>{t.label}</option>)}
              </select>
              <button type="button" onClick={sendTpl} disabled={sending || !tpl || missing.length > 0}
                      title={missing.length ? `Fill in: ${missing.join(', ')}` : undefined}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">
                <Send size={15} /> {sending ? 'Sending…' : 'Send template'}
              </button>
            </div>
            {tpl && tpl.params.some((p) => !context[p]) && (
              <div className="grid sm:grid-cols-2 gap-2">
                {tpl.params.filter((p) => !context[p]).map((p) => (
                  <label key={p} className="text-[11px] text-navy-500">
                    {AUTO_VARS[p] ?? p.replace(/_/g, ' ')}
                    <input className="input !py-1.5 mt-0.5" value={vars[p] ?? ''} onChange={(e) => setVars((v) => ({ ...v, [p]: e.target.value }))} />
                  </label>
                ))}
              </div>
            )}
            {tpl && <p className="text-xs text-navy-500 bg-navy-50 rounded-lg px-3 py-2 whitespace-pre-wrap">{fillTemplate(tpl, values)}</p>}
            {text && <p className="text-[11px] text-navy-400 flex items-center gap-1"><ImageIcon size={11} /> Your draft is kept — send it once the customer replies.</p>}
          </>
        )}
      </div>
    </div>
  );
}
