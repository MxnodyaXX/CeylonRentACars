/* =====================================================================
   The full booking record — booking number, price breakdown, payment
   ledger, files and history. Pure helpers (plus file upload) used by the
   Booking Details window and the store.
   ===================================================================== */
import { supabase, supabaseEnabled } from './supabase';
import { bookingBill, bookingDue, bookingPaid } from './credit';
import { UNIT, RentalType } from './rentalPeriod';
import type { ActivityEntry, Booking, PaymentEntry, Vehicle } from '../types';

/** Human booking number for calls, receipts and WhatsApp: CRC-2026-K3F9 */
export const bookingNo = (b: Pick<Booking, 'id' | 'createdAt' | 'startDate'>) =>
  `CRC-${(b.createdAt || b.startDate || '').slice(0, 4) || '0000'}-${b.id.replace(/[^a-z0-9]/gi, '').slice(-4).toUpperCase().padStart(4, '0')}`;

export const newId = () => Math.random().toString(36).slice(2, 10);
export const rs = (n: number) => `Rs ${Math.round(n).toLocaleString('en-LK')}`;

/* ---------- Price ---------- */

export interface PriceLine { label: string; amount: number; tone?: 'minus' | 'muted' }
/** Rental × rate, extra charges, discount → bill; then paid and due */
export function priceBreakdown(b: Booking, vehicle?: Vehicle) {
  const type = (b.rentalType ?? 'Daily') as RentalType;
  const lines: PriceLine[] = [];
  // recovered part-way through a month: the full months, then the days of the month in progress
  const recovered = type === 'Monthly' && b.checklists?.return?.recovery && b.unitRate;
  const fullMonths = recovered ? (b.rentalUnits ?? 0) * b.unitRate! : 0;
  if (recovered && b.totalAmount > fullMonths) {
    if (b.rentalUnits) lines.push({ label: `${b.rentalUnits} ${b.rentalUnits === 1 ? UNIT[type].one : UNIT[type].many} × ${rs(b.unitRate!)}`, amount: fullMonths });
    lines.push({ label: 'Part month — days used until the vehicle was recovered', amount: b.totalAmount - fullMonths });
  } else if (type !== 'Daily' && b.rentalUnits) {
    lines.push({ label: `${b.rentalUnits} ${b.rentalUnits === 1 ? UNIT[type].one : UNIT[type].many} × ${rs(b.unitRate ?? 0)}`, amount: b.totalAmount });
  } else {
    const rate = b.totalDays ? Math.round(b.totalAmount / b.totalDays) : vehicle?.dailyRent ?? 0;
    lines.push({ label: `${b.totalDays} day${b.totalDays === 1 ? '' : 's'} × ${rs(rate)}`, amount: b.totalAmount });
  }
  const charged = (b.charges ?? []).filter((c) => c.status === 'Charged');
  const chargedTotal = charged.reduce((s, c) => s + c.amount, 0);
  const otherExtras = (b.extraCharges ?? 0) - chargedTotal;
  if (otherExtras > 0) lines.push({ label: 'Extra charges (km, extras)', amount: otherExtras });
  charged.forEach((c) => lines.push({ label: `${c.kind}${c.note ? ` — ${c.note}` : ''}`, amount: c.amount }));
  if (b.discount) lines.push({ label: 'Discount', amount: -b.discount, tone: 'minus' });
  return { lines, bill: bookingBill(b), paid: bookingPaid(b), due: bookingDue(b) };
}

/* ---------- Payment ledger ---------- */

/** Net money in from the customer for one ledger entry (deposits are tracked separately) */
const netOf = (p: PaymentEntry) => (p.kind === 'Payment' || p.kind === 'Advance' ? p.amount : p.kind === 'Refund' ? -p.amount : 0);

/**
 * The ledger to show. Bookings made before the ledger existed only have totals, so the
 * money not explained by ledger entries is shown as one "recorded before the payment log" line.
 */
export function ledgerOf(b: Booking): PaymentEntry[] {
  const list = [...(b.payments ?? [])];
  const explained = list.reduce((s, p) => s + netOf(p), 0);
  const legacy = bookingPaid(b) - explained;
  if (legacy > 0) {
    list.unshift({ id: 'legacy', at: b.createdAt, kind: 'Payment', amount: legacy, method: b.paymentMethod ?? '—', by: '—', note: 'Recorded before the payment log' });
  }
  const depositLogged = list.filter((p) => p.kind === 'Deposit received').reduce((s, p) => s + p.amount, 0);
  if (b.depositType === 'cash' && (b.depositAmount ?? 0) > depositLogged) {
    list.unshift({ id: 'legacy-deposit', at: b.createdAt, kind: 'Deposit received', amount: (b.depositAmount ?? 0) - depositLogged, method: 'Cash', by: '—', note: 'Recorded before the payment log' });
  }
  return list.sort((a, c) => a.at.localeCompare(c.at));
}

/** Cash deposit still held (collected − returned − deducted) */
export const depositHeld = (b: Booking) =>
  b.depositType === 'cash' ? Math.max(0, (b.depositAmount ?? 0) - (b.depositReturned ?? 0) - (b.depositDeduction ?? 0)) : 0;

/* ---------- History ---------- */

/** Activity entries + the older "[Corrected …]" / "[Cancelled …]" note lines, newest first */
export function historyOf(b: Booking): ActivityEntry[] {
  const out: ActivityEntry[] = [...(b.activity ?? [])];
  out.push({ at: b.createdAt, by: b.insertedByAdmin ? 'Admin (owner entry)' : '—', type: 'Created', text: 'Booking created' });
  for (const line of (b.notes ?? '').split('\n')) {
    const m = line.match(/^\[(Corrected|Cancelled) (.+?) by (.+?): (.+)\]$/);
    if (!m) continue;
    const at = new Date(m[2].replace(',', ''));
    // skip lines already written to the activity log
    if (out.some((a) => a.text === m[4])) continue;
    out.push({ at: isNaN(at.getTime()) ? b.createdAt : at.toISOString(), by: m[3], type: m[1] === 'Corrected' ? 'Edited' : 'Cancelled', text: m[4] });
  }
  return out.sort((a, c) => c.at.localeCompare(a.at));
}
/** Customer-facing notes without the audit lines (those show in History) */
export const plainNotes = (notes?: string) =>
  (notes ?? '').split('\n').filter((l) => !/^\[(Corrected|Cancelled) .+\]$/.test(l)).join('\n').trim();

/* ---------- Handover ---------- */

export const FUEL_LEVELS = ['Full', '3/4', '1/2', '1/4', 'Empty'] as const;
export const CHECK_ITEMS = [
  'Spare tyre', 'Jack & wheel spanner', 'Vehicle documents', 'Revenue licence & insurance card', 'First-aid kit',
  'Floor mats', 'AC working', 'Lights & indicators', 'Tyres OK', 'Interior clean', 'Child seat (if booked)',
] as const;

/* ---------- Files (private bucket) ---------- */

const BUCKET = 'booking-files';

/** Shrink photos to ~1600px JPEG before upload — phone photos are often 5–10 MB */
export async function compressImage(file: File, max = 1600, quality = 0.82): Promise<Blob> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file;
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return file;
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return await new Promise((res) => canvas.toBlob((b) => res(b ?? file), 'image/jpeg', quality));
}
const toDataUrl = (blob: Blob) => new Promise<string>((res, rej) => {
  const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = rej; r.readAsDataURL(blob);
});

/** Upload a document / photo for a booking. Returns the storage path (or a data URL when offline). */
export async function uploadBookingFile(bookingId: string, file: File): Promise<string> {
  const blob = await compressImage(file);
  const isImg = blob.type.startsWith('image/');
  if (!supabaseEnabled) return toDataUrl(blob);
  const ext = isImg ? 'jpg' : (file.name.split('.').pop() ?? 'bin');
  const path = `${bookingId}/${Date.now()}-${newId()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: isImg ? 'image/jpeg' : file.type || undefined });
  if (error) throw error;
  return path;
}
/** A short-lived link to open a stored file */
export async function fileUrl(path: string): Promise<string> {
  if (path.startsWith('data:') || path.startsWith('http')) return path;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 10);
  if (error) throw error;
  return data.signedUrl;
}
export async function deleteBookingFile(path: string) {
  if (!supabaseEnabled || path.startsWith('data:')) return;
  await supabase.storage.from(BUCKET).remove([path]).catch(() => undefined);
}

/* ---------- Readable change records ---------- */

export interface FieldChange { label: string; from: string; to: string; delta?: number }

const pretty = (v: string) => {
  const m = v.trim().match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}):(\d{2}))?$/);
  if (!m) return v.trim();
  const date = new Date(`${m[1]}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  if (!m[2]) return date;
  const h = Number(m[2]);
  return `${date}, ${h % 12 || 12}:${m[3]} ${h >= 12 ? 'PM' : 'AM'}`;
};
const money = (v: string) => { const m = v.match(/^Rs ([\d,]+)$/); return m ? Number(m[1].replace(/,/g, '')) : undefined; };

/**
 * Split an edit record — "Return: 2026-10-14 07:00 → 2026-10-23 21:00; Total: Rs 84,500 → Rs 115,000 — reason"
 * — into rows. Returns null when the text isn't a list of changes.
 */
export function parseChanges(text: string): { changes: FieldChange[]; reason?: string } | null {
  const parts = text.split('; ');
  const changes: FieldChange[] = [];
  let reason: string | undefined;
  for (let i = 0; i < parts.length; i++) {
    const last = i === parts.length - 1;
    const m = parts[i].match(last ? /^([^:→]+): (.*?) → (.*?)(?: — (.+))?$/ : /^([^:→]+): (.*?) → (.*)$/);
    if (!m) return null;
    const from = pretty(m[2]), to = pretty(m[3]);
    const a = money(from), b = money(to);
    changes.push({ label: m[1].trim(), from, to, ...(a !== undefined && b !== undefined && a !== b ? { delta: b - a } : {}) });
    if (last && m[4]) reason = m[4].trim();
  }
  return changes.length ? { changes, reason } : null;
}

/* ---------- What still needs filling in ---------- */

export type DetailsTab = 'overview' | 'payments' | 'vehicle' | 'documents' | 'history';
export interface MissingItem {
  label: string;
  tab: DetailsTab | 'edit';   // where it is filled in ('edit' = the Edit form)
  critical?: boolean;         // needed before the vehicle is handed over
  after?: boolean;            // can only be done once the booking is saved (copies, agreement, checklists)
}

/**
 * Details still missing on a booking — upcoming, live and completed alike (cancelled never).
 * critical = needed before the vehicle is handed over. `after` items (copies, agreement,
 * checklists) can only be done once the booking exists, so new-booking forms leave them out.
 */
export function missingInfo(b: Booking): MissingItem[] {
  if (b.status === 'Cancelled') return [];
  const out: MissingItem[] = [];
  const ci = b.customerInfo ?? {};
  const selfDrive = !b.driverId;
  const docs = b.documents ?? [];
  const handedOver = b.status === 'Ongoing' || b.status === 'Completed';

  if (!b.customerNIC && !ci.passportNumber) out.push({ label: 'NIC / passport no.', tab: 'overview', critical: true });
  if (selfDrive) {
    if (!ci.licenceNumber) out.push({ label: 'Licence number', tab: 'overview', critical: true });
    if (!ci.licenceExpiry) out.push({ label: 'Licence expiry', tab: 'overview' });
    else if (ci.licenceExpiry < b.endDate) out.push({ label: 'Licence expires before return', tab: 'overview', critical: true });
    if (ci.licenceType === 'Foreign' && !ci.idp) out.push({ label: 'International Driving Permit', tab: 'overview', critical: true });
  }
  if (!b.pickupLocation) out.push({ label: 'Pickup location', tab: 'edit' });
  if (!b.dropLocation) out.push({ label: 'Return location', tab: 'edit' });
  if (!b.startTime) out.push({ label: 'Pickup time', tab: 'edit' });
  if (!b.endTime) out.push({ label: 'Return time', tab: 'edit' });
  if (!docs.some((d) => d.kind === 'NIC / Passport')) out.push({ label: 'ID copy', tab: 'documents', after: true });
  if (selfDrive && !docs.some((d) => d.kind === 'Driving licence')) out.push({ label: 'Licence copy', tab: 'documents', after: true });
  if (handedOver && !b.agreement?.signedAt && !docs.some((d) => d.kind === 'Signed agreement')) out.push({ label: 'Signed agreement', tab: 'documents', after: true });
  if (handedOver && !b.checklists?.pickup) out.push({ label: 'Pickup checklist', tab: 'vehicle', after: true });
  if (b.status === 'Completed') {
    if (!b.checklists?.return) out.push({ label: 'Return checklist', tab: 'vehicle', after: true });
    if (depositHeld(b) > 0) out.push({ label: 'Deposit to settle', tab: 'payments', critical: true });
  }
  return out;
}

/** Customer details still missing, worded for the customer (used to ask them by WhatsApp / SMS) */
export function customerDetailsToAsk(b: Booking): string[] {
  const ci = b.customerInfo ?? {};
  const docs = b.documents ?? [];
  const selfDrive = !b.driverId;
  const out: string[] = [];
  if (!b.customerNIC && !ci.passportNumber) out.push('NIC or passport number');
  if (!docs.some((d) => d.kind === 'NIC / Passport')) out.push('a photo of your NIC / passport');
  if (selfDrive) {
    if (!ci.licenceNumber || !ci.licenceExpiry) out.push('driving licence number and expiry date');
    if (!docs.some((d) => d.kind === 'Driving licence')) out.push('a photo of your driving licence (both sides)');
    if (ci.licenceType === 'Foreign' && !ci.idp) out.push('your International Driving Permit');
  }
  if (!ci.address) out.push('home address');
  if (!ci.emergencyName || !ci.emergencyPhone) out.push('an emergency contact (name and phone)');
  return out;
}

/** The request message; WhatsApp can carry photos, an SMS reply can't, so it asks for those on WhatsApp */
export function customerDetailsMessage(b: Booking, items: string[], via: 'whatsapp' | 'sms'): string {
  const ref = bookingNo(b);
  if (via === 'whatsapp') {
    return [
      `Hello ${b.customerName},`,
      '',
      `Thank you for booking with Ceylon Rent A Cars (${ref}, ${b.startDate}). To prepare your rental agreement, please reply with:`,
      '',
      ...items.map((i) => `• ${i}`),
      '',
      'Thank you! — Ceylon Rent A Cars, 071 733 3313',
    ].join('\n');
  }
  const photos = items.some((i) => i.startsWith('a photo'));
  const text = items.filter((i) => !i.startsWith('a photo'));
  return `Dear ${b.customerName}, for your Ceylon Rent A Cars booking ${ref}`
    + (text.length ? ` please reply with: ${text.join('; ')}.` : ' we need copies of your documents.')
    + (photos ? ' Please WhatsApp photos of your NIC/passport and licence to 071 733 3313.' : '')
    + ' Thank you.';
}

/** Status to show: a booking the company took back (non-payment, fraud…) reads "Recovered", not "Completed" */
export const shownStatus = (b: Pick<Booking, 'status' | 'checklists'>): Booking['status'] | 'Recovered' =>
  b.status === 'Completed' && b.checklists?.return?.recovery ? 'Recovered' : b.status;

/** Same day-of-month n months later (31 Jan + 1 → 28/29 Feb), keeping the time of day */
const addMonths = (d: Date, n: number) => {
  const y = d.getFullYear(), m = d.getMonth() + n;
  return new Date(y, m, Math.min(d.getDate(), new Date(y, m + 1, 0).getDate()), d.getHours(), d.getMinutes());
};

/**
 * Rent for the time a monthly rental actually ran (e.g. the vehicle was recovered early):
 * every full calendar month at the monthly rate, plus the days of the month in progress at
 * that month's day rate (monthly rate ÷ the days in that month). A started day counts, unless
 * partial days are waived for the booking.
 */
export function monthlyRentUsed(start: { date: string; time?: string }, endLocal: string, monthlyRate: number, waivePartialDay = false) {
  const from = new Date(`${start.date}T${start.time || '00:00'}`);
  const to = new Date(endLocal);
  let months = 0;
  while (months < 1200 && addMonths(from, months + 1) <= to) months++;
  const periodStart = addMonths(from, months), periodEnd = addMonths(from, months + 1);
  const monthDays = Math.round((periodEnd.getTime() - periodStart.getTime()) / 86_400_000);
  const partMs = to.getTime() - periodStart.getTime();
  let days = partMs <= 0 ? 0 : waivePartialDay ? Math.floor(partMs / 86_400_000) : Math.ceil(partMs / 86_400_000 - 1e-9);
  if (!months && !days) days = 1;   // at least one day
  const dayRate = monthlyRate / monthDays;
  const partRent = Math.round(days * dayRate);
  return { months, days, monthDays, dayRate, partRent, rent: months * monthlyRate + partRent,
    from, to, periodStart, periodEnd, partMs: Math.max(0, partMs), waived: waivePartialDay };
}
