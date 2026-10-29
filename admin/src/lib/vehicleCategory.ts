import { Vehicle } from '../types';

/* Vehicle types — the same groups as "Choose Your Ride" on the Ceylon Rent A Cars website.
   Saved in vehicles.web_category. ("With Driver" on the website is a service, not a type.) */
export const VEHICLE_CATEGORIES = [
  { id: 'economy', label: 'Economy', hint: 'Small cars — Wagon R, Alto, Vitz' },
  { id: 'sedan',   label: 'Sedan',   hint: 'Axio, Premio, Allion' },
  { id: 'hybrid',  label: 'Hybrid',  hint: 'Aqua, Prius, Fit hybrid' },
  { id: 'suv',     label: 'SUV',     hint: 'Vezel, Raize, Prado' },
  { id: 'luxury',  label: 'Luxury',  hint: 'Mercedes, BMW, premium cars' },
  { id: 'van',     label: 'Van',     hint: 'KDH, Hiace — 8+ seats' },
] as const;

export function categoryLabel(id?: string): string | undefined {
  return VEHICLE_CATEGORIES.find((c) => c.id === id)?.label;
}

/** Sensible first guess for vehicles that have no type yet */
export function guessCategory(v: Pick<Vehicle, 'seats' | 'fuelType'>): string {
  if ((v.seats ?? 0) >= 8) return 'van';
  if ((v.seats ?? 0) === 7) return 'suv';
  if (/hybrid|electric/i.test(v.fuelType ?? '')) return 'hybrid';
  return 'economy';
}
