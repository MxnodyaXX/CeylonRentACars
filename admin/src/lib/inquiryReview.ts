/* =====================================================================
   Inquiry review helpers (inquiry page): lead temperature, response time,
   things to double-check, customer history, alternatives, message templates.
   ===================================================================== */
import type { Booking, Inquiry, InquiryQuote, Vehicle } from '../types';
import { FollowUp, parseRequest } from './inquiryFollowups';

export type Temperature = 'New' | 'Hot' | 'Warm' | 'Cold';

/** Hot / Warm / Cold from the logged outcomes (list is newest first) */
export function temperatureOf(list: FollowUp[], quote?: InquiryQuote): { level: Temperature; reason: string } {
  if (list.length === 0) return { level: 'New', reason: 'Not contacted yet' };
  const last = list[0];
  const ageDays = (Date.now() - new Date(last.createdAt).getTime()) / 864e5;
  const noAnswers = list.filter((f) => f.outcome === 'No answer').length;
  if (last.outcome === 'Not interested') return { level: 'Cold', reason: 'Customer not interested' };
  if (noAnswers >= 2 && last.outcome === 'No answer') return { level: 'Cold', reason: `${noAnswers} unanswered attempts` };
  if (ageDays > 7) return { level: 'Cold', reason: 'No contact for over a week' };
  if (['Confirmed — ready to book', 'Interested', 'Quote sent'].includes(last.outcome) || quote?.status === 'accepted') {
    return { level: 'Hot', reason: quote?.status === 'accepted' ? 'Quote accepted' : last.outcome };
  }
  return { level: 'Warm', reason: last.outcome };
}

const human = (ms: number) => {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
  return `${Math.floor(h / 24)} days`;
};

/** How quickly the team first responded — or how long the lead has been waiting */
export function responseInfo(createdAt: string, list: FollowUp[]) {
  const created = new Date(createdAt).getTime();
  const first = list.length ? list[list.length - 1] : undefined;
  const ms = (first ? new Date(first.createdAt).getTime() : Date.now()) - created;
  return { contacted: !!first, time: human(ms), late: ms > 2 * 3600000 };
}

/** Pull "HH:mm" and the place out of a request line like "Panadura — https://… · 2026-10-07 00:00" */
export const timeIn = (line?: string) => {
  const m = line?.match(/(\d{2}):(\d{2})\s*$/);
  return m ? [Number(m[1]), Number(m[2])] as const : null;
};
export const placeIn = (line?: string) => (line ?? '').split(' · ')[0].replace(/\s*—\s*https?:\/\/\S+/, '').trim();
export const mapIn = (line?: string) => line?.match(/https?:\/\/\S+/)?.[0];

const VAGUE = /^(sri lanka|ceylon|(western|central|southern|northern|eastern|north western|north central|uva|sabaragamuwa) province|—|-)?$/i;

export interface Flag { level: 'warn' | 'info'; text: string }

/** Things to double-check with the customer before confirming */
export function flagsOf(inq: Inquiry): Flag[] {
  const { fields } = parseRequest(inq.notes);
  const out: Flag[] = [];
  ([['Pickup', fields.Pickup], ['Return', fields.Return]] as const).forEach(([label, line]) => {
    if (!line) return;
    const t = timeIn(line);
    if (t && (t[0] >= 23 || t[0] < 5)) {
      out.push({ level: 'warn', text: `${label} time is ${String(t[0]).padStart(2, '0')}:${String(t[1]).padStart(2, '0')} — late night. Confirm with the customer (12 AM means midnight).` });
    }
    const place = placeIn(line);
    if (VAGUE.test(place)) out.push({ level: 'warn', text: `${label} location "${place || '—'}" is too vague — ask for the exact address or hotel.` });
  });
  if (fields.Type === 'Airport pickup' && !/flight/i.test(fields.Message ?? '')) {
    out.push({ level: 'info', text: 'Airport pickup — ask for the flight number and landing time.' });
  }
  return out;
}

const lastDigits = (p?: string) => (p ?? '').replace(/\D/g, '').slice(-9);

/** Past bookings by the same phone number or email */
export function customerHistory(inq: Inquiry, bookings: Booking[]) {
  const phone = lastDigits(inq.customerPhone);
  const email = parseRequest(inq.notes).fields.Email?.toLowerCase();
  const mine = bookings
    .filter((b) => (phone.length >= 7 && lastDigits(b.customerPhone) === phone) || (!!email && b.customerEmail?.toLowerCase() === email))
    .sort((a, b) => b.startDate.localeCompare(a.startDate));
  const live = mine.filter((b) => b.status !== 'Cancelled');
  const completed = mine.filter((b) => b.status === 'Completed');
  return {
    bookings: mine,
    completed: completed.length,
    spent: completed.reduce((sum, b) => sum + (b.totalAmount || 0), 0),
    outstanding: live.reduce((sum, b) => sum + Math.max(0, (b.totalAmount || 0) - (b.paidAmount || 0)), 0),
    deductions: mine.filter((b) => (b.depositDeduction ?? 0) > 0),
  };
}

/** The requested vehicle, whether it's free, and similar vehicles free for the dates */
export function alternativesFor(
  inq: Inquiry, vehicles: Vehicle[],
  isAvailable: (id: string, start: string, end: string) => boolean,
) {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const requested = vehicles.find((v) => v.id === inq.vehicleId)
    ?? vehicles.find((v) => norm(inq.requestedVehicle).includes(norm(`${v.brand} ${v.model}`)));
  if (!inq.startDate || !inq.endDate) return { requested, requestedFree: null as boolean | null, list: [] as Vehicle[] };
  const requestedFree = requested ? isAvailable(requested.id, inq.startDate, inq.endDate) : null;
  const seats = requested?.seats ?? 0;
  const price = requested?.dailyRent ?? 0;
  const list = vehicles
    .filter((v) => v.id !== requested?.id && v.status !== 'Maintenance')
    .filter((v) => (v.seats ?? 0) >= seats && (!price || Math.abs(v.dailyRent - price) <= price * 0.5))
    .filter((v) => isAvailable(v.id, inq.startDate, inq.endDate))
    .sort((a, b) => Math.abs(a.dailyRent - price) - Math.abs(b.dailyRent - price))
    .slice(0, 4);
  return { requested, requestedFree, list };
}

/** Rental days between the requested dates (minimum 1) */
export const daysBetween = (start?: string, end?: string) =>
  start && end ? Math.max(1, Math.round((new Date(end + 'T00:00').getTime() - new Date(start + 'T00:00').getTime()) / 864e5)) : 1;

export const rs = (n: number) => `Rs ${Math.round(n).toLocaleString('en-LK')}`;

export const prettyDate = (d?: string) =>
  d ? new Date(d.length === 10 ? d + 'T00:00' : d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

/** Public website link that opens a vehicle's details (photos, specs, reviews) */
const WEBSITE_URL = ((import.meta.env.VITE_WEBSITE_URL as string | undefined) ?? 'http://localhost:5173').replace(/\/$/, '');
export const vehicleLink = (id: string) => `${WEBSITE_URL}/vehicles?vehicle=${encodeURIComponent(id)}`;

/** One personal page listing all suggested vehicles, with an apology and the customer's dates */
export function alternativesLink(inq: Inquiry, alternatives: Vehicle[], ref?: string) {
  const q = new URLSearchParams({
    ids: alternatives.map((v) => v.id).join(','),
    req: inq.requestedVehicle.replace(/\s*\(.*\)$/, ''),     // without the plate number
    n: inq.customerName.trim().split(' ')[0],
    ...(inq.startDate ? { from: inq.startDate } : {}),
    ...(inq.endDate ? { to: inq.endDate } : {}),
    ...(ref ? { ref } : {}),
  });
  return `${WEBSITE_URL}/alternatives?${q.toString()}`;
}

const SIGN = (staff: string) => ['', 'Kind regards,', staff, '*Ceylon Rent A Cars*', '📞 077 972 6761'];

/** One-click WhatsApp / email templates (*bold* renders bold in WhatsApp) */
export function templates(inq: Inquiry, staff: string, alternatives: Vehicle[] = [], requestedId?: string) {
  const first = inq.customerName.trim().split(' ')[0];
  const ref = parseRequest(inq.notes).reference;
  const dates = inq.startDate && inq.endDate ? `${prettyDate(inq.startDate)} – ${prettyDate(inq.endDate)}` : '';
  const open = (line: string) => [`Dear ${first},`, '', line, ''];
  return [
    {
      id: 'intro', label: 'Introduction',
      text: [...open(`Thank you for your ${ref ? `booking request (*${ref}*)` : 'inquiry'} with *Ceylon Rent A Cars*.`),
        `🚗 *Vehicle:* ${inq.requestedVehicle}`, ...(dates ? [`📅 *Dates:* ${dates}`] : []), '',
        'We would like to confirm a few details and answer any questions you may have. When would be a good time for a quick call?',
        ...SIGN(staff)].join('\n'),
    },
    {
      id: 'confirmed', label: 'Vehicle confirmed',
      text: [...open(`Good news — the *${inq.requestedVehicle}* is confirmed for your trip${dates ? ` (${dates})` : ''}. ✅`),
        ...(requestedId ? ['🔗 *Vehicle details & photos:*', vehicleLink(requestedId), ''] : []),
        'We will share the final quote and deposit details shortly. Please let us know if anything changes.',
        ...SIGN(staff)].join('\n'),
    },
    {
      id: 'alternatives', label: 'Dates not available',
      text: [...open(`We're sorry — the *${inq.requestedVehicle.replace(/\s*\(.*\)$/, '')}* is not available${dates ? ` for ${dates}` : ''}. We have picked similar vehicles that are free for your trip:`),
        ...(alternatives.length
          ? [
              ...alternatives.map((v) => `• *${v.brand} ${v.model}* (${v.year}) — from ${rs(v.webPrice ?? v.dailyRent)}/day`),
              '',
              '👉 *See them all with photos & book:*',
              alternativesLink(inq, alternatives, ref),
            ]
          : ['• Please tell us your preferred vehicle type and we will find the best match.']),
        '', 'Would any of these work for you?', ...SIGN(staff)].join('\n'),
    },
    {
      id: 'licence', label: 'Licence photo',
      text: [...open('To prepare your rental, please send us:'),
        '1️⃣ A photo of your *driving licence* (front and back)',
        '2️⃣ Your *International Driving Permit* (if your licence is not Sri Lankan)',
        '3️⃣ A photo of your *passport* information page',
        '', 'We will arrange the temporary Sri Lankan driving permit for you if needed.', ...SIGN(staff)].join('\n'),
    },
    {
      id: 'payment', label: 'Payment / deposit',
      text: [...open(`To confirm your booking${ref ? ` (*${ref}*)` : ''}, please pay the deposit using the details below:`),
        ...(inq.quote ? [`💰 *Total:* ${rs(inq.quote.total)}`, `🔒 *Deposit:* ${rs(inq.quote.deposit)}`, ''] : []),
        '🏦 *Bank:* ________', '👤 *Account name:* Ceylon Rent A Cars', '🔢 *Account no:* ________',
        '', 'Please send us the payment slip once done. The deposit is refunded when the vehicle is returned.',
        ...SIGN(staff)].join('\n'),
    },
  ];
}

/** Quote → WhatsApp / email text */
export function quoteMessage(inq: Inquiry, q: InquiryQuote, staff: string) {
  const first = inq.customerName.trim().split(' ')[0];
  const ref = parseRequest(inq.notes).reference;
  const dates = inq.startDate && inq.endDate ? `${prettyDate(inq.startDate)} – ${prettyDate(inq.endDate)}` : '';
  return [
    `Dear ${first},`, '',
    `Here is your quote${ref ? ` for booking request *${ref}*` : ''}:`, '',
    `🚗 *Vehicle:* ${inq.requestedVehicle}`,
    ...(dates ? [`📅 *Dates:* ${dates} (${q.days} ${q.days === 1 ? 'day' : 'days'})`] : []),
    '',
    `• Rental: ${rs(q.dailyRate)} × ${q.days} days = ${rs(q.dailyRate * q.days)}`,
    ...q.extras.filter((e) => e.amount).map((e) => `• ${e.label}: ${rs(e.amount)}`),
    ...(q.discount ? [`• Discount: −${rs(q.discount)}`] : []),
    '',
    `💰 *Total: ${rs(q.total)}*`,
    `🔒 *Refundable deposit:* ${rs(q.deposit)}`,
    '',
    'Reply *YES* to confirm and we will send the payment details.',
    ...SIGN(staff),
  ].join('\n');
}

/** The qualification checklist: "can we actually serve this booking?" */
export const CHECKLIST = [
  { id: 'available', label: 'Vehicle available for the dates', hint: 'Double-checked against the bookings calendar' },
  { id: 'licence', label: 'Licence checked', hint: 'Self-drive: licence + International Driving Permit, or local permit arranged' },
  { id: 'fits', label: 'Passengers & luggage fit the vehicle', hint: 'Number of people, bags, child seats' },
  { id: 'locations', label: 'Pickup & return confirmed', hint: 'Exact address / hotel — flight number for airport pickups' },
  { id: 'price', label: 'Price & deposit agreed', hint: 'Quote sent and accepted by the customer' },
] as const;
