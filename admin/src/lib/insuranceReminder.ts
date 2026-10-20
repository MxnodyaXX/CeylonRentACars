import { Vehicle, Owner, Notification } from '../types';
import { sendSms, smsTemplates } from './sms';

const lsKey = (vehicleId: string) => `EMRAC_ins_reminder_${vehicleId}`;
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const relatedIdFor = (vehicleId: string) => `ins-missing:${vehicleId}`;

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

/** Kept for callers that save a vehicle: removes the old per-browser gate (no longer used). */
export function clearInsuranceReminder(vehicleId: string): void {
  try { localStorage.removeItem(lsKey(vehicleId)); } catch { /* storage blocked */ }
}

interface ReminderParams {
  vehicles: Vehicle[];
  owners: Owner[];
  notifications: Notification[];
  addNotification: (n: Omit<Notification, 'id' | 'createdAt' | 'read'>) => void;
  /** false = in-app alert only, no SMS (local development, automated tests) */
  sendTexts: boolean;
}

/**
 * Weekly reminder for vehicles whose insurance details are incomplete: an in-app alert to the owner
 * and an SMS (opt-in, quiet hours respected).
 *
 * The "once a week" gate is the alert itself, which lives in the database: if this vehicle got a
 * reminder in the last 7 days — read or not, from any browser or any admin — nothing is sent. (It used
 * to be per browser, so every new browser, port or login sent the owner another SMS.)
 */
export function runInsuranceReminders({ vehicles, owners, notifications, addNotification, sendTexts }: ReminderParams): void {
  const now = Date.now();
  for (const v of vehicles) {
    clearInsuranceReminder(v.id);
    if (isInsuranceComplete(v)) continue;

    const relatedId = relatedIdFor(v.id);
    const recent = notifications.some((n) => n.type === 'InsuranceExpiry' && n.relatedId === relatedId
      && now - new Date(n.createdAt).getTime() < ONE_WEEK_MS);
    if (recent) continue;

    addNotification({
      type: 'InsuranceExpiry',
      title: `Insurance incomplete — ${v.brand} ${v.model} (${v.vehicleNumber})`,
      message: `Insurance information is missing for ${v.vehicleNumber}. Please update the provider, policy number, expiry date, and premium in the Vehicles page.`,
      relatedId,
      ownerId: v.ownerId || undefined,
    });

    const owner = owners.find((o) => o.id === v.ownerId);
    if (sendTexts && owner?.phone) {
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
  }
}
