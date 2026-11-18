/* =====================================================================
   Rental agreement designer: the company's own agreement (uploaded as a PDF,
   one background image per page) with booking fields placed on top.
   Printing fills every {{field}} from the booking and prints the pages.
   The template lives in app_settings ('agreement_template'); page images in
   the public vehicle-images bucket under templates/agreement/ (admin-only writes).
   ===================================================================== */
import type { Booking, Owner, PaymentEntry, Vehicle } from '../types';
import { bookingNo, depositHeld, priceBreakdown } from './bookingRecord';
import { durationLabel } from './rentalPeriod';
import { fullDayRate } from './partDay';
import { supabase, supabaseEnabled } from './supabase';
import { DEFAULT_POLICIES, rentalAgreementHtml } from './printAgreement';

export type TplKind = 'text' | 'box' | 'line' | 'check' | 'signature' | 'image' | 'breakdown';

export interface TplElement {
  id: string;
  page: number;                 // page index
  kind: TplKind;
  x: number; y: number; w: number; h: number;   // millimetres from the page's top-left corner
  text?: string;                // text: may hold {{field}} tokens
  size?: number;                // font size in pt
  bold?: boolean;
  italic?: boolean;
  color?: string;
  align?: 'left' | 'center' | 'right';
  fit?: boolean;                // shrink the text until it fits the box
  fill?: string;                // box: background colour (white = cover the dotted line)
  border?: string;              // box: border colour ('' = none)
  field?: string;               // check: tick when this field's value equals `equals`; signature: 'pickup' | 'return'
  equals?: string;
  src?: string;                 // image
  showDetail?: boolean;         // breakdown: the small "how it was worked out" line under each item (default on)
  showTotal?: boolean;          // breakdown: the total line at the bottom (default on)
  font?: string;                // CSS font-family (one of FONTS); missing = Arial
  lineHeight?: number;          // line spacing (1.2 = normal)
  letterSpacing?: number;       // extra space between letters, in pt
}

/** Fonts every Windows / Mac browser has */
export const FONTS: { label: string; css: string }[] = [
  { label: 'Arial', css: 'Arial, Helvetica, sans-serif' },
  { label: 'Calibri', css: "Calibri, Carlito, 'Segoe UI', sans-serif" },
  { label: 'Segoe UI', css: "'Segoe UI', Roboto, sans-serif" },
  { label: 'Verdana', css: 'Verdana, Geneva, sans-serif' },
  { label: 'Tahoma', css: 'Tahoma, Geneva, sans-serif' },
  { label: 'Times New Roman', css: "'Times New Roman', Times, serif" },
  { label: 'Georgia', css: 'Georgia, serif' },
  { label: 'Cambria', css: 'Cambria, Georgia, serif' },
  { label: 'Courier New', css: "'Courier New', Courier, monospace" },
];
export const DEFAULT_FONT = FONTS[0].css;

export interface TplPage { src: string; w: number; h: number }   // background image + page size in mm

export interface AgreementTemplate {
  pages: TplPage[];
  elements: TplElement[];
  /** the company's standard terms (cleaning fee, cancellation…) — may hold {{field}} tokens */
  terms?: Record<string, string>;
  updatedAt?: string;
  updatedBy?: string;
}

export const A4 = { w: 210, h: 297 };
export const emptyTemplate = (): AgreementTemplate => ({ pages: [], elements: [] });

/* ---------- Fields ---------- */

export interface TplField { key: string; label: string; group: string; sample: string }

/**
 * The company's standard terms: typed once in the designer (Company terms), printed on every agreement.
 * The default text may use {{fields}} from the booking.
 */
export const TERM_FIELDS: TplField[] = [
  { key: 'insuranceCoverage', label: 'Insurance coverage', group: 'Company terms', sample: 'Comprehensive' },
  { key: 'materialExclusions', label: 'Material exclusions disclosed', group: 'Company terms', sample: 'None' },
  { key: 'agreedFuel', label: 'Agreed fuel type / grade', group: 'Company terms', sample: '{{fuelType}}' },
  { key: 'specificConditions', label: 'Applicable specific conditions', group: 'Company terms', sample: 'None' },
  { key: 'balanceDueWhen', label: 'Balance due date / time', group: 'Company terms', sample: 'At pickup — {{pickupDateTime}}' },
  { key: 'lateGrace', label: 'Late-return grace period', group: 'Company terms', sample: '2 hours' },
  { key: 'lateCharge', label: 'Late-return charge', group: 'Company terms', sample: 'One extra day ({{rate}})' },
  { key: 'cleaningFee', label: 'Cleaning fee conditions / cap', group: 'Company terms', sample: 'Only if returned unusually dirty — up to Rs 3,000' },
  { key: 'fuelShortfall', label: 'Fuel-shortfall adjustment / service fee', group: 'Company terms', sample: 'Fuel used at the pump price + Rs 500 service fee' },
  { key: 'driverDelivery', label: 'Additional driver / delivery charges', group: 'Company terms', sample: 'As agreed — none for this booking' },
  { key: 'depositRefund', label: 'Deposit refund deadline / channel', group: 'Company terms', sample: 'At return, or within 7 days — cash or bank transfer' },
  { key: 'cancellationSchedule', label: 'Approved cancellation schedule & version', group: 'Company terms', sample: 'Advance refundable up to 48 hours before pickup · v1' },
];

const BREAKDOWN_SAMPLE = JSON.stringify({
  rows: [
    { label: '4 days × Rs 8,500', detail: "the car's standard daily rate", amount: 34000, group: 'rent' },
    { label: 'Child seat', detail: '4 days × Rs 500', amount: 2000, group: 'charge' },
    { label: 'Discount', amount: -2000, group: 'deduction' },
  ],
  total: 34000,
});

export const FIELDS: TplField[] = [
  // Agreement
  { key: 'agreementNo', label: 'Agreement no. (booking no.)', group: 'Agreement', sample: 'CRC-2026-K3F9' },
  { key: 'bookingRef', label: 'Booking ref', group: 'Agreement', sample: 'CRC-2026-K3F9' },
  { key: 'today', label: "Today's date", group: 'Agreement', sample: '17 Nov 2026' },
  { key: 'staff', label: 'Printed by (staff)', group: 'Agreement', sample: 'Manodya' },
  // Customer
  { key: 'customerName', label: 'Full name', group: 'Customer', sample: 'Janaka Ranga Thilakarathne' },
  { key: 'nic', label: 'NIC / Passport no.', group: 'Customer', sample: '199012345678' },
  { key: 'licence', label: 'Licence no. / expiry', group: 'Customer', sample: 'B1234567 / 12 Mar 2030' },
  { key: 'licenceNo', label: 'Licence no.', group: 'Customer', sample: 'B1234567' },
  { key: 'licenceExpiry', label: 'Licence expiry', group: 'Customer', sample: '12 Mar 2030' },
  { key: 'address', label: 'Permanent address', group: 'Customer', sample: 'No 12, Galle Road, Panadura' },
  { key: 'mobile', label: 'Mobile', group: 'Customer', sample: '077 123 4567' },
  { key: 'email', label: 'Email', group: 'Customer', sample: 'janaka@example.com' },
  { key: 'mobileEmail', label: 'Mobile / email', group: 'Customer', sample: '077 123 4567 / janaka@example.com' },
  { key: 'emergency', label: 'Emergency contact / mobile', group: 'Customer', sample: 'Nimali / 071 765 4321' },
  { key: 'nationality', label: 'Nationality', group: 'Customer', sample: 'Sri Lankan' },
  // Vehicle
  { key: 'vehicleNo', label: 'Registration no.', group: 'Vehicle', sample: 'CBU-1352' },
  { key: 'makeModelYear', label: 'Make / model / year', group: 'Vehicle', sample: 'Toyota Raize / 2022' },
  { key: 'makeModel', label: 'Make & model', group: 'Vehicle', sample: 'Toyota Raize' },
  { key: 'year', label: 'Year', group: 'Vehicle', sample: '2022' },
  { key: 'colourFuel', label: 'Colour / fuel type', group: 'Vehicle', sample: 'White / Petrol' },
  { key: 'colour', label: 'Colour', group: 'Vehicle', sample: 'White' },
  { key: 'fuelType', label: 'Fuel type', group: 'Vehicle', sample: 'Petrol' },
  { key: 'transmission', label: 'Transmission', group: 'Vehicle', sample: 'Auto' },
  { key: 'owner', label: 'Vehicle owner', group: 'Vehicle', sample: 'Brian Perera' },
  { key: 'insurance', label: 'Insurance provider / policy', group: 'Vehicle', sample: 'Ceylinco / VP-2231' },
  { key: 'insuranceExcess', label: 'Insurance excess', group: 'Vehicle', sample: 'Rs 25,000' },
  { key: 'insuranceCoverageExcess', label: 'Insurance coverage / excess', group: 'Vehicle', sample: 'Comprehensive / Rs 25,000' },
  // Rental period
  { key: 'pickupDate', label: 'Pickup date', group: 'Rental', sample: '20 Dec 2026' },
  { key: 'pickupTime', label: 'Pickup time', group: 'Rental', sample: '09:00' },
  { key: 'pickupDateTime', label: 'Pickup date / time', group: 'Rental', sample: '20 Dec 2026 / 09:00' },
  { key: 'returnDate', label: 'Return date', group: 'Rental', sample: '24 Dec 2026' },
  { key: 'returnTime', label: 'Return time', group: 'Rental', sample: '09:00' },
  { key: 'returnDateTime', label: 'Return date / time', group: 'Rental', sample: '24 Dec 2026 / 09:00' },
  { key: 'pickupLocation', label: 'Pickup location', group: 'Rental', sample: 'Panadura office' },
  { key: 'returnLocation', label: 'Return location', group: 'Rental', sample: 'Panadura office' },
  { key: 'rentalPackage', label: 'Rental package (Daily / Monthly / Hourly)', group: 'Rental', sample: 'Daily' },
  { key: 'packageBox', label: 'Package tick (Daily / Weekly / Monthly / Other)', group: 'Rental', sample: 'Daily' },
  { key: 'tripType', label: 'Trip type (Self drive / With driver)', group: 'Rental', sample: 'Self drive' },
  { key: 'duration', label: 'Duration', group: 'Rental', sample: '4 days' },
  { key: 'rate', label: 'Rate', group: 'Rental', sample: 'Rs 8,500 a day' },
  { key: 'dailyRate', label: 'Daily rate (Rs …)', group: 'Rental', sample: 'Rs 8,500' },
  { key: 'includedKm', label: 'Included km', group: 'Rental', sample: '400' },
  { key: 'extraKmRate', label: 'Extra km rate (number)', group: 'Rental', sample: '50' },
  { key: 'allowedArea', label: 'Driving territory / limits', group: 'Rental', sample: DEFAULT_POLICIES.allowedArea },
  { key: 'fuelPolicy', label: 'Fuel policy', group: 'Rental', sample: DEFAULT_POLICIES.fuelPolicy },
  { key: 'lateReturnPolicy', label: 'Late return policy', group: 'Rental', sample: DEFAULT_POLICIES.lateReturnPolicy },
  { key: 'driverName', label: 'Assigned driver', group: 'Rental', sample: '' },
  // Payment
  { key: 'total', label: 'Total rental charge (number)', group: 'Payment', sample: '34,000' },
  { key: 'chargeBreakdown', label: 'How the total was worked out (text lines)', group: 'Payment', sample: "4 days × Rs 8,500 (the car's standard daily rate) — Rs 34,000\nChild seat (4 days × Rs 500) — Rs 2,000\nDiscount — − Rs 2,000\nTotal — Rs 34,000" },
  { key: 'paid', label: 'Paid so far (number)', group: 'Payment', sample: '10,000' },
  { key: 'advance', label: 'Advance (number)', group: 'Payment', sample: '10,000' },
  { key: 'advanceReceipt', label: 'Advance receipt / reference', group: 'Payment', sample: 'Receipt 1043 · 12 Nov 2026 · Bank transfer' },
  { key: 'balance', label: 'Balance due (number)', group: 'Payment', sample: '24,000' },
  { key: 'deposit', label: 'Security deposit (number)', group: 'Payment', sample: '25,000' },
  { key: 'depositText', label: 'Security deposit (as text)', group: 'Payment', sample: 'Rs 25,000 cash' },
  { key: 'depositReceipt', label: 'Deposit receipt / reference', group: 'Payment', sample: 'Receipt 1051 · 20 Dec 2026 · Cash' },
  { key: 'paymentMethod', label: 'Payment method', group: 'Payment', sample: 'Cash' },
  // Handover / return
  { key: 'pickupAt', label: 'Handover date / time', group: 'Handover', sample: '20 Dec 2026, 09:12' },
  { key: 'pickupOdometer', label: 'Odometer at handover', group: 'Handover', sample: '45,210' },
  { key: 'pickupFuel', label: 'Fuel at handover', group: 'Handover', sample: '3/4' },
  { key: 'pickupDamage', label: 'Damage noted at handover', group: 'Handover', sample: 'Small scratch, rear bumper' },
  { key: 'pickupItems', label: 'Items handed over', group: 'Handover', sample: 'Spare tyre, Jack & wheel spanner' },
  { key: 'returnAt', label: 'Return date / time (actual)', group: 'Handover', sample: '' },
  { key: 'returnOdometer', label: 'Odometer at return', group: 'Handover', sample: '' },
  { key: 'returnFuel', label: 'Fuel at return', group: 'Handover', sample: '' },
  { key: 'returnDamage', label: 'Damage noted at return', group: 'Handover', sample: '' },
  ...TERM_FIELDS,
];

export const fieldLabel = (key: string) => FIELDS.find((f) => f.key === key)?.label ?? key;
export const SAMPLE_VALUES: Record<string, string> = { ...Object.fromEntries(FIELDS.map((f) => [f.key, f.sample])), breakdown: BREAKDOWN_SAMPLE };

/** Adds the company terms to a booking's values (their {{fields}} filled from the booking) */
export function applyTerms(values: Record<string, string>, terms?: Record<string, string>): Record<string, string> {
  const out = { ...values };
  for (const f of TERM_FIELDS) out[f.key] = fillText(terms?.[f.key] ?? f.sample, values);
  out.insuranceCoverageExcess = join(out.insuranceCoverage, values.insuranceExcess);
  return out;
}

/** "Receipt 1043 · 12 Nov 2026 · Bank transfer" for each ledger entry of a kind */
const receiptText = (b: Booking, kind: PaymentEntry['kind']) =>
  (b.payments ?? []).filter((x) => x.kind === kind)
    .map((x) => [x.receiptNo ? `Receipt ${x.receiptNo}` : '', dNice(x.at), x.method, (b.payments ?? []).filter((y) => y.kind === kind).length > 1 ? `Rs ${num(x.amount)}` : ''].filter(Boolean).join(' · '))
    .join('; ');

const dNice = (d?: string) => (d ? new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const dtNice = (iso?: string) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const num = (n?: number) => (n || n === 0 ? Math.round(n).toLocaleString('en-LK') : '');
const join = (...xs: (string | undefined)[]) => xs.filter((x) => x && x.trim()).join(' / ');

/** Every field's value for one booking */
export function agreementValues(b: Booking, vehicle: Vehicle | undefined, extra: { owner?: Owner; driverName?: string; staff: string }): Record<string, string> {
  const ci = b.customerInfo ?? {};
  const a = { ...DEFAULT_POLICIES, ...(b.agreement ?? {}) };
  const p = priceBreakdown(b, vehicle);
  const pick = b.checklists?.pickup, ret = b.checklists?.return;
  const type = b.rentalType ?? 'Daily';
  const rate = type !== 'Daily' && b.unitRate ? `Rs ${num(b.unitRate)} a ${type === 'Monthly' ? 'month' : 'hour'}`
    : b.totalDays ? `Rs ${num(b.totalAmount / b.totalDays)} a day` : '';
  const deposit = b.depositType === 'cash' ? (depositHeld(b) || b.depositAmount || 0) : 0;
  const advance = b.advanceAmount || (b.payments ?? []).filter((x) => x.kind === 'Advance').reduce((s, x) => s + x.amount, 0);
  const perDay = type !== 'Daily' || !b.totalDays ? 0 : (b.partDayAmount ?? 0) > 0 ? fullDayRate(b) : b.totalAmount / b.totalDays;
  const rows = p.lines.map((l) => ({ label: l.label, detail: l.detail, amount: l.amount, group: l.group }));
  const money = (n: number) => `${n < 0 ? '− ' : ''}Rs ${num(Math.abs(n))}`;
  return {
    agreementNo: bookingNo(b),
    bookingRef: bookingNo(b),
    today: dNice(new Date().toISOString()),
    staff: extra.staff,
    customerName: b.customerName,
    nic: b.customerNIC || ci.passportNumber || '',
    licence: join(ci.licenceNumber, dNice(ci.licenceExpiry)),
    licenceNo: ci.licenceNumber ?? '',
    licenceExpiry: dNice(ci.licenceExpiry),
    address: ci.address ?? '',
    mobile: b.customerPhone,
    email: b.customerEmail ?? '',
    mobileEmail: join(b.customerPhone, b.customerEmail),
    emergency: join(ci.emergencyName, ci.emergencyPhone),
    nationality: ci.nationality ?? '',
    vehicleNo: vehicle?.vehicleNumber ?? '',
    makeModelYear: vehicle ? join(`${vehicle.brand} ${vehicle.model}`, vehicle.year ? String(vehicle.year) : '') : '',
    makeModel: vehicle ? `${vehicle.brand} ${vehicle.model}` : '',
    year: vehicle?.year ? String(vehicle.year) : '',
    colourFuel: join(vehicle?.color, vehicle?.fuelType),
    colour: vehicle?.color ?? '',
    fuelType: vehicle?.fuelType ?? '',
    transmission: vehicle?.transmission ?? '',
    owner: extra.owner?.name ?? '',
    insurance: join(vehicle?.insurance?.provider, vehicle?.insurance?.policyNumber),
    insuranceExcess: a.insuranceExcess ? `Rs ${num(a.insuranceExcess)}` : '',
    pickupDate: dNice(b.startDate),
    pickupTime: b.startTime ?? '',
    pickupDateTime: join(dNice(b.startDate), b.startTime),
    returnDate: dNice(b.endDate),
    returnTime: b.endTime ?? '',
    returnDateTime: join(dNice(b.endDate), b.endTime),
    pickupLocation: b.pickupLocation ?? '',
    returnLocation: b.dropLocation || b.pickupLocation || '',
    rentalPackage: type,
    packageBox: type === 'Hourly' ? 'Other' : type,
    tripType: b.driverId || extra.driverName ? 'With driver' : 'Self drive',
    duration: durationLabel(b),
    rate,
    dailyRate: perDay ? `Rs ${num(perDay)}` : '',
    includedKm: num((vehicle?.includedKmPerDay ?? 100) * (b.totalDays || 1)),
    extraKmRate: num(vehicle?.extraKmRate ?? 50),
    allowedArea: a.allowedArea ?? '',
    fuelPolicy: a.fuelPolicy ?? '',
    lateReturnPolicy: a.lateReturnPolicy ?? '',
    driverName: extra.driverName ?? '',
    total: num(p.bill),
    breakdown: JSON.stringify({ rows, total: p.bill }),
    chargeBreakdown: [...rows.map((r) => `${r.label}${r.detail ? ` (${r.detail})` : ''} — ${money(r.amount)}`), `Total — ${money(p.bill)}`].join('\n'),
    paid: num(p.paid),
    advance: advance ? num(advance) : '',
    // from the payment log; older bookings without entries: the method on the booking
    advanceReceipt: receiptText(b, 'Advance') || (advance ? b.paymentMethod ?? '' : ''),
    depositReceipt: receiptText(b, 'Deposit received') || (deposit ? b.paymentMethod ?? '' : ''),
    balance: num(p.due),
    deposit: deposit ? num(deposit) : '',
    depositText: b.depositType === 'cash' ? `Rs ${num(deposit)} cash` : b.depositType ? (b.depositAssetDescription ?? '') : '',
    paymentMethod: b.paymentMethod ?? '',
    pickupAt: dtNice(pick?.at || b.pickupAt),
    pickupOdometer: num(pick?.odometer),
    pickupFuel: pick?.fuel ?? '',
    pickupDamage: pick?.damage ?? '',
    pickupItems: pick ? Object.entries(pick.items ?? {}).filter(([, v]) => v).map(([k]) => k).join(', ') : '',
    returnAt: dtNice(ret?.at || b.returnAt),
    returnOdometer: num(ret?.odometer),
    returnFuel: ret?.fuel ?? '',
    returnDamage: ret?.damage ?? '',
    'sig:pickup': pick?.signature ?? '',
    'sig:return': ret?.signature ?? '',
  };
}

/** Replaces {{field}} tokens with values */
export const fillText = (text: string, values: Record<string, string>) =>
  text.replace(/\{\{\s*([\w:]+)\s*\}\}/g, (_, k: string) => values[k] ?? '');

/** Whether a tick element is ticked */
export const isTicked = (el: TplElement, values: Record<string, string>) =>
  !!el.field && (values[el.field] ?? '').trim().toLowerCase() === (el.equals ?? '').trim().toLowerCase();

/* ---------- Load / save ---------- */

const KEY = 'agreement_template';
const LOCAL = 'emrac-agreement-template';
let cache: Promise<AgreementTemplate | null> | null = null;

function clean(raw: unknown): AgreementTemplate | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as AgreementTemplate;
  if (!Array.isArray(r.pages) || !Array.isArray(r.elements)) return null;
  return {
    pages: r.pages.filter((p) => p && typeof p.src === 'string'), elements: r.elements.filter((e) => e && e.id),
    terms: r.terms && typeof r.terms === 'object' ? r.terms : undefined, updatedAt: r.updatedAt, updatedBy: r.updatedBy,
  };
}

export function loadAgreementTemplate(fresh = false): Promise<AgreementTemplate | null> {
  if (cache && !fresh) return cache;
  cache = (async () => {
    if (!supabaseEnabled) {
      try { return clean(JSON.parse(localStorage.getItem(LOCAL) || 'null')); } catch { return null; }
    }
    const { data, error } = await supabase.from('app_settings').select('value').eq('key', KEY).maybeSingle();
    if (error) { cache = null; throw error; }
    return clean(data?.value);
  })();
  return cache;
}

export async function saveAgreementTemplate(t: AgreementTemplate): Promise<void> {
  const value = { ...t, updatedAt: new Date().toISOString() };
  if (!supabaseEnabled) {
    localStorage.setItem(LOCAL, JSON.stringify(value));   // throws when the browser's storage is full
  } else {
    const { error } = await supabase.from('app_settings').upsert({ key: KEY, value, updated_at: value.updatedAt }, { onConflict: 'key' });
    if (error) throw error;
  }
  cache = Promise.resolve(value);
}

/** Saves one page image; returns its URL (a data URL when there's no Supabase) */
export async function uploadTemplateImage(blob: Blob, name: string): Promise<string> {
  if (!supabaseEnabled) {
    return await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(blob); });
  }
  const path = `templates/agreement/${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${name}`;
  const { error } = await supabase.storage.from('vehicle-images').upload(path, blob, { cacheControl: '31536000', contentType: blob.type || 'image/jpeg' });
  if (error) throw error;
  return supabase.storage.from('vehicle-images').getPublicUrl(path).data.publicUrl;
}

/** Each page of a PDF as a JPEG + its size in mm (pdf.js is loaded only here) */
export async function pdfToPages(file: File, onProgress?: (done: number, total: number) => void): Promise<{ blob: Blob; w: number; h: number }[]> {
  const pdfjs = await import('pdfjs-dist');
  const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const out: { blob: Blob; w: number; h: number }[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const base = page.getViewport({ scale: 1 });                 // 1 unit = 1/72 inch
    const scale = 2.4;                                           // ≈ 170 dpi — sharp on paper, light enough to load
    const vp = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Could not draw the page'))), 'image/jpeg', supabaseEnabled ? 0.86 : 0.6));
    out.push({ blob, w: +(base.width * 25.4 / 72).toFixed(2), h: +(base.height * 25.4 / 72).toFixed(2) });
    onProgress?.(i, doc.numPages);
  }
  return out;
}

/** An uploaded picture as a page (A4 unless its shape says landscape) */
export async function imageToPage(file: File): Promise<{ blob: Blob; w: number; h: number }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const land = img.naturalWidth > img.naturalHeight;
    const w = land ? A4.h : A4.w;
    return { blob: file, w, h: +(w * img.naturalHeight / img.naturalWidth).toFixed(2) };
  } finally { URL.revokeObjectURL(url); }
}

/* ---------- Printing ---------- */

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** The charge breakdown as a small table: each item (+ how it was worked out) with its amount, then the total */
export function breakdownHtml(el: TplElement, raw?: string): string {
  let d: { rows: { label: string; detail?: string; amount: number; group?: string }[]; total: number };
  try { d = JSON.parse(raw || ''); } catch { return ''; }
  if (!d?.rows?.length) return '';
  const c = /^#[0-9a-f]{6}$/i.test(el.color ?? '') ? el.color! : '#111111';
  const grey = '#6b7280', rule = '#d1d5db';
  const lkr = (s: string) => s.replace(/\bRs\.?\s?/g, 'LKR ');
  const amt = (n: number) => (n < 0 ? `(${num(Math.abs(n))})` : num(n));
  const showDetail = el.showDetail !== false;
  // each line: a title, then how it was worked out underneath
  const items = d.rows.map((r) => {
    const rent = r.group === 'rent' || (!r.group && r === d.rows[0]);
    const title = rent ? (r.label === 'Part month' ? 'Vehicle rental — part month' : 'Vehicle rental') : r.label;
    const how = [rent && r.label !== 'Part month' ? r.label : '', showDetail ? r.detail ?? '' : ''].filter(Boolean).join(' · ');
    return { title, how: lkr(how), amount: r.amount };
  });
  const cell = 'padding:0.32em 0;vertical-align:top';
  const row = (it: { title: string; how: string; amount: number }) =>
    `<tr><td style="${cell};padding-right:1em;border-bottom:0.15mm solid ${rule}"><div style="font-weight:600">${esc(it.title)}</div>${it.how ? `<div style="font-size:0.82em;color:${grey};margin-top:0.1em">${esc(it.how)}</div>` : ''}</td>`
    + `<td style="${cell};text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;border-bottom:0.15mm solid ${rule}${it.amount < 0 ? `;color:${grey}` : ''}">${amt(it.amount)}</td></tr>`;
  // a subtotal before any discount / deduction, so the reductions read clearly
  const firstMinus = items.findIndex((it) => it.amount < 0);
  const plus = items.filter((it) => it.amount >= 0).reduce((s, it) => s + it.amount, 0);
  const sub = firstMinus > 0
    ? `<tr><td style="${cell};text-align:right;padding-right:1em;color:${grey};font-size:0.9em">Subtotal</td><td style="${cell};text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums">${num(plus)}</td></tr>` : '';
  const body = firstMinus > 0 ? items.slice(0, firstMinus).map(row).join('') + sub + items.slice(firstMinus).map(row).join('') : items.map(row).join('');
  const head = `<tr><th style="text-align:left;font-size:0.72em;letter-spacing:0.08em;text-transform:uppercase;color:${grey};font-weight:600;padding:0 0 0.3em;border-bottom:0.3mm solid ${c}">Description</th>`
    + `<th style="text-align:right;font-size:0.72em;letter-spacing:0.08em;text-transform:uppercase;color:${grey};font-weight:600;padding:0 0 0.3em;border-bottom:0.3mm solid ${c};white-space:nowrap">Amount (LKR)</th></tr>`;
  const tot = el.showTotal !== false
    ? `<tr><td style="padding:0.4em 0.5em;background:${c}12;border-top:0.4mm solid ${c};font-weight:700;letter-spacing:0.02em">Total rental charge</td>`
      + `<td style="padding:0.4em 0.5em;background:${c}12;border-top:0.4mm solid ${c};text-align:right;white-space:nowrap;font-weight:700;font-size:1.08em;font-variant-numeric:tabular-nums">LKR ${num(d.total)}</td></tr>` : '';
  return `<table style="width:100%;border-collapse:collapse;color:${c};font-family:${el.font || DEFAULT_FONT};line-height:${el.lineHeight || 1.2};letter-spacing:${el.letterSpacing || 0}pt">${head}${body}${tot}</table>`;
}

function elementHtml(el: TplElement, values: Record<string, string>): string {
  const box = `left:${el.x}mm;top:${el.y}mm;width:${el.w}mm;height:${el.h}mm;`;
  switch (el.kind) {
    case 'box':
      return `<div class="el" style="${box}background:${el.fill || 'transparent'};${el.border ? `border:0.3mm solid ${el.border};` : ''}"></div>`;
    case 'line':
      return `<div class="el" style="${box}background:${el.color || '#111'}"></div>`;
    case 'image':
      return el.src ? `<img class="el" src="${esc(el.src)}" style="${box}object-fit:contain" alt="">` : '';
    case 'signature': {
      const s = values[`sig:${el.field || 'pickup'}`];
      return s ? `<img class="el" src="${esc(s)}" style="${box}object-fit:contain;object-position:left center" alt="">` : '';
    }
    case 'breakdown': {
      const inner = breakdownHtml(el, values.breakdown);
      return inner ? `<div class="el fit" style="${box}font-size:${el.size || 9}pt;line-height:1.2"><div>${inner}</div></div>` : '';
    }
    case 'check':
      return isTicked(el, values) ?`<div class="el t" style="${box}font-size:${el.size || 12}pt;color:${el.color || '#111'};text-align:center;line-height:${el.h}mm;font-weight:700">✓</div>` : '';
    default: {
      const t = fillText(el.text ?? '', values);
      if (!t.trim()) return '';
      const jc = el.align === 'center' ? 'center' : el.align === 'right' ? 'flex-end' : 'flex-start';
      return `<div class="el t${el.fit !== false ? ' fit' : ''}" style="${box}font-size:${el.size || 10}pt;color:${el.color || '#111'};text-align:${el.align || 'left'};justify-content:${jc};font-weight:${el.bold ? 700 : 400};${el.italic ? 'font-style:italic;' : ''}font-family:${el.font || DEFAULT_FONT};line-height:${el.lineHeight || 1.2};letter-spacing:${el.letterSpacing || 0}pt"><span>${esc(t)}</span></div>`;
    }
  }
}

/**
 * Prints a booking's agreement: the designed agreement when one is set up, otherwise the built-in one.
 * The window opens straight away (inside the click) so the browser doesn't block it.
 */
export function printBookingAgreement(b: Booking, vehicle: Vehicle | undefined, extra: { owner?: Owner; driverName?: string; staff: string }) {
  const w = window.open('', '_blank', 'width=900,height=1100');
  if (!w) return;
  w.document.write('<p style="font-family:Arial,sans-serif;padding:24px;color:#555">Preparing the agreement…</p>');
  loadAgreementTemplate().catch(() => null).then((t) => {
    const html = t && t.pages.length
      ? agreementHtml(t, applyTerms(agreementValues(b, vehicle, extra), t.terms), `Rental agreement ${bookingNo(b)}`)
      : rentalAgreementHtml(b, vehicle, extra.staff);
    w.document.open(); w.document.write(html); w.document.close();
  });
}

/** The whole filled agreement as a printable HTML document */
export function agreementHtml(t: AgreementTemplate, values: Record<string, string>, title: string): string {
  const pages = t.pages.map((p, i) => `<section class="page" style="width:${p.w}mm;height:${p.h}mm">
<img class="bg" src="${esc(p.src)}" alt="">${t.elements.filter((e) => e.page === i).map((e) => elementHtml(e, values)).join('')}</section>`).join('');
  const first = t.pages[0] ?? A4;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  @page{size:${first.w}mm ${first.h}mm;margin:0}
  *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  html,body{margin:0;padding:0;background:#e5e7eb}
  body{font-family:Arial,Helvetica,sans-serif}
  .page{position:relative;overflow:hidden;background:#fff;margin:8mm auto;box-shadow:0 2px 12px rgba(0,0,0,.15);page-break-after:always;break-after:page}
  .page:last-child{page-break-after:auto;break-after:auto}
  .bg{position:absolute;inset:0;width:100%;height:100%}
  .el{position:absolute;overflow:hidden}
  .t{white-space:pre-wrap;word-break:break-word;line-height:1.2;display:flex;align-items:center}
  @media print{html,body{background:#fff}.page{margin:0;box-shadow:none}}
</style></head><body>${pages}
<script>
  // shrink any text that doesn't fit its box
  document.querySelectorAll('.fit').forEach(function(el){
    var s=parseFloat(el.style.fontSize),w=el.firstChild;
    while(s>5&&(w.scrollWidth>el.clientWidth+1||w.offsetHeight>el.clientHeight+1)){s-=0.5;el.style.fontSize=s+'pt';}
  });
  var imgs=[].slice.call(document.images);
  Promise.all(imgs.map(function(i){return i.complete?0:new Promise(function(r){i.onload=i.onerror=r;});}))
    .then(function(){setTimeout(function(){window.print();},250);});
</script></body></html>`;
}
