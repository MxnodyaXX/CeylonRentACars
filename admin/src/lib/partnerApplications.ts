/* =====================================================================
   Partner applications from the website ("List your vehicle").
   Table partner_applications + private bucket partner-files
   (supabase/security/13_partner_applications.sql). Admin only.
   Approving creates the owner, the vehicle and the owner's login — in that order
   and awaited, so the vehicle never points at an owner that isn't saved yet.
   ===================================================================== */
import { supabase, supabaseEnabled } from './supabase';
import { db } from './db';
import { sendSms } from './sms';
import { useStore } from '../store/useStore';
import { useAuthStore } from '../store/useAuthStore';
import { missingForApproval } from './partnerVerification';
import type { Owner, PartnerApplication, PartnerAppStatus, Vehicle } from '../types';

export const PARTNER_BUCKET = 'partner-files';

export const DOC_LABELS = {
  cr: 'Registration book (CR)', nicFront: 'NIC — front', nicBack: 'NIC — back',
  revenueLicence: 'Revenue licence', insurance: 'Insurance certificate',
} as const;

const num = (v: unknown) => (v == null || v === '' ? undefined : Number(v));
const str = (v: unknown) => (v == null || v === '' ? undefined : String(v));

function fromDb(r: Record<string, unknown>): PartnerApplication {
  return {
    id: r.id as string, applicantType: r.applicant_type as PartnerApplication['applicantType'], status: r.status as PartnerAppStatus,
    phone: r.phone as string, name: r.name as string, email: str(r.email), nic: r.nic as string, address: r.address as string, city: str(r.city),
    vehicleNumber: r.vehicle_number as string, brand: r.brand as string, model: r.model as string, year: num(r.year),
    category: str(r.category), color: str(r.color), seats: num(r.seats), transmission: str(r.transmission), fuelType: str(r.fuel_type),
    mileage: num(r.mileage), askingDaily: num(r.asking_daily), askingMonthly: num(r.asking_monthly), priceNotes: str(r.price_notes),
    availableFrom: str(r.available_from), notes: str(r.notes),
    photos: Array.isArray(r.photos) ? (r.photos as string[]) : [],
    documents: (r.documents as PartnerApplication['documents']) ?? {},
    agreement: r.agreement as PartnerApplication['agreement'],
    infoRequest: str(r.info_request), applicantReply: str(r.applicant_reply), reviewNotes: str(r.review_notes),
    inspection: (r.inspection as PartnerApplication['inspection']) ?? undefined,
    verification: (r.verification as PartnerApplication['verification']) ?? undefined,
    agreedDaily: num(r.agreed_daily), agreedMonthly: num(r.agreed_monthly), commissionRate: num(r.commission_rate),
    decisionReason: str(r.decision_reason), ownerId: str(r.owner_id), vehicleId: str(r.vehicle_id),
    decidedBy: str(r.decided_by), decidedAt: str(r.decided_at),
    history: Array.isArray(r.history) ? (r.history as PartnerApplication['history']) : [],
    createdAt: r.created_at as string, updatedAt: r.updated_at as string,
  };
}

/** Every application, newest first. Error text mentions the table when 13 hasn't been run. */
export async function loadApplications(): Promise<PartnerApplication[]> {
  if (!supabaseEnabled) return [];
  const { data, error } = await supabase.from('partner_applications').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(fromDb);
}

/** A short-lived link to open one private file */
export async function fileUrl(path: string): Promise<string | null> {
  const { data } = await supabase.storage.from(PARTNER_BUCKET).createSignedUrl(path, 60 * 10);
  return data?.signedUrl ?? null;
}

type Patch = Partial<{
  status: PartnerAppStatus; info_request: string | null; review_notes: string | null; inspection: unknown; verification: unknown;
  photos: string[]; documents: PartnerApplication['documents'];
  agreed_daily: number | null; agreed_monthly: number | null; commission_rate: number | null; decision_reason: string | null;
  owner_id: string; vehicle_id: string; decided_by: string; decided_at: string;
}>;

/** Save a change and add it to the application's history */
export async function updateApplication(a: PartnerApplication, patch: Patch, by: string, text?: string): Promise<PartnerApplication> {
  const history = text ? [...a.history, { at: new Date().toISOString(), by, text }] : a.history;
  const { data, error } = await supabase.from('partner_applications').update({ ...patch, history }).eq('id', a.id).select('*').single();
  if (error) throw error;
  return fromDb(data);
}

/** 94771234567 → 0771234567 (how phones are kept on owners) */
export const localPhone = (key: string) => (key.startsWith('94') && key.length === 11 ? `0${key.slice(2)}` : key);
const sameNumber = (a: string, b: string) => a.replace(/\D/g, '').slice(-9) === b.replace(/\D/g, '').slice(-9);

const uid = () => Math.random().toString(36).slice(2, 10);
const sms = (a: PartnerApplication, text: string) =>
  sendSms(localPhone(a.phone), text, { category: 'partnerApplication', role: 'owner', relatedId: a.id, transactional: true });

export const partnerSms = {
  needsInfo: (a: PartnerApplication, ask: string) =>
    sms(a, `Ceylon Rent A Cars: about your vehicle ${a.vehicleNumber} (${a.id}) we need: ${ask}. Please reply at ceylonrentacars.com/list-your-vehicle`),
  rejected: (a: PartnerApplication) =>
    sms(a, `Ceylon Rent A Cars: thank you for applying to list ${a.vehicleNumber} (${a.id}). We can't accept it at this time. Details: ceylonrentacars.com/list-your-vehicle`),
  approved: (a: PartnerApplication, login?: { username: string; password: string }) =>
    sms(a, `Ceylon Rent A Cars: your vehicle ${a.vehicleNumber} is approved — welcome aboard!${login
      ? ` Owner account: ${window.location.origin} Username: ${login.username} Temporary password: ${login.password} (change it when you sign in).`
      : ' You can see it in your owner account.'}`),
};

/** Bank details the owner gave on the check call (free text: "BOC Panadura" / "1234567 — N. Perera") */
function bankFromCall(a: PartnerApplication): Partial<Owner> {
  const ans = a.verification?.answers ?? {};
  const bank = ans.bankName?.value?.trim(), acc = ans.bankAccount?.value?.trim();
  if (!bank && !acc) return {};
  const [number, holder] = (acc ?? '').split(/s*[—–-]s*|,s*/);
  return { bankName: bank || undefined, accountNumber: number?.trim() || acc || undefined, accountHolderName: holder?.trim() || undefined };
}

/** Admin adds a file the owner sent another way (WhatsApp, email) — kept in the same private bucket */
export async function uploadForApplication(a: PartnerApplication, file: File, kind: string): Promise<string> {
  const ext = (file.name.match(/.([A-Za-z0-9]{2,5})$/)?.[1] ?? 'jpg').toLowerCase();
  const path = `${a.phone}/admin-${Date.now()}-${kind}.${ext}`;
  const { error } = await supabase.storage.from(PARTNER_BUCKET).upload(path, file, { contentType: file.type || undefined });
  if (error) throw error;
  return path;
}

export interface ApproveInput { agreedDaily: number; agreedMonthly?: number; commissionRate: number; createLogin: boolean; notify: boolean }
export interface ApproveResult { app: PartnerApplication; ownerId: string; vehicleId: string; newOwner: boolean; login?: { username: string; password: string } | null }

/**
 * Approve: use the existing owner with this phone (another vehicle from a current partner) or make a
 * new one, add the vehicle (not on the website until it is set up on the Website page), make the
 * owner's login, then mark the application approved.
 */
export async function approveApplication(a: PartnerApplication, input: ApproveInput, by: string): Promise<ApproveResult> {
  const blockers = missingForApproval(a).filter((m) => m.critical);
  if (blockers.length) throw new Error(`Still to do first: ${blockers.map((m) => m.label).join(', ')}.`);
  const store = useStore.getState();
  if (store.vehicles.some((v) => v.vehicleNumber.replace(/\W/g, '').toUpperCase() === a.vehicleNumber.replace(/\W/g, '').toUpperCase())) {
    throw new Error(`${a.vehicleNumber} is already in the fleet.`);
  }
  const now = new Date().toISOString();
  let owner = store.owners.find((o) => o.phone && sameNumber(o.phone, a.phone));
  const newOwner = !owner;
  if (!owner) {
    owner = {
      id: uid(), name: a.name, phone: localPhone(a.phone), email: a.email ?? '', address: [a.address, a.city].filter(Boolean).join(', '),
      nic: a.nic, commissionRate: input.commissionRate, ...bankFromCall(a), totalEarnings: 0, pendingPayout: 0, smsOptIn: true, createdAt: now,
    } satisfies Owner;
    const { error } = await db.insertOwner(owner);
    if (error) throw new Error(`The owner was not saved: ${error.message}`);
    useStore.setState((s) => ({ owners: [...s.owners, owner!] }));
  }
  const vehicle: Vehicle = {
    id: uid(), vehicleNumber: a.vehicleNumber, brand: a.brand, model: a.model, year: a.year ?? new Date().getFullYear(),
    ownerId: owner.id, dailyRent: input.agreedDaily, status: 'Available',
    insurance: { provider: '', policyNumber: '', expiryDate: '', premium: 0 },
    revenue: 0, rentCount: 0, color: a.color, seats: a.seats, fuelType: a.fuelType, transmission: a.transmission, mileage: a.mileage,
    createdAt: now,
  };
  const { error: vErr } = await db.insertVehicle(vehicle);
  if (vErr) throw new Error(`The vehicle was not saved: ${vErr.message}`);
  useStore.setState((s) => ({ vehicles: [...s.vehicles, vehicle] }));

  // a login only for a new partner (a current owner already has one)
  let login: { username: string; password: string } | null = null;
  if (input.createLogin && newOwner) {
    await useAuthStore.getState().refreshUsers();   // current usernames, so the new one is unique
    login = await useAuthStore.getState().createOwnerAccount(owner.id, owner.name);
  }

  const app = await updateApplication(a, {
    status: 'Approved', agreed_daily: input.agreedDaily, agreed_monthly: input.agreedMonthly ?? null, commission_rate: input.commissionRate,
    owner_id: owner.id, vehicle_id: vehicle.id, decided_by: by, decided_at: now, info_request: null,
  }, by, `Approved — Rs ${input.agreedDaily.toLocaleString('en-LK')} a day${input.agreedMonthly ? `, Rs ${input.agreedMonthly.toLocaleString('en-LK')} a month` : ''}, commission ${input.commissionRate}%. ${newOwner ? 'New owner' : `Added to ${owner.name}`}, vehicle ${vehicle.vehicleNumber}${login ? `, login ${login.username}` : ''}`);
  if (input.notify) await partnerSms.approved(app, login ?? undefined);
  return { app, ownerId: owner.id, vehicleId: vehicle.id, newOwner, login };
}
