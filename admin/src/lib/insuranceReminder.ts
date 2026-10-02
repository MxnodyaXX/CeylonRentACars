import { Vehicle, Owner, Notification } from '../types';
import { sendSms, smsTemplates } from './sms';

const lsKey = (vehicleId: string) => `EMRAC_ins_reminder_${vehicleId}`;
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Returns true only when all four insurance fields are filled in. */
export function isInsuranceComplete(v: Pick<Vehicle, 'insurance'>): boolean {
  const ins = v.insurance;
  return !!(
    ins?.provider?.trim() &&
    ins?.policyNumber?.trim() &&
    ins?.expiryDate?.trim() &&
    (ins?.premium ?? 0) > 0
  );
}

/** Call this after the user saves a vehicle with complete insurance so the
 *  weekly SMS gate is reset and no further reminders fire. */
export function clearInsuranceReminder(vehicleId: string): void {
  localStorage.removeItem(lsKey(vehicleId));
}

interface ReminderParams {
  vehicles: Vehicle[];
  owners: Owner[];
  notifications: Notification[];
  addNotification: (n: Omit<Notification, 'id' | 'createdAt' | 'read'>) => void;
}

/**
 * Run once per session (after data loads).
 *
 * For every vehicle whose insurance is incomplete:
 *  - fires an in-app InsuranceExpiry notification (deduplicated against existing unread)
 *  - sends an SMS to the vehicle owner (respects opt-in & quiet hours)
 *  - records the send time in localStorage; will not re-fire for 7 days
 *
 * When insurance becomes complete the localStorage key is cleared automatically,
 * so reminders stop without any manual intervention.
 *
 * WhatsApp delivery: if the configured `send-sms` Edge Function routes to a
 * gateway that supports WhatsApp (e.g. Twilio), the same `sendSms` call works
 * for WhatsApp as well — no code change needed on this side.
 */
export function runInsuranceReminders({
  vehicles,
  owners,
  notifications,
  addNotification,
}: ReminderParams): void {
  // Skip SMS (but still create in-app notifications) when running under Playwright.
  const isPlaywright = navigator.userAgent.includes('Playwright') ||
    (window as unknown as Record<string, unknown>).__playwright != null;

  const now = Date.now();

  for (const v of vehicles) {
    if (isInsuranceComplete(v)) {
      // Insurance is now complete — clear the gate so no stale reminders fire
      clearInsuranceReminder(v.id);
      continue;
    }

    // Weekly rate-limit: don't spam the owner more than once per 7 days
    const lastSent = Number(localStorage.getItem(lsKey(v.id)) ?? 0);
    if (now - lastSent < ONE_WEEK_MS) continue;

    // In-app notification — skip if there is already an unread alert for this vehicle
    const relatedId = `ins-missing:${v.id}`;
    const alreadyPending = notifications.some(
      (n) => n.type === 'InsuranceExpiry' && n.relatedId === relatedId && !n.read,
    );
    if (!alreadyPending) {
      addNotification({
        type: 'InsuranceExpiry',
        title: `Insurance incomplete — ${v.brand} ${v.model} (${v.vehicleNumber})`,
        message: `Insurance information is missing for ${v.vehicleNumber}. Please update the provider, policy number, expiry date, and premium in the Vehicles page.`,
        relatedId,
        ownerId: v.ownerId || undefined,
      });
    }

    // SMS to the vehicle's owner (fire-and-forget — never throws).
    // Skipped when running under Playwright so automated test runs don't
    // send real messages every time freshSession() clears localStorage.
    const owner = owners.find((o) => o.id === v.ownerId);
    if (owner?.phone && !isPlaywright) {
      sendSms(
        owner.phone,
        smsTemplates.ownerInsuranceMissing(owner.name, `${v.brand} ${v.model}`, v.vehicleNumber),
        {
          category: 'insuranceMissing',
          role: 'owner',
          relatedId: v.id,
          optIn: owner.smsOptIn !== false,
          transactional: false, // respects quiet hours
        },
      );
    }

    // Stamp the send time — next reminder fires in 7 days
    localStorage.setItem(lsKey(v.id), String(now));
  }
}
