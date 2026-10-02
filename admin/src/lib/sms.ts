import { supabase, supabaseEnabled } from './supabase';

/** Phone that receives internal admin/staff alerts (set VITE_ADMIN_PHONE in .env). */
export const ADMIN_PHONE = (import.meta.env.VITE_ADMIN_PHONE as string | undefined) ?? '';

/** Normalize a Sri Lankan phone number to the 94XXXXXXXXX form the gateway expects.
 *  Returns null if it can't be made into a valid 11-digit 94 number. */
export function normalizeLkPhone(raw: string): string | null {
  const d = (raw ?? '').replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('94') && d.length === 11) return d;          // 947XXXXXXXX
  if (d.startsWith('0') && d.length === 10) return '94' + d.slice(1); // 07XXXXXXXX
  if (d.length === 9 && d.startsWith('7')) return '94' + d;     // 7XXXXXXXX
  return null;
}

export type SmsRole = 'customer' | 'owner' | 'referrer' | 'driver' | 'admin';

export interface SmsOptions {
  category?: string;       // template key, for logging (e.g. 'bookingConfirmation')
  role?: SmsRole;          // recipient type, for logging
  relatedId?: string;      // booking/owner id, for logging
  optIn?: boolean;         // recipient's SMS consent — if explicitly false, skip
  transactional?: boolean; // true = always send (confirmations, OTP); false = respect quiet hours
}

// Quiet hours: don't send non-transactional (marketing/reminder) texts late night / early morning.
const QUIET_START = 21; // 9 PM
const QUIET_END   = 8;  // 8 AM
function inQuietHours(d = new Date()): boolean {
  const h = d.getHours();
  return h >= QUIET_START || h < QUIET_END;
}

/** Send one SMS via the `send-sms` Edge Function. Resolves false (never throws) on
 *  any failure so callers can fire-and-forget without breaking the main flow. */
export async function sendSms(to: string, message: string, opts: SmsOptions = {}): Promise<boolean> {
  if (!supabaseEnabled) {
    console.warn('[sms] skipped — Supabase not configured');
    return false;
  }
  if (opts.optIn === false) {
    console.warn('[sms] skipped — recipient opted out:', to);
    return false;
  }
  if (opts.transactional === false && inQuietHours()) {
    console.warn('[sms] skipped — quiet hours (non-transactional):', to);
    return false;
  }
  const phone = normalizeLkPhone(to);
  if (!phone) {
    console.warn('[sms] skipped — invalid phone:', to);
    return false;
  }
  try {
    const { data, error } = await supabase.functions.invoke('send-sms', {
      body: { to: phone, message, category: opts.category, role: opts.role, relatedId: opts.relatedId },
    });
    if (error) { console.error('[sms] invoke error:', error); return false; }
    const ok = !!(data as { ok?: boolean })?.ok;
    if (!ok) console.error('[sms] gateway rejected:', data);
    return ok;
  } catch (e) {
    console.error('[sms] failed:', e);
    return false;
  }
}

/** Professional SMS templates, grouped by recipient. Kept concise — each ~160 chars
 *  is one SMS segment/unit; a few run to 2 segments. `BRAND` is the public business
 *  name; internal admin alerts use a short `EMRAC:` prefix. */
const BRAND = 'EMRAC Rent A Car';
const rs = (n: number) => `Rs ${n.toLocaleString()}`;

export const smsTemplates = {
  // ── Customer ──────────────────────────────────────────────────────────────
  bookingConfirmation: (name: string, vehicle: string, start: string, end: string, total: number) =>
    `Dear ${name}, your booking with ${BRAND} is confirmed.\nVehicle: ${vehicle}\nPeriod: ${start} to ${end}\nTotal: ${rs(total)}\nThank you for choosing us.`,

  bookingModified: (name: string, vehicle: string, start: string, end: string) =>
    `Dear ${name}, your ${BRAND} booking has been updated.\nVehicle: ${vehicle}\nNew period: ${start} to ${end}\nPlease contact us if this is unexpected.`,

  bookingCancelled: (name: string, vehicle: string) =>
    `Dear ${name}, your ${BRAND} booking for ${vehicle} has been cancelled. If you have any questions, please contact us. Thank you.`,

  paymentReceived: (name: string, amount: number, balance: number) =>
    `Dear ${name}, we have received your payment of ${rs(amount)}. ` +
    (balance > 0 ? `Outstanding balance: ${rs(balance)}.` : `Your rental is now fully paid.`) +
    ` Thank you - ${BRAND}.`,

  paymentReminder: (name: string, balance: number) =>
    `Dear ${name}, this is a reminder from ${BRAND} that an outstanding balance of ${rs(balance)} remains on your rental. Kindly settle it at your earliest convenience. Thank you.`,

  pickupReminder: (name: string, vehicle: string, start: string, location?: string) =>
    `Dear ${name}, a reminder from ${BRAND}: your vehicle ${vehicle} is ready for pickup on ${start}${location ? ` at ${location}` : ''}. We look forward to serving you.`,

  vehicleHandedOver: (name: string, vehicle: string) =>
    `Dear ${name}, your hired vehicle ${vehicle} has been handed over. Please drive safely, and contact us anytime for assistance. - ${BRAND}.`,

  returnReminder: (name: string, vehicle: string, end: string) =>
    `Dear ${name}, a friendly reminder from ${BRAND}: your hired vehicle ${vehicle} is due for return on ${end}. Please return it on time to avoid extra charges. Thank you.`,

  overdueReturn: (name: string, vehicle: string, end: string) =>
    `Dear ${name}, our records show ${vehicle} was due back on ${end} and is now overdue. Late charges may apply. Please return it or contact us immediately. - ${BRAND}.`,

  extraCharge: (name: string, reason: string, amount: number) =>
    `Dear ${name}, an additional charge of ${rs(amount)} (${reason}) applies to your ${BRAND} rental. Kindly settle it at your convenience. Thank you.`,

  depositRefund: (name: string, amount: number) =>
    `Dear ${name}, your security deposit refund of ${rs(amount)} has been processed. Thank you for renting with ${BRAND}.`,

  pickupOtp: (code: string) =>
    `Your ${BRAND} verification code is ${code}. Share it with our staff to confirm your vehicle pickup. Do not share it with anyone else.`,

  thankYouFeedback: (name: string, link?: string) =>
    `Dear ${name}, thank you for choosing ${BRAND}. We hope you enjoyed your rental and would love your feedback${link ? `: ${link}` : '.'}`,

  // ── Vehicle owner ─────────────────────────────────────────────────────────
  ownerVehicleBooked: (ownerName: string, vehicle: string, start: string, end: string, amount: number) =>
    `Dear ${ownerName}, good news - your vehicle ${vehicle} has been booked (${start} to ${end}) for ${rs(amount)}. - ${BRAND}.`,

  ownerHandover: (ownerName: string, vehicle: string, action: 'handed over' | 'returned') =>
    `Dear ${ownerName}, your vehicle ${vehicle} has been ${action}.${action === 'returned' ? ' It is now back in the fleet.' : ''} - ${BRAND}.`,

  ownerPayoutSettled: (ownerName: string, amount: number) =>
    `Dear ${ownerName}, your payout of ${rs(amount)} from ${BRAND} has been settled. Thank you for partnering with us.`,

  ownerStatement: (ownerName: string, month: string, earnings: number, pending: number) =>
    `Dear ${ownerName}, your ${month} statement from ${BRAND}: earnings ${rs(earnings)}, pending payout ${rs(pending)}. Full details are in your owner portal.`,

  referralPayout: (ownerName: string, amount: number) =>
    `Dear ${ownerName}, you have a pending referral payout of ${rs(amount)} to settle with the referrers on ${BRAND}. Kindly arrange the settlement. Thank you.`,

  ownerInsuranceExpiry: (ownerName: string, vehicle: string, date: string) =>
    `Dear ${ownerName}, the insurance for your vehicle ${vehicle} expires on ${date}. Please renew it to keep the vehicle active. - ${BRAND}.`,

  ownerInsuranceMissing: (ownerName: string, vehicle: string, regNo: string) =>
    `Dear ${ownerName}, insurance details for your vehicle ${vehicle} (${regNo}) are incomplete in the ${BRAND} system. Please update them to keep the vehicle compliant. - ${BRAND}.`,

  ownerExpenseLogged: (ownerName: string, vehicle: string, category: string, amount: number) =>
    `Dear ${ownerName}, an expense was logged on your vehicle ${vehicle}: ${category} ${rs(amount)}. View details in your owner portal. - ${BRAND}.`,

  // ── Referrer (owner or external) ──────────────────────────────────────────
  referralConverted: (referrerName: string, fee: number) =>
    `Dear ${referrerName}, a customer you referred has booked with ${BRAND}. You have earned a referral fee of ${rs(fee)}. Thank you for the business!`,

  referralReceived: (referrerName: string, amount: number) =>
    `Dear ${referrerName}, your referral payout of ${rs(amount)} has been settled. Thank you for referring business to ${BRAND}.`,

  referralSummary: (referrerName: string, month: string, total: number, count: number) =>
    `Dear ${referrerName}, your ${month} referral summary from ${BRAND}: ${rs(total)} earned across ${count} booking${count !== 1 ? 's' : ''}. Thank you!`,

  // ── Driver ────────────────────────────────────────────────────────────────
  driverAssigned: (driverName: string, vehicle: string, customer: string, start: string) =>
    `Dear ${driverName}, you have a new ${BRAND} assignment: ${vehicle} for ${customer}, starting ${start}. Please check your schedule.`,

  driverSchedule: (driverName: string, vehicle: string, start: string, end: string) =>
    `Dear ${driverName}, reminder: your ${vehicle} trip runs ${start} to ${end}. Please be on time. - ${BRAND}.`,

  driverLicenseExpiry: (driverName: string, date: string) =>
    `Dear ${driverName}, your driving licence expires on ${date}. Please renew it to continue accepting ${BRAND} trips.`,

  // ── Customer credit reminders ─────────────────────────────────────────────
  creditReminder: (customerName: string, amount: number, count: number) =>
    `Dear ${customerName}, this is a gentle reminder that you have an outstanding balance of ${rs(amount)} across ${count} booking${count !== 1 ? 's' : ''} with ${BRAND}. Kindly settle your account at your earliest convenience. Thank you.`,

  // ── Admin / staff (internal alerts) ───────────────────────────────────────
  adminNewBooking: (customer: string, vehicle: string, start: string, end: string, total: number) =>
    `EMRAC: New booking - ${customer}, ${vehicle}, ${start} to ${end}, ${rs(total)}.`,

  adminNewInquiry: (customer: string, phone: string, vehicle?: string) =>
    `EMRAC: New inquiry from ${customer} (${phone})${vehicle ? ` for ${vehicle}` : ''}. Follow up to convert the lead.`,

  adminOverdueReturn: (customer: string, vehicle: string, end: string) =>
    `EMRAC ALERT: ${vehicle} (customer ${customer}) was due ${end} and is overdue. Action required.`,

  adminPaymentOverdue: (customer: string, balance: number, days: number) =>
    `EMRAC ALERT: ${customer} has an overdue balance of ${rs(balance)} (${days} days). Please follow up for payment.`,

  adminInsuranceDue: (vehicle: string, date: string) =>
    `EMRAC: Insurance for ${vehicle} expires on ${date}. Please arrange renewal.`,

  adminDamageReported: (vehicle: string, detail: string) =>
    `EMRAC ALERT: Damage/incident reported on ${vehicle}. ${detail}. Review required.`,

  adminDailySummary: (date: string, pickups: number, returnsDue: number, revenue: number) =>
    `EMRAC daily summary (${date}): ${pickups} pickup(s), ${returnsDue} return(s) due, ${rs(revenue)} booked.`,

  adminReferralUnsettled: (ownerName: string, amount: number) =>
    `EMRAC: ${ownerName} has ${rs(amount)} in referral fees still unsettled. Consider following up.`,
};
