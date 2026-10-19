import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { AppState, Vehicle, Owner, Booking, Inquiry, Expense, Driver, Notification, Commission, VehicleHandover, Customer, ProcessDraft, ActivityEntry, PaymentEntry, ExtraCharge, VehicleExchange, HandoverChecklist, PayoutAdjustment } from '../types';
import { sampleData } from '../data/sampleData';
import { supabaseEnabled } from '../lib/supabase';
import { db, dbFetchAll } from '../lib/db';
import { resolveReferralFee } from '../lib/referral';
import { blocksAvailability, bookingStartMs, bookingEndMs, rangesOverlap } from '../lib/availability';
import { legsOf, mainCommission, previewExchange } from '../lib/exchange';
import { sendSms, smsTemplates, ADMIN_PHONE } from '../lib/sms';
import { toast } from './useToast';

// One clear message (not one per row) when the website columns are missing in Supabase
let lastListingErrorAt = 0;
function notifyListingError(message: string) {
  if (Date.now() - lastListingErrorAt < 4000) return;
  lastListingErrorAt = Date.now();
  if (/web_(featured|order|category|badge|location|price)/.test(message)) {
    toast.error(
      'Website setup not finished',
      'Run admin/supabase/website.sql in the Supabase SQL Editor once, then try again.',
    );
  } else {
    toast.error('Could not update the website listing', message);
  }
}
import { useAuthStore } from './useAuthStore';
import cab1234Img from '../data/CAB-1234.png';

const uid = () => Math.random().toString(36).slice(2, 10);
const now = () => new Date().toISOString();

/**
 * A vehicle under maintenance (e.g. a breakdown hold) stays there: bookings starting, ending or being
 * cancelled never move it back. Only an explicit admin action does (Breakdown → Mark vehicle as ready,
 * or Vehicles → status when there is no breakdown hold).
 */
const keepMaintenance = (vehicleId: string, next: Vehicle['status']): Vehicle['status'] =>
  useStore.getState().vehicles.find((v) => v.id === vehicleId)?.status === 'Maintenance' ? 'Maintenance' : next;
const underMaintenance = (vehicleId: string) => useStore.getState().vehicles.find((v) => v.id === vehicleId)?.status === 'Maintenance';
// One toast per distinct error, not one per row (e.g. "mark all read" on 40 notifications)
let lastDbError = { msg: '', at: 0 };
export function reportDbError(err: unknown, what = 'Failed to save changes to the database.') {
  const msg = (err as { message?: string })?.message ?? String(err);
  console.error('[db]', msg, err);
  if (msg === lastDbError.msg && Date.now() - lastDbError.at < 4000) return;
  lastDbError = { msg, at: Date.now() };
  const missingColumn = /column .* does not exist|could not find the .* column|schema cache/i.test(msg);
  toast.error('Not saved to the database', missingColumn
    ? `${what} The database is missing a new column — run admin/supabase/fix-missing-columns.sql in Supabase. (${msg})`.trim()
    : `${what} ${msg}`.trim());
}
/** Throws Supabase's { error } result so it can be caught — Supabase never rejects on its own */
export const ok = (r: unknown) => {
  const e = (r as { error?: unknown } | null | undefined)?.error;
  if (e) throw e;
  return r;
};
// Supabase returns PromiseLike (not full Promise), so wrap in Promise.resolve for .catch support
const sync = (fn: () => PromiseLike<unknown>) => {
  if (supabaseEnabled) {
    Promise.resolve(fn()).then(ok).catch((err) => reportDbError(err, ''));
  }
};

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      // When Supabase is connected the database is the single source of truth —
      // start empty and hydrate from it. Sample/dummy data is only used in the
      // offline/demo mode (no Supabase env configured).
      ...(supabaseEnabled
        ? { vehicles: [], owners: [], bookings: [], inquiries: [], commissions: [], expenses: [], drivers: [], notifications: [] }
        : sampleData),
      handovers: [],
      customers: [],
      drafts: [],
      loaded: false,

      // ── Supabase bootstrap ────────────────────────────────────────────────
      loadAll: async () => {
        if (!supabaseEnabled) { set({ loaded: true }); return; }
        try {
          const timeoutMs = 12_000;
          const timeoutP = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Database load timed out')), timeoutMs),
          );
          const data = await Promise.race([dbFetchAll(), timeoutP]);
          set((s) => {
            // Keep locally-added bookings that haven't made it to Supabase yet (e.g. DB
            // insert still in-flight, or it failed silently). They stay visible to the user
            // and are re-attempted on the next explicit save.
            const dbIds = new Set(data.bookings.map((b) => b.id));
            const pending = s.bookings.filter((b) => !dbIds.has(b.id));
            return { ...data, bookings: [...data.bookings, ...pending], loaded: true };
          });
        } catch (err) {
          console.error('Supabase load failed:', err);
          toast.error('Could not load data', 'Failed to reach the database — check your connection.');
          set({ loaded: true });
        }
      },

      // ── Vehicles ──────────────────────────────────────────────────────────
      addVehicle: (v) => {
        const newV: Vehicle = { ...v, id: uid(), createdAt: now(), revenue: 0, rentCount: 0 };
        set((s) => ({ vehicles: [...s.vehicles, newV] }));
        sync(() => db.insertVehicle(newV));
        toast.success('Vehicle added', `${newV.brand} ${newV.model} (${newV.vehicleNumber}) is now in the fleet.`);
        return newV.id;
      },

      updateVehicle: (id, updates) => {
        set((s) => ({ vehicles: s.vehicles.map((v) => (v.id === id ? { ...v, ...updates } : v)) }));
        sync(() => db.updateVehicle(id, updates));
        toast.success('Vehicle updated', 'Changes have been saved.');
      },

      // Website listing tweaks (Website page) — saved silently, no toast per click.
      // Supabase reports failures in the result rather than throwing, so check it.
      // If the save fails, the change is rolled back so the screen never shows a listing
      // the website can't see.
      updateWebsiteListing: (id, updates) => {
        const before = get().vehicles.find((v) => v.id === id);
        if (!before) return;
        const previous = Object.fromEntries(
          Object.keys(updates).map((k) => [k, before[k as keyof Vehicle]]),
        ) as Partial<Vehicle>;
        set((s) => ({ vehicles: s.vehicles.map((v) => (v.id === id ? { ...v, ...updates } : v)) }));
        if (!supabaseEnabled) return;

        Promise.resolve(db.updateVehicle(id, updates)).then((r) => {
          if (!r.error) return;
          console.error('[website listing]', r.error);
          set((s) => ({ vehicles: s.vehicles.map((v) => (v.id === id ? { ...v, ...previous } : v)) }));
          notifyListingError(r.error.message ?? String(r.error));
        });
      },

      deleteVehicle: (id) => {
        set((s) => ({ vehicles: s.vehicles.filter((v) => v.id !== id) }));
        sync(() => db.deleteVehicle(id));
        toast.warning('Vehicle removed', 'The vehicle has been deleted from the fleet.');
      },

      // ── Owners ────────────────────────────────────────────────────────────
      addOwner: (o) => {
        const newO: Owner = { ...o, id: uid(), createdAt: now(), totalEarnings: 0, pendingPayout: 0 };
        set((s) => ({ owners: [...s.owners, newO] }));
        // The owner's login is created on the Permissions page, where its temporary password is
        // shown once (logins are Supabase Auth accounts — passwords can't be looked up later).
        if (supabaseEnabled) {
          Promise.resolve(db.insertOwner(newO)).then(ok)
            .catch((err) => reportDbError(err, 'The owner was not saved.'));
        } else useAuthStore.getState().createOwnerAccount(newO.id, newO.name);
        toast.success('Owner added', `${newO.name} has been registered. Create their login on the Permissions page.`);
      },

      updateOwner: (id, updates) => {
        set((s) => ({ owners: s.owners.map((o) => (o.id === id ? { ...o, ...updates } : o)) }));
        sync(() => db.updateOwner(id, updates));
        toast.success('Owner updated', 'Changes have been saved.');
      },

      // ── Bookings ──────────────────────────────────────────────────────────
      addBooking: (b) => {
        const id = uid();
        const vehicle = get().vehicles.find((v) => v.id === b.vehicleId);

        // The referrer's fee is the only deduction — the owner keeps the rest of the total.
        const referralFee = resolveReferralFee(b.referralFeeType, b.referralFeeValue, b.totalAmount);
        const ownerPayout = Math.max(0, b.totalAmount - referralFee);

        const commission: Commission = {
          id: uid(),
          bookingId: id,
          vehicleId: b.vehicleId,
          ownerId: vehicle?.ownerId ?? '',
          referral: b.referral ?? 'Direct',
          totalIncome: b.totalAmount,
          commissionRate: 0,
          commissionAmount: 0,
          ownerPayout,
          coordinatorFee: referralFee,
          status: 'Pending',
          createdAt: now(),
        };

        const newBooking: Booking = { ...b, id, referralFee, createdAt: now() };
        const vehicleUpdates = {
          status: keepMaintenance(b.vehicleId, 'Reserved'),
          revenue: (vehicle?.revenue ?? 0) + b.totalAmount,
          rentCount: (vehicle?.rentCount ?? 0) + 1,
        };

        // Build the notification record manually so we can insert it LAST in the
        // DB chain. Calling addNotification() here would sync it immediately, which
        // triggers a realtime → loadAll() race that can wipe the booking before it
        // lands in Supabase.
        const bookingNotif: Notification = {
          id: uid(), type: 'BookingReminder', read: false, createdAt: now(),
          title: 'New Booking Created',
          message: `Booking for ${b.customerName} confirmed (${b.startDate} – ${b.endDate})`,
          relatedId: id,
        };

        set((s) => ({
          bookings: [...s.bookings, newBooking],
          commissions: [...s.commissions, commission],
          vehicles: s.vehicles.map((v) =>
            v.id === b.vehicleId ? { ...v, ...vehicleUpdates } : v
          ),
          notifications: [bookingNotif, ...s.notifications],
        }));

        if (supabaseEnabled) {
          // Each step is checked for a Supabase error so a failure surfaces
          // immediately rather than silently letting the chain continue.
          const ok = (r: { error: unknown } | undefined | null) => {
            if (r && r.error) throw r.error;
          };
          Promise.resolve(db.insertBooking(newBooking))
            .then((r) => ok(r))
            .then(() => db.insertCommission(commission))
            .then((r) => ok(r))
            .then(() => db.updateVehicle(b.vehicleId, vehicleUpdates))
            .then((r) => ok(r))
            .then(() => db.insertNotification(bookingNotif))
            .catch((err) => {
              const msg = (err as { message?: string })?.message ?? String(err);
              console.error('[addBooking] DB sync error:', msg, err);
              toast.error('Booking saved locally — DB sync failed', msg);
            });
        }

        // ── SMS fan-out (all no-op if SMS not configured / recipient opted out) ──
        const vehicleLabel = vehicle ? `${vehicle.brand} ${vehicle.model} (${vehicle.vehicleNumber})` : 'your vehicle';
        const customerOptIn = get().customers.find((c) => c.phone === b.customerPhone)?.smsOptIn;

        // 1. Confirmation to the customer
        sendSms(b.customerPhone, smsTemplates.bookingConfirmation(b.customerName, vehicleLabel, b.startDate, b.endDate, b.totalAmount),
          { category: 'bookingConfirmation', role: 'customer', relatedId: id, optIn: customerOptIn, transactional: true });

        // 2. The vehicle owner — their car was booked (income incoming)
        const vehicleOwner = get().owners.find((o) => o.id === vehicle?.ownerId);
        if (vehicleOwner?.phone) {
          sendSms(vehicleOwner.phone, smsTemplates.ownerVehicleBooked(vehicleOwner.name, vehicleLabel, b.startDate, b.endDate, b.totalAmount),
            { category: 'ownerVehicleBooked', role: 'owner', relatedId: id, optIn: vehicleOwner.smsOptIn, transactional: true });
        }

        // 3. The referrer — they earned a fee (only if a registered owner, so we have a phone)
        if (referralFee > 0 && b.referral && b.referral !== 'Direct') {
          const referrer = get().owners.find((o) => o.name.trim().toLowerCase() === b.referral!.trim().toLowerCase());
          if (referrer?.phone) {
            sendSms(referrer.phone, smsTemplates.referralConverted(referrer.name, referralFee),
              { category: 'referralConverted', role: 'referrer', relatedId: id, optIn: referrer.smsOptIn, transactional: true });
          }
        }

        // 4. Admin — new booking alert
        if (ADMIN_PHONE) {
          sendSms(ADMIN_PHONE, smsTemplates.adminNewBooking(b.customerName, vehicleLabel, b.startDate, b.endDate, b.totalAmount),
            { category: 'adminNewBooking', role: 'admin', relatedId: id, transactional: true });
        }

        toast.success('Booking created', `Booking for ${b.customerName} confirmed (${b.startDate} → ${b.endDate}).`);

        return id;
      },

      updateBooking: (id, updates) => {
        const prev = get().bookings.find((b) => b.id === id);
        set((s) => ({ bookings: s.bookings.map((b) => (b.id === id ? { ...b, ...updates } : b)) }));
        sync(() => db.updateBooking(id, updates));
        toast.success('Booking updated', 'Changes have been saved.');

        // Payment-received receipt to the customer when the paid amount increases.
        if (prev && updates.paidAmount !== undefined && updates.paidAmount > prev.paidAmount) {
          const paidNow = updates.paidAmount - prev.paidAmount;
          const balance = Math.max(0, prev.totalAmount - (prev.discount ?? 0) - updates.paidAmount);
          const optIn = get().customers.find((c) => c.phone === prev.customerPhone)?.smsOptIn;
          sendSms(prev.customerPhone, smsTemplates.paymentReceived(prev.customerName, paidNow, balance),
            { category: 'paymentReceived', role: 'customer', relatedId: id, optIn, transactional: true });
        }
      },

      startBooking: (id) => {
        const booking = get().bookings.find((b) => b.id === id);
        if (!booking) return;
        if (underMaintenance(booking.vehicleId)) {
          toast.error('Vehicle under maintenance', 'It is not cleared for rental — swap the vehicle or confirm it ready from its breakdown first.');
          return;
        }
        set((s) => ({
          bookings: s.bookings.map((b) => b.id === id ? { ...b, status: 'Ongoing' as const } : b),
          vehicles: s.vehicles.map((v) => v.id === booking.vehicleId ? { ...v, status: 'Ongoing' as const } : v),
        }));
        if (supabaseEnabled) {
          sync(() => db.updateBooking(id, { status: 'Ongoing' }));
          sync(() => db.updateVehicle(booking.vehicleId, { status: 'Ongoing' }));
        }
        toast.success('Rental started', `${booking.customerName}'s vehicle is now on rent.`);
      },

      completeBooking: (id) => {
        const booking = get().bookings.find((b) => b.id === id);
        if (!booking) return;
        const afterComplete = keepMaintenance(booking.vehicleId, 'Available');
        set((s) => ({
          bookings: s.bookings.map((b) => b.id === id ? { ...b, status: 'Completed' as const } : b),
          vehicles: s.vehicles.map((v) => v.id === booking.vehicleId ? { ...v, status: afterComplete } : v),
        }));
        if (supabaseEnabled) {
          sync(() => db.updateBooking(id, { status: 'Completed' }));
          sync(() => db.updateVehicle(booking.vehicleId, { status: afterComplete }));
        }
        toast.success('Rental completed', `${booking.customerName}'s booking is closed and the vehicle is available.`);
      },

      markReferralPaid: (bookingId, paid) => {
        const updates: Partial<Booking> = { referralPaid: paid, referralPaidAt: paid ? now() : undefined };
        set((s) => ({ bookings: s.bookings.map((b) => (b.id === bookingId ? { ...b, ...updates } : b)) }));
        sync(() => db.updateBooking(bookingId, updates));

        if (!paid) return;

        // Tell the referrer their fee has been received and reduce their pending payout.
        const settledBk = get().bookings.find((b) => b.id === bookingId);
        if (settledBk?.referral && settledBk.referral !== 'Direct') {
          const referrer = get().owners.find((o) => o.name.trim().toLowerCase() === settledBk.referral!.trim().toLowerCase());
          if (referrer) {
            if (referrer.phone) {
              sendSms(referrer.phone, smsTemplates.referralReceived(referrer.name, settledBk.referralFee ?? 0),
                { category: 'referralReceived', role: 'referrer', relatedId: bookingId, optIn: referrer.smsOptIn, transactional: true });
            }
            // Reduce referral owner's pending payout since the fee has now been settled.
            const fee = settledBk.referralFee ?? 0;
            if (fee > 0) {
              const ownerUpdates = { pendingPayout: Math.max(0, referrer.pendingPayout - fee) };
              set((s) => ({ owners: s.owners.map((o) => o.id === referrer.id ? { ...o, ...ownerUpdates } : o) }));
              sync(() => db.updateOwner(referrer.id, ownerUpdates));
            }
          }
        }

        // Once the paying owner has no referral fees left outstanding, resolve their
        // "referral payout due" alert so the settlement reflects on the owner's side.
        const st = get();
        const booking = st.bookings.find((b) => b.id === bookingId);
        const ownerId = st.vehicles.find((v) => v.id === booking?.vehicleId)?.ownerId;
        if (!ownerId) return;
        const ownerVehicleIds = new Set(st.vehicles.filter((v) => v.ownerId === ownerId).map((v) => v.id));
        const stillOwes = st.bookings.some((b) =>
          ownerVehicleIds.has(b.vehicleId) &&
          (b.referralFee ?? 0) > 0 && b.referral && b.referral !== 'Direct' &&
          (b.status === 'Ongoing' || b.status === 'Completed') && !b.referralPaid,
        );
        if (stillOwes) return;
        const toResolve = st.notifications.filter((n) => n.type === 'ReferralPayout' && n.ownerId === ownerId && !n.read);
        if (toResolve.length === 0) return;
        set((s) => ({
          notifications: s.notifications.map((n) =>
            n.type === 'ReferralPayout' && n.ownerId === ownerId && !n.read ? { ...n, read: true } : n,
          ),
        }));
        toResolve.forEach((n) => sync(() => db.updateNotification(n.id, { read: true })));
      },

      cancelBooking: (id, why) => {
        const booking = get().bookings.find((b) => b.id === id);
        // The reason is kept in the booking notes, e.g. "[Cancelled 11 Oct 2026, 5:20 pm by Admin: Customer changed plans — flight moved]"
        const stamp = new Date().toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        const notes = why
          ? [booking?.notes, `[Cancelled ${stamp} by ${why.by}: ${why.reason}${why.details ? ` — ${why.details}` : ''}]`].filter(Boolean).join('\n')
          : booking?.notes;
        const updates: Partial<Booking> = {
          status: 'Cancelled',
          ...(why ? { notes, activity: [...(booking?.activity ?? []), { at: new Date().toISOString(), by: why.by, type: 'Cancelled' as const, text: `${why.reason}${why.details ? ` — ${why.details}` : ''}` }] } : {}),
        };
        const afterCancel = booking ? keepMaintenance(booking.vehicleId, 'Available') : 'Available';
        set((s) => {
          const vehicles = booking
            ? s.vehicles.map((v) => (v.id === booking.vehicleId ? { ...v, status: afterCancel } : v))
            : s.vehicles;
          return {
            bookings: s.bookings.map((b) => (b.id === id ? { ...b, ...updates } : b)),
            vehicles,
          };
        });
        if (supabaseEnabled && booking) {
          sync(() => db.updateBooking(id, updates));
          sync(() => db.updateVehicle(booking.vehicleId, { status: afterCancel }));
        }
        toast.warning('Booking cancelled', booking ? `${booking.customerName}'s booking was cancelled${why ? ` — ${why.reason.toLowerCase()}` : ''}.` : 'The booking was cancelled.');
      },

      // ── Inquiries ─────────────────────────────────────────────────────────
      addInquiry: (i) => {
        const newI: Inquiry = { ...i, id: uid(), createdAt: now() };
        set((s) => ({ inquiries: [...s.inquiries, newI] }));
        sync(() => db.insertInquiry(newI));
        toast.success('Inquiry added', `Lead from ${newI.customerName} captured.`);
        if (ADMIN_PHONE) {
          sendSms(ADMIN_PHONE, smsTemplates.adminNewInquiry(newI.customerName, newI.customerPhone, newI.requestedVehicle),
            { category: 'adminNewInquiry', role: 'admin', relatedId: newI.id, transactional: true });
        }
      },

      updateInquiry: (id, updates) => {
        set((s) => ({ inquiries: s.inquiries.map((i) => (i.id === id ? { ...i, ...updates } : i)) }));
        sync(() => db.updateInquiry(id, updates));
        toast.success('Inquiry updated', 'Changes have been saved.');
      },

      // Silent save for the inquiry review page (checklist ticks, quote drafts); errors still surface
      patchInquiry: (id, updates) => {
        set((s) => ({ inquiries: s.inquiries.map((i) => (i.id === id ? { ...i, ...updates } : i)) }));
        sync(() => Promise.resolve(db.updateInquiry(id, updates)).then((r) => { if (r.error) throw r.error; }));
      },

      // ── Expenses ──────────────────────────────────────────────────────────
      addExpense: (e) => {
        const newE: Expense = { ...e, id: uid(), createdAt: now() };
        set((s) => ({ expenses: [...s.expenses, newE] }));
        sync(() => db.insertExpense(newE));
        toast.success('Expense added', `${newE.category} · Rs ${newE.amount.toLocaleString()} recorded.`);
        // Notify the vehicle's owner that an expense was logged against their vehicle.
        const exV = get().vehicles.find((x) => x.id === newE.vehicleId);
        const exOwner = get().owners.find((o) => o.id === exV?.ownerId);
        if (exOwner?.phone) {
          const label = exV ? `${exV.brand} ${exV.model} (${exV.vehicleNumber})` : 'your vehicle';
          sendSms(exOwner.phone, smsTemplates.ownerExpenseLogged(exOwner.name, label, newE.category, newE.amount),
            { category: 'ownerExpenseLogged', role: 'owner', relatedId: newE.id, optIn: exOwner.smsOptIn, transactional: true });
        }
      },

      deleteExpense: (id) => {
        set((s) => ({ expenses: s.expenses.filter((e) => e.id !== id) }));
        sync(() => db.deleteExpense(id));
        toast.warning('Expense removed', 'The expense has been deleted.');
      },

      // ── Drivers ───────────────────────────────────────────────────────────
      addDriver: (d) => {
        const newD: Driver = { ...d, id: uid(), joinedAt: now(), totalEarnings: 0 };
        set((s) => ({ drivers: [...s.drivers, newD] }));
        sync(() => db.insertDriver(newD));
        toast.success('Driver added', `${newD.name} has been registered.`);
      },

      updateDriver: (id, updates) => {
        set((s) => ({ drivers: s.drivers.map((d) => (d.id === id ? { ...d, ...updates } : d)) }));
        sync(() => db.updateDriver(id, updates));
        toast.success('Driver updated', 'Changes have been saved.');
      },

      // ── Handovers ─────────────────────────────────────────────
      addHandover: (h) => {
        const newH: VehicleHandover = { ...h, id: uid(), createdAt: now() };
        set((s) => ({
          handovers: [...s.handovers, newH],
        }));
        sync(() => db.insertHandover(newH));
        toast.success('Handover recorded', `Vehicle ${h.type} logged successfully.`);
      },

      // ── Notifications ─────────────────────────────────────────────────────
      addNotification: (n) => {
        const newN: Notification = { ...n, id: uid(), createdAt: now(), read: false };
        set((s) => ({ notifications: [newN, ...s.notifications] }));
        sync(() => db.insertNotification(newN));
      },

      markNotificationRead: (id) => {
        set((s) => ({
          notifications: s.notifications.map((n) => (n.id === id ? { ...n, read: true } : n)),
        }));
        sync(() => db.updateNotification(id, { read: true }));
      },

      markAllRead: () => {
        set((s) => ({ notifications: s.notifications.map((n) => ({ ...n, read: true })) }));
        if (supabaseEnabled) {
          get().notifications.forEach((n) => {
            if (!n.read) sync(() => db.updateNotification(n.id, { read: true }));
          });
        }
      },

      updateCommission: (id, updates) => {
        const existing = get().commissions.find((c) => c.id === id);
        set((s) => ({
          commissions: s.commissions.map((c) => (c.id === id ? { ...c, ...updates } : c)),
        }));
        sync(() => db.updateCommission(id, updates));

        // When a commission transitions to Paid, reduce the vehicle owner's pending payout.
        if (updates.status === 'Paid' && existing && existing.status !== 'Paid') {
          const owner = get().owners.find((o) => o.id === existing.ownerId);
          if (owner && existing.ownerPayout > 0) {
            const ownerUpdates = { pendingPayout: Math.max(0, owner.pendingPayout - existing.ownerPayout) };
            set((s) => ({ owners: s.owners.map((o) => o.id === owner.id ? { ...o, ...ownerUpdates } : o) }));
            sync(() => db.updateOwner(owner.id, ownerUpdates));
          }
        }
      },

      // ── Manual Booking (past-record entry) ───────────────────────────────
      addManualBooking: (data) => {
        const bookingId = uid();
        const store = get();
        const vehicle = store.vehicles.find((v) => v.id === data.vehicleId);
        const isCancelled = data.status === 'Cancelled';

        // ── 1. Resolve / create customer ──────────────────────────────────
        const existingCust = store.customers.find((c) => c.phone === data.customerPhone);
        const customerId = existingCust?.id ?? uid();
        const isNewCust = !existingCust;
        const customerRecord: Customer = existingCust
          ? { ...existingCust, name: data.customerName, email: data.customerEmail ?? existingCust.email, nic: data.customerNIC ?? existingCust.nic }
          : { id: customerId, name: data.customerName, phone: data.customerPhone, email: data.customerEmail, nic: data.customerNIC, address: (data as { customerAddress?: string }).customerAddress, notes: undefined, smsOptIn: true, createdAt: now() };

        // ── 2. Referral fee ───────────────────────────────────────────────
        const referralFee = resolveReferralFee(data.referralFeeType, data.referralFeeValue, data.totalAmount);
        const ownerPayout = Math.max(0, data.totalAmount - referralFee);

        // ── 3. Booking record ─────────────────────────────────────────────
        const newBooking: Booking = { ...data, id: bookingId, customerId, referralFee, createdAt: now() };

        // ── 4. Commission record ──────────────────────────────────────────
        const commissionPaid = (data as { commissionAlreadyPaid?: boolean }).commissionAlreadyPaid ?? data.status === 'Completed';
        const referralPaidFlag = (data as { referralAlreadyPaid?: boolean }).referralAlreadyPaid ?? false;
        const commission: Commission = {
          id: uid(),
          bookingId,
          vehicleId: data.vehicleId,
          ownerId: vehicle?.ownerId ?? '',
          referral: data.referral ?? 'Direct',
          totalIncome: data.totalAmount,
          commissionRate: 0,
          commissionAmount: 0,
          ownerPayout,
          coordinatorFee: referralFee,
          status: commissionPaid ? 'Paid' : 'Pending',
          createdAt: now(),
        };

        // ── 5. Vehicle stat updates (skip for Cancelled) ──────────────────
        const vehicleUpdates: Partial<Vehicle> = isCancelled ? {} : {
          revenue: (vehicle?.revenue ?? 0) + data.totalAmount,
          rentCount: (vehicle?.rentCount ?? 0) + 1,
          ...(data.status === 'Ongoing'    ? { status: keepMaintenance(data.vehicleId, 'Ongoing') } :
              data.status === 'Confirmed'  ? { status: keepMaintenance(data.vehicleId, 'Reserved') } : {}),
        };

        // ── 6. Vehicle owner earnings ─────────────────────────────────────
        const vehicleOwner = store.owners.find((o) => o.id === vehicle?.ownerId);
        const vehicleOwnerUpdates: Partial<Owner> = (!isCancelled && vehicleOwner) ? {
          totalEarnings: vehicleOwner.totalEarnings + ownerPayout,
          pendingPayout: commissionPaid ? vehicleOwner.pendingPayout : vehicleOwner.pendingPayout + ownerPayout,
        } : {};

        // ── 7. Referral owner earnings ────────────────────────────────────
        const MKTG = ['WhatsApp','Facebook','Instagram','TikTok','Google','Word of Mouth'];
        const isOwnerReferral = !!data.referral && data.referral !== 'Direct' && !MKTG.includes(data.referral);
        const referralOwner = isOwnerReferral
          ? store.owners.find((o) => o.name.trim().toLowerCase() === (data.referral ?? '').trim().toLowerCase())
          : undefined;
        const referralOwnerUpdates: Partial<Owner> = (!isCancelled && referralOwner && referralFee > 0) ? {
          totalEarnings: referralOwner.totalEarnings + referralFee,
          pendingPayout: referralPaidFlag ? referralOwner.pendingPayout : referralOwner.pendingPayout + referralFee,
        } : {};

        // ── 8. Build notification records (added to local state now, synced to DB last) ──
        // IMPORTANT: We do NOT call addNotification() here because that function calls
        // sync() immediately, which inserts to Supabase right away. That triggers a
        // realtime event and loadAll() fires BEFORE the booking chain finishes, wiping
        // the local state. Instead we build the records manually and append them to the
        // same atomic set() call, then add the DB inserts as the LAST steps in the chain.
        const bookingNotif: Notification = {
          id: uid(), type: 'BookingReminder', read: false, createdAt: now(),
          title: 'Manual Booking Recorded',
          message: `${data.customerName} · ${vehicle?.vehicleNumber ?? data.vehicleId} · ${data.startDate} → ${data.endDate}`,
          relatedId: bookingId,
        };
        const referralNotif: Notification | null = (!referralPaidFlag && referralOwner && referralFee > 0 && !isCancelled) ? {
          id: uid(), type: 'ReferralPayout', read: false, createdAt: now(),
          title: 'Referral Fee Outstanding',
          message: `${referralOwner.name} is owed Rs ${referralFee.toLocaleString()} for referring ${data.customerName}`,
          ownerId: vehicleOwner?.id,
          relatedId: bookingId,
        } : null;

        // ── 9. Single atomic local-state update ───────────────────────────
        set((s) => ({
          customers: isNewCust
            ? [...s.customers, customerRecord]
            : s.customers.map((c) => (c.id === customerId ? customerRecord : c)),
          bookings: [...s.bookings, { ...newBooking, referralPaid: referralPaidFlag }],
          commissions: [...s.commissions, commission],
          vehicles: Object.keys(vehicleUpdates).length > 0
            ? s.vehicles.map((v) => (v.id === data.vehicleId ? { ...v, ...vehicleUpdates } : v))
            : s.vehicles,
          owners: s.owners.map((o) => {
            if (vehicleOwner && o.id === vehicleOwner.id && Object.keys(vehicleOwnerUpdates).length > 0)
              return { ...o, ...vehicleOwnerUpdates };
            if (referralOwner && o.id === referralOwner.id && Object.keys(referralOwnerUpdates).length > 0)
              return { ...o, ...referralOwnerUpdates };
            return o;
          }),
          notifications: referralNotif
            ? [bookingNotif, referralNotif, ...s.notifications]
            : [bookingNotif, ...s.notifications],
        }));

        // ── 10. DB sync — each step is checked for a Supabase error so a silent
        //       failure (Supabase never rejects, it returns { error }) surfaces
        //       immediately rather than letting the chain continue past a broken
        //       step. Notifications are inserted LAST so realtime's loadAll() fires
        //       only after every other record is already in Supabase ───────────────
        if (supabaseEnabled) {
          // Turn a Supabase { error } result into a real thrown error so catch() fires.
          const ok = (r: { error: unknown } | undefined | null) => {
            if (r && r.error) throw r.error;
          };

          const custOp = isNewCust
            ? db.insertCustomer(customerRecord)
            : db.updateCustomer(customerId, { name: customerRecord.name, email: customerRecord.email, nic: customerRecord.nic });
          Promise.resolve(custOp)
            .then((r) => ok(r))
            .then(() => db.insertBooking({ ...newBooking, referralPaid: referralPaidFlag }))
            .then((r) => ok(r))
            .then(() => db.insertCommission(commission))
            .then((r) => ok(r))
            .then(() => { if (Object.keys(vehicleUpdates).length > 0) return db.updateVehicle(data.vehicleId, vehicleUpdates); })
            .then((r) => { if (r) ok(r); })
            .then(() => { if (vehicleOwner && Object.keys(vehicleOwnerUpdates).length > 0) return db.updateOwner(vehicleOwner.id, vehicleOwnerUpdates); })
            .then((r) => { if (r) ok(r); })
            .then(() => { if (referralOwner && Object.keys(referralOwnerUpdates).length > 0) return db.updateOwner(referralOwner.id, referralOwnerUpdates); })
            .then((r) => { if (r) ok(r); })
            .then(() => db.insertNotification(bookingNotif))
            .then(() => { if (referralNotif) return db.insertNotification(referralNotif); })
            .catch((err) => {
              const msg = (err as { message?: string })?.message ?? String(err);
              console.error('[addManualBooking] DB sync error:', msg, err);
              toast.error('Booking saved locally — DB sync failed', msg);
            });
        }

        toast.success('Manual booking saved', `Booking for ${data.customerName} has been recorded and all records updated.`);
        return bookingId;
      },

      // Rebuild vehicle revenue/rentCount and owner earnings from the actual
      // bookings & commissions — the authoritative source. Heals any drift in the
      // stored rollups and is safe to run any time (idempotent).
      recomputeStats: () => {
        const s = get();
        const active = s.bookings.filter((b) => b.status !== 'Cancelled');
        const activeIds = new Set(active.map((b) => b.id));

        // Owner earnings from commissions of non-cancelled bookings.
        const ownerAgg: Record<string, { total: number; pending: number }> = {};
        s.commissions.forEach((c) => {
          if (!activeIds.has(c.bookingId)) return;
          const a = (ownerAgg[c.ownerId] ??= { total: 0, pending: 0 });
          a.total += c.ownerPayout;
          if (c.status !== 'Paid') a.pending += c.ownerPayout;
        });

        const vehicleAgg: Record<string, { revenue: number; count: number }> = {};
        active.forEach((b) => legsOf(b).forEach((leg) => {
          const a = (vehicleAgg[leg.vehicleId] ??= { revenue: 0, count: 0 });
          a.revenue += leg.revenue; a.count += 1;
        }));
        const vehicles = s.vehicles.map((v) => ({ ...v, revenue: vehicleAgg[v.id]?.revenue ?? 0, rentCount: vehicleAgg[v.id]?.count ?? 0 }));
        const owners = s.owners.map((o) => {
          const agg = ownerAgg[o.id] ?? { total: 0, pending: 0 };
          return { ...o, totalEarnings: agg.total, pendingPayout: agg.pending };
        });

        set({ vehicles, owners });

        // Persist only the rows that actually changed.
        vehicles.forEach((v) => {
          const old = s.vehicles.find((x) => x.id === v.id)!;
          if (old.revenue !== v.revenue || old.rentCount !== v.rentCount) {
            sync(() => db.updateVehicle(v.id, { revenue: v.revenue, rentCount: v.rentCount }));
          }
        });
        owners.forEach((o) => {
          const old = s.owners.find((x) => x.id === o.id)!;
          if (old.totalEarnings !== o.totalEarnings || old.pendingPayout !== o.pendingPayout) {
            sync(() => db.updateOwner(o.id, { totalEarnings: o.totalEarnings, pendingPayout: o.pendingPayout }));
          }
        });

        toast.success('Statistics recalculated', 'Revenue and earnings were rebuilt from the actual bookings.');
      },

      // Admin correction of an existing booking (wrong amounts, dates, status…). Only this
      // booking's own effect is changed: its old amounts are taken off the vehicle / owners
      // and the corrected ones added back, so other bookings' figures are never touched.
      editBooking: (id, updates, meta) => {
        const s = get();
        const prev = s.bookings.find((b) => b.id === id);
        if (!prev) return;
        const stamp = new Date().toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        const audit = `[Corrected ${stamp} by ${meta.by}: ${meta.changes.join('; ')}${meta.reason ? ` — ${meta.reason}` : ''}]`;
        const entry: ActivityEntry = { at: new Date().toISOString(), by: meta.by, type: meta.type ?? 'Edited', text: `${meta.changes.join('; ')}${meta.reason ? ` — ${meta.reason}` : ''}` };
        const changes: Partial<Booking> = { ...updates, notes: [updates.notes ?? prev.notes, audit].filter(Boolean).join('\n'), activity: [...(prev.activity ?? []), entry] };
        const next: Booking = { ...prev, ...changes };

        const live = (b: Booking) => b.status !== 'Cancelled';
        const comm = mainCommission(s.commissions, prev);
        const ownerOf = (vid: string) => s.vehicles.find((v) => v.id === vid)?.ownerId;
        const commPaid = comm?.status === 'Paid';
        // the car the customer has now; after a mid-trip exchange earlier cars keep their fixed share
        const current = (b: Booking) => { const l = legsOf(b); return l[l.length - 1]; };
        const legPaid = (commissionId?: string) => s.commissions.find((c) => c.id === commissionId)?.status === 'Paid';
        const referrerOf = (b: Booking) =>
          b.referral && b.referral !== 'Direct'
            ? s.owners.find((o) => o.name.trim().toLowerCase() === b.referral!.trim().toLowerCase())
            : undefined;

        // ── Deltas: remove the old booking's effect, add the corrected one ──
        const vDelta: Record<string, { revenue: number; count: number }> = {};
        const oDelta: Record<string, { total: number; pending: number }> = {};
        const addV = (vid: string, revenue: number, count: number) => {
          const d = (vDelta[vid] ??= { revenue: 0, count: 0 }); d.revenue += revenue; d.count += count;
        };
        const addO = (oid: string | undefined, total: number, pending: number) => {
          if (!oid) return;
          const d = (oDelta[oid] ??= { total: 0, pending: 0 }); d.total += total; d.pending += pending;
        };
        const apply = (b: Booking, sign: 1 | -1, currentPayout?: number) => {
          if (!live(b)) return;
          const legs = legsOf(b);
          legs.forEach((leg, i) => {
            const isCurrent = i === legs.length - 1;
            const p = isCurrent && currentPayout !== undefined ? currentPayout : leg.payout;
            const paid = isCurrent ? commPaid : legPaid(leg.commissionId);
            addV(leg.vehicleId, sign * leg.revenue, sign);
            addO(ownerOf(leg.vehicleId), sign * p, paid ? 0 : sign * p);
          });
          const ref = referrerOf(b), fee = b.referralFee ?? 0;
          if (ref && fee > 0) addO(ref.id, sign * fee, b.referralPaid ? 0 : sign * fee);
        };
        apply(prev, -1, comm?.ownerPayout);
        apply(next, 1);

        const exchanged = !!next.exchanges?.length;
        const commUpdates: Partial<Commission> | undefined = comm && {
          totalIncome: current(next).revenue, coordinatorFee: exchanged ? 0 : next.referralFee ?? 0, ownerPayout: current(next).payout,
          vehicleId: next.vehicleId, ownerId: ownerOf(next.vehicleId) ?? '', referral: next.referral ?? 'Direct',
        };
        const bookings = s.bookings.map((b) => (b.id === id ? next : b));
        // Vehicle status follows its live bookings (a vehicle in maintenance stays there)
        const statusFor = (v: Vehicle): Vehicle['status'] =>
          v.status === 'Maintenance' ? v.status
            : bookings.some((b) => b.vehicleId === v.id && b.status === 'Ongoing') ? 'Ongoing'
            : bookings.some((b) => b.vehicleId === v.id && b.status === 'Confirmed') ? 'Reserved'
            : 'Available';
        const touchedV = new Set([prev.vehicleId, next.vehicleId, ...Object.keys(vDelta)]);
        const vehicleUpdates: Record<string, Partial<Vehicle>> = {};
        s.vehicles.forEach((v) => {
          if (!touchedV.has(v.id)) return;
          const d = vDelta[v.id] ?? { revenue: 0, count: 0 };
          const u: Partial<Vehicle> = {};
          if (d.revenue) u.revenue = Math.max(0, v.revenue + d.revenue);
          if (d.count) u.rentCount = Math.max(0, v.rentCount + d.count);
          const st = statusFor(v);
          if (st !== v.status) u.status = st;
          if (Object.keys(u).length) vehicleUpdates[v.id] = u;
        });
        const ownerUpdates: Record<string, Partial<Owner>> = {};
        s.owners.forEach((o) => {
          const d = oDelta[o.id];
          if (!d || (!d.total && !d.pending)) return;
          ownerUpdates[o.id] = { totalEarnings: Math.max(0, o.totalEarnings + d.total), pendingPayout: Math.max(0, o.pendingPayout + d.pending) };
        });

        // earlier cars' commission rows (mid-trip exchanges) follow their part too — e.g. a payout adjustment
        const legRows: Record<string, Partial<Commission>> = {};
        legsOf(next).forEach((l) => {
          if (!l.commissionId) return;
          const c = s.commissions.find((x) => x.id === l.commissionId);
          if (c && c.status !== 'Paid' && Math.abs(c.ownerPayout - l.payout) > 0.005) legRows[c.id] = { ownerPayout: l.payout };
        });
        set((st) => ({
          bookings,
          commissions: st.commissions.map((c) => (commUpdates && c.id === comm!.id ? { ...c, ...commUpdates } : legRows[c.id] ? { ...c, ...legRows[c.id] } : c)),
          vehicles: st.vehicles.map((v) => (vehicleUpdates[v.id] ? { ...v, ...vehicleUpdates[v.id] } : v)),
          owners: st.owners.map((o) => (ownerUpdates[o.id] ? { ...o, ...ownerUpdates[o.id] } : o)),
        }));

        sync(() => db.updateBooking(id, changes));
        if (commUpdates) sync(() => db.updateCommission(comm!.id, commUpdates));
        Object.entries(legRows).forEach(([cid, u]) => sync(() => db.updateCommission(cid, u)));
        Object.entries(vehicleUpdates).forEach(([vid, u]) => sync(() => db.updateVehicle(vid, u)));
        Object.entries(ownerUpdates).forEach(([oid, u]) => sync(() => db.updateOwner(oid, u)));
        toast.success('Booking corrected', `${next.customerName}: ${meta.changes.length} change${meta.changes.length === 1 ? '' : 's'} saved.`);
      },

      // ── Full booking record ─────────────────────────────────────────────
      // Save fields on a booking and add a line to its history (silent — no toast)
      logBookingActivity: (id, entry, updates = {}) => {
        const b = get().bookings.find((x) => x.id === id);
        if (!b) return;
        const changes: Partial<Booking> = { ...updates, activity: [...(b.activity ?? []), { at: new Date().toISOString(), ...entry }] };
        set((s) => ({ bookings: s.bookings.map((x) => (x.id === id ? { ...x, ...changes } : x)) }));
        sync(() => db.updateBooking(id, changes));
      },

      // Payment ledger: every payment, advance, refund and deposit movement, with the totals kept in step
      recordPayment: (id, p) => {
        const b = get().bookings.find((x) => x.id === id);
        if (!b) return;
        const entry: PaymentEntry = { ...p, id: p.id ?? uid(), at: p.at ?? now() };
        const totals: Partial<Booking> =
          entry.kind === 'Payment'            ? { paidAmount: b.paidAmount + entry.amount, paymentMethod: entry.method }
          : entry.kind === 'Advance'          ? { advanceAmount: (b.advanceAmount ?? 0) + entry.amount, paymentMethod: entry.method }
          : entry.kind === 'Refund'           ? { paidAmount: Math.max(0, b.paidAmount - entry.amount) }
          : entry.kind === 'Deposit received' ? { depositAmount: (b.depositAmount ?? 0) + entry.amount, depositType: b.depositType ?? 'cash' }
          : { depositReturned: (b.depositReturned ?? 0) + entry.amount };
        const text = `Rs ${entry.amount.toLocaleString()} ${entry.kind.toLowerCase()} by ${entry.method}${entry.receiptNo ? ` (receipt ${entry.receiptNo})` : ''}${entry.note ? ` — ${entry.note}` : ''}`;
        get().logBookingActivity(id, { by: entry.by, type: entry.kind.startsWith('Deposit') ? 'Deposit' : 'Payment', text },
          { ...totals, payments: [...(b.payments ?? []), entry] });
        toast.success(`${entry.kind} recorded`, `Rs ${entry.amount.toLocaleString()} for ${b.customerName}.`);
        // A real payment gets the usual SMS receipt
        if (entry.kind === 'Payment' || entry.kind === 'Advance') {
          const after = { ...b, ...totals } as Booking;
          const balance = Math.max(0, after.totalAmount + (after.extraCharges ?? 0) - (after.discount ?? 0) - after.paidAmount - (after.advanceAmount ?? 0));
          const optIn = get().customers.find((c) => c.phone === b.customerPhone)?.smsOptIn;
          sendSms(b.customerPhone, smsTemplates.paymentReceived(b.customerName, entry.amount, balance),
            { category: 'paymentReceived', role: 'customer', relatedId: id, optIn, transactional: true });
        }
        return entry.id;
      },

      // Close out a cash deposit: what goes back to the customer and what is kept (and why)
      settleDeposit: (id, st, by) => {
        const b = get().bookings.find((x) => x.id === id);
        if (!b) return;
        const entries: PaymentEntry[] = st.returned > 0
          ? [{ id: uid(), at: now(), kind: 'Deposit returned', amount: st.returned, method: st.method, by, note: st.notes || undefined }] : [];
        get().logBookingActivity(id, {
          by, type: 'Deposit',
          text: `Deposit settled — returned Rs ${st.returned.toLocaleString()}${st.deduction ? `, kept Rs ${st.deduction.toLocaleString()}` : ''}${st.notes ? ` (${st.notes})` : ''}`,
        }, {
          depositReturned: (b.depositReturned ?? 0) + st.returned, depositDeduction: (b.depositDeduction ?? 0) + st.deduction,
          depositNotes: [b.depositNotes, st.notes].filter(Boolean).join('; ') || undefined,
          payments: [...(b.payments ?? []), ...entries],
        });
        toast.success('Deposit settled', `${b.customerName}: deposit closed.`);
      },

      // Fines, tolls, damage… charged to the customer go onto the bill (extra charges)
      addCharge: (id, c) => {
        const b = get().bookings.find((x) => x.id === id);
        if (!b) return;
        const charge: ExtraCharge = { ...c, id: c.id ?? uid(), at: now(), status: 'Charged' };
        get().logBookingActivity(id, { by: c.by, type: 'Charge', text: `${c.kind} Rs ${c.amount.toLocaleString()} added${c.note ? ` — ${c.note}` : ''}` },
          { charges: [...(b.charges ?? []), charge], extraCharges: (b.extraCharges ?? 0) + c.amount });
        toast.success('Charge added', `${c.kind}: Rs ${c.amount.toLocaleString()} added to the bill.`);
        return charge.id;
      },
      waiveCharge: (id, chargeId, by) => {
        const b = get().bookings.find((x) => x.id === id);
        const c = b?.charges?.find((x) => x.id === chargeId);
        if (!b || !c || c.status === 'Waived') return;
        get().logBookingActivity(id, { by, type: 'Charge', text: `${c.kind} Rs ${c.amount.toLocaleString()} waived` }, {
          charges: (b.charges ?? []).map((x) => (x.id === chargeId ? { ...x, status: 'Waived' as const } : x)),
          extraCharges: Math.max(0, (b.extraCharges ?? 0) - c.amount),
        });
      },

      // Pickup / return handover with its checklist — starts or completes the rental
      adjustOwnerPayout: (bookingId, a) => {
        const b = get().bookings.find((x) => x.id === bookingId);
        if (!b) return 'Booking not found.';
        if (!(Math.abs(a.amount) > 0)) return 'Enter an amount.';
        if (!legsOf(b).some((l) => l.vehicleId === a.vehicleId)) return 'That vehicle is not on this booking.';
        const legs = legsOf(b);
        const leg = [...legs].reverse().find((l) => l.vehicleId === a.vehicleId)!;
        const commId = leg.commissionId ?? mainCommission(get().commissions, b)?.id;
        if (get().commissions.find((c) => c.id === commId)?.status === 'Paid') return 'That owner payout is already marked paid — record a reimbursement from the owner instead.';
        if (a.amount > leg.payout + 0.005) return `The owner only earns Rs ${Math.round(leg.payout).toLocaleString('en-LK')} on this booking — deduct at most that, and record the rest as owed.`;
        const adj: PayoutAdjustment = { ...a, id: a.id ?? uid(), at: now() };
        if ((b.payoutAdjustments ?? []).some((x) => x.id === adj.id)) return null;   // already applied
        get().editBooking(bookingId, { payoutAdjustments: [...(b.payoutAdjustments ?? []), adj] }, {
          by: a.by, type: 'Edited', changes: [`Owner payout ${a.amount > 0 ? 'reduced' : 'increased'} by Rs ${Math.abs(a.amount).toLocaleString('en-LK')}`], reason: a.reason,
        });
        return null;
      },

      reverseOwnerPayoutAdjustment: (bookingId, adjustmentId, by) => {
        const b = get().bookings.find((x) => x.id === bookingId);
        const adj = b?.payoutAdjustments?.find((x) => x.id === adjustmentId);
        if (!b || !adj) return 'Adjustment not found.';
        if (adj.reversedAt) return null;
        get().editBooking(bookingId, {
          payoutAdjustments: (b.payoutAdjustments ?? []).map((x) => (x.id === adjustmentId ? { ...x, reversedAt: now(), reversedBy: by } : x)),
        }, { by, type: 'Edited', changes: [`Owner payout adjustment of Rs ${Math.abs(adj.amount).toLocaleString('en-LK')} reversed`], reason: adj.reason });
        return null;
      },

      exchangeVehicle: (bookingId, x) => {
        const s = get();
        const b = s.bookings.find((v) => v.id === bookingId);
        if (!b) return 'Booking not found.';
        if (b.status !== 'Ongoing') return 'Only a rental in progress can have its vehicle exchanged.';
        if (x.toVehicleId === b.vehicleId) return 'Choose a different vehicle.';
        const from = s.vehicles.find((v) => v.id === b.vehicleId);
        const to = s.vehicles.find((v) => v.id === x.toVehicleId);
        if (!from || !to) return 'Vehicle not found.';
        const comm = mainCommission(s.commissions, b);
        if (comm?.status === 'Paid') return 'The owner payout for this booking is already marked paid — change it in Commissions first.';
        const atDate = new Date(x.at);
        if (!get().isVehicleAvailable(to.id, atDate.toLocaleDateString('en-CA'), b.endDate, b.id, atDate.toTimeString().slice(0, 5), b.endTime)) {
          return `${to.brand} ${to.model} is not free from the exchange time to the end of this booking.`;
        }

        const p = previewExchange(b, x.fromDays, to.dailyRent);
        const ownerOf = (vid: string) => s.vehicles.find((v) => v.id === vid)?.ownerId;
        const comp = x.compensation && x.compensation.amount > 0 ? x.compensation : undefined;
        const pickupKm = b.checklists?.pickup?.odometer;
        const ex: VehicleExchange = {
          id: uid(), at: x.at, by: x.by, fromVehicleId: from.id, toVehicleId: to.id,
          fromDays: p.fromDays, fromRevenue: p.fromRevenue, fromPayout: p.fromPayout, toRate: to.dailyRent,
          commissionId: uid(), reason: x.reason, ...(x.details ? { details: x.details } : {}),
          ...(b.checklists?.pickup ? { pickup: b.checklists.pickup } : {}),
          returned: x.returned, delivered: x.delivered,
          ...(pickupKm !== undefined ? { kmDriven: Math.max(0, x.returned.odometer - pickupKm) } : {}),
          ...(x.damage?.description ? { damage: x.damage } : {}),
          ...(comp ? { compensation: comp } : {}),
        };
        const name = (v: Vehicle) => `${v.brand} ${v.model} (${v.vehicleNumber})`;
        const rsF = (n: number) => `Rs ${Math.round(n).toLocaleString('en-LK')}`;

        // customer charges: damage they pay for, and the owner's lost days if they cover them
        const today = x.at.slice(0, 10);
        const newCharges: ExtraCharge[] = [
          ...(x.damage?.payer === 'Customer' && (x.damage.amount ?? 0) > 0
            ? [{ id: uid(), kind: 'Damage' as const, amount: x.damage.amount!, date: today, note: `${name(from)}: ${x.damage.description}`, status: 'Charged' as const, by: x.by, at: now() }] : []),
          ...(comp?.paidBy === 'Customer'
            ? [{ id: uid(), kind: 'Other' as const, amount: comp.amount, date: today, note: `Owner compensation for lost days — ${name(from)}`, status: 'Charged' as const, by: x.by, at: now() }] : []),
        ];
        const extra = newCharges.reduce((sum, c) => sum + c.amount, 0);
        const text = [
          `Vehicle exchanged: ${name(from)} → ${name(to)} — ${x.reason}${x.details ? ` (${x.details})` : ''}`,
          `${from.vehicleNumber}: ${p.fromDays} day${p.fromDays === 1 ? '' : 's'}, owner gets ${rsF(p.fromPayout + (comp?.amount ?? 0))}; ${to.vehicleNumber}: ${p.toDays} day${p.toDays === 1 ? '' : 's'} × ${rsF(to.dailyRent)} = ${rsF(p.toPayout)}`,
          ...(x.damage?.description ? [`Damage: ${x.damage.description} — paid by ${x.damage.payer}${x.damage.amount ? ` (${rsF(x.damage.amount)})` : ''}`] : []),
        ].join('. ');
        const deliveredList: HandoverChecklist = { at: x.at, by: x.by, odometer: x.delivered.odometer, fuel: x.delivered.fuel, items: {}, notes: `Replacement for ${name(from)}` };
        const bookingChanges: Partial<Booking> = {
          vehicleId: to.id,
          exchanges: [...(b.exchanges ?? []), ex],
          checklists: { ...(b.checklists ?? {}), pickup: deliveredList },
          ...(newCharges.length ? { charges: [...(b.charges ?? []), ...newCharges], extraCharges: (b.extraCharges ?? 0) + extra } : {}),
          activity: [...(b.activity ?? []), { at: now(), by: x.by, type: 'Swapped' as const, text }],
        };
        const next: Booking = { ...b, ...bookingChanges };
        const legsBefore = legsOf(b), legsAfter = legsOf(next);
        const curBefore = legsBefore[legsBefore.length - 1], curAfter = legsAfter[legsAfter.length - 1];

        // commissions: the main row follows the new car; the old car's part gets its own row
        const mainUpdates: Partial<Commission> = {
          vehicleId: to.id, ownerId: ownerOf(to.id) ?? '', totalIncome: curAfter.revenue, ownerPayout: curAfter.payout, coordinatorFee: 0,
        };
        const legComm: Commission = {
          id: ex.commissionId, bookingId: b.id, vehicleId: from.id, ownerId: ownerOf(from.id) ?? '',
          referral: b.referral ?? 'Direct', totalIncome: p.fromRevenue, commissionRate: 0, commissionAmount: 0,
          // includes any payout adjustment already made for this car
          ownerPayout: legsAfter.find((l) => l.commissionId === ex.commissionId)?.payout ?? p.fromPayout + (comp?.amount ?? 0), coordinatorFee: p.isFirst ? b.referralFee ?? 0 : 0,
          status: 'Pending', createdAt: now(),
        };

        // older bookings may have no commission row — the replacement's share then gets a new one
        const newMain: Commission | null = comm ? null : {
          id: uid(), bookingId: b.id, referral: b.referral ?? 'Direct', commissionRate: 0, commissionAmount: 0,
          status: 'Pending', createdAt: now(), ...(mainUpdates as Required<Pick<Commission, 'vehicleId' | 'ownerId' | 'totalIncome' | 'ownerPayout' | 'coordinatorFee'>>),
        };
        // owners: rebuild both owners' totals from their commission rows (the record of what they earn),
        // the same way "Recalculate statistics" does — so the split is exact whatever the totals were before
        const commissions = [...s.commissions.map((c) => (comm && c.id === comm.id ? { ...c, ...mainUpdates } : c)), legComm, ...(newMain ? [newMain] : [])];
        const bookingsAfter = s.bookings.map((v) => (v.id === b.id ? next : v));
        const liveIds = new Set(bookingsAfter.filter((v) => v.status !== 'Cancelled').map((v) => v.id));
        const ownerUpdates: Record<string, Partial<Owner>> = {};
        new Set([ownerOf(from.id), ownerOf(to.id)].filter(Boolean) as string[]).forEach((oid) => {
          const mine = commissions.filter((c) => c.ownerId === oid && liveIds.has(c.bookingId));
          const referrals = bookingsAfter.filter((v) => liveIds.has(v.id) && (v.referralFee ?? 0) > 0
            && v.referral && s.owners.find((o) => o.id === oid)?.name.trim().toLowerCase() === v.referral.trim().toLowerCase());
          ownerUpdates[oid] = {
            totalEarnings: mine.reduce((sum, c) => sum + c.ownerPayout, 0) + referrals.reduce((sum, v) => sum + (v.referralFee ?? 0), 0),
            pendingPayout: mine.filter((c) => c.status !== 'Paid').reduce((sum, c) => sum + c.ownerPayout, 0)
              + referrals.filter((v) => !v.referralPaid).reduce((sum, v) => sum + (v.referralFee ?? 0), 0),
          };
        });

        // vehicles: revenue follows each car's share; old car to maintenance (or free), new car on the trip
        const fromUpdates: Partial<Vehicle> = {
          revenue: Math.max(0, from.revenue - curBefore.revenue + p.fromRevenue), status: from.status === 'Maintenance' ? 'Maintenance' : x.oldCarTo,
          ...(x.returned.odometer > (from.mileage ?? 0) ? { mileage: x.returned.odometer } : {}),
        };
        const toUpdates: Partial<Vehicle> = {
          revenue: to.revenue + curAfter.revenue, rentCount: to.rentCount + 1, status: 'Ongoing',
          ...(x.delivered.odometer > (to.mileage ?? 0) ? { mileage: x.delivered.odometer } : {}),
        };

        // handover records (Handovers page) and a repair expense when the company / owner pays
        const place = x.location || '—';
        const handovers: VehicleHandover[] = [
          { id: uid(), bookingId: b.id, vehicleId: from.id, type: 'return', location: place, dateTime: x.at, mileage: x.returned.odometer, fuelLevel: x.returned.fuel,
            notes: ['Exchanged mid-trip', x.reason, x.returned.damage].filter(Boolean).join(' · '), createdAt: now() },
          { id: uid(), bookingId: b.id, vehicleId: to.id, type: 'delivery', location: place, dateTime: x.at, mileage: x.delivered.odometer, fuelLevel: x.delivered.fuel,
            notes: `Replacement for ${name(from)}`, createdAt: now() },
        ];
        const expense: Expense | null = x.damage && (x.damage.payer === 'Company' || x.damage.payer === 'Owner') && (x.damage.amount ?? 0) > 0
          ? { id: uid(), vehicleId: from.id, category: 'Damage', amount: x.damage.amount!, date: today,
              description: `${x.damage.description} — during booking of ${b.customerName} (paid by ${x.damage.payer === 'Owner' ? 'the owner' : 'the company'})`, createdAt: now() }
          : null;

        set((st) => ({
          bookings: st.bookings.map((v) => (v.id === b.id ? next : v)),
          commissions: [...st.commissions.map((c) => (comm && c.id === comm.id ? { ...c, ...mainUpdates } : c)), legComm, ...(newMain ? [newMain] : [])],
          vehicles: st.vehicles.map((v) => (v.id === from.id ? { ...v, ...fromUpdates } : v.id === to.id ? { ...v, ...toUpdates } : v)),
          owners: st.owners.map((o) => (ownerUpdates[o.id] ? { ...o, ...ownerUpdates[o.id] } : o)),
          handovers: [...st.handovers, ...handovers],
          expenses: expense ? [...st.expenses, expense] : st.expenses,
        }));
        sync(() => db.updateBooking(b.id, bookingChanges));
        if (comm) sync(() => db.updateCommission(comm.id, mainUpdates));
        if (newMain) sync(() => db.insertCommission(newMain));
        sync(() => db.insertCommission(legComm));
        sync(() => db.updateVehicle(from.id, fromUpdates));
        sync(() => db.updateVehicle(to.id, toUpdates));
        Object.entries(ownerUpdates).forEach(([oid, u]) => sync(() => db.updateOwner(oid, u)));
        handovers.forEach((h) => sync(() => db.insertHandover(h)));
        if (expense) sync(() => db.insertExpense(expense));
        toast.success('Vehicle exchanged', `${b.customerName} continues in ${to.brand} ${to.model}.`);
        return null;
      },

      recordHandover: (id, kind, list, location) => {
        const st = get();
        const b = st.bookings.find((x) => x.id === id);
        if (!b) return;
        const vehicle = st.vehicles.find((v) => v.id === b.vehicleId);
        if (kind === 'pickup' && vehicle?.status === 'Maintenance') {
          toast.error('Vehicle under maintenance', 'It is not cleared for rental — swap the vehicle or confirm it ready from its breakdown first.');
          return;
        }
        const status = kind === 'pickup' ? 'Ongoing' as const : 'Completed' as const;
        const handover: VehicleHandover = {
          id: uid(), bookingId: id, vehicleId: b.vehicleId, type: kind === 'pickup' ? 'delivery' : 'return',
          location: location || (kind === 'pickup' ? b.pickupLocation : b.dropLocation) || '—', dateTime: list.at,
          mileage: list.odometer, fuelLevel: list.fuel, notes: [list.damage, list.notes].filter(Boolean).join(' · ') || undefined,
          createdAt: now(),
        };
        const pickupKm = kind === 'return' ? b.checklists?.pickup?.odometer : undefined;
        const text = kind === 'pickup'
          ? `Vehicle handed over — ${list.odometer.toLocaleString()} km, fuel ${list.fuel}`
          : `Vehicle returned — ${list.odometer.toLocaleString()} km${pickupKm ? ` (${(list.odometer - pickupKm).toLocaleString()} km driven)` : ''}, fuel ${list.fuel}`;
        const vehicleUpdates: Partial<Vehicle> = { status: kind === 'pickup' ? 'Ongoing' : keepMaintenance(b.vehicleId, 'Available'), ...(list.odometer > (vehicle?.mileage ?? 0) ? { mileage: list.odometer } : {}) };
        set((x) => ({
          handovers: [...x.handovers, handover],
          vehicles: x.vehicles.map((v) => (v.id === b.vehicleId ? { ...v, ...vehicleUpdates } : v)),
        }));
        get().logBookingActivity(id, { by: list.by, type: 'Handover', text }, {
          status, checklists: { ...(b.checklists ?? {}), [kind]: list },
          ...(kind === 'pickup' ? { pickupAt: list.at } : { returnAt: list.at }),
        });
        sync(() => db.insertHandover(handover));
        sync(() => db.updateVehicle(b.vehicleId, vehicleUpdates));
        toast.success(kind === 'pickup' ? 'Rental started' : 'Rental completed', `${b.customerName}: ${text.toLowerCase()}.`);
      },

      // Settle a customer's credit due — the outstanding amount has been collected,
      // so it's added to the booking's paid amount and the credit is marked settled.
      settleCredit: (bookingId) => {
        const b = get().bookings.find((x) => x.id === bookingId);
        if (!b || b.creditSettled) return;
        const credit = b.creditAmount ?? 0;
        const updates: Partial<Booking> = { creditSettled: true, paidAmount: b.paidAmount + credit };
        set((s) => ({ bookings: s.bookings.map((x) => (x.id === bookingId ? { ...x, ...updates } : x)) }));
        sync(() => db.updateBooking(bookingId, updates));
        toast.success('Credit settled', `Rs ${credit.toLocaleString()} collected from ${b.customerName}.`);
      },

      // ── Customers ─────────────────────────────────────────────────────────
      addCustomer: (c) => {
        const newC = { ...c, id: uid(), createdAt: now() };
        set((s) => ({ customers: [...s.customers, newC] }));
        sync(() => db.insertCustomer(newC));
        toast.success('Customer added', `${newC.name} has been saved.`);
      },

      updateCustomer: (id, updates) => {
        set((s) => ({ customers: s.customers.map((c) => (c.id === id ? { ...c, ...updates } : c)) }));
        sync(() => db.updateCustomer(id, updates));
        toast.success('Customer updated', 'Changes have been saved.');
      },

      deleteCustomer: (id) => {
        set((s) => ({ customers: s.customers.filter((c) => c.id !== id) }));
        sync(() => db.deleteCustomer(id));
        toast.warning('Customer removed', 'The customer has been deleted.');
      },

      // ── Process Drafts ───────────────────────────────────────────────────
      saveDraft: (d: Omit<ProcessDraft, 'id' | 'createdAt' | 'updatedAt'>) => {
        // Dedup: update existing draft if same type + bookingId, or same type + vehicleId (no bookingId)
        const match = get().drafts.find((x) =>
          x.type === d.type &&
          (d.bookingId ? x.bookingId === d.bookingId : d.vehicleId ? x.vehicleId === d.vehicleId : false),
        );
        if (match) {
          set((s) => ({
            drafts: s.drafts.map((x) =>
              x.id === match.id ? { ...x, ...d, updatedAt: now() } : x,
            ),
          }));
          return match.id;
        }
        const id = uid();
        set((s) => ({ drafts: [...s.drafts, { ...d, id, createdAt: now(), updatedAt: now() }] }));
        toast.warning('Draft saved', 'The incomplete process was saved. Continue it from the Incomplete page.');
        return id;
      },

      discardDraft: (id: string) => {
        set((s) => ({ drafts: s.drafts.filter((d) => d.id !== id) }));
      },

      // ── Helpers ───────────────────────────────────────────────────────────
      isVehicleAvailable: (vehicleId, startDate, endDate, excludeBookingId, startTime, endTime) => {
        const { bookings, vehicles } = get();
        if (vehicles.find((v) => v.id === vehicleId)?.status === 'Maintenance') {
          const own = excludeBookingId ? bookings.find((b) => b.id === excludeBookingId) : undefined;
          if (own?.vehicleId !== vehicleId) return false;
        }
        // Compare full date-times so a same-day return + re-hire doesn't clash
        // (e.g. returned 08:00, handed to the next hire from 12:00 the same day).
        const candStart = bookingStartMs({ startDate, startTime });
        const candEnd   = bookingEndMs({ endDate, endTime });
        return !bookings.some((b) => {
          // Only live bookings (Confirmed/Ongoing) hold the vehicle — Completed
          // and Cancelled bookings release it, so they never block new dates.
          if (!blocksAvailability(b)) return false;
          if (excludeBookingId && b.id === excludeBookingId) return false;
          // After a mid-trip exchange each car is held only for its own part of the trip
          return legsOf(b).some((leg) => leg.vehicleId === vehicleId && rangesOverlap(
            candStart, candEnd,
            leg.from ? new Date(leg.from).getTime() : bookingStartMs(b),
            leg.until ? new Date(leg.until).getTime() : bookingEndMs(b)));
        });
      },
    }),
    {
      name: 'emrac-store-v7',
      version: 2,
      // When Supabase is the source of truth, only persist local-only state
      // (drafts). Persisting DB-backed data caused stale sample/demo data to
      // survive in localStorage and appear as "pending" bookings after the DB
      // was cleared, because loadAll() merges local-only records with DB data.
      partialize: supabaseEnabled
        ? (state: AppState) => ({ drafts: state.drafts })
        : (state: AppState) => state,
    }
  )
);
