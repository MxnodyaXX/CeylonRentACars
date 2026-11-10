import type { Booking, Owner } from '../types';

/*
 * Every booking records two separate things:
 *   referral  WHO brought the customer — a vehicle owner, a named third party, or 'Direct' (nobody).
 *             Only a person earns a referral fee.
 *   channel   HOW the customer reached us — walk-in, WhatsApp, Facebook… (no fee, for marketing reports)
 *
 * Older bookings kept the channel in the referral box (e.g. referral = 'Facebook'); those are read as
 * channel = Facebook, referral = Direct, so old and new bookings report the same way.
 */

export const CHANNELS: { value: string; label: string; sub: string }[] = [
  { value: 'Walk-in',            label: 'Walk-in',            sub: 'Came to us in person' },
  { value: 'Phone Call',         label: 'Phone call',         sub: 'Called us' },
  { value: 'WhatsApp',           label: 'WhatsApp',           sub: 'Messaged us on WhatsApp' },
  { value: 'Website',            label: 'Website',            sub: 'Booking request on the website' },
  { value: 'Facebook',           label: 'Facebook',           sub: 'Facebook page or ads' },
  { value: 'Instagram',          label: 'Instagram',          sub: 'Instagram page or ads' },
  { value: 'TikTok',             label: 'TikTok',             sub: 'TikTok video or ads' },
  { value: 'Google',             label: 'Google',             sub: 'Google search or Maps' },
  { value: 'YouTube',            label: 'YouTube',            sub: 'YouTube channel or ads' },
  { value: 'Word of Mouth',      label: 'Word of mouth',      sub: 'A past customer or friend told them' },
  { value: 'Returning customer', label: 'Returning customer', sub: 'Rented from us before' },
  { value: 'Other',              label: 'Other',              sub: 'Anything else' },
];
const CHANNEL_SET = new Set(CHANNELS.map((c) => c.value.toLowerCase()));

/** Is this text a channel (not a person)? Case doesn't matter. */
export const isChannel = (s?: string) => !!s && CHANNEL_SET.has(s.trim().toLowerCase());

/** The channel as written in the list ("facebook" → "Facebook") */
export const channelName = (s?: string) => CHANNELS.find((c) => c.value.toLowerCase() === (s ?? '').trim().toLowerCase())?.value;

/** How the booking's customer reached us — its channel, or the old channel-in-referral, or undefined (not recorded) */
export const channelOf = (b?: Pick<Booking, 'channel' | 'referral'>) => channelName(b?.channel) ?? channelName(b?.referral);

/** The person who brought the customer, or undefined for Direct / a channel */
export const referrerOf = (referral?: string) => {
  const r = (referral ?? '').trim();
  return !r || r.toLowerCase() === 'direct' || r.toLowerCase() === 'company' || isChannel(r) ? undefined : r;
};

export const nameKey = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

/** "Thisaga" reads better than "THISAGA" or "thisaga" — used to pick between spellings used equally often */
export const looksLikeName = (s: string) => s.trim().split(/\s+/).every((w) => /^[A-Z][^A-Z]*$/.test(w) || !/[a-z]/i.test(w[0] ?? ''));
/** The spelling to keep: used most, then written like a name */
export const bestSpelling = (counts: [string, number][]) =>
  [...counts].sort((a, b) => b[1] - a[1] || Number(looksLikeName(b[0])) - Number(looksLikeName(a[0])))[0][0];

/** One name per person: an owner's own spelling when it matches (any case), otherwise the spelling used most */
export function canonicalNames(names: string[], owners: Pick<Owner, 'name'>[]) {
  const byKey = new Map<string, Map<string, number>>();
  names.forEach((n) => {
    const k = nameKey(n);
    const m = byKey.get(k) ?? new Map<string, number>();
    m.set(n.trim(), (m.get(n.trim()) ?? 0) + 1);
    byKey.set(k, m);
  });
  const out = new Map<string, string>();
  byKey.forEach((spellings, k) => {
    const owner = owners.find((o) => nameKey(o.name) === k);
    const best = owner?.name ?? bestSpelling([...spellings.entries()]);
    out.set(k, best);
  });
  return (n: string) => out.get(nameKey(n)) ?? n.trim();
}

/** Channels where the company found the customer (no person to hold responsible for a credit) */
const MARKETING = new Set(['whatsapp', 'facebook', 'instagram', 'tiktok', 'google', 'youtube', 'website', 'word of mouth']);
export const isMarketingChannel = (s?: string) => !!s && MARKETING.has(s.trim().toLowerCase());
