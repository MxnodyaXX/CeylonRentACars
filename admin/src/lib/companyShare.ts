import { create } from 'zustand';
import { supabase, supabaseEnabled } from './supabase';
import type { Booking } from '../types';

/*
 * The company's share of each rental. Every booking is paid to the company; the company keeps its
 * share and pays the owner the rest (monthly owner payouts). No referral fees — all commission is
 * the company's. The method is chosen on each booking (default from the company setting, which
 * Brian can change on Owner payouts → Company share):
 *
 *   percent      X% of the rental
 *   percent_min  X% of the rental, but at least Rs M per day (per trip for hourly hires)
 *   per_day      Rs X per day (per trip for hourly hires)
 *   fixed        Rs X for the whole trip
 *
 * It is worked out on the FINAL bill: rent + extra km + every other charge − discount (shareBaseOf).
 * Deductions are not in the base — a part the customer paid for the owner's car already comes off the
 * owner's payout, and one the company carries comes out of the company's share. The commission and the
 * owner's share are worked out again whenever a charge is added or removed (and at "Complete rental").
 * Bookings without a method (made before this) keep a company share of 0, as they were.
 */

export type ShareType = 'percent' | 'percent_min' | 'per_day' | 'fixed';
export interface ShareMethod { type: ShareType; value: number; min?: number }

export const SHARE_TYPES: { value: ShareType; label: string; sub: string }[] = [
  { value: 'percent_min', label: '% with a minimum per day', sub: 'e.g. 15%, but at least Rs 1,000 a day' },
  { value: 'percent',     label: '% of the rental',          sub: 'e.g. 15% of the rental' },
  { value: 'per_day',     label: 'Fixed amount per day',     sub: 'e.g. Rs 1,000 × the days' },
  { value: 'fixed',       label: 'Fixed amount for the trip', sub: 'e.g. Rs 5,000 in total' },
];

export const DEFAULT_SHARE: ShareMethod = { type: 'percent_min', value: 15, min: 1000 };

type BaseFields = Pick<Booking, 'totalAmount' | 'charges' | 'extraCharges' | 'discount'>;
/** The final bill's income the commission is taken from: rent + charges (extra km, late days, fines…) − discount */
export function shareBaseOf(b: BaseFields) {
  const charged = (b.charges ?? []).filter((c) => c.status === 'Charged');
  const plus = charged.filter((c) => c.amount > 0).reduce((s, c) => s + c.amount, 0);
  // an amount typed in Edit booking that matches no listed charge
  const unlisted = (b.extraCharges ?? 0) - charged.reduce((s, c) => s + c.amount, 0);
  return Math.max(0, (b.totalAmount ?? 0) + plus + Math.max(0, unlisted) - (b.discount ?? 0));
}
/** The parts of that base, for showing how it was worked out */
export function shareBaseParts(b: BaseFields) {
  const charged = (b.charges ?? []).filter((c) => c.status === 'Charged' && c.amount > 0);
  const unlisted = (b.extraCharges ?? 0) - (b.charges ?? []).filter((c) => c.status === 'Charged').reduce((s, c) => s + c.amount, 0);
  return { rent: b.totalAmount ?? 0, charges: charged.reduce((s, c) => s + c.amount, 0) + Math.max(0, unlisted), discount: b.discount ?? 0 };
}

const rsN = (n: number) => `Rs ${Math.round(n).toLocaleString('en-LK')}`;

/** The units the minimum / per-day amount is counted in: days (daily), days of the period (monthly), one trip (hourly) */
const unitsOf = (b: Pick<Booking, 'rentalType' | 'totalDays'>, days?: number) =>
  (b.rentalType === 'Hourly' ? 1 : Math.max(1, days ?? b.totalDays ?? 1));

export function methodOf(b: Pick<Booking, 'companyShareType' | 'companyShareValue' | 'companyShareMin'>): ShareMethod | undefined {
  if (!b.companyShareType) return undefined;
  return { type: b.companyShareType, value: b.companyShareValue ?? 0, min: b.companyShareMin };
}

type ShareFields = Pick<Booking, 'companyShareType' | 'companyShareValue' | 'companyShareMin' | 'rentalType' | 'totalDays'
  | 'companyKmRate' | 'companyKmKm' | 'companyKmCharge'>;

/** The extra km split per km (set at the return): the km charge, and the company's part of it (Rs per km × km, never more than the charge) */
export function kmSplitOf(b: Pick<Booking, 'companyKmRate' | 'companyKmKm' | 'companyKmCharge'>) {
  const charge = Math.max(0, b.companyKmCharge ?? 0);
  if (b.companyKmRate === undefined || b.companyKmRate === null || !charge) return undefined;
  const km = Math.max(0, b.companyKmKm ?? 0);
  const company = Math.min(charge, Math.round(Math.max(0, b.companyKmRate) * km));
  return { rate: b.companyKmRate, km, charge, company, owner: charge - company };
}

/** The share from the booking's method alone, on an amount */
function methodShare(b: ShareFields, revenue: number, days?: number) {
  const m = methodOf(b);
  if (!m || revenue <= 0) return 0;
  const units = unitsOf(b, days);
  const pct = Math.round(revenue * (m.value / 100));
  const share = m.type === 'percent' ? pct
    : m.type === 'percent_min' ? Math.max(pct, Math.round((m.min ?? 0) * units))
    : m.type === 'per_day' ? Math.round(m.value * units)
    : Math.round(m.value);
  return Math.max(0, Math.min(revenue, share));
}

/**
 * The company's share of a rental amount (never more than the rental).
 * When the extra km are split per km (e.g. charged Rs 70/km: company Rs 10, owner Rs 60), the km charge is taken out of
 * the amount, the method applies to the rest, and the company's km part is added.
 */
export function companyShareOf(b: ShareFields, revenue: number, days?: number): number {
  if (revenue <= 0) return 0;
  const km = kmSplitOf(b);
  if (!km) return methodShare(b, revenue, days);
  const rest = Math.max(0, revenue - km.charge);
  return Math.max(0, Math.min(revenue, methodShare(b, rest, days) + km.company));
}

/** "15% of Rs 130,500 = Rs 19,575 (minimum 17 days × Rs 1,000 = Rs 17,000)" */
export function shareWorking(b: ShareFields, revenue: number, days?: number): string | undefined {
  const km = kmSplitOf(b);
  const main = mainWorking(b, km ? Math.max(0, revenue - km.charge) : revenue, days);
  if (!km) return main;
  const kmText = `extra km ${km.km.toLocaleString('en-LK')} km × ${rsN(km.rate)} = ${rsN(km.company)} (of the ${rsN(km.charge)} km charge; ${rsN(km.owner)} to the owner)`;
  if (main === 'No commission on this trip') return `No commission on the rent + ${kmText}`;
  return main ? `${main} + ${kmText}` : kmText;
}

function mainWorking(b: ShareFields, revenue: number, days?: number): string | undefined {
  const m = methodOf(b);
  if (!m) return undefined;
  const units = unitsOf(b, days);
  const unitWord = b.rentalType === 'Hourly' ? 'trip' : units === 1 ? 'day' : 'days';
  const share = methodShare(b, revenue, days);
  const pct = Math.round(revenue * (m.value / 100));
  switch (m.type) {
    case 'percent': return `${m.value}% of ${rsN(revenue)}`;
    case 'percent_min': {
      const floor = Math.round((m.min ?? 0) * units);
      return pct >= floor
        ? `${m.value}% of ${rsN(revenue)} (more than the ${rsN(m.min ?? 0)}/day minimum)`
        : `Minimum ${b.rentalType === 'Hourly' ? '' : `${units} ${unitWord} × `}${rsN(m.min ?? 0)} — ${m.value}% would be only ${rsN(pct)}`;
    }
    case 'per_day': return `${b.rentalType === 'Hourly' ? '' : `${units} ${unitWord} × `}${rsN(m.value)}${share < Math.round(m.value * units) ? ' (capped at the rental)' : ''}`;
    case 'fixed': return m.value === 0 ? 'No commission on this trip' : `Fixed amount for the trip${share < m.value ? ' (capped at the rental)' : ''}`;
  }
}

/* ---------- the company default (app_settings 'company_share', admin only) ---------- */

interface ShareSettingState { method: ShareMethod; loaded: boolean; load: () => Promise<void>; save: (m: ShareMethod) => Promise<void> }

const DEMO_KEY = 'crac-demo-company-share';
export const useCompanyShare = create<ShareSettingState>()((set) => ({
  method: DEFAULT_SHARE,
  loaded: false,
  load: async () => {
    if (!supabaseEnabled) {
      try { set({ method: { ...DEFAULT_SHARE, ...JSON.parse(localStorage.getItem(DEMO_KEY) ?? '{}') }, loaded: true }); } catch { set({ loaded: true }); }
      return;
    }
    const { data } = await supabase.from('app_settings').select('value').eq('key', 'company_share').maybeSingle();
    const v = (data?.value ?? {}) as Partial<ShareMethod>;
    set({ method: { ...DEFAULT_SHARE, ...(v.type ? v : {}) }, loaded: true });
  },
  save: async (m) => {
    set({ method: m });
    if (!supabaseEnabled) { try { localStorage.setItem(DEMO_KEY, JSON.stringify(m)); } catch { /* private mode */ } return; }
    const { error } = await supabase.from('app_settings').upsert({ key: 'company_share', value: m, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (error) throw new Error(error.message);
  },
}));
