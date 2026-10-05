/* =====================================================================
   WhatsApp inbox DEMO — sample conversations kept in memory, so the
   Messages page and inquiry chat can be tried before Meta is connected.
   Nothing is sent to anyone. Switch on/off from the Messages page.
   ===================================================================== */
import type { WaChat, WaMessage } from './whatsappInbox';
import { useStore } from '../store/useStore';

const KEY = 'crc-wa-demo';
export const demoOn = (() => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } })();
export function setDemo(on: boolean) {
  try { if (on) localStorage.setItem(KEY, '1'); else localStorage.removeItem(KEY); } catch { /* ignore */ }
  window.location.reload();
}

const digits = (p: string) => { const d = (p ?? '').replace(/\D/g, ''); return d.startsWith('0') ? `94${d.slice(1)}` : d; };
const ago = (min: number) => new Date(Date.now() - min * 60e3).toISOString();
let seq = 0;
const id = () => `demo-${++seq}`;

let messages: WaMessage[] = [];
let chats: WaChat[] = [];
const listeners = new Set<(m: WaMessage) => void>();
let seeded = false;

/** A small "photo" (SVG) so image messages render without Meta */
const LICENCE_SVG = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="220"><rect width="360" height="220" rx="14" fill="#e8f0fe"/>
  <rect x="18" y="18" width="324" height="34" rx="6" fill="#1d4ed8"/><text x="30" y="41" font-family="Arial" font-size="15" fill="#fff" font-weight="bold">DRIVING LICENCE — DEMO</text>
  <rect x="26" y="70" width="90" height="112" rx="8" fill="#cbd5e1"/><circle cx="71" cy="110" r="20" fill="#94a3b8"/><rect x="45" y="138" width="52" height="30" rx="14" fill="#94a3b8"/>
  <g font-family="Arial" font-size="13" fill="#334155"><text x="134" y="92">Name: SAMPLE CUSTOMER</text><text x="134" y="116">No: B1234567</text><text x="134" y="140">Valid: 2030-01-01</text><text x="134" y="164">Class: B</text></g></svg>`)}`;

export const demoMediaUrl = (mediaId: string) => (mediaId === 'demo-licence' ? LICENCE_SVG : '#');

function seed() {
  if (seeded) return;
  seeded = true;
  // Use real inquiries when available, so "Open inquiry" works in the demo
  const inqs = [...(useStore.getState().inquiries ?? [])]
    .filter((i) => i.customerPhone)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const first = (n: string) => n.trim().split(' ')[0];
  const veh = (v: string) => v.replace(/\s*\(.*\)$/, '');

  const a = inqs[0] ? { phone: digits(inqs[0].customerPhone), name: inqs[0].customerName, vehicle: veh(inqs[0].requestedVehicle) }
                    : { phone: '94771234567', name: 'Kasun Perera', vehicle: 'Toyota Axio' };
  const b = inqs[1] && digits(inqs[1].customerPhone) !== a.phone
    ? { phone: digits(inqs[1].customerPhone), name: inqs[1].customerName, vehicle: veh(inqs[1].requestedVehicle) }
    : { phone: '447700900123', name: 'Sarah Johnson', vehicle: 'Toyota KDH van' };
  const c = { phone: '94712223344', name: 'Nimal Fernando', vehicle: 'Suzuki Wagon R' };
  const d = { phone: '61412345678', name: 'Liam Walker', vehicle: 'Toyota Prius' };

  const m = (phone: string, direction: 'in' | 'out', minAgo: number, body: string, extra: Partial<WaMessage> = {}): WaMessage => ({
    id: id(), phone, direction, kind: 'text', body, status: direction === 'in' ? 'received' : 'read',
    staff: direction === 'out' ? 'Admin' : undefined, createdAt: ago(minAgo), ...extra,
  });

  messages = [
    // A — active chat, customer just sent their licence photo (unread)
    m(a.phone, 'out', 26 * 60, `Dear ${first(a.name)}, thank you for your booking request CRC-4821 for the ${a.vehicle} with Ceylon Rent A Cars. Please reply to this message so we can confirm the details with you.`,
      { kind: 'template', template: 'booking_request_update' }),
    m(a.phone, 'in', 95, `Hi! Yes I'm still interested. Can I pick it up at the airport?`),
    m(a.phone, 'out', 80, `Of course 😊 Airport pickup at Katunayake is free. We'll need a photo of your *driving licence* to confirm.`),
    m(a.phone, 'out', 62, 'Our driver can also meet you at arrivals with a name board.', { staff: 'WhatsApp app (phone)' }),
    m(a.phone, 'in', 12, 'Here is my licence', { kind: 'image', mediaId: 'demo-licence', mediaMime: 'image/svg+xml' }),
    m(a.phone, 'in', 11, 'Is the price the same as on the website?'),

    // B — foreign customer, waiting for our reply (unread)
    m(b.phone, 'in', 3 * 60, `Hello, do you have the ${b.vehicle} available next week? We are 4 adults.`),
    m(b.phone, 'out', 170, `Hello ${first(b.name)}! Yes, it's available. Could you send your exact dates and where you'd like to pick it up?`, { status: 'delivered' }),
    m(b.phone, 'in', 40, '14th to 20th, pickup from Colombo Fort please 🙏'),

    // C — more than 24 h ago: only templates allowed from the admin
    m(c.phone, 'in', 3 * 24 * 60, `Ayubowan, how much for the ${c.vehicle} for a month?`),
    m(c.phone, 'out', 3 * 24 * 60 - 20, 'Monthly rate is LKR 145,000 including insurance. Shall I reserve it for you?'),

    // D — we started with a template, no reply yet; one failed message
    m(d.phone, 'out', 6 * 60, `Dear ${first(d.name)}, we are following up on your request CRC-4790 with Ceylon Rent A Cars. Reply to this message and we will be happy to help.`,
      { kind: 'template', template: 'inquiry_followup', status: 'delivered' }),
    m(d.phone, 'out', 5 * 60, 'Here is the vehicle link', { status: 'failed', error: 'Message failed to send because more than 24 hours have passed since the customer last replied.' }),
  ];
  chats = [
    { phone: a.phone, name: a.name, lastReadAt: ago(70) },
    { phone: b.phone, name: b.name, lastReadAt: ago(150) },
    { phone: c.phone, name: c.name, lastReadAt: ago(60) },
    { phone: d.phone, name: d.name, lastReadAt: ago(60) },
  ];
}

const emit = (msg: WaMessage) => listeners.forEach((l) => l(msg));
const update = (mid: string, patch: Partial<WaMessage>) => {
  const i = messages.findIndex((x) => x.id === mid);
  if (i < 0) return;
  messages[i] = { ...messages[i], ...patch };
  emit(messages[i]);
};

export async function demoLoadMessages(phone?: string) {
  seed();
  return messages.filter((x) => !phone || x.phone === digits(phone)).sort((x, y) => x.createdAt.localeCompare(y.createdAt));
}
export async function demoLoadChats() { seed(); return chats.map((c) => ({ ...c })); }
export async function demoMarkRead(phone: string) {
  const p = digits(phone);
  const c = chats.find((x) => x.phone === p);
  if (c) c.lastReadAt = new Date().toISOString(); else chats.push({ phone: p, lastReadAt: new Date().toISOString() });
}
export function demoSubscribe(cb: (m: WaMessage) => void) { listeners.add(cb); return () => { listeners.delete(cb); }; }

const REPLIES = ['Thank you! 👍', 'Perfect, that works for me.', 'Great, see you then!', 'Ok noted 🙏', 'Can I pay by card on pickup?'];

/** "Sends" a message: ticks go sent → delivered → read, then the customer replies */
export async function demoSend(to: string, body: string, staff?: string, template?: string): Promise<WaMessage> {
  seed();
  const msg: WaMessage = {
    id: id(), phone: digits(to), direction: 'out', kind: template ? 'template' : 'text', template, body,
    status: 'sent', staff, createdAt: new Date().toISOString(),
  };
  messages.push(msg);
  setTimeout(() => update(msg.id, { status: 'delivered' }), 1200);
  setTimeout(() => update(msg.id, { status: 'read' }), 2800);
  setTimeout(() => {
    const reply: WaMessage = {
      id: id(), phone: msg.phone, direction: 'in', kind: 'text', status: 'received',
      body: template ? 'Hi, yes please — I would like to go ahead.' : REPLIES[Math.floor(Math.random() * REPLIES.length)],
      createdAt: new Date().toISOString(),
    };
    messages.push(reply);
    emit(reply);
  }, 5000);
  return msg;
}
