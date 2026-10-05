/* =====================================================================
   WhatsApp inbox (Meta WhatsApp Cloud API through Supabase Edge Functions)
   Tables: whatsapp_messages, whatsapp_chats (admin/supabase/whatsapp.sql)
   Functions: whatsapp-send, whatsapp-webhook, whatsapp-media (see WHATSAPP.md)
   ===================================================================== */
import { useEffect, useState } from 'react';
import { supabase, supabaseEnabled } from './supabase';
import { demoOn, demoLoadChats, demoLoadMessages, demoMarkRead, demoMediaUrl, demoSend, demoSubscribe } from './whatsappDemo';

/** The inbox is switched on once the Meta setup is done (VITE_WHATSAPP_ENABLED=true in .env.local) */
export const whatsappLive = supabaseEnabled && import.meta.env.VITE_WHATSAPP_ENABLED === 'true';
/** Demo mode: sample chats in memory (before Meta is connected) — toggled on the Messages page */
export const whatsappDemo = !whatsappLive && demoOn;
export const whatsappEnabled = whatsappLive || whatsappDemo;

export interface WaMessage {
  id: string;
  waId?: string;
  phone: string;
  direction: 'in' | 'out';
  kind: string;
  body?: string;
  mediaId?: string;
  mediaMime?: string;
  mediaName?: string;
  template?: string;
  status: string;            // received | sent | delivered | read | failed
  error?: string;
  staff?: string;
  createdAt: string;
}

export interface WaChat { phone: string; name?: string; lastReadAt?: string }

const fromDb = (r: Record<string, unknown>): WaMessage => ({
  id: r.id as string,
  waId: (r.wa_id as string) ?? undefined,
  phone: r.phone as string,
  direction: r.direction as 'in' | 'out',
  kind: r.kind as string,
  body: (r.body as string) ?? undefined,
  mediaId: (r.media_id as string) ?? undefined,
  mediaMime: (r.media_mime as string) ?? undefined,
  mediaName: (r.media_name as string) ?? undefined,
  template: (r.template as string) ?? undefined,
  status: r.status as string,
  error: (r.error as string) ?? undefined,
  staff: (r.staff as string) ?? undefined,
  createdAt: r.created_at as string,
});

/** International digits only (Sri Lankan 07x… → 947x…) — how WhatsApp identifies a customer */
export const waPhone = (p: string) => {
  const d = (p ?? '').replace(/\D/g, '');
  return d.startsWith('0') ? `94${d.slice(1)}` : d;
};

/** Customer service window: free-form replies are allowed for 24 h after the customer's last message */
export function windowInfo(messages: WaMessage[]) {
  const lastIn = [...messages].reverse().find((m) => m.direction === 'in');
  if (!lastIn) return { open: false, closesAt: undefined as Date | undefined, lastIn };
  const closesAt = new Date(new Date(lastIn.createdAt).getTime() + 24 * 3600e3);
  return { open: closesAt.getTime() > Date.now(), closesAt, lastIn };
}

export const mediaUrl = (mediaId: string) => whatsappDemo ? demoMediaUrl(mediaId) :
  `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/whatsapp-media?id=${encodeURIComponent(mediaId)}`;

/* ---------------- Loading ---------------- */

export async function loadMessages(phone?: string): Promise<WaMessage[]> {
  if (whatsappDemo) return demoLoadMessages(phone);
  let q = supabase.from('whatsapp_messages').select('*').order('created_at', { ascending: true }).limit(phone ? 500 : 3000);
  if (phone) q = q.eq('phone', waPhone(phone));
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map(fromDb);
}

export async function loadChats(): Promise<WaChat[]> {
  if (whatsappDemo) return demoLoadChats();
  const { data, error } = await supabase.from('whatsapp_chats').select('*');
  if (error) throw error;
  return (data ?? []).map((r) => ({ phone: r.phone, name: r.name ?? undefined, lastReadAt: r.last_read_at ?? undefined }));
}

export async function markRead(phone: string) {
  if (whatsappDemo) return demoMarkRead(phone);
  await supabase.from('whatsapp_chats').upsert({ phone: waPhone(phone), last_read_at: new Date().toISOString() }, { onConflict: 'phone' });
}

/** Live: calls back on any new message or status change */
export function subscribeMessages(onChange: (m: WaMessage) => void) {
  if (whatsappDemo) return demoSubscribe(onChange);
  const channel = supabase
    .channel(`wa-${Math.random().toString(36).slice(2)}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'whatsapp_messages' },
      (p) => { if (p.new && (p.new as Record<string, unknown>).id) onChange(fromDb(p.new as Record<string, unknown>)); })
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}

/** Merge one changed message into a list (insert or update by id) */
export const upsertMessage = (list: WaMessage[], m: WaMessage) => {
  const i = list.findIndex((x) => x.id === m.id);
  if (i < 0) return [...list, m].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const next = [...list]; next[i] = m; return next;
};

/* ---------------- Sending ---------------- */

async function invokeSend(body: Record<string, unknown> | FormData): Promise<WaMessage | undefined> {
  const { data, error } = await supabase.functions.invoke('whatsapp-send', { body });
  // Supabase wraps non-2xx answers in an error; read our { error } message from the response
  if (error) {
    let msg = error.message;
    try { const ctx = (error as { context?: Response }).context; if (ctx) msg = (await ctx.json()).error ?? msg; } catch { /* keep generic */ }
    throw new Error(msg);
  }
  return data?.message ? fromDb(data.message) : undefined;
}

export const sendText = (to: string, text: string, staff?: string) =>
  whatsappDemo ? demoSend(to, text, staff) : invokeSend({ to: waPhone(to), text, staff });

export const sendTemplate = (to: string, t: WaTemplate, values: Record<string, string>, staff?: string) =>
  whatsappDemo ? demoSend(to, fillTemplate(t, values), staff, t.name) : invokeSend({
    to: waPhone(to), staff,
    template: { name: t.name, language: t.language, params: t.params.map((p) => values[p] ?? ''), preview: fillTemplate(t, values) },
  });

/** Photo / video / audio / document with an optional caption (inside the 24-hour window) */
export async function sendFile(to: string, file: File, caption?: string, staff?: string): Promise<WaMessage | undefined> {
  if (whatsappDemo) return demoSend(to, caption ?? '', staff, undefined, file);
  const form = new FormData();
  form.append('to', waPhone(to));
  form.append('file', file, file.name);
  if (caption) form.append('caption', caption);
  if (staff) form.append('staff', staff);
  return invokeSend(form);
}

/** WhatsApp size limits per type (MB) */
export const fileLimitMb = (f: File) => (/^image\/(jpeg|png)$/.test(f.type) ? 5 : /^(video|audio)\//.test(f.type) ? 16 : 25);

/* ---------------- Approved templates ----------------
   Templates must be created and approved in WhatsApp Manager with EXACTLY these names,
   languages and {{1}}, {{2}}… placeholders (see WHATSAPP.md). They are the only messages
   allowed when more than 24 hours have passed since the customer's last message. */

export interface WaTemplate {
  name: string;
  language: string;
  label: string;
  params: ('name' | 'vehicle' | 'dates' | 'reference')[];   // values for {{1}}, {{2}}…
  text: string;                                              // the approved body, for preview
}

export const WA_TEMPLATES: WaTemplate[] = [
  {
    name: 'booking_request_update', language: 'en', label: 'Booking request — start the chat',
    params: ['name', 'vehicle', 'dates', 'reference'],
    text: 'Dear {{1}}, thank you for your booking request {{4}} for the {{2}} ({{3}}) with Ceylon Rent A Cars. Please reply to this message so we can confirm the details with you.',
  },
  {
    name: 'inquiry_followup', language: 'en', label: 'Follow-up reminder',
    params: ['name', 'reference'],
    text: 'Dear {{1}}, we are following up on your request {{2}} with Ceylon Rent A Cars. Reply to this message and we will be happy to help.',
  },
  {
    name: 'hello_world', language: 'en_US', label: 'Test message (Meta sample)',
    params: [],
    text: 'Hello World — welcome and congratulations! This message demonstrates your ability to send a WhatsApp message notification from the Cloud API.',
  },
];

export const fillTemplate = (t: WaTemplate, v: Record<string, string>) =>
  t.params.reduce((s, p, i) => s.split(`{{${i + 1}}}`).join(v[p] || `[${p}]`), t.text);

/* ---------------- Unread badge ---------------- */

/** Number of conversations with unread customer messages (live) */
export function useWhatsAppUnread() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!whatsappEnabled) return;
    let alive = true;
    const refresh = () => Promise.all([loadMessages(), loadChats()])
      .then(([msgs, chats]) => { if (alive) setCount(unreadByPhone(msgs, chats).size); })
      .catch(() => {});
    refresh();
    const off = subscribeMessages(() => refresh());
    const onRead = () => refresh();
    window.addEventListener('wa:read', onRead);
    return () => { alive = false; off(); window.removeEventListener('wa:read', onRead); };
  }, []);
  return count;
}

export function unreadByPhone(msgs: WaMessage[], chats: WaChat[]) {
  const read = new Map(chats.map((c) => [c.phone, c.lastReadAt ?? '']));
  const out = new Map<string, number>();
  msgs.forEach((m) => {
    if (m.direction === 'in' && m.createdAt > (read.get(m.phone) ?? '')) out.set(m.phone, (out.get(m.phone) ?? 0) + 1);
  });
  return out;
}
