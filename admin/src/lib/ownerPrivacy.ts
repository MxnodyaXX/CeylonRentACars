import { useStore } from '../store/useStore';
import { useAuthStore } from '../store/useAuthStore';
import type { Booking } from '../types';
import { nameKey, referrerOf } from './channels';

/*
 * Customers belong to Ceylon Rent A Cars, not to the car's owner. An OWNER login sees that their car is
 * booked, when, and how it comes back — but not who to call: the customer is shown as first name + initials
 * ("Dushmantha N."), and their phone, e-mail, NIC, address, documents and messages are hidden. Otherwise an
 * owner could contact the customer and rent the car to them directly.
 *
 * Except the owner's own customers: a booking the owner entered themselves, or one they referred (its
 * referral is the owner's name) — they already know that customer.
 */

/** "Dushmantha niroshan" → "Dushmantha N." · "Kasun Lakmal Perera" → "Kasun L. P." · one word stays as it is */
export function maskName(name?: string | null): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'Customer';
  const [first, ...rest] = parts;
  const firstNice = first.charAt(0).toUpperCase() + first.slice(1);
  return [firstNice, ...rest.map((p) => `${p.replace(/[^\p{L}\p{N}]/gu, '').charAt(0).toUpperCase()}.`).filter((x) => x !== '.')].join(' ');
}

/** Is this one of the owner's own customers (entered by them, or referred by them)? */
export function ownersOwnCustomer(b: Pick<Booking, 'referral' | 'enteredByOwner'>, ownerId?: string, ownerName?: string): boolean {
  if (!ownerId) return false;
  if (b.enteredByOwner && b.enteredByOwner === ownerId) return true;
  const ref = referrerOf(b.referral);
  return !!ref && !!ownerName && nameKey(ref) === nameKey(ownerName);
}

/** For the signed-in login: should this booking's customer details be hidden? (owner logins only) */
export function useCustomerPrivacy() {
  const me = useAuthStore((s) => s.currentUser);
  const owners = useStore((s) => s.owners);
  const owner = me?.role === 'owner';
  const ownerName = owner ? owners.find((o) => o.id === me?.ownerId)?.name : undefined;
  const hides = (b?: Pick<Booking, 'referral' | 'enteredByOwner'> | null) => !!b && owner && !ownersOwnCustomer(b, me?.ownerId, ownerName);
  return {
    owner,
    /** hide this booking's customer contact details */
    hides,
    /** the customer's name as this login may see it */
    name: (b: Pick<Booking, 'customerName' | 'referral' | 'enteredByOwner'>) => (hides(b) ? maskName(b.customerName) : b.customerName),
    /** the customer's phone as this login may see it ('' when hidden) */
    phone: (b: Pick<Booking, 'customerPhone' | 'referral' | 'enteredByOwner'>) => (hides(b) ? '' : b.customerPhone),
  };
}

export const HIDDEN_CONTACT = 'Contact via Ceylon Rent A Cars';
