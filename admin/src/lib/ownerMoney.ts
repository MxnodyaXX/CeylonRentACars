import { create } from 'zustand';
import { useStore } from '../store/useStore';
import { useAuthStore } from '../store/useAuthStore';
import type { Booking, Vehicle } from '../types';
import { fixedTermsOn } from './ownerTerms';
import { getOwnerAmountsSetting, type OwnerAmountsSetting } from './appSettings';

/*
 * Fixed-amount cars (Vehicles → Edit → "How the owner is paid" → Fixed amount): the owner is paid a fixed
 * amount whether the car is rented or not, and the company keeps every rental in full. So the owner must
 * NOT see what those rentals earned — no rent, bill, charges, payments or totals — only that the car was
 * booked (dates, status). Owners on a share of each rental see everything, as before.
 *
 * Decided per booking by the terms on its start day, so a car that moves to (or from) fixed terms keeps
 * the right view of its older rentals.
 *
 * On top of that, Settings → "Show rental amounts to owners" (app_settings 'owner_amounts'): when it is OFF,
 * no owner sees any rental amount on any car — only their own payouts and whether each is pending or received.
 */

/** Does this booking fall under the car's fixed terms? */
export const isFixedBooking = (b: Pick<Booking, 'vehicleId' | 'startDate'>, vehicles: Pick<Vehicle, 'id' | 'ownerTerms'>[]) =>
  !!fixedTermsOn(vehicles.find((v) => v.id === b.vehicleId), b.startDate);

/** Is this car on fixed terms today? */
export const isFixedCar = (v: Pick<Vehicle, 'ownerTerms'> | undefined, day = new Date().toLocaleDateString('en-CA')) => !!fixedTermsOn(v, day);

/* ── the admin switch ── */
interface OwnerAmountsState {
  /** owners see rental amounts (true until the setting says otherwise) */
  show: boolean;
  loaded: boolean;
  setting: OwnerAmountsSetting | null;
  load: () => Promise<void>;
  set: (s: OwnerAmountsSetting) => void;
}
export const useOwnerAmounts = create<OwnerAmountsState>((set) => ({
  show: true,
  loaded: false,
  setting: null,
  load: async () => {
    try {
      const s = await getOwnerAmountsSetting();
      set({ show: s.show, loaded: true, setting: s });
    } catch {
      // table missing / offline: keep what we had (the database still has the final say)
      set({ loaded: true });
    }
  },
  set: (s) => set({ show: s.show, loaded: true, setting: s }),
}));

/** An owner login may not see rental amounts at all (the admin switched them off) */
export const useAmountsOff = () => {
  const owner = useAuthStore((s) => s.currentUser?.role === 'owner');
  const show = useOwnerAmounts((s) => s.show);
  return owner && !show;
};

/**
 * For the signed-in login: should a booking's money be hidden? Only an OWNER login — for bookings on their
 * fixed-amount cars, or for every booking when rental amounts are switched off. Admins and the team always see it.
 */
export function useOwnerMoney() {
  const owner = useAuthStore((s) => s.currentUser?.role === 'owner');
  const vehicles = useStore((s) => s.vehicles);
  const amountsOff = useAmountsOff();
  return {
    owner,
    /** no rental amounts for this owner at all — payouts only */
    amountsOff,
    /** hide this booking's amounts */
    hides: (b?: Pick<Booking, 'vehicleId' | 'startDate'> | null) => !!b && owner && (amountsOff || isFixedBooking(b, vehicles)),
    /** this car is on fixed terms today (shown with its terms instead of earnings) */
    hidesCar: (v?: Pick<Vehicle, 'ownerTerms'>) => owner && isFixedCar(v),
    /** hide this car's rent and earnings (fixed terms today, or amounts switched off) */
    hidesCarMoney: (v?: Pick<Vehicle, 'ownerTerms'>) => owner && (amountsOff || isFixedCar(v)),
    /** what to show instead of a hidden booking amount */
    label: (b?: Pick<Booking, 'vehicleId' | 'startDate'> | null) => (b && isFixedBooking(b, vehicles) ? FIXED_LABEL : HIDDEN_AMOUNT),
    /** the hover text for that label */
    why: (b?: Pick<Booking, 'vehicleId' | 'startDate'> | null) => (b && isFixedBooking(b, vehicles)
      ? "You're paid a fixed amount for this car — rental amounts aren't shown"
      : 'Rental amounts are not shown — your payouts are on the Commissions page'),
  };
}

/** Text shown instead of an amount on a fixed-amount car */
export const FIXED_LABEL = 'Fixed monthly car';
/** Text shown instead of an amount when rental amounts are switched off for owners */
export const HIDDEN_AMOUNT = 'Not shown';
